import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { useAppController, useControllerState } from "@/state/reactBinding";
import type { AgentRuntimeProfile, RuntimeHealthProbeResult } from "@/config/types";
import { buildAgentCliSnippets } from "@/runtime/cliSnippets";
import { findAgentProfile } from "@/runtime/profiles";

function fmtTokens(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function healthClass(health: RuntimeHealthProbeResult | null): string {
  if (!health) return "text-slate-300";
  if (health.state === "healthy") return "text-emerald-300";
  if (health.state === "degraded") return "text-amber-300";
  return "text-red-300";
}

export function AgentRuntimeTab(): JSX.Element {
  const controller = useAppController();
  const config = useControllerState((c) => c.config);
  const gateway = useControllerState((c) => c.gateway);
  const health = useControllerState((c) => c.runtimeHealth);
  const [busy, setBusy] = useState<string | null>(null);
  const activeProfile = useMemo(
    () => findAgentProfile(config),
    [config],
  );
  const cliSnippets = useMemo(() => buildAgentCliSnippets(config.agentRuntime.gateway, activeProfile), [activeProfile, config.agentRuntime.gateway]);
  const [copied, setCopied] = useState<string | null>(null);

  async function applyProfile(profile: AgentRuntimeProfile): Promise<void> {
    setBusy(`profile:${profile.id}`);
    await controller.applyAgentProfile(profile.id);
    setBusy(null);
  }

  async function startGateway(): Promise<void> {
    setBusy("gateway:start");
    await controller.startGateway();
    setBusy(null);
  }

  async function stopGateway(): Promise<void> {
    setBusy("gateway:stop");
    await controller.stopGateway();
    setBusy(null);
  }

  async function checkHealth(): Promise<void> {
    setBusy("health");
    await controller.refreshRuntimeHealth();
    setBusy(null);
  }

  async function copySnippet(id: string, value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1600);
  }

  function snippetBlock(id: string, title: string, value: string, path?: string): JSX.Element {
    return (
      <div className="rounded-lg border border-slate-700 bg-black/25 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">{title}</div>
            {path ? <div className="mt-1 break-all text-xs text-slate-500">{path}</div> : null}
          </div>
          <button type="button" className="btn-ghost" onClick={() => void copySnippet(id, value)} data-testid={`copy-${id}`}>
            {copied === id ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-slate-800 bg-slate-950/80 p-3 text-xs leading-relaxed text-slate-200" data-testid={`snippet-${id}`}>
          <code>{value}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Agent Runtime</h2>
            <p className="mt-1 text-sm text-slate-400">Atlas sits between OpenCode and llama.cpp, applies profiles, checks health, and blocks unsafe context before it reaches the model.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={gateway.running || busy === "gateway:start"} onClick={() => void startGateway()} data-testid="gateway-start">
              {busy === "gateway:start" ? "Starting..." : "Start Gateway"}
            </button>
            <button type="button" className="btn-danger" disabled={!gateway.running || gateway.external || busy === "gateway:stop"} onClick={() => void stopGateway()} data-testid="gateway-stop">
              Stop Gateway
            </button>
            <button type="button" className="btn-ghost" disabled={busy === "health"} onClick={() => void checkHealth()} data-testid="runtime-health-check">
              {busy === "health" ? "Checking..." : "Check Health"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <div className="rounded-lg border border-slate-700 bg-black/20 p-3">
            <div className="text-xs text-slate-400">Gateway</div>
            <div className={gateway.running ? "mt-1 text-lg font-semibold text-emerald-300" : "mt-1 text-lg font-semibold text-slate-300"} data-testid="gateway-state">
              {gateway.running ? "Running" : "Stopped"}
            </div>
            {gateway.external ? <div className="mt-1 text-xs text-slate-500">Managed service</div> : null}
          </div>
          <div className="rounded-lg border border-slate-700 bg-black/20 p-3">
            <div className="text-xs text-slate-400">Active Profile</div>
            <div className="mt-1 break-words text-lg font-semibold text-white" data-testid="active-runtime-profile">{activeProfile?.name ?? "None"}</div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-black/20 p-3">
            <div className="text-xs text-slate-400">Upstream Health</div>
            <div className={clsx("mt-1 text-lg font-semibold capitalize", healthClass(health))} data-testid="runtime-health-state">{health?.state ?? "Not checked"}</div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-black/20 p-3">
            <div className="text-xs text-slate-400">Blocked Requests</div>
            <div className="mt-1 text-lg font-semibold text-white" data-testid="gateway-rejected-count">{gateway.rejectedCount}</div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-black/20 p-3">
            <div className="text-xs text-slate-400">Auto Compression</div>
            <div className={config.agentRuntime.gateway.autoCompressionEnabled ? "mt-1 text-lg font-semibold text-emerald-300" : "mt-1 text-lg font-semibold text-slate-300"} data-testid="gateway-compression-state">
              {config.agentRuntime.gateway.autoCompressionEnabled ? "On" : "Off"}
            </div>
            <div className="mt-1 text-xs text-slate-500" data-testid="gateway-compressed-count">{gateway.compressedCount ?? 0} compressed</div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-700 bg-black/30 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">OpenCode Endpoint</div>
          <code className="block break-all text-xs text-slate-200" data-testid="opencode-endpoint">Base URL: {cliSnippets.gatewayBaseUrl}</code>
          <code className="mt-1 block break-all text-xs text-slate-200" data-testid="opencode-model">Model: {config.agentRuntime.gateway.modelAlias}</code>
          <code className="mt-1 block break-all text-xs text-slate-200">API key: {config.agentRuntime.gateway.apiKey}</code>
        </div>

        {health ? (
          <div className="mt-4 rounded-lg border border-slate-700 bg-black/20 p-3 text-sm">
            <div className="text-xs text-slate-400">Last health check</div>
            <div className="mt-1 text-slate-200" data-testid="runtime-health-reason">{health.reason}</div>
            <div className="mt-1 text-xs text-slate-500">{health.endpoint} in {health.latencyMs}ms; models: {health.modelIds.length ? health.modelIds.join(", ") : "none"}</div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {config.agentRuntime.profiles.map((profile) => {
          const active = profile.id === config.agentRuntime.activeProfileId;
          const policy = profile.requestPolicy;
          return (
            <div key={profile.id} className={clsx("card p-4", active ? "border-accent/70 bg-accent/10" : "")} data-testid={`runtime-profile-${profile.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">{profile.name}</h3>
                  <p className="mt-1 text-xs uppercase tracking-wide text-accent">{profile.role}</p>
                </div>
                <button type="button" className={active ? "btn-ghost" : "btn-primary"} disabled={active || busy === `profile:${profile.id}`} onClick={() => void applyProfile(profile)} data-testid={`apply-profile-${profile.id}`}>
                  {active ? "Active" : busy === `profile:${profile.id}` ? "Applying..." : "Apply"}
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-400">{profile.description}</p>
              {profile.modelPath ? (
                <div className="mt-3 rounded-lg border border-slate-700 bg-black/20 p-2">
                  <div className="text-xs text-slate-500">Model</div>
                  <div className="mt-1 break-all text-xs text-slate-200" data-testid={`runtime-profile-model-${profile.id}`}>{profile.modelPath}</div>
                </div>
              ) : null}
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-slate-700 bg-black/20 p-2">
                  <div className="text-xs text-slate-500">Context</div>
                  <div className="text-slate-100">{fmtTokens(policy.contextWindowTokens)}</div>
                </div>
                <div className="rounded-lg border border-slate-700 bg-black/20 p-2">
                  <div className="text-xs text-slate-500">Usable Prompt</div>
                  <div className="text-slate-100">{fmtTokens(policy.maxPromptTokens)}</div>
                </div>
                <div className="rounded-lg border border-slate-700 bg-black/20 p-2">
                  <div className="text-xs text-slate-500">Output Reserve</div>
                  <div className="text-slate-100">{fmtTokens(policy.reservedOutputTokens)}</div>
                </div>
                <div className="rounded-lg border border-slate-700 bg-black/20 p-2">
                  <div className="text-xs text-slate-500">Overload</div>
                  <div className="capitalize text-slate-100">{policy.overloadBehavior}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">CLI Setup</h2>
            <p className="mt-1 text-sm text-slate-400">Point OpenCode, Codex, or any OpenAI-compatible client at the Atlas gateway so profiles, timeouts, and token budget checks stay centralized.</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-black/25 px-3 py-2 text-xs text-slate-300">
            <div>Provider: {cliSnippets.openCodeProviderId}</div>
            <div className="mt-1 break-all">Model: {cliSnippets.openCodeModel}</div>
            <div className="mt-1">Run Codex: <code>{cliSnippets.codexRunCommand}</code></div>
          </div>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {snippetBlock("opencode", "OpenCode config", cliSnippets.openCodeConfigJson, cliSnippets.openCodeConfigPath)}
          {snippetBlock("codex", "Codex profile", cliSnippets.codexProfileToml, cliSnippets.codexProfilePath)}
          {snippetBlock("env", "OpenAI-compatible env", cliSnippets.openAiEnv)}
          {snippetBlock("health", "Gateway health check", cliSnippets.healthCheckCommand)}
        </div>
      </div>
    </div>
  );
}
