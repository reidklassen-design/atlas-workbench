import { defaultServerFlags } from "@/config/flagCatalog";
import type { AgentRequestPolicy, AgentRuntimeConfig, AgentRuntimeProfile, AppConfig, FlagValues } from "@/config/types";

const ONE_SECOND = 1000;

export const AGENT_RUNTIME_PROFILE_VERSION = 9;

const QWEN3_CODER_MODEL_DIRECTORY = "/home/reid/Downloads";
const QWEN3_CODER_MODEL_PATH = `${QWEN3_CODER_MODEL_DIRECTORY}/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf`;
const QWEN3_CODER_ALIAS = "Qwen3-Coder-30B-A3B";

export function codingRequestPolicy(overrides: Partial<AgentRequestPolicy> = {}): AgentRequestPolicy {
  const contextWindowTokens = overrides.contextWindowTokens ?? 131072;
  const reservedOutputTokens = overrides.reservedOutputTokens ?? 12288;
  const reservedSystemTokens = overrides.reservedSystemTokens ?? 4096;
  const safetyMarginTokens = overrides.safetyMarginTokens ?? 8192;
  const maxPromptTokens =
    overrides.maxPromptTokens ??
    Math.max(1024, contextWindowTokens - reservedOutputTokens - reservedSystemTokens - safetyMarginTokens);
  return {
    contextWindowTokens,
    reservedOutputTokens,
    reservedSystemTokens,
    safetyMarginTokens,
    maxPromptTokens,
    maxOutputTokens: overrides.maxOutputTokens ?? reservedOutputTokens,
    maxSingleFileTokens: overrides.maxSingleFileTokens ?? 24000,
    maxLogTokens: overrides.maxLogTokens ?? 16000,
    requestTimeoutMs: overrides.requestTimeoutMs ?? 20 * 60 * ONE_SECOND,
    streamStallTimeoutMs: overrides.streamStallTimeoutMs ?? 90 * ONE_SECOND,
    overloadBehavior: overrides.overloadBehavior ?? "reject",
  };
}

function serverFlags(overrides: FlagValues): FlagValues {
  return { ...defaultServerFlags(), ...overrides };
}

function qwen3CoderServerFlags(overrides: FlagValues): FlagValues {
  return serverFlags({
    alias: QWEN3_CODER_ALIAS,
    parallel: 1,
    "batch-size": 1024,
    "ubatch-size": 256,
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
    ...overrides,
  });
}

