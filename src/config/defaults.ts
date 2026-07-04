import { defaultFinetuneParams, defaultServerFlags } from "./flagCatalog";
import type { AppConfig } from "./types";
import { defaultAgentRuntimeConfig } from "@/runtime/profiles";

export const CONFIG_SCHEMA_VERSION = 1;

export function defaultConfig(): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    binaryPaths: { server: "/home/reid/.local/bin/llama-server", finetune: "/home/reid/.local/bin/llama-finetune" },
    gpu: { autoOffloadInitialized: false, optimizedProfileVersion: 4, offloadMode: "auto" },
    model: {
      directory: "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF",
      selectedModel: "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF/ornith-1.0-35b-Q4_K_M.gguf",
    },
    server: { host: "0.0.0.0", port: 8099 },
    serverFlags: defaultServerFlags(),
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
      profiles: Array.isArray(saved.agentRuntime.profiles) && saved.agentRuntime.profiles.length > 0 ? saved.agentRuntime.profiles : base.agentRuntime.profiles,
    };
  }
  return merged;
}
