// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { createServer, type Server, get as httpGetRaw } from "node:http";
import { PassThrough } from "node:stream";
import type { ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { ProcessManager } from "@/process/processManager";
import { defaultConfig } from "@/config/defaults";
import { existsSync } from "node:fs";
import { FAKE_SERVER, FAKE_FINETUNE, mkTempDir, rmrf, join } from "./helpers/backendHarness";
import type { AppConfig, ProcessLogLine } from "@/config/types";

function cfg(over: Partial<AppConfig> = {}, env: Record<string, string> = {}): { config: AppConfig; env: Record<string, string> } {
  const base = defaultConfig();
  base.binaryPaths = { server: FAKE_SERVER, finetune: FAKE_FINETUNE };
  return {
    config: {
      ...base,
      ...over,
      server: { ...base.server, ...(over.server ?? {}) },
      model: { ...base.model, ...(over.model ?? {}) },
      serverFlags: { ...base.serverFlags, ...(over.serverFlags ?? {}) },
      finetune: { ...base.finetune, ...(over.finetune ?? {}) },
    },
    env,
  };
}

async function getFreePort(): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const s: Server = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        s.close(() => resolve(port));
      } else {
        s.close();
        reject(new Error("could not get port"));
      }
    });
    s.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPERM" || err.code === "EACCES") resolve(null);
      else reject(err);
    });
  });
}

function mockSpawn(opts: { stdout?: string[]; stderr?: string[]; exitCode?: number | null; delayMs?: number; stayRunning?: boolean } = {}): typeof nodeSpawn {
  return (() => {
    const child = new EventEmitter() as ChildProcess;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const mutable = child as unknown as { killed: boolean; exitCode: number | null; signalCode: NodeJS.Signals | null };
    Object.defineProperties(child, {
      stdout: { value: stdout },
      stderr: { value: stderr },
      stdin: { value: null },
      stdio: { value: [null, stdout, stderr, null, null] as ChildProcess["stdio"] },
      pid: { value: 4242 },
      killed: { value: false, writable: true },
      exitCode: { value: null, writable: true },
      signalCode: { value: null, writable: true },
    });
    Object.defineProperty(child, "kill", {
      value: ((signal?: NodeJS.Signals | number) => {
        mutable.killed = true;
        mutable.signalCode = typeof signal === "string" ? signal : "SIGTERM";
        setTimeout(() => {
          child.emit("exit", null, mutable.signalCode);
          stdout.end();
          stderr.end();
          child.emit("close", null, mutable.signalCode);
        }, 0);
      return true;
      }) as ChildProcess["kill"],
    });

    setTimeout(() => {
      child.emit("spawn");
      for (const line of opts.stdout ?? []) stdout.write(line);
      for (const line of opts.stderr ?? []) stderr.write(line);
      if (!opts.stayRunning) {
        mutable.exitCode = opts.exitCode ?? 0;
        child.emit("exit", mutable.exitCode, null);
        stdout.end();
        stderr.end();
        child.emit("close", mutable.exitCode, null);
      }
    }, opts.delayMs ?? 0);

    return child;
  }) as typeof nodeSpawn;
}

