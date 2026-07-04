// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type Server, get as httpGetRaw } from "node:http";
import { existsSync } from "node:fs";
import { Backend, CommandError } from "@/ipc/backend";
import { defaultConfig } from "@/config/defaults";
import {
  makeBackend,
  mkTempDir,
  rmrf,
  makeGguf,
  makeFile,
  join,
  FAKE_SERVER,
  FAKE_FINETUNE,
  type BackendHarness,
} from "./helpers/backendHarness";
import type { AppConfig, SystemMetrics } from "@/config/types";

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
        reject(new Error("no port"));
      }
    });
    s.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPERM" || err.code === "EACCES") resolve(null);
      else reject(err);
    });
  });
}

async function httpGet(url: string, timeoutMs = 4000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("http timeout")), timeoutMs);
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

async function startMetricsServer(bodies: string[], slotsBody = JSON.stringify([{ n_prompt_tokens: 35935, n_ctx: 98304 }])): Promise<{ port: number; close: () => Promise<void> } | null> {
  const port = await getFreePort();
  if (port === null) return null;
  let index = 0;
  const server = createServer((req, res) => {
    if (req.url === "/slots") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(slotsBody);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(bodies[Math.min(index, bodies.length - 1)] ?? "");
    index += 1;
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function waitFor<T>(fn: () => T | Promise<T>, predicate: (v: T) => boolean, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (predicate(value)) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out (${timeoutMs}ms)`);
    await new Promise((r) => setTimeout(r, 30));
  }
}

const harnesses: BackendHarness[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.cleanup();
  for (const d of dirs.splice(0)) await rmrf(d);
});

function withFakeBinary(over: Partial<AppConfig> = {}, env: Record<string, string> = {}): Promise<BackendHarness> {
  return makeBackend({ config: over, env });
}

describe("backend config & binary commands", () => {
  it("loads and saves config", async () => {
    const h = await withFakeBinary();
    harnesses.push(h);
    const config = (await h.backend.handle("config.load")) as AppConfig;
    config.server.port = 9999;
    const saved = (await h.backend.handle("config.save", { config })) as AppConfig;
    expect(saved.server.port).toBe(9999);
    expect((await h.backend.handle("config.load") as AppConfig).server.port).toBe(9999);
  });

  it("persists binary paths across a reopen (new backend instance)", async () => {
    const h = await withFakeBinary();
    harnesses.push(h);
    const config = (await h.backend.handle("config.load")) as AppConfig;
    config.binaryPaths.server = "";
    config.binaryPaths.finetune = "";
    await h.backend.handle("config.save", { config });

    const updated = (await h.backend.handle("binary.set", { server: FAKE_SERVER, finetune: FAKE_FINETUNE })) as AppConfig;
    expect(updated.binaryPaths.server).toBe(FAKE_SERVER);

    const reopened = new Backend({ configStore: h.backend.configStore, processManager: h.backend.processManager, monitor: h.backend.monitor, errorLog: h.backend.errorLog });
    const reloaded = (await reopened.handle("config.load")) as AppConfig;
    expect(reloaded.binaryPaths.server).toBe(FAKE_SERVER);
    expect(reloaded.binaryPaths.finetune).toBe(FAKE_FINETUNE);
  });

  it("applies an agent runtime profile to persisted llama.cpp flags", async () => {
    const h = await withFakeBinary();
    harnesses.push(h);
    const updated = (await h.backend.handle("runtime.applyProfile", { profileId: "3090-ti-qwen-3-6-27b-96k-coder" })) as AppConfig;
    expect(updated.agentRuntime.activeProfileId).toBe("3090-ti-qwen-3-6-27b-96k-coder");
    expect(updated.agentRuntime.gateway.modelAlias).toBe("atlas/3090-ti-qwen-3-6-27b-96k-coder");
    expect(updated.serverFlags["ctx-size"]).toBe(98304);
    expect(updated.model.selectedModel).toBe("/home/reid/Downloads/Qwen3.6-27B-Q4_K_M.gguf");
    expect(updated.serverFlags["ubatch-size"]).toBe(256);
    expect(updated.serverFlags.metrics).toBe(true);

    const reloaded = (await h.backend.handle("config.load")) as AppConfig;
    expect(reloaded.agentRuntime.activeProfileId).toBe("3090-ti-qwen-3-6-27b-96k-coder");
    expect(reloaded.serverFlags["ctx-size"]).toBe(98304);
  });

  it("derives live tokens/sec from llama.cpp counters instead of the historical average gauge", async () => {
    const metricsServer = await startMetricsServer([
      [
        "llamacpp:tokens_predicted_total 100",
        "llamacpp:tokens_predicted_seconds_total 10",
        "llamacpp:prompt_tokens_total 50",
        "llamacpp:prompt_seconds_total 5",
        "llamacpp:predicted_tokens_seconds 114.7",
        "llamacpp:prompt_tokens_seconds 1200",
        "llamacpp:requests_processing 0",
        "llamacpp:requests_deferred 0",
      ].join("\n"),
      [
        "llamacpp:tokens_predicted_total 100",
        "llamacpp:tokens_predicted_seconds_total 10",
        "llamacpp:prompt_tokens_total 50",
        "llamacpp:prompt_seconds_total 5",
        "llamacpp:predicted_tokens_seconds 114.7",
        "llamacpp:prompt_tokens_seconds 1200",
        "llamacpp:requests_processing 1",
        "llamacpp:requests_deferred 0",
      ].join("\n"),
      [
        "llamacpp:tokens_predicted_total 140",
        "llamacpp:tokens_predicted_seconds_total 12",
        "llamacpp:prompt_tokens_total 50",
        "llamacpp:prompt_seconds_total 5",
        "llamacpp:predicted_tokens_seconds 114.7",
        "llamacpp:prompt_tokens_seconds 1200",
        "llamacpp:requests_processing 1",
        "llamacpp:requests_deferred 0",
      ].join("\n"),
      [
        "llamacpp:tokens_predicted_total 140",
        "llamacpp:tokens_predicted_seconds_total 12",
        "llamacpp:prompt_tokens_total 50",
        "llamacpp:prompt_seconds_total 5",
        "llamacpp:predicted_tokens_seconds 114.7",
        "llamacpp:prompt_tokens_seconds 1200",
        "llamacpp:requests_processing 0",
        "llamacpp:requests_deferred 0",
      ].join("\n"),
    ]);
    if (metricsServer === null) return;
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000).mockReturnValueOnce(6000).mockReturnValueOnce(7000);
    try {
      const h = await withFakeBinary({ server: { host: "127.0.0.1", port: metricsServer.port } });
      harnesses.push(h);

      const first = (await h.backend.handle("monitor.collect", { pids: [] })) as SystemMetrics;
      const activePending = (await h.backend.handle("monitor.collect", { pids: [] })) as SystemMetrics;
      const active = (await h.backend.handle("monitor.collect", { pids: [] })) as SystemMetrics;
      const idle = (await h.backend.handle("monitor.collect", { pids: [] })) as SystemMetrics;

      expect(first.runtime?.averageGenerationTokensPerSecond).toBe(114.7);
      expect(first.runtime?.generationTokensPerSecond).toBeUndefined();
      expect(activePending.runtime?.generationTokensPerSecond).toBe(0);
      expect(active.runtime?.generationTokensPerSecond).toBe(8);
      expect(idle.runtime?.generationTokensPerSecond).toBe(0);
      expect(active.runtime?.averageGenerationTokensPerSecond).toBe(114.7);
      expect(active.runtime?.contextTokens).toBe(35935);
      expect(active.runtime?.contextWindowTokens).toBe(98304);
    } finally {
      nowSpy.mockRestore();
      await metricsServer.close();
    }
  });

  it("rejects a nonexistent binary path with a plain-language error", async () => {
    const h = await withFakeBinary();
    harnesses.push(h);
    await expect(h.backend.handle("binary.set", { server: "/no/such/binary", finetune: FAKE_FINETUNE })).rejects.toThrow();
    try {
      await h.backend.handle("binary.set", { server: "/no/such/binary", finetune: FAKE_FINETUNE });
    } catch (err) {
      expect(err).toBeInstanceOf(CommandError);
      expect((err as CommandError).message).toMatch(/not found/i);
    }
  });
});

describe("backend model listing", () => {
  it("lists .gguf files in a valid directory", async () => {
    const dir = await mkTempDir();
    dirs.push(dir);
    await makeGguf(dir, "alpha.gguf");
    await makeGguf(dir, "beta.gguf");
    await makeFile(dir, "not-a-model.txt");
    const h = await withFakeBinary();
    harnesses.push(h);
    const result = (await h.backend.handle("model.list", { directory: dir })) as { files: string[] };
    expect(result.files).toEqual(["alpha.gguf", "beta.gguf"]);
  });

  it("reports a message for an empty directory", async () => {
    const dir = await mkTempDir();
    dirs.push(dir);
    const h = await withFakeBinary();
    harnesses.push(h);
    const result = (await h.backend.handle("model.list", { directory: dir })) as { files: string[]; message?: string };
    expect(result.files).toEqual([]);
    expect(result.message).toMatch(/no .gguf files/i);
  });

  it("errors on a nonexistent directory", async () => {
    const h = await withFakeBinary();
    harnesses.push(h);
    await expect(h.backend.handle("model.list", { directory: "/no/such/dir" })).rejects.toThrow();
    try {
      await h.backend.handle("model.list", { directory: "/no/such/dir" });
    } catch (err) {
      expect((err as CommandError).message).toMatch(/could not read|not found|directory/i);
    }
  });
});

describe("backend server start/stop with a real child process", () => {
  it("starts the server, responds on the port, streams logs, and stops", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const h = await withFakeBinary({ server: { host: "127.0.0.1", port } });
    harnesses.push(h);
    const config = (await h.backend.handle("config.load")) as AppConfig;
    config.server = { host: "127.0.0.1", port };

    const logs: string[] = [];
    h.backend.on("log", (line: { text: string }) => logs.push(line.text));

    const status = (await h.backend.handle("server.start", { config })) as { state: string; pid?: number };
    expect(status.state).toBe("running");
    expect(status.pid).toBeGreaterThan(0);

    await waitFor(() => logs.some((l) => /listening/.test(l)), (v) => v, 5000);
    const res = await httpGet(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);

    const stopped = (await h.backend.handle("server.stop")) as { state: string };
    expect(stopped.state).toBe("exited");
    await waitFor(() => !h.backend.processManager.isRunning("server"), (v) => v, 4000);
  });

  it("errors with a plain-language message when the model file is missing", async () => {
    const h = await withFakeBinary({ model: { directory: "/m", selectedModel: "/m/missing.gguf" } });
    harnesses.push(h);
    const config = (await h.backend.handle("config.load")) as AppConfig;
    config.model.selectedModel = "/m/missing.gguf";
    try {
      await h.backend.handle("server.start", { config });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as CommandError).message).toMatch(/not found/i);
    }
  });
});

describe("backend Atlas Gateway commands", () => {
  it("starts and stops the gateway through backend commands", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const gatewayPort = await getFreePort();
    if (gatewayPort === null) return;
    const h = await withFakeBinary({
      server: { host: "127.0.0.1", port },
      agentRuntime: {
        ...defaultConfig().agentRuntime,
        gateway: { ...defaultConfig().agentRuntime.gateway, port: gatewayPort },
      },
    });
    harnesses.push(h);

    const started = (await h.backend.handle("gateway.start")) as { running: boolean; port: number };
    expect(started.running).toBe(true);
    expect(started.port).toBe(gatewayPort);

    const status = (await h.backend.handle("gateway.status")) as { running: boolean };
    expect(status.running).toBe(true);

    const stopped = (await h.backend.handle("gateway.stop")) as { running: boolean };
    expect(stopped.running).toBe(false);
  });

  it("reports an externally managed gateway as running", async () => {
    const gatewayPort = await getFreePort();
    if (gatewayPort === null) return;
    const external = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        gateway: {
          running: true,
          host: "0.0.0.0",
          port: gatewayPort,
          upstream: "http://127.0.0.1:8099",
          modelAlias: "atlas/external",
          activeProfileId: "external-profile",
          requestCount: 7,
          rejectedCount: 1,
          compressedCount: 2,
        },
      }));
    });
    await new Promise<void>((resolve, reject) => {
      external.once("error", reject);
      external.listen(gatewayPort, "127.0.0.1", () => resolve());
    });
    const h = await withFakeBinary({
      agentRuntime: {
        ...defaultConfig().agentRuntime,
        gateway: { ...defaultConfig().agentRuntime.gateway, host: "0.0.0.0", port: gatewayPort },
      },
    });
    harnesses.push(h);
    try {
      const status = (await h.backend.handle("gateway.status")) as { running: boolean; external?: boolean; requestCount: number };
      expect(status.running).toBe(true);
      expect(status.external).toBe(true);
      expect(status.requestCount).toBe(7);

      const started = (await h.backend.handle("gateway.start")) as { running: boolean; external?: boolean };
      expect(started.running).toBe(true);
      expect(started.external).toBe(true);
    } finally {
      await new Promise<void>((resolve) => external.close(() => resolve()));
    }
  });
});

describe("backend fine-tuning", () => {
  it("runs training to completion and verifies the output model file exists", async () => {
    const dir = await mkTempDir();
    dirs.push(dir);
    const outPath = join(dir, "trained.bin");
    const dataset = await makeFile(dir, "data.jsonl", false, '{"text":"hello"}');
    const h = await withFakeBinary({ finetune: { "lora-out": outPath, "train-data": dataset, epochs: 1 } }, { FAKE_FINETUNE_DELAY_MS: "10" });
    harnesses.push(h);
    const config = (await h.backend.handle("config.load")) as AppConfig;
    config.finetune["lora-out"] = outPath;
    config.finetune["train-data"] = dataset;
    config.finetune["epochs"] = 1;

    const complete = new Promise<{ exists: boolean; outputPath: string }>((resolve) => {
      h.backend.once("training-complete", (p) => resolve(p as { exists: boolean; outputPath: string }));
    });

    const status = (await h.backend.handle("training.start", { config })) as { state: string };
    expect(status.state).toBe("running");
    const payload = await complete;
    expect(payload.exists).toBe(true);
    expect(existsSync(outPath)).toBe(true);
  });

  it("errors with a plain-language message when the dataset is missing", async () => {
    const h = await withFakeBinary({ finetune: { "train-data": "/no/such/data.jsonl" } });
    harnesses.push(h);
    const config = (await h.backend.handle("config.load")) as AppConfig;
    config.finetune["train-data"] = "/no/such/data.jsonl";
    try {
      await h.backend.handle("training.start", { config });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as CommandError).message).toMatch(/dataset/i);
    }
  });

  it("stop terminates the training process", async () => {
    const dir = await mkTempDir();
    dirs.push(dir);
    const outPath = join(dir, "trained-stop.bin");
    const dataset = await makeFile(dir, "data.jsonl", false, "{}");
    const h = await withFakeBinary({ finetune: { "lora-out": outPath, "train-data": dataset, epochs: 100 } }, { FAKE_FINETUNE_DELAY_MS: "200" });
    harnesses.push(h);
    const config = (await h.backend.handle("config.load")) as AppConfig;
    config.finetune["lora-out"] = outPath;
    config.finetune["train-data"] = dataset;
    config.finetune["epochs"] = 100;
    await h.backend.handle("training.start", { config });
    expect(h.backend.processManager.isRunning("finetune")).toBe(true);
    const stopped = (await h.backend.handle("training.stop")) as { state: string };
    expect(stopped.state).toBe("exited");
    expect(h.backend.processManager.isRunning("finetune")).toBe(false);
  });
});

describe("backend monitor and error log", () => {
  it("collects metrics and reports GPU not detected", async () => {
    const h = await withFakeBinary();
    harnesses.push(h);
    const metrics = (await h.backend.handle("monitor.collect", { pids: [] })) as { gpu: { detected: boolean; note?: string }; cpu: { perCore: number[] } };
    expect(metrics.gpu.detected).toBe(false);
    expect(metrics.cpu.perCore.length).toBeGreaterThan(0);
  });

  it("appends errors to the on-disk error log", async () => {
    const h = await withFakeBinary();
    harnesses.push(h);
    await h.backend.handle("error.log", {
      error: { id: "e1", ts: Date.now(), scope: "test", title: "boom", message: "it broke", fix: "restart" },
    });
    const log = await h.backend.errorLog.read();
    expect(log).toMatch(/boom/);
  });
});

describe("backend external crash surfaces an error event", () => {
  it("emits an error event with exit code when the server crashes", async () => {
    const h = await withFakeBinary({}, { FAKE_SERVER_MODE: "crash" });
    harnesses.push(h);
    const config = (await h.backend.handle("config.load")) as AppConfig;

    const errorEvent = new Promise<{ exitCode: number | null }>((resolve) => {
      h.backend.on("error", (e: { exitCode: number | null }) => resolve({ exitCode: e.exitCode ?? null }));
    });

    try {
      await h.backend.handle("server.start", { config });
    } catch {
      // start rejects on crash
    }
    const evt = await errorEvent;
    expect(evt.exitCode).toBe(137);
  });
});
