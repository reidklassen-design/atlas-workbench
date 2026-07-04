export type FlagType = "number" | "boolean" | "string" | "enum" | "path";

export type FlagSection =
  | "Server"
  | "Model Loading"
  | "Context & Batching"
  | "Sampling"
  | "Prompts & Templates"
  | "Position Encoding"
  | "Embeddings & Special"
  | "LoRA & Control Vectors"
  | "SSL & Advanced"
  | "Fine-tuning";

export interface FlagDef {
  id: string;
  flag: string;
  negatedFlag?: string;
  label: string;
  section: FlagSection;
  type: FlagType;
  default: string | number | boolean;
  help: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** When true the flag is emitted even for falsy/empty defaults (e.g. host/port). */
  alwaysEmit?: boolean;
}

export interface FinetuneParamDef {
  id: string;
  flag: string;
  negatedFlag?: string;
  label: string;
  type: FlagType;
  default: string | number | boolean;
  help: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  alwaysEmit?: boolean;
}

export interface BinaryPaths {
  server: string;
  finetune: string;
}

export interface ModelState {
  directory: string;
  selectedModel: string;
}

export interface ServerEndpoint {
  host: string;
  port: number;
}

export type GpuOffloadMode = "auto" | "full" | "manual" | "cpu";

export interface GpuConfig {
  autoOffloadInitialized: boolean;
  optimizedProfileVersion: number;
  offloadMode: GpuOffloadMode;
}

export type FlagValues = Record<string, string | number | boolean>;
export type FinetuneValues = Record<string, string | number | boolean>;

export type AgentRuntimeRole = "main-coding" | "compression" | "embedding" | "reranker" | "rescue";
export type OverloadBehavior = "reject" | "compress" | "retrieve";

export interface AgentRequestPolicy {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  reservedSystemTokens: number;
  safetyMarginTokens: number;
  maxPromptTokens: number;
  maxOutputTokens: number;
  maxSingleFileTokens: number;
  maxLogTokens: number;
  requestTimeoutMs: number;
  streamStallTimeoutMs: number;
  overloadBehavior: OverloadBehavior;
}

export interface AgentGatewayConfig {
  enabled: boolean;
  host: string;
  port: number;
  apiKey: string;
  modelAlias: string;
  autoCompressionEnabled: boolean;
}

export interface AgentRuntimeProfile {
  id: string;
  name: string;
  role: AgentRuntimeRole;
  description: string;
  modelPath?: string;
  modelDirectory?: string;
  serverFlagOverrides: FlagValues;
  gpuOffloadMode?: GpuOffloadMode;
  requestPolicy: AgentRequestPolicy;
}

export interface AgentRuntimeConfig {
  activeProfileId: string;
  gateway: AgentGatewayConfig;
  profiles: AgentRuntimeProfile[];
}

export interface AppConfig {
  schemaVersion: number;
  binaryPaths: BinaryPaths;
  gpu: GpuConfig;
  model: ModelState;
  server: ServerEndpoint;
  serverFlags: FlagValues;
  finetune: FinetuneValues;
  agentRuntime: AgentRuntimeConfig;
}

export interface ProcessLogLine {
  stream: "stdout" | "stderr";
  text: string;
  ts: number;
  replaceKey?: string;
}

export interface ProcessStatus {
  kind: "server" | "finetune";
  state: "stopped" | "starting" | "running" | "exited";
  pid?: number;
  exitCode?: number | null;
  external?: boolean;
  cmdline?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface AppError {
  id: string;
  scope: string;
  title: string;
  message: string;
  fix: string;
  retry?: () => void | Promise<void>;
  exitCode?: number | null;
  stderrTail?: string;
  ts: number;
}

export interface CpuMetrics {
  overall: number;
  perCore: number[];
}

export interface RamMetrics {
  used: number;
  total: number;
  percent: number;
}

export interface GpuMetrics {
  detected: boolean;
  name?: string;
  usagePercent?: number;
  memoryUsed?: number;
  memoryTotal?: number;
  temperatureCelsius?: number;
  note?: string;
}

export interface ProcessResource {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryBytes: number;
}

export interface SystemMetrics {
  cpu: CpuMetrics;
  ram: RamMetrics;
  gpu: GpuMetrics;
  runtime?: RuntimeMetrics;
  processes: ProcessResource[];
  ts: number;
}

export interface RuntimeMetrics {
  generationTokensPerSecond?: number;
  promptTokensPerSecond?: number;
  averageGenerationTokensPerSecond?: number;
  averagePromptTokensPerSecond?: number;
  requestsProcessing?: number;
  requestsDeferred?: number;
  contextTokens?: number;
  contextWindowTokens?: number;
  source: "llama.cpp";
}

export type RuntimeHealthState = "healthy" | "degraded" | "unreachable";

export interface RuntimeHealthProbeResult {
  state: RuntimeHealthState;
  endpoint: string;
  checkedAt: number;
  latencyMs: number;
  healthOk: boolean;
  modelsOk: boolean;
  slotsOk?: boolean;
  modelIds: string[];
  reason: string;
}

export interface GatewayStatus {
  running: boolean;
  external?: boolean;
  host: string;
  port: number;
  upstream: string;
  modelAlias: string;
  activeProfileId: string;
  startedAt?: number;
  requestCount: number;
  rejectedCount: number;
  compressedCount?: number;
  compactionActive?: boolean;
  lastCompression?: {
    beforeTokens: number;
    afterTokens: number;
    savedTokens: number;
    ts: number;
  };
  lastError?: string;
  lastBudget?: {
    ok: boolean;
    estimatedPromptTokens: number;
    requestedOutputTokens: number;
    usablePromptTokens: number;
    overflowTokens: number;
    action: "forward" | "reject" | "compress" | "retrieve";
    reasons: string[];
  };
}
