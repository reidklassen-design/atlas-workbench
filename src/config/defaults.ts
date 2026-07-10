import { defaultFinetuneParams, defaultServerFlags } from "./flagCatalog";
import type { AppConfig } from "./types";
import { AGENT_RUNTIME_PROFILE_VERSION, defaultAgentRuntimeConfig } from "@/runtime/profiles";

export const CONFIG_SCHEMA_VERSION = 1;

export function defaultConfig(): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    binaryPaths: { server: "/home/reid/.local/bin/llama-server", finetune: "/home/reid/.local/bin/llama-finetune" },
    gpu: { autoOffloadInitialized: false, optimizedProfileVersion: 9, offloadMode: "full" },
    model: {
      directory: "/home/reid/Downloads",
      selectedModel: "/home/reid/Downloads/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf",
    },
    server: { host: "127.0.0.1", port: 8099 },
    systemPrompt: "",
    serverFlags: {
      ...defaultServerFlags(),
      alias: "Qwen3-Coder-30B-A3B",
      "ctx-size": 188000,
      "n-gpu-layers": 999,
      "batch-size": 1024,
      "ubatch-size": 256,
      parallel: 1,
      "flash-attn": "on",
      "cache-type-k": "q4_0",
      "cache-type-v": "q4_0",
      "cont-batching": true,
      slots: true,
      metrics: true,
      "context-shift": true,
      predict: 8192,
      reasoning: "off",
      "reasoning-budget": 0,
      temp: 0.2,
      "top-k": 20,
      "top-p": 0.8,
      "repeat-penalty": 1.05,
      threads: 16,
      "threads-batch": 16,
    },
    finetune: defaultFinetuneParams(),
    agentRuntime: defaultAgentRuntimeConfig(),
  };
}

/**
 * Merge a persisted config with the current defaults so that newly added
 * flags or fields appear with safe values while previously saved values are
 * preserved. This keeps the config format backward compatible.
 */