export function defaultAgentRuntimeProfiles(): AgentRuntimeProfile[] {
  return [
    {
      id: "3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu",
      name: "3090 Ti Qwen3-Coder 30B 188K Full-GPU",
      role: "main-coding",
      description: "Default DarkFactory coder: measured highest all-GPU context on the 3090 Ti with Qwen3-Coder Q4 XL, q4 KV cache, and fast 1024/256 batching.",
      modelDirectory: QWEN3_CODER_MODEL_DIRECTORY,
      modelPath: QWEN3_CODER_MODEL_PATH,
      gpuOffloadMode: "full",
      serverFlagOverrides: qwen3CoderServerFlags({
        "ctx-size": 188000,
      }),
      requestPolicy: codingRequestPolicy({
        contextWindowTokens: 188000,
        reservedOutputTokens: 8192,
        maxOutputTokens: 8192,
        safetyMarginTokens: 12288,
        maxSingleFileTokens: 40000,
        maxLogTokens: 28000,
        requestTimeoutMs: 20 * 60 * ONE_SECOND,
        streamStallTimeoutMs: 90 * ONE_SECOND,
      }),
    },
    {
      id: "3090-ti-qwen3-coder-30b-a3b-q4-xl-262k-max-context",
      name: "3090 Ti Qwen3-Coder 30B 262K Max Context",
      role: "main-coding",
      description: "Maximum-context Qwen3-Coder profile for giant repo reads. It reaches the native 262K window by letting llama.cpp auto-fit and spill some tensors to CPU.",
      modelDirectory: QWEN3_CODER_MODEL_DIRECTORY,
      modelPath: QWEN3_CODER_MODEL_PATH,
      gpuOffloadMode: "auto",
      serverFlagOverrides: qwen3CoderServerFlags({
        "ctx-size": 262144,
      }),
      requestPolicy: codingRequestPolicy({
        contextWindowTokens: 262144,
        reservedOutputTokens: 8192,
        maxOutputTokens: 8192,
        safetyMarginTokens: 16384,
        maxSingleFileTokens: 48000,
        maxLogTokens: 32000,
        requestTimeoutMs: 20 * 60 * ONE_SECOND,
        streamStallTimeoutMs: 90 * ONE_SECOND,
      }),
    },
    {
      id: "3090-ti-qwen3-coder-30b-a3b-q4-xl-131k-headroom",
      name: "3090 Ti Qwen3-Coder 30B 131K GPU Headroom",
      role: "main-coding",
      description: "All-GPU Qwen3-Coder profile with extra VRAM margin. Use it when you want the same coder but less pressure on the desktop or sidecar tools.",
      modelDirectory: QWEN3_CODER_MODEL_DIRECTORY,
      modelPath: QWEN3_CODER_MODEL_PATH,
      gpuOffloadMode: "full",
      serverFlagOverrides: qwen3CoderServerFlags({
        "ctx-size": 131072,
      }),
      requestPolicy: codingRequestPolicy({
        contextWindowTokens: 131072,
        reservedOutputTokens: 8192,
        maxOutputTokens: 8192,
        safetyMarginTokens: 12288,
        maxSingleFileTokens: 32000,
        maxLogTokens: 24000,
        requestTimeoutMs: 20 * 60 * ONE_SECOND,
        streamStallTimeoutMs: 90 * ONE_SECOND,
      }),
    },
    {
      id: "3090-ti-ornith-35b-96k-always-on",
      name: "3090 Ti Ornith 35B 96K Always-On",
      role: "main-coding",
      description: "Default local agent endpoint: keeps Ornith 35B loaded with enough headroom for long runs, compression, and recovery.",
      modelDirectory: "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF",
      modelPath: "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF/ornith-1.0-35b-Q4_K_M.gguf",
      gpuOffloadMode: "auto",
      serverFlagOverrides: serverFlags({
        alias: "Ornith1",
        "ctx-size": 98304,
        parallel: 1,
        "batch-size": 1024,
        "ubatch-size": 256,
        "flash-attn": "on",
        "cache-type-k": "q8_0",
        "cache-type-v": "q8_0",
        "cont-batching": true,
        slots: true,
        metrics: true,
        "context-shift": true,
        predict: 8192,
        reasoning: "off",
        "reasoning-budget": 0,
        threads: 16,
        "threads-batch": 16,
      }),
      requestPolicy: codingRequestPolicy({
        contextWindowTokens: 98304,
        reservedOutputTokens: 8192,
        maxOutputTokens: 8192,
        maxSingleFileTokens: 18000,
        maxLogTokens: 12000,
      }),
    },
    {
      id: "3090-ti-ornith-35b-125k-max-context",
      name: "3090 Ti Ornith 35B 125K Max Context",
      role: "main-coding",
      description: "Maximum-context mode for deliberate large reads. Use when you need the biggest window more than all-day headroom.",
      modelDirectory: "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF",
      modelPath: "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF/ornith-1.0-35b-Q4_K_M.gguf",
      gpuOffloadMode: "auto",
      serverFlagOverrides: serverFlags({
        alias: "Ornith1",
        "ctx-size": 125000,
        parallel: 1,
        "batch-size": 1024,
        "ubatch-size": 256,
        "flash-attn": "on",
        "cache-type-k": "q8_0",
        "cache-type-v": "q8_0",
        "cont-batching": true,
        slots: true,
        metrics: true,
        "context-shift": true,
        predict: 8192,
        reasoning: "off",
        "reasoning-budget": 0,
        threads: 16,
        "threads-batch": 16,
      }),
      requestPolicy: codingRequestPolicy({
        contextWindowTokens: 125000,
        reservedOutputTokens: 8192,
        maxOutputTokens: 8192,
        maxSingleFileTokens: 24000,
        maxLogTokens: 12000,
      }),
    },
    {
      id: "3090-ti-qwen-3-6-27b-96k-coder",
      name: "3090 Ti Qwen 3.6 27B 96K Coder",
      role: "main-coding",
      description: "Second-choice serious coding model with more VRAM headroom than Ornith 35B while keeping large-codebase context.",
      modelDirectory: "/home/reid/Downloads",
      modelPath: "/home/reid/Downloads/Qwen3.6-27B-Q4_K_M.gguf",
      gpuOffloadMode: "auto",
      serverFlagOverrides: serverFlags({
        alias: "Qwen3.6-27B",
        "ctx-size": 98304,
        parallel: 1,
        "batch-size": 1024,
        "ubatch-size": 256,
        "flash-attn": "on",
        "cache-type-k": "q8_0",
        "cache-type-v": "q8_0",
        "cont-batching": true,
        slots: true,
        metrics: true,
        "context-shift": true,
        predict: 8192,
        reasoning: "off",
        "reasoning-budget": 0,
      }),
      requestPolicy: codingRequestPolicy({
        contextWindowTokens: 98304,
        reservedOutputTokens: 8192,
        maxOutputTokens: 8192,
        maxSingleFileTokens: 18000,
        maxLogTokens: 12000,
      }),
    },
    {
      id: "3090-ti-ornith-9b-64k-fast",
      name: "3090 Ti Ornith 9B 64K Fast",
      role: "main-coding",
      description: "Fast fallback for simple edits, routing, and cheap iteration when the 35B model is unnecessary.",
      modelDirectory: "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith 1.0 9b",
      modelPath: "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith 1.0 9b/ornith-1.0-9b-Q8_0.gguf",
      gpuOffloadMode: "auto",
      serverFlagOverrides: serverFlags({
        alias: "Ornith1-9B",
        "ctx-size": 65536,
        parallel: 1,
        "batch-size": 1024,
        "ubatch-size": 256,
        "flash-attn": "on",
        "cache-type-k": "q8_0",
        "cache-type-v": "q8_0",
        "cont-batching": true,
        slots: true,
        metrics: true,
        "context-shift": true,
        predict: 8192,
        reasoning: "off",
        "reasoning-budget": 0,
      }),
      requestPolicy: codingRequestPolicy({
        contextWindowTokens: 65536,
        reservedOutputTokens: 8192,
        maxOutputTokens: 8192,
        maxSingleFileTokens: 16000,
        maxLogTokens: 12000,
      }),
    },
    {
      id: "compression-sidecar",
      name: "Compression Sidecar",
      role: "compression",
      description: "Small-model profile for summarizing old context, logs, and oversized files before the main coder sees them.",
      modelDirectory: "/home/reid/Downloads",
      modelPath: "/home/reid/Downloads/Qwen2.5-3B-Instruct-Q4_K_M.gguf",
      gpuOffloadMode: "cpu",
      serverFlagOverrides: serverFlags({
        alias: "Qwen2.5-3B-compress",
        "ctx-size": 32768,
        parallel: 1,
        "batch-size": 256,
        "ubatch-size": 64,
        "flash-attn": "on",
        "cache-type-k": "q4_0",
        "cache-type-v": "q4_0",
        "n-gpu-layers": 0,
        metrics: true,
        threads: 8,
        "threads-batch": 8,
        predict: 4096,
      }),
      requestPolicy: codingRequestPolicy({
        contextWindowTokens: 32768,
        reservedOutputTokens: 4096,
        maxOutputTokens: 4096,
        maxSingleFileTokens: 20000,
        maxLogTokens: 24000,
        requestTimeoutMs: 8 * 60 * ONE_SECOND,
        streamStallTimeoutMs: 45 * ONE_SECOND,
        overloadBehavior: "compress",
      }),
    },
    {
      id: "rescue-low-vram",
      name: "Rescue Low VRAM",
      role: "rescue",
      description: "Fallback profile for recovering after VRAM pressure, repeated stalls, or driver instability.",
      gpuOffloadMode: "auto",
      serverFlagOverrides: serverFlags({
        alias: "Qwythos-9B-rescue",
        "ctx-size": 32768,
        parallel: 1,
        "batch-size": 256,
        "ubatch-size": 64,
        "flash-attn": "on",
        "cache-type-k": "q4_0",
        "cache-type-v": "q4_0",
        metrics: true,
        slots: true,
        predict: 4096,
      }),
      requestPolicy: codingRequestPolicy({
        contextWindowTokens: 32768,
        reservedOutputTokens: 4096,
        maxOutputTokens: 4096,
        maxSingleFileTokens: 12000,
        maxLogTokens: 8000,
        requestTimeoutMs: 10 * 60 * ONE_SECOND,
        streamStallTimeoutMs: 45 * ONE_SECOND,
      }),
    },
  ];
}

