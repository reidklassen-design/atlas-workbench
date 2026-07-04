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

async function proxyFetch(
  fetchImpl: typeof fetch,
  upstreamUrl: string,
  req: IncomingMessage,
  res: ServerResponse,
  body?: string,
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
  private lastError?: string;
  private lastBudget?: TokenBudgetResult;

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
    this.lastError = undefined;
    this.lastBudget = undefined;
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
      host: gateway?.host ?? "127.0.0.1",
      port: gateway?.port ?? 18080,
      upstream: config ? urlBase(config.server.host, config.server.port) : "",
      modelAlias: gateway?.modelAlias ?? "atlas/local",
      activeProfileId: config?.agentRuntime.activeProfileId ?? "",
      startedAt: this.startedAt,
      requestCount: this.requestCount,
      rejectedCount: this.rejectedCount,
      compressedCount: this.compressedCount,
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
      const profile = findAgentProfile(this.config);
      const budget = evaluateTokenBudget(budgetInputFromOpenAiRequest(parsed), profile.requestPolicy);
      this.lastBudget = budget;
      if (!budget.ok) {
        if (budget.action === "compress" || this.config.agentRuntime.gateway.autoCompressionEnabled) {
          const compressed = compressOpenAiRequest(parsed, budget.usablePromptTokens);
          const compressedBudget = evaluateTokenBudget(budgetInputFromOpenAiRequest(compressed.body), profile.requestPolicy);
          this.lastBudget = compressedBudget;
          if (compressed.compressed && compressedBudget.ok) {
            this.compressedCount += 1;
            await proxyFetch(this.fetchImpl, `${urlBase(this.config.server.host, this.config.server.port)}${path}`, req, res, JSON.stringify(compressed.body));
            return;
          }
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
      await proxyFetch(this.fetchImpl, `${urlBase(this.config.server.host, this.config.server.port)}${path}`, req, res, body);
      return;
    }
    sendJson(res, 404, { error: { message: `Atlas Gateway route not found: ${path}`, type: "not_found" } });
  }
}
