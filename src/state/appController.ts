import { invoke as defaultInvoke, onEvent as defaultOnEvent, type IpcEventName } from "@/ipc/transport";
import { defaultConfig } from "@/config/defaults";
import { describeGpuOffload } from "@/process/flagBuilder";
import type { AppConfig, AppError, FlagValues, ProcessLogLine, ProcessStatus, SystemMetrics } from "@/config/types";

export interface ListModelsResult {
  directory: string;
  files: string[];
  error?: string;
  message?: string;
}

type Listener = () => void;

export interface ControllerDeps {
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  onEvent?: (event: IpcEventName, listener: (payload: unknown) => void) => () => void;
}

const MAX_LOG_LINES = 2000;

export class AppController {
  config: AppConfig = defaultConfig();
  loaded = false;
  needsBinarySetup = false;
  server: ProcessStatus = { kind: "server", state: "stopped" };
  training: ProcessStatus = { kind: "finetune", state: "stopped" };
  serverLogs: ProcessLogLine[] = [];
  trainingLogs: ProcessLogLine[] = [];
  metrics: SystemMetrics | null = null;
  errors: AppError[] = [];
  models: ListModelsResult = { directory: "", files: [] };
  lastTraining: { outputPath: string; exists: boolean; exitCode: number | null } | null = null;
  metricsRunning = false;

  private listeners = new Set<Listener>();
  private unsubs: (() => void)[] = [];
  private metricsTimer?: ReturnType<typeof setInterval>;
  private saveQueue: Promise<unknown> = Promise.resolve();
  private readonly invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  private readonly onEvent: (event: IpcEventName, listener: (payload: unknown) => void) => () => void;

