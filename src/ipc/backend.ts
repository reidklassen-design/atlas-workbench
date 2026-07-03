import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { ConfigStore, createConfigStore } from "@/config/configStore";
import { validateBinary, type BinaryValidationResult } from "@/config/binaryValidation";
import { defaultConfig } from "@/config/defaults";
import { ProcessManager, ProcessStartError, type ProcessKind } from "@/process/processManager";
import { SystemMonitor } from "@/monitor/systemMonitor";
import { createErrorLog, ErrorLog } from "@/errors/errorLog";
import {
  fromDirectoryError,
  fromGeneric,
  fromInvalidDataset,
  fromMissingFile,
  fromProcessExit,
  fromProcessStartError,
  isPortInUse,
} from "@/errors/errorMapper";
import type { AppConfig, AppError, ProcessLogLine, ProcessStatus } from "@/config/types";

export class CommandError extends Error {
  constructor(
    public scope: string,
    public title: string,
    message: string,
    public fix: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export interface BackendOptions {
  configStore?: ConfigStore;
  processManager?: ProcessManager;
  monitor?: SystemMonitor;
  errorLog?: ErrorLog;
}

export interface ListModelsResult {
  directory: string;
  files: string[];
  error?: string;
  message?: string;
}

export interface TrainingCompletePayload {
  outputPath: string;
  exists: boolean;
  exitCode: number | null;
}

export class Backend extends EventEmitter {
  readonly configStore: ConfigStore;
  readonly processManager: ProcessManager;
  readonly monitor: SystemMonitor;
  readonly errorLog: ErrorLog;
  private stopping = new Map<string, boolean>();

  constructor(opts: BackendOptions = {}) {
    super();
    this.configStore = opts.configStore ?? createConfigStore();
    this.processManager = opts.processManager ?? new ProcessManager();
    this.monitor = opts.monitor ?? new SystemMonitor();
    this.errorLog = opts.errorLog ?? createErrorLog();

    this.processManager.on("log", (line: ProcessLogLine & { kind: ProcessKind }) => this.emit("log", line));
    this.processManager.on("status", (status: ProcessStatus) => this.handleProcessStatus(status));
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      const stat = await fs.stat(path);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private async handleProcessStatus(status: ProcessStatus): Promise<void> {
    this.emit("status", status);
    if (status.state !== "exited") return;
    const kind = status.kind;
    const userStopped = this.stopping.get(kind) === true;
    this.stopping.set(kind, false);

    const stderrTail = this.processManager.getStderrTail(kind);
    const wasCrash = !userStopped && (kind === "server" || (status.exitCode !== null ? status.exitCode !== 0 : true));

    if (wasCrash) {
      const error = fromProcessExit(kind, kind, status.exitCode ?? null, stderrTail);
      await this.recordError(error);
      this.emitSafeError(error);
    } else if (kind === "finetune" && status.exitCode === 0) {
      const config = await this.configStore.load();
      const outputPath = String(config.finetune["lora-out"] ?? "");
      const exists = outputPath ? await this.fileExists(outputPath) : false;
      const payload: TrainingCompletePayload = { outputPath, exists, exitCode: status.exitCode };
      this.emit("training-complete", payload);
    }
  }

  private async recordError(error: AppError): Promise<void> {
    try {
      await this.errorLog.append(error);
    } catch {
      // logging must never mask the original error
    }
  }

  private emitSafeError(error: AppError): void {
    if (this.listenerCount("error") > 0) {
      this.emit("error", error);
    }
  }

  async handle(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
    switch (cmd) {
      case "config.load":
        return this.configStore.load();
      case "config.reset":
        return defaultConfig();
      case "config.save": {
        const config = args.config as AppConfig;
        await this.configStore.save(config);
        return this.configStore.load();
      }
      case "binary.validate":
        return validateBinary(String(args.path ?? ""));
      case "binary.set": {
        const config = await this.configStore.load();
        const server = args.server !== undefined ? String(args.server) : config.binaryPaths.server;
        const finetune = args.finetune !== undefined ? String(args.finetune) : config.binaryPaths.finetune;
        const results = await Promise.all<BinaryValidationResult>([
          server ? validateBinary(server) : Promise.resolve({ path: server, ok: true }),
          finetune ? validateBinary(finetune) : Promise.resolve({ path: finetune, ok: true }),
        ]);
        const failed = results.find((r) => !r.ok);
        if (failed) {
          throw new CommandError("binary-config", "Invalid binary path", failed.reason ?? "The selected path is not valid.", "Choose an executable file and try again.");
        }
        const updated: AppConfig = { ...config, binaryPaths: { server, finetune } };
        await this.configStore.save(updated);
        return this.configStore.load();
      }
      case "model.list": {
        const directory = String(args.directory ?? "");
        return this.listModels(directory);
      }
      case "server.start": {
        const config = args.config as AppConfig;
        return this.startServer(config);
      }
      case "server.stop":
        return this.stopProcess("server");
      case "server.status":
        return this.processManager.statusOf("server");
      case "training.start": {
        const config = args.config as AppConfig;
        return this.startTraining(config);
      }
      case "training.stop":
        return this.stopProcess("finetune");
      case "training.status":
        return this.processManager.statusOf("finetune");
      case "training.checkOutput": {
        const path = String(args.path ?? "");
        return { path, exists: path ? await this.fileExists(path) : false };
      }
      case "monitor.collect": {
        const pids = (args.pids as { pid: number; name: string }[]) ?? [];
        return this.monitor.collect(pids);
      }
      case "error.log": {
        await this.errorLog.append(args.error as AppError);
        return { ok: true };
      }
      case "dialog.open":
        return null;
      default:
        throw new CommandError("ipc", "Unknown command", `The command “${cmd}” is not implemented.`, "Update the app or report this issue.");
    }
  }

  private async listModels(directory: string): Promise<ListModelsResult> {
    const trimmed = directory.trim();
    if (!trimmed) {
      return { directory: trimmed, files: [], message: "Choose a folder to list your models." };
    }
    try {
      const stat = await fs.stat(trimmed);
      if (!stat.isDirectory()) {
        throw new CommandError("model-management", "Not a folder", `“${trimmed}” is a file, not a folder.`, "Select a folder that contains GGUF model files.");
      }
      const entries = await fs.readdir(trimmed);
      const gguf = entries.filter((e) => /\.gguf$/i.test(e)).sort();
      if (gguf.length === 0) {
        return { directory: trimmed, files: [], message: `No .gguf files were found in “${trimmed}”.` };
      }
      return { directory: trimmed, files: gguf };
    } catch (err) {
      if (err instanceof CommandError) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new CommandError("model-management", fromDirectoryError("model-management", trimmed).title, fromDirectoryError("model-management", trimmed).message, fromDirectoryError("model-management", trimmed).fix);
      }
      throw new CommandError("model-management", "Could not open directory", `Could not read “${trimmed}”: ${code ?? "unknown error"}`, "Choose a different folder and try again.");
    }
  }

  private async startServer(config: AppConfig): Promise<ProcessStatus> {
    if (config.model.selectedModel.trim() !== "") {
      const exists = await this.fileExists(config.model.selectedModel);
      if (!exists) {
        const error = fromMissingFile("server-control", "Model file", config.model.selectedModel);
        await this.recordError(error);
        throw new CommandError(error.scope, error.title, error.message, error.fix);
      }
    }
    await this.configStore.save(config);
    try {
      const status = await this.processManager.startServer(config);
      return status;
    } catch (err) {
      if (err instanceof ProcessStartError) {
        const error = fromProcessStartError("server-control", err);
        await this.recordError(error);
        throw new CommandError(error.scope, error.title, error.message, error.fix);
      }
      throw err;
    }
  }

  private async startTraining(config: AppConfig): Promise<ProcessStatus> {
    const dataset = String(config.finetune["train-data"] ?? "").trim();
    if (dataset) {
      const exists = await this.fileExists(dataset);
      if (!exists) {
        const error = fromInvalidDataset("fine-tuning", dataset);
        await this.recordError(error);
        throw new CommandError(error.scope, error.title, error.message, error.fix);
      }
    } else {
      const error = fromGeneric("fine-tuning", "Training dataset required", "No training dataset was provided.", "Choose a training dataset file before starting training.");
      await this.recordError(error);
      throw new CommandError(error.scope, error.title, error.message, error.fix);
    }
    await this.configStore.save(config);
    try {
      const status = await this.processManager.startFinetune(config);
      return status;
    } catch (err) {
      if (err instanceof ProcessStartError) {
        const error = fromProcessStartError("fine-tuning", err);
        await this.recordError(error);
        throw new CommandError(error.scope, error.title, error.message, error.fix);
      }
      throw err;
    }
  }

  private async stopProcess(kind: "server" | "finetune"): Promise<ProcessStatus> {
    this.stopping.set(kind, true);
    return this.processManager.stop(kind);
  }

  /** True when the most recent server stderr indicates a port conflict. */
  serverPortConflict(): boolean {
    return isPortInUse(this.processManager.getStderrTail("server"));
  }
}

export { basename, join };
