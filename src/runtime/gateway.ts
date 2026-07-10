import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { probeLlamaServerHealth } from "@/runtime/healthWatchdog";
import { evaluateTokenBudget, type TokenBudgetResult } from "@/runtime/tokenBudget";
import { findAgentProfile } from "@/runtime/profiles";
import { compressOpenAiRequest } from "@/runtime/compression";
import type { AppConfig, GatewayStatus, RuntimeHealthProbeResult } from "@/config/types";

export interface AtlasGatewayOptions {
  config: AppConfig;
  fetchImpl?: typeof fetch;
}

function clientHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed || trimmed === "0.0.0.0" || trimmed === "::" || trimmed === "*") return "127.0.0.1";
  return trimmed.replace(/^\[|\]$/g, "");
}

function urlBase(host: string, port: number): string {
  return `http://${clientHost(host)}:${port}`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(raw) });
  res.end(raw);
}

function configuredApiKey(config: AppConfig): string {
  return config.agentRuntime.gateway.apiKey.trim();
}

function requestToken(req: IncomingMessage): string {
  const raw = req.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return "";
  const trimmed = value.trim();
  if (/^bearer\s+/i.test(trimmed)) return trimmed.replace(/^bearer\s+/i, "").trim();
  if (/^basic\s+/i.test(trimmed)) {
    try {
      const decoded = Buffer.from(trimmed.replace(/^basic\s+/i, "").trim(), "base64").toString("utf8");
      return decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : decoded;
    } catch {
      return "";
    }
  }
  return trimmed;
}

function isAuthorized(req: IncomingMessage, config: AppConfig): boolean {
  const apiKey = configuredApiKey(config);
  return apiKey === "" || requestToken(req) === apiKey;
}

