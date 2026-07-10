// @vitest-environment node
import { describe, expect, it, afterEach } from "vitest";
import { createServer, request as httpRequest } from "node:http";
import { AtlasGateway } from "@/runtime/gateway";
import { applyAgentProfile } from "@/runtime/profiles";
import { defaultConfig } from "@/config/defaults";
import type { AppConfig } from "@/config/types";

async function getFreePort(): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("no port"));
      }
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPERM" || err.code === "EACCES") resolve(null);
      else reject(err);
    });
  });
}

function httpJson(port: number, path: string, body?: unknown, apiKey = "atlas-local"): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string | number> = {};
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    if (raw) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(raw);
    }
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: raw ? "POST" : "GET",
        headers,
      },
      (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => {
          text += chunk.toString("utf8");
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) as Record<string, unknown> : {} });
        });
      },
    );
    req.on("error", reject);
    if (raw) req.write(raw);
    req.end();
  });
}

function fakeFetch(seenBodies: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    if (url.endsWith("/v1/models")) return new Response(JSON.stringify({ data: [{ id: "fake/upstream" }] }), { status: 200 });
    if (url.endsWith("/slots")) return new Response("[]", { status: 200 });
    if (url.endsWith("/v1/chat/completions")) {
      seenBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "proxied" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }) as typeof fetch;
}

function reasoningOnlyFetch(seenBodies: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    if (url.endsWith("/v1/models")) return new Response(JSON.stringify({ data: [{ id: "fake/upstream" }] }), { status: 200 });
    if (url.endsWith("/v1/chat/completions")) {
      seenBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "", reasoning_content: "I spent the whole budget thinking." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }) as typeof fetch;
}

function configWithGateway(port: number): AppConfig {
  const config = applyAgentProfile(defaultConfig(), "3090-ti-ornith-35b-96k-always-on");
  config.agentRuntime.gateway.port = port;
  config.server.port = 8099;
  return config;
}

const gateways: AtlasGateway[] = [];
afterEach(async () => {
  for (const gateway of gateways.splice(0)) {
    await gateway.stop().catch(() => undefined);
  }
});