export function mergeConfigs(saved: Partial<AppConfig>, base: AppConfig = defaultConfig()): AppConfig {
  const merged: AppConfig = JSON.parse(JSON.stringify(base));
  const savedProfileVersion = saved.gpu && typeof saved.gpu.optimizedProfileVersion === "number" ? saved.gpu.optimizedProfileVersion : base.gpu.optimizedProfileVersion;
  const refreshOptimizedProfile = savedProfileVersion < AGENT_RUNTIME_PROFILE_VERSION;
  if (typeof saved.schemaVersion === "number") merged.schemaVersion = saved.schemaVersion;
  if (saved.binaryPaths && typeof saved.binaryPaths === "object") {
    merged.binaryPaths = {
      server: typeof saved.binaryPaths.server === "string" ? saved.binaryPaths.server : "",
      finetune: typeof saved.binaryPaths.finetune === "string" ? saved.binaryPaths.finetune : "",
    };
  }
  if (saved.gpu && typeof saved.gpu === "object") {
    merged.gpu = {
      autoOffloadInitialized: typeof saved.gpu.autoOffloadInitialized === "boolean" ? saved.gpu.autoOffloadInitialized : base.gpu.autoOffloadInitialized,
      optimizedProfileVersion: typeof saved.gpu.optimizedProfileVersion === "number" ? saved.gpu.optimizedProfileVersion : base.gpu.optimizedProfileVersion,
      offloadMode: saved.gpu.offloadMode === "auto" || saved.gpu.offloadMode === "full" || saved.gpu.offloadMode === "manual" || saved.gpu.offloadMode === "cpu" ? saved.gpu.offloadMode : base.gpu.offloadMode,
    };
  }
  if (saved.model && typeof saved.model === "object") {
    merged.model = {
      directory: typeof saved.model.directory === "string" ? saved.model.directory : "",
      selectedModel: typeof saved.model.selectedModel === "string" ? saved.model.selectedModel : "",
    };
  }
  if (saved.server && typeof saved.server === "object") {
    merged.server = {
      host: typeof saved.server.host === "string" ? saved.server.host : base.server.host,
      port: typeof saved.server.port === "number" ? saved.server.port : base.server.port,
    };
  }
  if (typeof saved.systemPrompt === "string") merged.systemPrompt = saved.systemPrompt;
  if (saved.serverFlags && typeof saved.serverFlags === "object") {
    for (const [key, value] of Object.entries(saved.serverFlags)) {
      const def = base.serverFlags[key];
      if (def === undefined) continue;
      if (typeof value === typeof def) merged.serverFlags[key] = value;
    }
  }
  if (saved.finetune && typeof saved.finetune === "object") {
    for (const [key, value] of Object.entries(saved.finetune)) {
      const def = base.finetune[key];
      if (def === undefined) continue;
      if (typeof value === typeof def) merged.finetune[key] = value;
    }
  }
  if (saved.agentRuntime && typeof saved.agentRuntime === "object") {
    merged.agentRuntime = {
      ...base.agentRuntime,
      activeProfileId: typeof saved.agentRuntime.activeProfileId === "string" ? saved.agentRuntime.activeProfileId : base.agentRuntime.activeProfileId,
      gateway:
        saved.agentRuntime.gateway && typeof saved.agentRuntime.gateway === "object"
          ? {
              ...base.agentRuntime.gateway,
              enabled: typeof saved.agentRuntime.gateway.enabled === "boolean" ? saved.agentRuntime.gateway.enabled : base.agentRuntime.gateway.enabled,
              host: typeof saved.agentRuntime.gateway.host === "string" ? saved.agentRuntime.gateway.host : base.agentRuntime.gateway.host,
              port: typeof saved.agentRuntime.gateway.port === "number" ? saved.agentRuntime.gateway.port : base.agentRuntime.gateway.port,
              apiKey: typeof saved.agentRuntime.gateway.apiKey === "string" ? saved.agentRuntime.gateway.apiKey : base.agentRuntime.gateway.apiKey,
              modelAlias: typeof saved.agentRuntime.gateway.modelAlias === "string" ? saved.agentRuntime.gateway.modelAlias : base.agentRuntime.gateway.modelAlias,
              autoCompressionEnabled: typeof saved.agentRuntime.gateway.autoCompressionEnabled === "boolean" ? saved.agentRuntime.gateway.autoCompressionEnabled : base.agentRuntime.gateway.autoCompressionEnabled,
            }
          : base.agentRuntime.gateway,
      visualLocator:
        saved.agentRuntime.visualLocator && typeof saved.agentRuntime.visualLocator === "object"
          ? {
              ...base.agentRuntime.visualLocator,
              enabled: typeof saved.agentRuntime.visualLocator.enabled === "boolean" ? saved.agentRuntime.visualLocator.enabled : base.agentRuntime.visualLocator.enabled,
              host: typeof saved.agentRuntime.visualLocator.host === "string" ? saved.agentRuntime.visualLocator.host : base.agentRuntime.visualLocator.host,
              port: typeof saved.agentRuntime.visualLocator.port === "number" ? saved.agentRuntime.visualLocator.port : base.agentRuntime.visualLocator.port,
              apiKey: typeof saved.agentRuntime.visualLocator.apiKey === "string" ? saved.agentRuntime.visualLocator.apiKey : base.agentRuntime.visualLocator.apiKey,
              modelAlias: typeof saved.agentRuntime.visualLocator.modelAlias === "string" ? saved.agentRuntime.visualLocator.modelAlias : base.agentRuntime.visualLocator.modelAlias,
              serverPath: typeof saved.agentRuntime.visualLocator.serverPath === "string" ? saved.agentRuntime.visualLocator.serverPath : base.agentRuntime.visualLocator.serverPath,
              modelPath: typeof saved.agentRuntime.visualLocator.modelPath === "string" ? saved.agentRuntime.visualLocator.modelPath : base.agentRuntime.visualLocator.modelPath,
              mmprojPath: typeof saved.agentRuntime.visualLocator.mmprojPath === "string" ? saved.agentRuntime.visualLocator.mmprojPath : base.agentRuntime.visualLocator.mmprojPath,
              gpuLayers: typeof saved.agentRuntime.visualLocator.gpuLayers === "string" ? saved.agentRuntime.visualLocator.gpuLayers : base.agentRuntime.visualLocator.gpuLayers,
              contextSize: typeof saved.agentRuntime.visualLocator.contextSize === "number" ? saved.agentRuntime.visualLocator.contextSize : base.agentRuntime.visualLocator.contextSize,
              autoStartWithGateway: typeof saved.agentRuntime.visualLocator.autoStartWithGateway === "boolean" ? saved.agentRuntime.visualLocator.autoStartWithGateway : base.agentRuntime.visualLocator.autoStartWithGateway,
            }
          : base.agentRuntime.visualLocator,
      profiles: Array.isArray(saved.agentRuntime.profiles) && saved.agentRuntime.profiles.length > 0 ? saved.agentRuntime.profiles : base.agentRuntime.profiles,
    };
  }
  if (refreshOptimizedProfile) {
    const activeProfile = base.agentRuntime.profiles.find((profile) => profile.id === base.agentRuntime.activeProfileId) ?? base.agentRuntime.profiles[0];
    merged.gpu.optimizedProfileVersion = base.gpu.optimizedProfileVersion;
    merged.gpu.offloadMode = activeProfile?.gpuOffloadMode ?? base.gpu.offloadMode;
    merged.agentRuntime = {
      ...merged.agentRuntime,
      activeProfileId: base.agentRuntime.activeProfileId,
      gateway: {
        ...merged.agentRuntime.gateway,
        host: base.agentRuntime.gateway.host,
        modelAlias: base.agentRuntime.gateway.modelAlias,
        autoCompressionEnabled: base.agentRuntime.gateway.autoCompressionEnabled,
      },
      visualLocator: merged.agentRuntime.visualLocator ?? base.agentRuntime.visualLocator,
      profiles: base.agentRuntime.profiles,
    };
    if (activeProfile) {
      merged.serverFlags = { ...merged.serverFlags, ...activeProfile.serverFlagOverrides };
      if (activeProfile.modelPath) {
        merged.model.selectedModel = activeProfile.modelPath;
        merged.model.directory = activeProfile.modelDirectory ?? activeProfile.modelPath.slice(0, activeProfile.modelPath.lastIndexOf("/"));
      }
    }
  }
  return merged;
}
