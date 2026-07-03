import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { buildFinetuneArgs, buildServerArgs } from "./flagBuilder";
import type { AppConfig, ProcessLogLine, ProcessStatus } from "@/config/types";

export type ProcessKind = "server" | "finetune";

export interface StartOptions {
  /** Override the spawn implementation (used by tests to inject stand-in binaries). */
  spawnImpl?: typeof spawn;
  /** Current working directory for the child process. */
  cwd?: string;
  /** Extra environment variables merged into process.env for the child. */
  env?: Record<string, string>;
}

interface ManagedProcess {
  proc: ChildProcess;
  kind: ProcessKind;
  startedAt: number;
  endedAt?: number;
  stderrTail: string[];
  stdoutTail: string[];
  pid?: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  crashed: boolean;
  dead: boolean;
}

export class ProcessStartError extends Error {
  constructor(public scope: string, message: string, public fix: string) {
    super(message);
    this.name = "ProcessStartError";
  }
}

const GRACEFUL_TIMEOUT_MS = 5000;
const TAIL_LINES = 40;

export class ProcessManager extends EventEmitter {
  private managed = new Map<ProcessKind, ManagedProcess>();
  private spawnImpl: typeof spawn;
  private cwd?: string;
  private env?: Record<string, string>;

  constructor(opts: StartOptions = {}) {
    super();
    this.spawnImpl = opts.spawnImpl ?? spawn;
    this.cwd = opts.cwd;
    this.env = opts.env;
  }

  private emitLog(kind: ProcessKind, stream: "stdout" | "stderr", text: string): void {
    const line: ProcessLogLine & { kind: ProcessKind } = { kind, stream, text, ts: Date.now() };
    this.emit("log", line);
  }

  private emitStatus(kind: ProcessKind, status: ProcessStatus): void {
    this.emit("status", { ...status, kind });
  }

  private pushTail(arr: string[], text: string): void {
    arr.push(text);
    if (arr.length > TAIL_LINES) arr.shift();
  }

  startServer(config: AppConfig): Promise<ProcessStatus> {
    return this.start("server", config.binaryPaths.server, buildServerArgs(config));
  }

  startFinetune(config: AppConfig): Promise<ProcessStatus> {
    return this.start("finetune", config.binaryPaths.finetune, buildFinetuneArgs(config));
  }