  constructor(deps: ControllerDeps = {}) {
    this.invoke = deps.invoke ?? defaultInvoke;
    this.onEvent = deps.onEvent ?? defaultOnEvent;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private commit(patch: Partial<AppController>): void {
    Object.assign(this, patch);
    this.notify();
  }

  private pushLog(target: "serverLogs" | "trainingLogs", line: ProcessLogLine): void {
    if (line.replaceKey) {
      const existing = this[target].findIndex((l) => l.replaceKey === line.replaceKey);
      if (existing >= 0) {
        const arr = this[target].slice();
        arr[existing] = line;
        this[target] = arr;
        this.notify();
        return;
      }
    }
    const arr = this[target].concat(line);
    if (arr.length > MAX_LOG_LINES) arr.splice(0, arr.length - MAX_LOG_LINES);
    this[target] = arr;
    this.notify();
  }

  private pushServerLog(text: string, stream: "stdout" | "stderr" = "stdout"): void {
    this.pushLog("serverLogs", { stream, text, ts: Date.now() });
  }

  private pushTrainingLog(text: string, stream: "stdout" | "stderr" = "stdout"): void {
    this.pushLog("trainingLogs", { stream, text, ts: Date.now() });
  }

  private errorLogTarget(error: AppError): "serverLogs" | "trainingLogs" {
    const scope = error.scope.toLowerCase();
    if (scope.includes("fine") || scope.includes("train")) return "trainingLogs";
    return "serverLogs";
  }

  private pushErrorToLog(error: AppError): void {
    const lines = [`${error.title}: ${error.message}`];
    if (error.fix) lines.push(`Fix: ${error.fix}`);
    this.pushLog(this.errorLogTarget(error), { stream: "stderr", text: lines.join("\n"), ts: Date.now() });
  }

  private pushError(error: AppError, retry?: () => Promise<unknown> | void): void {
    if (retry) error.retry = retry as () => void | Promise<void>;
    this.pushErrorToLog(error);
    this.errors = [...this.errors, error];
    this.notify();
    void this.invoke("error.log", { error }).catch(() => undefined);
  }

  dismissError = (id: string): void => {
    this.errors = this.errors.filter((e) => e.id !== id);
    this.notify();
  };

  clearLogs = (kind: "server" | "finetune"): void => {
    if (kind === "server") this.serverLogs = [];
    else this.trainingLogs = [];
    this.notify();
  };

  async init(): Promise<void> {
    try {
      const config = await this.invoke<AppConfig>("config.load");
      const needsBinarySetup = !config.binaryPaths.server.trim();
      this.commit({ config, loaded: true, needsBinarySetup });
      if (config.model.directory.trim()) {
        void this.listModels(config.model.directory);
      }
      void this.refreshServerStatus();
      void this.refreshTrainingStatus();
    } catch (err) {
      this.commit({ loaded: true, needsBinarySetup: true });
      this.pushError(err as AppError, () => this.init());
      return;
    }

    this.unsubs.push(
      this.onEvent("log", (payload) => {
        const line = payload as ProcessLogLine & { kind: "server" | "finetune" };
        const logLine = { stream: line.stream, text: line.text, ts: line.ts, replaceKey: line.replaceKey };
        if (line.kind === "server") this.pushLog("serverLogs", logLine);
        else this.pushLog("trainingLogs", logLine);
      }),
    );
    this.unsubs.push(
      this.onEvent("status", (payload) => {
        const status = payload as ProcessStatus;
        if (status.kind === "server") this.commit({ server: status });
        else this.commit({ training: status });
      }),
    );
    this.unsubs.push(
      this.onEvent("error", (payload) => {
        this.pushError(payload as AppError);
      }),
    );
    this.unsubs.push(
      this.onEvent("training-complete", (payload) => {
        const p = payload as { outputPath: string; exists: boolean; exitCode: number | null };
        this.lastTraining = p;
        if (p.exists) {
          this.pushTrainingLog(`Training complete. Output model: ${p.outputPath}`);
          this.notify();
        } else {
          this.pushError({
            id: `${Date.now()}`,
            scope: "fine-tuning",
            title: "Training produced no output model",
            message: `Training finished but the output model file was not found at “${p.outputPath}”.`,
            fix: "Check the output path is writable and that training completed successfully, then try again.",
            ts: Date.now(),
          });
        }
      }),
    );
    this.startMetrics();
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.stopMetrics();
  }

  async refreshConfig(): Promise<AppConfig> {
    const config = await this.invoke<AppConfig>("config.load");
    this.commit({ config, needsBinarySetup: !config.binaryPaths.server.trim() });
    return config;
  }

  async updateConfig(updater: (cfg: AppConfig) => AppConfig, persist = true): Promise<boolean> {
    const next = updater(JSON.parse(JSON.stringify(this.config)));
    this.commit({ config: next });
    if (persist) {
      try {
        const saved = await this.enqueueSave(next);
        this.commit({ config: saved });
        return true;
      } catch (err) {
        this.pushError(err as AppError, () => this.updateConfig(updater, persist));
        return false;
      }
    }
    return true;
  }

  private enqueueSave(config: AppConfig): Promise<AppConfig> {
    const op = this.saveQueue.then(() => this.invoke<AppConfig>("config.save", { config }));
    this.saveQueue = op.catch(() => undefined);
    return op;
  }

  async applyServerFlags(serverFlags: FlagValues): Promise<boolean> {
    try {
      const saved = await this.enqueueSave({ ...this.config, serverFlags });
      this.commit({ config: saved });
      return true;
    } catch (err) {
      this.pushError(err as AppError, () => this.applyServerFlags(serverFlags));
      return false;
    }
  }

  async validateBinary(path: string): Promise<{ ok: boolean; reason?: string; resolved?: string }> {
    try {
      const result = await this.invoke<{ ok: boolean; reason?: string; resolved?: string }>("binary.validate", { path });
      return result;
    } catch (err) {
      this.pushError(err as AppError);
      return { ok: false, reason: (err as AppError).message };
    }
  }

  async setBinaryPaths(paths: { server?: string; finetune?: string }): Promise<boolean> {
    try {
      const saved = await this.invoke<AppConfig>("binary.set", paths);
      this.commit({ config: saved, needsBinarySetup: !saved.binaryPaths.server.trim() });
      return true;
    } catch (err) {
      this.pushError(err as AppError, () => this.setBinaryPaths(paths));
      return false;
    }
  }

  async listModels(directory: string): Promise<ListModelsResult> {
    try {
      const result = await this.invoke<ListModelsResult>("model.list", { directory });
      this.models = result;
      this.notify();
      return result;
    } catch (err) {
      const appError = err as AppError;
      const result: ListModelsResult = { directory, files: [], error: appError.message };
      this.models = result;
      this.pushError(appError, () => this.listModels(directory));
      this.notify();
      return result;
    }
  }

  async setModelDirectory(directory: string): Promise<void> {
    await this.updateConfig((cfg) => ({ ...cfg, model: { ...cfg.model, directory } }));
    await this.listModels(directory);
  }

  async selectModel(name: string): Promise<boolean> {
    const directory = this.config.model.directory;
    const selectedModel = directory ? `${directory}/${name}` : name;
    const saved = await this.updateConfig((cfg) => ({ ...cfg, model: { ...cfg.model, selectedModel } }));
    if (!saved) return false;
    this.pushServerLog(`Model selected for next launch: ${selectedModel}`);
    return true;
  }

  async unloadModel(): Promise<boolean> {
    const saved = await this.updateConfig((cfg) => ({ ...cfg, model: { ...cfg.model, selectedModel: "" } }));
    if (!saved) return false;
    this.pushServerLog("Model selection cleared.");
    return true;
  }

  async startServer(): Promise<void> {
    const startedAt = Date.now();
    this.commit({ server: { kind: "server", state: "starting", startedAt } });
    this.pushServerLog(`Start requested. Binary: ${this.config.binaryPaths.server || "not set"}`);
    this.pushServerLog(`Selected model: ${this.config.model.selectedModel || "not set"}`);
    this.pushServerLog(`GPU offload: ${describeGpuOffload(this.config)}`);
    if (!this.config.model.selectedModel.trim()) {
      const error: AppError = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        scope: "server-control",
        title: "No model selected",
        message: "llama-server needs a GGUF model before Atlas can start it.",
        fix: "Open the Models tab, choose a GGUF file, then click Start again.",
        ts: Date.now(),
      };
      this.commit({ server: { kind: "server", state: "stopped" } });
      this.pushServerLog(`${error.title}: ${error.message}`, "stderr");
      this.pushError(error, () => this.startServer());
      return;
    }
    try {
      const status = await this.invoke<ProcessStatus>("server.start", { config: this.config });
      this.commit({ server: status });
      if (status.state === "starting") {
        this.pushServerLog(`Process spawned${status.pid ? ` with pid ${status.pid}` : ""}. Waiting for model load and health check.`);
      } else {
        this.pushServerLog(`Process spawned${status.pid ? ` with pid ${status.pid}` : ""}. llama-server reported healthy.`);
      }
      void this.collectMetrics().catch(() => undefined);
    } catch (err) {
      this.commit({ server: { kind: "server", state: "stopped" } });
      const appError = err as AppError;
      this.pushServerLog(`${appError.title}: ${appError.message}`, "stderr");
      this.pushError(err as AppError, () => this.startServer());
    }
  }

