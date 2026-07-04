// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defaultAgentRuntimeConfig, findAgentProfile } from "@/runtime/profiles";
import { buildAgentCliSnippets, gatewayBaseUrl } from "@/runtime/cliSnippets";

describe("agent CLI snippets", () => {
  it("normalizes wildcard hosts for local CLI clients", () => {
    const runtime = defaultAgentRuntimeConfig();
    expect(gatewayBaseUrl({ ...runtime.gateway, host: "0.0.0.0" })).toBe("http://127.0.0.1:18080/v1");
    expect(gatewayBaseUrl({ ...runtime.gateway, host: "::" })).toBe("http://127.0.0.1:18080/v1");
  });

  it("builds OpenCode config from the active runtime profile", () => {
    const runtime = defaultAgentRuntimeConfig();
    const profile = findAgentProfile(runtime);
    const snippets = buildAgentCliSnippets(runtime.gateway, profile);
    const config = JSON.parse(snippets.openCodeConfigJson);

    expect(config.model).toBe("atlas-gateway/atlas/3090-ti-ornith-35b-96k-always-on");
    expect(config.provider["atlas-gateway"].options.baseURL).toBe("http://127.0.0.1:18080/v1");
    expect(config.provider["atlas-gateway"].models[runtime.gateway.modelAlias].limit.context).toBe(98304);
    expect(config.provider["atlas-gateway"].models[runtime.gateway.modelAlias].limit.input).toBe(profile.requestPolicy.maxPromptTokens);
    expect(config.compaction.auto).toBe(true);
  });

  it("builds a user-level Codex profile for the Atlas provider", () => {
    const runtime = defaultAgentRuntimeConfig();
    const profile = findAgentProfile(runtime);
    const snippets = buildAgentCliSnippets(runtime.gateway, profile);

    expect(snippets.codexProfilePath).toBe("~/.codex/atlas-local.config.toml");
    expect(snippets.codexRunCommand).toBe("codex --profile atlas-local");
    expect(snippets.codexProfileToml).toContain('model_provider = "atlas"');
    expect(snippets.codexProfileToml).toContain('base_url = "http://127.0.0.1:18080/v1"');
    expect(snippets.codexProfileToml).toContain("model_context_window = 98304");
  });
});