async function httpGet(url: string, timeoutMs = 3000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HTTP timeout for ${url}`)), timeoutMs);
    const req = httpGetRaw(url, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString()));
      res.on("end", () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function waitFor<T>(fn: () => T | Promise<T>, predicate: (v: T) => boolean, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (predicate(value)) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 30));
  }
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe("ProcessManager server lifecycle", () => {
  it("starts the server, streams logs, responds on the port, and stops", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const { config, env } = cfg({ server: { host: "127.0.0.1", port } });
    const pm = new ProcessManager({ env });
    const logs: ProcessLogLine[] = [];
    pm.on("log", (line) => logs.push(line));

    const status = await pm.startServer(config);
    expect(status.state).toBe("running");
    expect(status.pid).toBeGreaterThan(0);

    await waitFor(() => logs.some((l) => /listening/.test(l.text)), (v) => v, 5000);

    const res = await httpGet(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/ok/);

    const stopped = await pm.stop("server");
    expect(stopped.state).toBe("exited");
    await waitFor(() => !pm.isRunning("server"), (v) => v, 3000);
  });

  it("disables Start when running and Stop when not running via status", async () => {
    const { config } = cfg();
    const pm = new ProcessManager({ spawnImpl: mockSpawn({ stayRunning: true }) });
    expect(pm.statusOf("server").state).toBe("stopped");
    await pm.startServer(config);
    expect(pm.isRunning("server")).toBe(true);
    await pm.stop("server");
    expect(pm.isRunning("server")).toBe(false);
  });

  it("reports a crash with the exit code and stderr", async () => {
    const { config } = cfg();
    const pm = new ProcessManager({ spawnImpl: mockSpawn({ stderr: ["fatal: simulated crash before binding\n"], exitCode: 137 }) });
    const statuses: string[] = [];
    pm.on("status", (s) => statuses.push(s.state));

    try {
      await pm.startServer(config);
    } catch {
      // some crashes reject the start promise before spawn resolves
    }
    await waitFor(() => pm.statusOf("server").state === "exited", (v) => v, 4000);
    const status = pm.statusOf("server");
    expect(status.exitCode).toBe(137);
    expect(pm.getStderrTail("server")).toMatch(/crash/);
  });

  it("detects a port-in-use failure via stderr", async () => {
    const { config } = cfg();
    const pm = new ProcessManager({ spawnImpl: mockSpawn({ stderr: ["listen: bind: address already in use\n"], exitCode: 1 }) });
    try {
      await pm.startServer(config);
    } catch {
      // expected to reject or exit
    }
    await waitFor(() => pm.statusOf("server").state === "exited", (v) => v, 4000);
    expect(pm.getStderrTail("server")).toMatch(/address already in use/i);
  });

  it("rejects start when the binary path is empty", async () => {
    const pm = new ProcessManager({});
    const { config } = cfg();
    config.binaryPaths.server = "";
    await expect(pm.startServer(config)).rejects.toThrow(/not configured/i);
  });
});

describe("ProcessManager fine-tuning lifecycle", () => {
  it("runs training to completion and writes the output model file", async () => {
    const dir = await mkTempDir();
    cleanups.push(() => rmrf(dir));
    const outPath = join(dir, "trained.bin");
    const { config } = cfg({ finetune: { "lora-out": outPath, epochs: 1, "train-data": "/data.jsonl" } });
    const pm = new ProcessManager({ env: { FAKE_FINETUNE_DELAY_MS: "10" } });
    const logs: ProcessLogLine[] = [];
    pm.on("log", (line) => logs.push(line));

    const status = await pm.startFinetune(config);
    expect(status.state).toBe("running");
    await waitFor(() => pm.statusOf("finetune").state === "exited", (v) => v, 5000);
    expect(pm.statusOf("finetune").exitCode).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    if (logs.length > 0) expect(logs.some((l) => /training complete/.test(l.text))).toBe(true);
  });

  it("captures child stdout and stderr before publishing exited status", async () => {
    const { config } = cfg();
    const pm = new ProcessManager({
      spawnImpl: mockSpawn({
        stdout: ["training step 1/1\n", "training complete\n"],
        stderr: ["warning: low vram\n"],
        exitCode: 2,
      }),
    });
    const logs: ProcessLogLine[] = [];
    pm.on("log", (line) => logs.push(line));

    await pm.startFinetune(config);
    await waitFor(() => pm.statusOf("finetune").state === "exited", (v) => v, 4000);

    expect(logs.some((l) => l.stream === "stdout" && /training complete/.test(l.text))).toBe(true);
    expect(pm.getStderrTail("finetune")).toMatch(/low vram/);
    expect(pm.statusOf("finetune").exitCode).toBe(2);
  });

  it("stop terminates the finetune process", async () => {
    const dir = await mkTempDir();
    cleanups.push(() => rmrf(dir));
    const outPath = join(dir, "trained-stop.bin");
    const { config } = cfg({ finetune: { "lora-out": outPath, epochs: 100, "train-data": "/data.jsonl" } });
    const pm = new ProcessManager({ env: { FAKE_FINETUNE_DELAY_MS: "200" } });
    await pm.startFinetune(config);
    expect(pm.isRunning("finetune")).toBe(true);
    const stopped = await pm.stop("finetune");
    expect(stopped.state).toBe("exited");
    expect(pm.isRunning("finetune")).toBe(false);
  });

  it("reports a finetune failure with exit code and stderr", async () => {
    const { config } = cfg({ finetune: { "train-data": "/data.jsonl" } });
    const pm = new ProcessManager({ spawnImpl: mockSpawn({ stderr: ["training error: dataset format invalid\n"], exitCode: 2 }) });
    try {
      await pm.startFinetune(config);
    } catch {
      // expected
    }
    await waitFor(() => pm.statusOf("finetune").state === "exited", (v) => v, 4000);
    expect(pm.statusOf("finetune").exitCode).toBe(2);
    expect(pm.getStderrTail("finetune")).toMatch(/dataset format invalid/);
  });
});
