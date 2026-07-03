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

  private emitLog(kind: ProcessKind, stream: "stdout" | "stderr", text: string, replaceKey?: string): void {
    const line: ProcessLogLine & { kind: ProcessKind } = { kind, stream, text, ts: Date.now(), replaceKey };
    this.emit("log", line);
  }

  private emitStatus(kind: ProcessKind, status: ProcessStatus): void {
    this.emit("status", { ...status, kind });
  }

  private pushTail(arr: string[], text: string): void {
    arr.push(text);
    if (arr.length > TAIL_LINES) arr.shift();
  }

  private modelLoadingProgressText(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed.includes("%")) return null;
    const lower = trimmed.toLowerCase();
    if (!/(load|tensor|model|gguf|llama_model)/.test(lower)) return null;
    const match = trimmed.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 0 || value > 100) return null;
    return `Model loading: ${match[1]}%...`;
  }

  private modelLoadingStageText(text: string): string | null {
    const lower = text.toLowerCase();
    if (lower.includes("load_model: loading model") || lower.includes("loading model '")) return "Model loading: opening model file...";
    if (lower.includes("loaded meta data") || (lower.includes("llama_model_loader") && lower.includes("metadata"))) return "Model loading: reading GGUF metadata...";
    if (lower.includes("loading model tensors") || lower.includes("load_tensors")) return "Model loading: loading tensors...";
    if (lower.includes("offloading") || lower.includes("assigned to device")) return "Model loading: assigning layers to GPU...";
    if (lower.includes("initializing, n_slots") || lower.includes("llama_context")) return "Model loading: initializing context...";
    if (lower.includes("model loaded")) return "Model loading: ready.";
    return null;
  }

  private emitProcessFragment(managed: ManagedProcess, stream: "stdout" | "stderr", text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const tail = stream === "stderr" ? managed.stderrTail : managed.stdoutTail;
    this.pushTail(tail, trimmed);
    if (managed.kind === "server") {
      const progress = this.modelLoadingProgressText(trimmed);
      if (progress) {
        this.emitLog(managed.kind, stream, progress, "server:model-loading");
        return;
      }
      const stage = this.modelLoadingStageText(trimmed);
      if (stage) {
        this.emitLog(managed.kind, stream, trimmed);
        this.emitLog(managed.kind, "stdout", stage, "server:model-loading");
        return;
      }
    }
    this.emitLog(managed.kind, stream, trimmed);
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
      const splitFragments = (buf: string, chunk: string): { fragments: string[]; rest: string } => {
        const data = buf + chunk;
        const fragments: string[] = [];
        let start = 0;
        for (let i = 0; i < data.length; i += 1) {
          if (data[i] === "\n" || data[i] === "\r") {
            if (i > start) fragments.push(data.slice(start, i));
            start = i + 1;
          }
        }
        return { fragments, rest: data.slice(start) };
      };

      proc.stdout?.on("data", (chunk: Buffer) => {
        const { fragments, rest } = splitFragments(lineBuffers.out, chunk.toString("utf8"));
        lineBuffers.out = rest;
        for (const fragment of fragments) this.emitProcessFragment(managed, "stdout", fragment);
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        const { fragments, rest } = splitFragments(lineBuffers.err, chunk.toString("utf8"));
        lineBuffers.err = rest;
        for (const fragment of fragments) this.emitProcessFragment(managed, "stderr", fragment);
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
        if (lineBuffers.out) this.emitProcessFragment(managed, "stdout", lineBuffers.out);
        if (lineBuffers.err) this.emitProcessFragment(managed, "stderr", lineBuffers.err);
        lineBuffers.out = "";
        lineBuffers.err = "";
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
