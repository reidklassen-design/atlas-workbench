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

function httpJson(port: number, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: raw ? "POST" : "GET",
        headers: raw ? { "content-type": "application/json", "content-length": Buffer.byteLength(raw) } : undefined,
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

function configWithGateway(port: number): AppConfig {
  const config = applyAgentProfile(defaultConfig(), "3090-ti-ornith-35b-125k-stable");
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

  it("forwards bounded chat completion requests", async () => {
    const port = await getFreePort();
    if (port === null) return;
    const gateway = new AtlasGateway(fakeFetch());
    gateways.push(gateway);
    await gateway.start({ config: configWithGateway(port) });

    const result = await httpJson(port, "/v1/chat/completions", {
      model: "atlas/3090-ti-ornith-35b-125k-stable",
      messages: [{ role: "user", content: "Change one file." }],
      max_tokens: 1024,
    });
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.json)).toContain("proxied");
    expect(gateway.status().requestCount).toBeGreaterThan(0);
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
      model: "atlas/3090-ti-ornith-35b-125k-stable",
      messages: [{ role: "user", content: huge }],
      max_tokens: 1024,
    });
    expect(result.status).toBe(200);
    expect(gateway.status().compressedCount).toBe(1);
    expect(gateway.status().rejectedCount).toBe(0);
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
      model: "atlas/3090-ti-ornith-35b-125k-stable",
      messages: [{ role: "user", content: huge }],
      max_tokens: 1024,
    });
    expect(result.status).toBe(413);
    expect(JSON.stringify(result.json)).toMatch(/context_budget_exceeded|could not compress/i);
  });
});