export function defaultAgentRuntimeConfig(): AgentRuntimeConfig {
  return {
    activeProfileId: "3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu",
    gateway: {
      enabled: false,
      host: "0.0.0.0",
      port: 18080,
      apiKey: "atlas-local",
      modelAlias: QWEN3_CODER_ALIAS,
      autoCompressionEnabled: true,
    },
    visualLocator: {
      enabled: true,
      host: "127.0.0.1",
      port: 8000,
      apiKey: "local",
      modelAlias: "nvidia/LocateAnything-3B",
      serverPath: "/home/reid/.local/share/darkfactory/locateanything/bin/llama-server",
      modelPath: "/home/reid/DarkFactoryModels/LocateAnything-3B-GGUF/LocateAnything-3B-Q4_K_M.gguf",
      mmprojPath: "/home/reid/DarkFactoryModels/LocateAnything-3B-GGUF/mmproj-LocateAnything-3B-BF16.gguf",
      gpuLayers: "all",
      contextSize: 4096,
      autoStartWithGateway: false,
    },
    profiles: defaultAgentRuntimeProfiles(),
  };
}

export function findAgentProfile(config: AppConfig | AgentRuntimeConfig, profileId?: string): AgentRuntimeProfile {
  const runtime = "agentRuntime" in config ? config.agentRuntime : config;
  const id = profileId ?? runtime.activeProfileId;
  return runtime.profiles.find((profile) => profile.id === id) ?? runtime.profiles[0] ?? defaultAgentRuntimeProfiles()[0];
}

export function applyAgentProfile(config: AppConfig, profileId: string): AppConfig {
  const profile = findAgentProfile(config, profileId);
  const next: AppConfig = JSON.parse(JSON.stringify(config));
  next.agentRuntime.activeProfileId = profile.id;
  next.serverFlags = { ...next.serverFlags, ...profile.serverFlagOverrides };
  next.agentRuntime.gateway.modelAlias = String(next.serverFlags.alias || `atlas/${profile.id}`);
  if (profile.modelPath) {
    next.model.selectedModel = profile.modelPath;
    next.model.directory = profile.modelDirectory ?? profile.modelPath.slice(0, profile.modelPath.lastIndexOf("/"));
  }
  if (profile.gpuOffloadMode) {
    next.gpu = { ...next.gpu, offloadMode: profile.gpuOffloadMode };
  }
  return next;
}