describe("AtlasGateway", () => {
  it("serves health and proxies models", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const gateway = new AtlasGateway(fakeFetch());
    gateways.push(gateway);
    await gateway.start({ config: configWithGateway(port) });

    const health = await httpJson(port, "/health");
    expect(health.status).toBe(200);
    expect(health.json.status).toBe("ok");

    const models = await httpJson(port, "/v1/models");
    expect(models.status).toBe(200);
    expect(models.json).toEqual({ data: [{ id: "fake/upstream" }] });
  });

  it("requires the configured api key for OpenAI-compatible routes", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const gateway = new AtlasGateway(fakeFetch());
    gateways.push(gateway);
    await gateway.start({ config: configWithGateway(port) });

    const health = await httpJson(port, "/health", undefined, "");
    expect(health.status).toBe(200);

    const models = await httpJson(port, "/v1/models", undefined, "");
    expect(models.status).toBe(401);
    expect(JSON.stringify(models.json)).toContain("unauthorized");
  });

  it("forwards bounded chat completion requests", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const gateway = new AtlasGateway(fakeFetch());
    gateways.push(gateway);
    await gateway.start({ config: configWithGateway(port) });

    const result = await httpJson(port, "/v1/chat/completions", {
      model: "atlas/3090-ti-ornith-35b-96k-always-on",
      messages: [{ role: "user", content: "Change one file." }],
      max_tokens: 1024,
    });
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.json)).toContain("proxied");
    expect(gateway.status().requestCount).toBeGreaterThan(0);
  });

  it("prepends the configured system prompt to chat completion requests", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const seenBodies: string[] = [];
    const gateway = new AtlasGateway(fakeFetch(seenBodies));
    gateways.push(gateway);
    const config = configWithGateway(port);
    config.systemPrompt = "You are Atlas. Be direct.";
    await gateway.start({ config });

    const result = await httpJson(port, "/v1/chat/completions", {
      model: "atlas/3090-ti-ornith-35b-96k-always-on",
      messages: [{ role: "user", content: "What model is loaded?" }],
      max_tokens: 1024,
    });

    expect(result.status).toBe(200);
    const forwarded = JSON.parse(seenBodies[0]) as { messages: Array<Record<string, unknown>> };
    expect(forwarded.messages[0]).toEqual({ role: "system", content: "You are Atlas. Be direct." });
    expect(forwarded.messages[1]).toEqual({ role: "user", content: "What model is loaded?" });
  });

  it("disables model thinking for structured JSON requests", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const seenBodies: string[] = [];
    const gateway = new AtlasGateway(fakeFetch(seenBodies));
    gateways.push(gateway);
    await gateway.start({ config: configWithGateway(port) });

    const result = await httpJson(port, "/v1/chat/completions", {
      model: "atlas/3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu",
      messages: [
        { role: "system", content: "You generate project plans." },
        { role: "user", content: "Return only the JSON blueprint. No markdown." },
      ],
      max_tokens: 8192,
    });

    expect(result.status).toBe(200);
    const forwarded = JSON.parse(seenBodies[0]) as Record<string, unknown>;
    expect(forwarded.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("does not disable thinking for ordinary coding requests", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const seenBodies: string[] = [];
    const gateway = new AtlasGateway(fakeFetch(seenBodies));
    gateways.push(gateway);
    await gateway.start({ config: configWithGateway(port) });

    const result = await httpJson(port, "/v1/chat/completions", {
      model: "atlas/3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu",
      messages: [{ role: "user", content: "Think through this refactor and explain the tradeoffs." }],
      max_tokens: 4096,
    });

    expect(result.status).toBe(200);
    const forwarded = JSON.parse(seenBodies[0]) as Record<string, unknown>;
    expect(forwarded.chat_template_kwargs).toBeUndefined();
  });

  it("blocks reasoning-only empty content for structured requests", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const seenBodies: string[] = [];
    const gateway = new AtlasGateway(reasoningOnlyFetch(seenBodies));
    gateways.push(gateway);
    await gateway.start({ config: configWithGateway(port) });

    const result = await httpJson(port, "/v1/chat/completions", {
      model: "atlas/3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu",
      messages: [{ role: "user", content: "Return only valid JSON." }],
      max_tokens: 8192,
    });

    expect(result.status).toBe(502);
    expect(JSON.stringify(result.json)).toContain("atlas_structured_empty_content");
    const forwarded = JSON.parse(seenBodies[0]) as Record<string, unknown>;
    expect(forwarded.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("compresses oversized prompts before forwarding", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const seenBodies: string[] = [];
    const gateway = new AtlasGateway(fakeFetch(seenBodies));
    gateways.push(gateway);
    const config = configWithGateway(port);
    await gateway.start({ config });
    const huge = "token ".repeat(120000);

    const result = await httpJson(port, "/v1/chat/completions", {
      model: "atlas/3090-ti-ornith-35b-96k-always-on",
      messages: [{ role: "user", content: huge }],
      max_tokens: 1024,
    });
    expect(result.status).toBe(200);
    const status = gateway.status();
    expect(status.compressedCount).toBe(1);
    expect(status.rejectedCount).toBe(0);
    expect(status.compactionActive).toBe(false);
    expect(status.lastCompression?.beforeTokens).toBeGreaterThan(status.lastCompression?.afterTokens ?? 0);
    expect(status.lastBudget?.estimatedPromptTokens).toBeLessThanOrEqual(status.lastBudget?.usablePromptTokens ?? 0);
    expect(seenBodies[0]).toContain("Atlas automatic compression");
  });

  it("rejects oversized prompts when automatic compression is disabled", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const gateway = new AtlasGateway(fakeFetch());
    gateways.push(gateway);
    const config = configWithGateway(port);
    config.agentRuntime.gateway.autoCompressionEnabled = false;
    await gateway.start({ config });
    const huge = "token ".repeat(120000);

    const result = await httpJson(port, "/v1/chat/completions", {
      model: "atlas/3090-ti-ornith-35b-96k-always-on",
      messages: [{ role: "user", content: huge }],
      max_tokens: 1024,
    });
    expect(result.status).toBe(413);
    expect(JSON.stringify(result.json)).toMatch(/context_budget_exceeded|could not compress/i);
  });
});
