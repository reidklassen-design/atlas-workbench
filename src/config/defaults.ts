import { defaultFinetuneParams, defaultServerFlags } from "./flagCatalog";
import type { AppConfig } from "./types";

export const CONFIG_SCHEMA_VERSION = 1;

export function defaultConfig(): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    binaryPaths: { server: "", finetune: "" },
    gpu: { autoOffloadInitialized: false, optimizedProfileVersion: 0, offloadMode: "auto" },
    model: { directory: "", selectedModel: "" },
    server: { host: "127.0.0.1", port: 8080 },
    serverFlags: defaultServerFlags(),
    finetune: defaultFinetuneParams(),
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
  return merged;
}
