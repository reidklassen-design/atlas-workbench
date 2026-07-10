import { render, type RenderResult } from "@testing-library/react";
import { AppProvider } from "@/state/reactBinding";
import { AppController } from "@/state/appController";
import { createMockTransport, emitToMock, type MockTransportHandlers, type EventListeners, type IpcEventName } from "@/ipc/transport";
import type { AppConfig } from "@/config/types";
import { defaultConfig } from "@/config/defaults";
import { defaultServerFlags } from "@/config/flagCatalog";
import { ReactNode } from "react";

export function baselineConfig(over: Partial<AppConfig> = {}): AppConfig {
  const base = defaultConfig();
  base.binaryPaths = { server: "/usr/bin/llama-server", finetune: "/usr/bin/llama-finetune" };
  return {
    ...base,
    ...over,
    binaryPaths: { ...base.binaryPaths, ...(over.binaryPaths ?? {}) },
    gpu: { ...base.gpu, ...(over.gpu ?? {}) },
    server: { ...base.server, ...(over.server ?? {}) },
    model: { ...base.model, ...(over.model ?? {}) },
    serverFlags: { ...base.serverFlags, ...(over.serverFlags ?? {}) },
    finetune: { ...base.finetune, ...(over.finetune ?? {}) },
  };
}

export function baselineHandlers(over: MockTransportHandlers = {}, configFactory: () => AppConfig = () => baselineConfig()): MockTransportHandlers {
  let config = configFactory();
  return {
    "config.load": () => config,
    "config.save": (args) => {
      config = args.config as AppConfig;
      return config;
    },
    "config.reset": () => baselineConfig(),
    "dialog.open": () => null,
    "binary.validate": (args) => ({ path: String(args.path), ok: true }),
    "binary.set": (args) => {
      config = { ...config, binaryPaths: { server: String(args.server ?? config.binaryPaths.server), finetune: String(args.finetune ?? config.binaryPaths.finetune) } };
      return config;
    },
    "model.list": (args) => ({ directory: String(args.directory ?? ""), files: [] as string[], message: "No .gguf files were found." }),
    "monitor.collect": () => ({
      cpu: { overall: 12.5, perCore: [10, 15, 20, 5] },
      ram: { used: 2_000_000_000, total: 8_000_000_000, percent: 25 },
      gpu: { detected: false, note: "GPU not detected" },
      processes: [],
      ts: Date.now(),
    }),
    "error.log": () => ({ ok: true }),
    "server.start": () => ({ kind: "server", state: "running", pid: 4321, startedAt: Date.now() }),
    "server.stop": () => ({ kind: "server", state: "exited", exitCode: 0 }),
    "server.status": () => ({ kind: "server", state: "stopped" }),
    "training.start": () => ({ kind: "finetune", state: "running", pid: 4322, startedAt: Date.now() }),
    "training.stop": () => ({ kind: "finetune", state: "exited", exitCode: 0 }),
    "training.status": () => ({ kind: "finetune", state: "stopped" }),
    "gateway.status": () => ({
      running: false,
      external: false,
      host: config.agentRuntime.gateway.host,
      port: config.agentRuntime.gateway.port,
      upstream: `http://${config.server.host}:${config.server.port}`,
      modelAlias: config.agentRuntime.gateway.modelAlias,
      activeProfileId: config.agentRuntime.activeProfileId,
      requestCount: 0,
      rejectedCount: 0,
    }),
    "visualLocator.start": () => ({
      running: true,
      external: false,
      state: "running",
      pid: 4323,
      host: config.agentRuntime.visualLocator.host,
      port: config.agentRuntime.visualLocator.port,
      endpoint: `http://${config.agentRuntime.visualLocator.host}:${config.agentRuntime.visualLocator.port}/v1`,
      modelAlias: config.agentRuntime.visualLocator.modelAlias,
      serverPath: config.agentRuntime.visualLocator.serverPath,
      modelPath: config.agentRuntime.visualLocator.modelPath,
      mmprojPath: config.agentRuntime.visualLocator.mmprojPath,
      gpuLayers: config.agentRuntime.visualLocator.gpuLayers,
      contextSize: config.agentRuntime.visualLocator.contextSize,
    }),
    "visualLocator.stop": () => ({
      running: false,
      external: false,
      state: "stopped",
      host: config.agentRuntime.visualLocator.host,
      port: config.agentRuntime.visualLocator.port,
      endpoint: `http://${config.agentRuntime.visualLocator.host}:${config.agentRuntime.visualLocator.port}/v1`,
      modelAlias: config.agentRuntime.visualLocator.modelAlias,
      serverPath: config.agentRuntime.visualLocator.serverPath,
      modelPath: config.agentRuntime.visualLocator.modelPath,
      mmprojPath: config.agentRuntime.visualLocator.mmprojPath,
      gpuLayers: config.agentRuntime.visualLocator.gpuLayers,
      contextSize: config.agentRuntime.visualLocator.contextSize,
    }),
    "visualLocator.status": () => ({
      running: false,
      external: false,
      state: "stopped",
      host: config.agentRuntime.visualLocator.host,
      port: config.agentRuntime.visualLocator.port,
      endpoint: `http://${config.agentRuntime.visualLocator.host}:${config.agentRuntime.visualLocator.port}/v1`,
      modelAlias: config.agentRuntime.visualLocator.modelAlias,
      serverPath: config.agentRuntime.visualLocator.serverPath,
      modelPath: config.agentRuntime.visualLocator.modelPath,
      mmprojPath: config.agentRuntime.visualLocator.mmprojPath,
      gpuLayers: config.agentRuntime.visualLocator.gpuLayers,
      contextSize: config.agentRuntime.visualLocator.contextSize,
    }),
    ...over,
  };
}

export interface RenderAppResult extends RenderResult {
  controller: AppController;
  listeners: EventListeners;
  emit: (event: IpcEventName, payload: unknown) => void;
}

export async function renderApp(children: ReactNode, handlers: MockTransportHandlers = baselineHandlers()): Promise<RenderAppResult> {
  const listeners: EventListeners = new Map();
  const transport = createMockTransport(handlers, listeners);
  const controller = new AppController({
    invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => transport.invoke(cmd, args) as Promise<T>,
    onEvent: (event, listener) => transport.on(event, listener),
  });
  await controller.init();
  await controller.collectMetrics().catch(() => undefined);
  const result = render(<AppProvider controller={controller} autoInit={false}>{children}</AppProvider>);
  return {
    ...result,
    controller,
    listeners,
    emit: (event: IpcEventName, payload: unknown) => emitToMock(listeners, event, payload),
  };
}

export { defaultServerFlags };
