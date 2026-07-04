// @vitest-environment node
import { describe, expect, it } from "vitest";
import { probeLlamaServerHealth } from "@/runtime/healthWatchdog";

function response(body: string, init: { status?: number } = {}): Response {
  return new Response(body, { status: init.status ?? 200 });
}

describe("llama.cpp health watchdog", () => {
  it("reports healthy when health and models endpoints respond", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/health")) return response("ok");
      if (url.endsWith("/v1/models")) return response(JSON.stringify({ data: [{ id: "local/code-model" }] }));
      if (url.endsWith("/slots")) return response("[]");
      return response("not found", { status: 404 });
    };

    const result = await probeLlamaServerHealth({ host: "0.0.0.0", port: 8099, fetchImpl });
    expect(result.state).toBe("healthy");
    expect(result.endpoint).toBe("http://127.0.0.1:8099");
    expect(result.modelIds).toEqual(["local/code-model"]);
    expect(calls).toContain("http://127.0.0.1:8099/health");
  });

  it("reports degraded when the process answers but model discovery is broken", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) return response("ok");
      if (url.endsWith("/v1/models")) return response(JSON.stringify({ data: [] }));
      return response("not found", { status: 404 });
    };

    const result = await probeLlamaServerHealth({ host: "127.0.0.1", port: 8099, fetchImpl });
    expect(result.state).toBe("degraded");
    expect(result.healthOk).toBe(true);
    expect(result.modelsOk).toBe(false);
  });

  it("reports unreachable when HTTP probing fails", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("connection refused");
    };

    const result = await probeLlamaServerHealth({ host: "127.0.0.1", port: 8099, fetchImpl });
    expect(result.state).toBe("unreachable");
    expect(result.reason).toMatch(/connection refused/i);
  });
});
