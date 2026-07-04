import type { AgentGatewayConfig, AgentRuntimeProfile } from "@/config/types";

export interface AgentCliSnippets {
  gatewayBaseUrl: string;
  openCodeProviderId: string;
  openCodeModel: string;
  openCodeConfigPath: string;
  openCodeConfigJson: string;
  codexProfileName: string;
  codexProfilePath: string;
  codexProfileToml: string;
  codexRunCommand: string;
  openAiEnv: string;
  healthCheckCommand: string;
}

function localClientHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

export function gatewayBaseUrl(gateway: AgentGatewayConfig): string {
  return `http://${localClientHost(gateway.host)}:${gateway.port}/v1`;
}

const OPEN_CODE_PROVIDER_ID = "atlas-gateway";

function openCodeConfig(gateway: AgentGatewayConfig, profile: AgentRuntimeProfile, baseUrl: string): Record<string, unknown> {
  const policy = profile.requestPolicy;
  return {
    "$schema": "https://opencode.ai/config.json",
    model: `${OPEN_CODE_PROVIDER_ID}/${gateway.modelAlias}`,
    tool_output: {
      max_lines: 300,
      max_bytes: 20000,
    },
    compaction: {
      auto: true,
      prune: true,
      tail_turns: 2,
      preserve_recent_tokens: Math.min(12000, Math.max(4096, policy.maxPromptTokens - policy.maxSingleFileTokens)),
      reserved: policy.reservedOutputTokens,
    },
    provider: {
      [OPEN_CODE_PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: "Atlas Gateway",
        options: {
          baseURL: baseUrl,
          apiKey: gateway.apiKey,
          timeout: policy.requestTimeoutMs,
          headerTimeout: policy.streamStallTimeoutMs,
        },
        models: {
          [gateway.modelAlias]: {
            name: profile.name,
            family: "atlas-local",
            status: "active",
            reasoning: true,
            temperature: true,
            tool_call: true,
            limit: {
              context: policy.contextWindowTokens,
              input: policy.maxPromptTokens,
              output: policy.maxOutputTokens,
            },
          },
        },
      },
    },
  };
}

export function buildAgentCliSnippets(gateway: AgentGatewayConfig, profile: AgentRuntimeProfile): AgentCliSnippets {
  const baseUrl = gatewayBaseUrl(gateway);
  const codexProfileName = "atlas-local";
  const model = gateway.modelAlias;
  const codexProfileToml = [
    `model = "${model}"`,
    `model_provider = "atlas"`,
    `model_context_window = ${profile.requestPolicy.contextWindowTokens}`,
    `approval_policy = "on-request"`,
    `sandbox_mode = "workspace-write"`,
    "",
    "[model_providers.atlas]",
    `name = "Atlas Gateway"`,
    `base_url = "${baseUrl}"`,
    `env_key = "OPENAI_API_KEY"`,
    "",
    "# Atlas Gateway accepts OpenAI-compatible Authorization: Bearer tokens.",
    "# Chat Completions local providers are supported by Codex today; Responses API proxying is the next Atlas hardening step.",
  ].join("\n");

  return {
    gatewayBaseUrl: baseUrl,
    openCodeProviderId: OPEN_CODE_PROVIDER_ID,
    openCodeModel: `${OPEN_CODE_PROVIDER_ID}/${model}`,
    openCodeConfigPath: "~/.config/opencode/opencode.json",
    openCodeConfigJson: JSON.stringify(openCodeConfig(gateway, profile, baseUrl), null, 2),
    codexProfileName,
    codexProfilePath: `~/.codex/${codexProfileName}.config.toml`,
    codexProfileToml,
    codexRunCommand: `codex --profile ${codexProfileName}`,
    openAiEnv: [`export OPENAI_BASE_URL="${baseUrl}"`, `export OPENAI_API_KEY="${gateway.apiKey}"`, `export OPENAI_MODEL="${model}"`].join("\n"),
    healthCheckCommand: `curl -fsS ${baseUrl.replace(/\/v1$/, "")}/health`,
  };
}