function readBody(req: IncomingMessage, limitBytes = 64 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error(`Request body exceeds ${limitBytes} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(messageText).join("\n");
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    return Object.values(obj).map(messageText).join("\n");
  }
  return "";
}

function budgetInputFromOpenAiRequest(body: Record<string, unknown>): {
  systemText: string;
  promptText: string;
  requestedOutputTokens?: number;
} {
  const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
  const systemParts: string[] = [];
  const promptParts: string[] = [];
  for (const message of messages) {
    const text = messageText(message.content);
    if (!text) continue;
    if (message.role === "system" || message.role === "developer") systemParts.push(text);
    else promptParts.push(text);
  }
  if (typeof body.prompt === "string") promptParts.push(body.prompt);
  return {
    systemText: systemParts.join("\n\n"),
    promptText: promptParts.join("\n\n"),
    requestedOutputTokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
  };
}

function structuredJsonOutputRequested(body: Record<string, unknown>): boolean {
  const responseFormat = body.response_format;
  if (responseFormat && typeof responseFormat === "object") {
    const text = JSON.stringify(responseFormat).toLowerCase();
    if (text.includes("json_object") || text.includes("json_schema") || text.includes('"json"')) return true;
  }

  const parts: string[] = [];
  const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
  for (const message of messages) parts.push(messageText(message.content));
  if (typeof body.prompt === "string") parts.push(body.prompt);
  const text = parts.join("\n").toLowerCase();
  return text.includes("json") && (
    text.includes("return only")
    || text.includes("strict json")
    || text.includes("valid json")
    || text.includes("json object")
    || text.includes("json blueprint")
    || text.includes("no markdown")
    || text.includes("no explanation")
  );
}

function normalizeOpenAiRequestForGateway(body: Record<string, unknown>): { body: Record<string, unknown>; structuredOutput: boolean } {
  if (!structuredJsonOutputRequested(body)) return { body, structuredOutput: false };
  const next = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const existing = next.chat_template_kwargs;
  const kwargs = existing && typeof existing === "object" && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};
  kwargs.enable_thinking = false;
  next.chat_template_kwargs = kwargs;
  return { body: next, structuredOutput: true };
}

function withConfiguredSystemPrompt(body: Record<string, unknown>, systemPrompt: string): Record<string, unknown> {
  const prompt = systemPrompt.trim();
  if (!prompt || !Array.isArray(body.messages)) return body;
  const next = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const messages = Array.isArray(next.messages) ? next.messages : [];
  next.messages = [{ role: "system", content: prompt }, ...messages];
  return next;
}

function structuredEmptyContentError(raw: string): Record<string, unknown> | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const choices = Array.isArray(parsed.choices) ? parsed.choices as Array<Record<string, unknown>> : [];
  const reasoningOnly = choices.some((choice) => {
    const message = choice.message as Record<string, unknown> | undefined;
    return message
      && String(message.content ?? "").trim() === ""
      && String(message.reasoning_content ?? "").trim() !== "";
  });
  if (!reasoningOnly) return null;
  return {
    error: {
      message: "Atlas blocked an upstream reasoning-only response: the model returned hidden reasoning_content but empty final message.content for a structured JSON request. Atlas should disable thinking for structured output; retry the request.",
      type: "atlas_structured_empty_content",
    },
  };
}

async function proxyFetch(
  fetchImpl: typeof fetch,
  upstreamUrl: string,
  req: IncomingMessage,
  res: ServerResponse,
  body?: string,
  options: { structuredOutput?: boolean } = {},
): Promise<void> {
  const headers: Record<string, string> = {};
  const contentType = req.headers["content-type"];
  const accept = req.headers.accept;
  if (contentType) headers["content-type"] = Array.isArray(contentType) ? contentType.join(",") : contentType;
  if (accept) headers.accept = Array.isArray(accept) ? accept.join(",") : accept;
  const upstream = await fetchImpl(upstreamUrl, {
    method: req.method,
    headers,
    body: body === undefined || req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
  if (options.structuredOutput) {
    const text = await upstream.text();
    const emptyContentError = structuredEmptyContentError(text);
    if (upstream.status >= 200 && upstream.status < 300 && emptyContentError) {
      sendJson(res, 502, emptyContentError);
      return;
    }
    const headers = Object.fromEntries(upstream.headers.entries());
    headers["content-length"] = String(Buffer.byteLength(text));
    res.writeHead(upstream.status, headers);
    res.end(text);
    return;
  }
  res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

export class AtlasGateway {
  private server: Server | null = null;
  private config: AppConfig | null = null;
  private fetchImpl: typeof fetch;
  private startedAt?: number;
  private requestCount = 0;
  private rejectedCount = 0;
  private compressedCount = 0;
  private compactionActive = false;
  private lastError?: string;
  private lastBudget?: TokenBudgetResult;
  private lastCompression?: GatewayStatus["lastCompression"];

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  get running(): boolean {
    return this.server !== null;
  }

  async start(options: AtlasGatewayOptions): Promise<GatewayStatus> {
    if (this.server) await this.stop();
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? this.fetchImpl;
    this.startedAt = Date.now();
    this.requestCount = 0;
    this.rejectedCount = 0;
    this.compressedCount = 0;
    this.compactionActive = false;
    this.lastError = undefined;
    this.lastBudget = undefined;
    this.lastCompression = undefined;
    const gateway = options.config.agentRuntime.gateway;
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res).catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        sendJson(res, 502, { error: { message: this.lastError, type: "atlas_gateway_error" } });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(gateway.port, gateway.host, () => resolve());
    });
    return this.status();
  }

  async stop(): Promise<GatewayStatus> {
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    return this.status();
  }

  async health(): Promise<RuntimeHealthProbeResult | null> {
    if (!this.config) return null;
    return probeLlamaServerHealth({
      host: this.config.server.host,
      port: this.config.server.port,
      fetchImpl: this.fetchImpl,
    });
  }

  status(): GatewayStatus {
    const config = this.config;
    const gateway = config?.agentRuntime.gateway;
    return {
      running: this.running,
      external: false,
      host: gateway?.host ?? "127.0.0.1",
      port: gateway?.port ?? 18080,
      upstream: config ? urlBase(config.server.host, config.server.port) : "",
      modelAlias: gateway?.modelAlias ?? "atlas/local",
      activeProfileId: config?.agentRuntime.activeProfileId ?? "",
      startedAt: this.startedAt,
      requestCount: this.requestCount,
      rejectedCount: this.rejectedCount,
      compressedCount: this.compressedCount,
      compactionActive: this.compactionActive,
      lastCompression: this.lastCompression,
      lastError: this.lastError,
      lastBudget: this.lastBudget,
    };
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.config) {
      sendJson(res, 503, { error: { message: "Atlas Gateway is not configured.", type: "atlas_gateway_unconfigured" } });
      return;
    }
    this.requestCount += 1;
    const path = new URL(req.url ?? "/", "http://atlas.local").pathname;
    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { status: "ok", gateway: this.status(), upstream: await this.health() });
      return;
    }
    if (!isAuthorized(req, this.config)) {
      this.rejectedCount += 1;
      sendJson(res, 401, { error: { message: "Atlas Gateway requires Authorization: Bearer <api key>.", type: "unauthorized" } });
      return;
    }
    if (req.method === "GET" && path === "/v1/models") {
      await proxyFetch(this.fetchImpl, `${urlBase(this.config.server.host, this.config.server.port)}/v1/models`, req, res);
      return;
    }
    if (req.method === "POST" && (path === "/v1/chat/completions" || path === "/v1/completions")) {
      const body = await readBody(req);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { error: { message: "Request body must be JSON.", type: "invalid_request_error" } });
        return;
      }
      const withSystemPrompt = path === "/v1/chat/completions" ? withConfiguredSystemPrompt(parsed, this.config.systemPrompt) : parsed;
      const normalized = normalizeOpenAiRequestForGateway(withSystemPrompt);
      const profile = findAgentProfile(this.config);
      const budget = evaluateTokenBudget(budgetInputFromOpenAiRequest(normalized.body), profile.requestPolicy);
      this.lastBudget = budget;
      if (!budget.ok) {
        if (budget.action === "compress" || this.config.agentRuntime.gateway.autoCompressionEnabled) {
          this.compactionActive = true;
          const compressed = compressOpenAiRequest(normalized.body, budget.usablePromptTokens);
          const compressedBudget = evaluateTokenBudget(budgetInputFromOpenAiRequest(compressed.body), profile.requestPolicy);
          this.lastBudget = compressedBudget;
          if (compressed.compressed && compressedBudget.ok) {
            this.compressedCount += 1;
            this.lastCompression = {
              beforeTokens: budget.estimatedPromptTokens,
              afterTokens: compressedBudget.estimatedPromptTokens,
              savedTokens: Math.max(0, budget.estimatedPromptTokens - compressedBudget.estimatedPromptTokens),
              ts: Date.now(),
            };
            try {
              await proxyFetch(this.fetchImpl, `${urlBase(this.config.server.host, this.config.server.port)}${path}`, req, res, JSON.stringify(compressed.body), { structuredOutput: normalized.structuredOutput });
            } finally {
              this.compactionActive = false;
            }
            return;
          }
          this.compactionActive = false;
        }
        this.rejectedCount += 1;
        sendJson(res, 413, {
          error: {
            message: `Atlas could not compress this request enough to fit the active profile budget: ${budget.reasons.join(" ")}`,
            type: "atlas_context_budget_exceeded",
            budget,
          },
        });
        return;
      }
      await proxyFetch(this.fetchImpl, `${urlBase(this.config.server.host, this.config.server.port)}${path}`, req, res, JSON.stringify(normalized.body), { structuredOutput: normalized.structuredOutput });
      return;
    }
    sendJson(res, 404, { error: { message: `Atlas Gateway route not found: ${path}`, type: "not_found" } });
  }
}