  async stopServer(): Promise<void> {
    try {
      this.pushServerLog("Stop requested. Reclaiming configured server port if a stale llama-server is using it.");
      const status = await this.invoke<ProcessStatus>("server.stop");
      this.commit({ server: status });
      this.pushServerLog("Server stopped.");
      void this.collectMetrics().catch(() => undefined);
    } catch (err) {
      this.pushError(err as AppError, () => this.stopServer());
    }
  }

  async refreshServerStatus(): Promise<void> {
    try {
      const status = await this.invoke<ProcessStatus>("server.status");
      this.commit({ server: status });
      if (status.external) {
        this.pushServerLog(`Linked to existing llama-server on configured port${status.pid ? ` (pid ${status.pid})` : ""}.`);
      }
    } catch {
      // Status refresh is opportunistic; explicit actions surface errors.
    }
  }

  async refreshTrainingStatus(): Promise<void> {
    try {
      const status = await this.invoke<ProcessStatus>("training.status");
      this.commit({ training: status });
    } catch {
      // Status refresh is opportunistic; explicit actions surface errors.
    }
  }

  async startTraining(): Promise<void> {
    try {
      const status = await this.invoke<ProcessStatus>("training.start", { config: this.config });
      this.commit({ training: status });
      this.pushTrainingLog(status.pid ? `Training started with pid ${status.pid}.` : "Training started.");
    } catch (err) {
      this.pushError(err as AppError, () => this.startTraining());
    }
  }

  async stopTraining(): Promise<void> {
    try {
      const status = await this.invoke<ProcessStatus>("training.stop");
      this.commit({ training: status });
      this.pushTrainingLog("Training stopped.");
    } catch (err) {
      this.pushError(err as AppError, () => this.stopTraining());
    }
  }

  async collectMetrics(): Promise<SystemMetrics> {
    const pids: { pid: number; name: string }[] = [];
    if (this.server.state === "running" && this.server.pid) pids.push({ pid: this.server.pid, name: "llama-server" });
    if (this.training.state === "running" && this.training.pid) pids.push({ pid: this.training.pid, name: "llama-finetune" });
    try {
      const metrics = await this.invoke<SystemMetrics>("monitor.collect", { pids });
      this.metrics = metrics;
      this.notify();
      return metrics;
    } catch (err) {
      this.pushError(err as AppError);
      throw err;
    }
  }

  startMetrics(intervalMs = 1000): void {
    if (this.metricsRunning) return;
    this.metricsRunning = true;
    void this.collectMetrics().catch(() => undefined);
    this.metricsTimer = setInterval(() => {
      void this.collectMetrics().catch(() => undefined);
    }, intervalMs);
  }

  stopMetrics(): void {
    this.metricsRunning = false;
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    this.metricsTimer = undefined;
  }
}
