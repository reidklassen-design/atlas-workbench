import type { RuntimeHealthProbeResult, RuntimeHealthState } from "@/config/types";

export interface RuntimeHealthProbeOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function clientHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed || trimmed === "0.0.0.0" || trimmed === "::") return "127.0.0.1";
  return trimmed;
}

function endpointFor(host: string, port: number): string {
  return `http://${clientHost(host)}:${port}`;
}

async function fetchText(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function parseModelIds(raw: string): string[] {
  try {
    const data = JSON.parse(raw) as { data?: Array<{ id?: string }>; models?: Array<{ model?: string; name?: string }> };
    const ids = [
      ...(Array.isArray(data.data) ? data.data.map((item) => item.id) : []),
      ...(Array.isArray(data.models) ? data.models.map((item) => item.model ?? item.name) : []),
    ];
    return ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  } catch {
    return [];
  }
}

export async function probeLlamaServerHealth(options: RuntimeHealthProbeOptions): Promise<RuntimeHealthProbeResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 3000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = endpointFor(options.host, options.port);
  const checkedAt = Date.now();
  try {
    const health = await fetchText(fetchImpl, `${endpoint}/health`, timeoutMs);
    const models = await fetchText(fetchImpl, `${endpoint}/v1/models`, timeoutMs);
    const slots = await fetchText(fetchImpl, `${endpoint}/slots`, timeoutMs).catch(() => null);
    const modelIds = parseModelIds(models.text);
    const healthOk = health.ok;
    const modelsOk = models.ok && modelIds.length > 0;
    const slotsOk = slots ? slots.ok : undefined;
    const state: RuntimeHealthState = healthOk && modelsOk ? "healthy" : "degraded";
    const reason =
      state === "healthy"
        ? "llama.cpp health and model endpoints are responding."
        : `Health endpoint ${health.status}; models endpoint ${models.status}; models discovered ${modelIds.length}.`;
    return {
      state,
      endpoint,
      checkedAt,
      latencyMs: Date.now() - started,
      healthOk,
      modelsOk,
      slotsOk,
      modelIds,
      reason,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      state: "unreachable",
      endpoint,
      checkedAt,
      latencyMs: Date.now() - started,
      healthOk: false,
      modelsOk: false,
      modelIds: [],
      reason: message,
    };
  }
}