  private start(kind: ProcessKind, binary: string, args: string[]): Promise<ProcessStatus> {
    const trimmed = (binary ?? "").trim();
    if (!trimmed) {
      const label = kind === "server" ? "server" : "finetune";
      return Promise.reject(
        new ProcessStartError(
          kind,
          `The ${label} binary path is not configured.`,
          `Open Settings and point the ${label} binary field at your llama.cpp ${label} executable.`,
        ),
      );
    }
    if (this.managed.has(kind)) {
      const existing = this.managed.get(kind)!;
      if (existing.proc.exitCode === null && !existing.proc.killed) {
        return Promise.resolve(this.statusOf(kind));
      }
    }

    return new Promise<ProcessStatus>((resolve, reject) => {
      let settled = false;
      let proc: ChildProcess;
      try {
        proc = this.spawnImpl(trimmed, args, {
          cwd: this.cwd,
          env: { ...process.env, ...this.env },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        reject(new ProcessStartError(kind, `Could not launch “${trimmed}”: ${(err as Error).message}`, "Check that the path is correct and executable."));
        return;
      }

      const managed: ManagedProcess = {
        proc,
        kind,
        startedAt: Date.now(),
        stderrTail: [],
        stdoutTail: [],
        pid: proc.pid,
        exitCode: null,
        signal: null,
        crashed: false,
        dead: false,
      };
      this.managed.set(kind, managed);

      const startingStatus: ProcessStatus = { kind, state: "starting", pid: proc.pid, startedAt: managed.startedAt };
      this.emitStatus(kind, startingStatus);

      const lineBuffers = { out: "", err: "" };
      const splitLines = (buf: string, chunk: string): { lines: string[]; rest: string } => {
        const data = buf + chunk;
        const parts = data.split(/\r?\n/);
        const rest = parts.pop() ?? "";
        return { lines: parts, rest };
      };

      proc.stdout?.on("data", (chunk: Buffer) => {
        const { lines, rest } = splitLines(lineBuffers.out, chunk.toString("utf8"));
        lineBuffers.out = rest;
        for (const line of lines) {
          this.pushTail(managed.stdoutTail, line);
          this.emitLog(kind, "stdout", line);
        }
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        const { lines, rest } = splitLines(lineBuffers.err, chunk.toString("utf8"));
        lineBuffers.err = rest;
        for (const line of lines) {
          this.pushTail(managed.stderrTail, line);
          this.emitLog(kind, "stderr", line);
        }
      });

      proc.once("error", (err: NodeJS.ErrnoException) => {
        settled = true;
        managed.crashed = true;
        managed.dead = true;
        managed.endedAt = Date.now();
        if (err.code === "ENOENT") {
          reject(
            new ProcessStartError(
              kind,
              `The ${kind} binary was not found at “${trimmed}”.`,
              "Open Settings and pick the correct llama.cpp binary path.",
            ),
          );
        } else {
          reject(new ProcessStartError(kind, `Failed to start the ${kind} binary: ${err.message}`, "Check permissions and path, then try again."));
        }
        const status: ProcessStatus = { kind, state: "exited", pid: managed.pid, exitCode: null, startedAt: managed.startedAt, endedAt: Date.now() };
        this.emitStatus(kind, status);
      });

      proc.once("spawn", () => {
        settled = true;
        managed.pid = proc.pid;
        const status: ProcessStatus = { kind, state: "running", pid: proc.pid, startedAt: managed.startedAt };
        this.emitStatus(kind, status);
        resolve(status);
      });

      proc.once("close", (code, signal) => {
        const wasRunning = !managed.dead && managed.exitCode === null;
        managed.exitCode = code;
        managed.signal = signal as NodeJS.Signals | null;
        managed.endedAt = Date.now();
        managed.dead = true;
        managed.crashed = wasRunning && code !== null && code !== 0;
        const flush = (buf: string, stream: "stdout" | "stderr") => {
          if (buf.length > 0) {
            this.pushTail(stream === "stderr" ? managed.stderrTail : managed.stdoutTail, buf);
            this.emitLog(kind, stream, buf);
          }
        };
        flush(lineBuffers.out, "stdout");
        flush(lineBuffers.err, "stderr");
        const status: ProcessStatus = {
          kind,
          state: "exited",
          pid: managed.pid,
          exitCode: code,
          startedAt: managed.startedAt,
          endedAt: Date.now(),
        };
        this.emitStatus(kind, status);
        if (!settled) {
          settled = true;
          reject(
            new ProcessStartError(
              kind,
              `The ${kind} binary exited with code ${code === null ? "null" : code} before it finished starting.`,
              "Check the binary, model path, and flags, then try again.",
            ),
          );
        }
      });
    });
  }

  async stop(kind: ProcessKind): Promise<ProcessStatus> {
    const managed = this.managed.get(kind);
    if (!managed || managed.exitCode !== null || managed.dead) {
      const status: ProcessStatus = { kind, state: "stopped" };
      this.emitStatus(kind, status);
      return status;
    }
    const proc = managed.proc;
    return new Promise<ProcessStatus>((resolve) => {
      let resolved = false;
      const finish = (status: ProcessStatus) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        this.emitStatus(kind, status);
        resolve(status);
      };
      proc.once("exit", (code, signal) => {
        managed.exitCode = code;
        managed.signal = signal as NodeJS.Signals | null;
        managed.endedAt = Date.now();
        managed.dead = true;
        finish({ kind, state: "exited", pid: managed.pid, exitCode: code, startedAt: managed.startedAt, endedAt: Date.now() });
      });
      try {
        proc.kill("SIGTERM");
      } catch {
        finish({ kind, state: "exited", pid: managed.pid, exitCode: managed.exitCode, startedAt: managed.startedAt, endedAt: Date.now() });
      }
      const timer = setTimeout(() => {
        if (!resolved && proc.exitCode === null) {
          try {
            proc.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
      }, GRACEFUL_TIMEOUT_MS);
    });
  }

  statusOf(kind: ProcessKind): ProcessStatus {
    const managed = this.managed.get(kind);
    if (!managed) return { kind, state: "stopped" };
    if (managed.dead || managed.exitCode !== null) {
      return { kind, state: "exited", pid: managed.pid, exitCode: managed.exitCode, startedAt: managed.startedAt, endedAt: managed.endedAt };
    }
    return { kind, state: "running", pid: managed.pid, startedAt: managed.startedAt };
  }

  isRunning(kind: ProcessKind): boolean {
    const managed = this.managed.get(kind);
    return Boolean(managed && !managed.dead && managed.exitCode === null && managed.pid !== undefined);
  }

  getPid(kind: ProcessKind): number | undefined {
    return this.managed.get(kind)?.pid;
  }

  getStderrTail(kind: ProcessKind, count = 20): string {
    const arr = this.managed.get(kind)?.stderrTail ?? [];
    return arr.slice(-count).join("\n");
  }

  getStdoutTail(kind: ProcessKind, count = 20): string {
    const arr = this.managed.get(kind)?.stdoutTail ?? [];
    return arr.slice(-count).join("\n");
  }
}
