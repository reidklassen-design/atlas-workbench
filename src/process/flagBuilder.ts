import { SERVER_FLAGS, FINETUNE_PARAMS } from "@/config/flagCatalog";
import type { AppConfig, FlagDef, FinetuneParamDef, FlagValues, GpuOffloadMode } from "@/config/types";

/**
 * The ids managed by the dedicated Server tab fields rather than the generic
 * Settings flag widgets. They are still converted into real --host / --port
 * arguments here.
 */
const SERVER_TAB_OWNED = new Set(["host", "port"]);

function isDefault(def: FlagDef | FinetuneParamDef, value: string | number | boolean): boolean {
  if (def.type === "number") {
    return Number(value) === Number(def.default);
  }
  if (def.type === "boolean") {
    return Boolean(value) === Boolean(def.default);
  }
  return String(value) === String(def.default);
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(6)));
}

function emitFlag(
  def: FlagDef | FinetuneParamDef,
  value: string | number | boolean,
  out: string[],
): void {
  if (def.type === "boolean") {
    if (Boolean(value)) out.push(def.flag);
    else if (def.negatedFlag) out.push(def.negatedFlag);
    return;
  }
  if (def.type === "string" || def.type === "path" || def.type === "enum") {
    const text = String(value ?? "");
    if (text === "" && !def.alwaysEmit) return;
    out.push(def.flag, text);
    return;
  }
  // number
  const num = Number(value);
  if (Number.isNaN(num)) return;
  out.push(def.flag, formatNumber(num));
}

function legacyGpuModeFromLayers(value: string | number | boolean | undefined): GpuOffloadMode {
  const layers = Number(value ?? 999);
  if (Number.isNaN(layers)) return "auto";
  if (layers <= 0) return "cpu";
  if (layers >= 999) return "auto";
  return "manual";
}

export function gpuOffloadMode(config: AppConfig): GpuOffloadMode {
  const mode = config.gpu?.offloadMode;
  if (mode === "auto" || mode === "full" || mode === "manual" || mode === "cpu") return mode;
  return legacyGpuModeFromLayers(config.serverFlags["n-gpu-layers"]);
}

export function describeGpuOffload(config: AppConfig): string {
  const layers = Number(config.serverFlags["n-gpu-layers"] ?? 999);
  const mode = gpuOffloadMode(config);
  if (mode === "auto") return "auto-fit (no --n-gpu-layers override)";
  if (mode === "cpu") return "CPU only (--n-gpu-layers 0)";
  if (mode === "full") return `full offload (--n-gpu-layers ${Number.isFinite(layers) && layers > 0 ? layers : 999})`;
  return `manual (--n-gpu-layers ${Number.isFinite(layers) ? layers : 0})`;
}

function emitGpuLayerFlag(config: AppConfig, def: FlagDef, value: string | number | boolean, out: string[]): void {
  const mode = gpuOffloadMode(config);
  if (mode === "auto") return;
  if (mode === "cpu") {
    emitFlag(def, 0, out);
    return;
  }
  const layers = Number(value);
  emitFlag(def, Number.isFinite(layers) && layers > 0 ? layers : 999, out);
}

/**
 * Convert the persisted app config into the exact argv passed to the
 * llama.cpp server binary. Pure and deterministic so tests can assert it.
 */
export function buildServerArgs(config: AppConfig): string[] {
  const args: string[] = [];
  args.push("--host", config.server.host);
  args.push("--port", String(config.server.port));

  if (config.model.selectedModel.trim() !== "") {
    args.push("--model", config.model.selectedModel);
  }

  for (const def of SERVER_FLAGS) {
    if (SERVER_TAB_OWNED.has(def.id)) continue;
    const value = config.serverFlags[def.id];
    if (value === undefined) continue;
    if (def.id === "n-gpu-layers") {
      emitGpuLayerFlag(config, def, value, args);
      continue;
    }
    const alwaysEmit = def.alwaysEmit === true;
    const changed = !isDefault(def, value) || alwaysEmit;
    if (!changed) continue;
    emitFlag(def, value, args);
  }
  return args;
}

/**
 * Convert the persisted fine-tuning config into the exact argv passed to the
 * llama.cpp finetune binary. Pure and deterministic.
 */
export function buildFinetuneArgs(config: AppConfig): string[] {
  const args: string[] = [];
  for (const def of FINETUNE_PARAMS) {
    const value = config.finetune[def.id];
    if (value === undefined) continue;
    const changed = !isDefault(def, value);
    if (!changed) continue;
    emitFlag(def, value, args);
  }
  return args;
}

/** Build a full command string for display/logging (binary + args). */
export function describeCommand(binary: string, args: string[]): string {
  const escaped = [binary, ...args].map((a) => (a.includes(" ") ? `"${a}"` : a));
  return escaped.join(" ");
}

function redactArgs(args: string[]): string[] {
  const out = [...args];
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === "--api-key" && i + 1 < out.length) out[i + 1] = "[redacted]";
  }
  return out;
}

export function buildServerCommandString(config: AppConfig): string {
  return describeCommand(config.binaryPaths.server || "llama-server", buildServerArgs(config));
}

export function buildRedactedServerCommandString(config: AppConfig): string {
  return describeCommand(config.binaryPaths.server || "llama-server", redactArgs(buildServerArgs(config)));
}

export function buildFinetuneCommandString(config: AppConfig): string {
  return describeCommand(config.binaryPaths.finetune || "llama-finetune", buildFinetuneArgs(config));
}

export { SERVER_FLAGS, FINETUNE_PARAMS };
export type { FlagValues };
