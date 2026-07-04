import { useEffect, useMemo, useState } from "react";
import { useAppController, useControllerState } from "@/state/reactBinding";
import { StatusIndicator } from "@/ui/components/StatusIndicator";
import { LogPanel } from "@/ui/components/LogPanel";
import { buildRedactedServerCommandString, describeGpuOffload, gpuOffloadMode } from "@/process/flagBuilder";
import type { AppConfig, GpuOffloadMode, ProcessLogLine, ProcessStatus } from "@/config/types";

const SERVER_READY_TIMEOUT_SECONDS = 600;

function latestTokensPerSecond(logs: { text: string }[]): string | null {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const match = logs[i].text.match(/([0-9]+(?:\.[0-9]+)?)\s+tokens?\s*(?:per\s*second|\/s|t\/s)/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function useElapsedSeconds(active: boolean, startedAt?: number): number {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!active) {
      setNow(Date.now());
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  if (!active || !startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function launchPhase(logs: ProcessLogLine[]): string {
  const text = logs.map((line) => line.text).join("\n");
  if (/health check passed|reported healthy|server ready|listening/i.test(text)) return "Readiness check passed";
  if (/waiting for llama-server health|health check|health at http/i.test(text)) return "Waiting for health endpoint";
  if (/load|model|gguf|llama_model_loader/i.test(text)) return "Loading model weights";
  if (/launching|start requested|process spawned/i.test(text)) return "Starting llama-server process";
  return "Preparing launch";
}

function latestLaunchSignal(logs: ProcessLogLine[]): ProcessLogLine | null {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const text = logs[i].text.trim();
    if (text) return logs[i];
  }
  return null;
}

function healthProbeUrl(config: AppConfig): string {
  const listenHost = config.server.host.trim();
  const host = listenHost === "" || listenHost === "0.0.0.0" || listenHost === "::" || listenHost === "*" ? "127.0.0.1" : listenHost.replace(/^\[|\]$/g, "");
  const displayHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${displayHost}:${config.server.port}/health`;
}

function ServerLaunchProgress({ config, status, logs, command }: { config: AppConfig; status: ProcessStatus; logs: ProcessLogLine[]; command: string }): JSX.Element | null {
  const active = status.state === "starting";
  const elapsed = useElapsedSeconds(active, status.startedAt);
  const latest = useMemo(() => latestLaunchSignal(logs), [logs]);
  const modelName = config.model.selectedModel.split("/").pop() || "No model selected";
  const remaining = Math.max(0, SERVER_READY_TIMEOUT_SECONDS - elapsed);
  const healthUrl = healthProbeUrl(config);

  if (!active) return null;

  return (
    <div className="card border-accent/50 bg-accent/10 p-4" role="status" aria-live="polite" data-testid="server-launch-progress">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">Loading Model</h2>
          <p className="mt-1 text-sm text-slate-200" data-testid="server-launch-phase">{launchPhase(logs)}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-panel px-3 py-2 text-right text-sm text-slate-200" data-testid="server-launch-elapsed">
          <div>{elapsed}s elapsed</div>
          <div className="text-xs text-slate-400">{remaining}s before timeout</div>
        </div>
      </div>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border border-slate-700 bg-black/20 p-3">
          <div className="text-xs text-slate-400">Model</div>
          <div className="mt-1 break-all text-slate-100" data-testid="server-launch-model">{modelName}</div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-black/20 p-3">
          <div className="text-xs text-slate-400">Health probe</div>
          <div className="mt-1 break-all text-slate-100" data-testid="server-launch-endpoint">{healthUrl}</div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-black/20 p-3">
          <div className="text-xs text-slate-400">Process</div>
          <div className="mt-1 text-slate-100" data-testid="server-launch-pid">{status.pid ? `pid ${status.pid}` : "Waiting for pid"}</div>
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-slate-700 bg-black/30 p-3">
        <div className="text-xs text-slate-400">Latest output</div>
        <div className={latest?.stream === "stderr" ? "mt-1 break-words text-sm text-rose-200" : "mt-1 break-words text-sm text-slate-100"} data-testid="server-launch-latest">
          {latest?.text ?? "Waiting for llama-server output or health probe logs."}
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-slate-700 bg-black/30 p-3">
        <div className="text-xs text-slate-400">Command</div>
        <code className="mt-1 block whitespace-pre-wrap break-all text-xs text-slate-200" data-testid="server-launch-command">{command}</code>
      </div>
    </div>
  );
}

export function ServerTab(): JSX.Element {
  const controller = useAppController();
  const config = useControllerState((c) => c.config);
  const status = useControllerState((c) => c.server);
  const logs = useControllerState((c) => c.serverLogs);
  const metrics = useControllerState((c) => c.metrics);
  const running = status.state === "running" || status.state === "starting";
  const gpuLayers = Number(config.serverFlags["n-gpu-layers"] ?? 0);
  const gpuMode = gpuOffloadMode(config);
  const command = buildRedactedServerCommandString(config);
  const liveTokensPerSecond = finiteNumber(metrics?.runtime?.generationTokensPerSecond);
  const tokensPerSecond = liveTokensPerSecond !== undefined ? liveTokensPerSecond.toFixed(2) : latestTokensPerSecond(logs);

  function setGpuLayers(value: number): void {
    void controller.updateConfig((cfg) => ({
      ...cfg,
      gpu: { ...cfg.gpu, offloadMode: value <= 0 ? "cpu" : "manual" },
      serverFlags: { ...cfg.serverFlags, "n-gpu-layers": Math.max(0, value) },
    }));
  }

  function setGpuMode(mode: GpuOffloadMode): void {
    void controller.updateConfig((cfg) => ({
      ...cfg,
      gpu: { ...cfg.gpu, offloadMode: mode },
      serverFlags: {
        ...cfg.serverFlags,
        "n-gpu-layers": mode === "cpu" ? 0 : mode === "full" ? 999 : cfg.serverFlags["n-gpu-layers"] ?? 999,
        "flash-attn": mode === "cpu" ? "auto" : "on",
        "cache-type-k": mode === "cpu" ? cfg.serverFlags["cache-type-k"] : "q8_0",
        "cache-type-v": mode === "cpu" ? cfg.serverFlags["cache-type-v"] : "q8_0",
      },
    }));
  }

  const modeButtons: { mode: GpuOffloadMode; label: string; testId: string }[] = [
    { mode: "auto", label: "Auto fit", testId: "gpu-mode-auto" },
    { mode: "full", label: "Full offload", testId: "gpu-mode-full" },
    { mode: "manual", label: "Manual", testId: "gpu-mode-manual" },
    { mode: "cpu", label: "CPU only", testId: "gpu-mode-cpu" },
  ];

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-48">
            <label className="field-label" htmlFor="server-host">Host</label>
            <input id="server-host" data-testid="server-host" className="input" value={config.server.host} onChange={(e) => void controller.updateConfig((cfg) => ({ ...cfg, server: { ...cfg.server, host: e.target.value } }))} />
          </div>
          <div className="w-32">
            <label className="field-label" htmlFor="server-port">Port</label>
            <input id="server-port" data-testid="server-port" type="number" min={1} max={65535} className="input" value={config.server.port} onChange={(e) => void controller.updateConfig((cfg) => ({ ...cfg, server: { ...cfg.server, port: Number(e.target.value) } }))} />
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <StatusIndicator status={status} />
            <button type="button" className="btn-primary" disabled={running} onClick={() => void controller.startServer()} data-testid="start-server">
              {status.state === "starting" ? "Starting…" : "Start"}
            </button>
            <button type="button" className="btn-danger" disabled={!running} onClick={() => void controller.stopServer()} data-testid="stop-server">
              Stop
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          The server launches with every flag configured in the Settings tab. Restart it after changing flags.
        </p>
        <div className="mt-3 rounded-lg border border-slate-700 bg-black/30 p-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-accent">Exact launch command</span>
            <span className="text-xs text-slate-400">API keys redacted</span>
          </div>
          <code className="block whitespace-pre-wrap break-all text-xs text-slate-200" data-testid="server-command-preview">{command}</code>
        </div>
      </div>

      <ServerLaunchProgress config={config} status={status} logs={logs} command={command} />

      <div className="card p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">Runtime Debug</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-700 bg-black/20 p-3">
            <div className="text-xs text-slate-400">Tokens/sec</div>
            <div className="mt-1 text-xl font-semibold text-white" data-testid="tokens-per-second">{tokensPerSecond ?? "Waiting for generation"}</div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-black/20 p-3">
            <div className="text-xs text-slate-400">GPU VRAM</div>
            <div className="mt-1 text-xl font-semibold text-white" data-testid="gpu-vram-debug">
              {metrics?.gpu.memoryUsed && metrics.gpu.memoryTotal ? `${(metrics.gpu.memoryUsed / 1024 / 1024).toFixed(0)} / ${(metrics.gpu.memoryTotal / 1024 / 1024).toFixed(0)} MiB` : "Waiting"}
            </div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-black/20 p-3">
          <div className="text-xs text-slate-400">Health</div>
          <div className="mt-1 text-xl font-semibold text-white" data-testid="server-health-debug">{status.state}</div>
        </div>
      </div>
        <div className="mt-3 rounded-lg border border-slate-700 bg-black/20 p-3 text-sm">
          <div className="text-xs text-slate-400">Server log file</div>
          <code className="mt-1 block break-all text-xs text-slate-200" data-testid="server-log-file">~/.config/atlas-workbench/logs/server.log</code>
        </div>
    </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">GPU Loading</h2>
            <p className="mt-1 text-sm text-slate-300">
              {metrics?.gpu.detected ? `Detected ${metrics.gpu.name ?? "GPU"}. Auto fit lets llama.cpp choose what fits in free VRAM.` : "No supported GPU has been detected yet."}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <div className="field-label">Mode</div>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-700" role="group" aria-label="GPU offload mode">
              {modeButtons.map((button) => (
                <button
                  key={button.mode}
                  type="button"
                  className={gpuMode === button.mode ? "bg-accent px-3 py-2 text-sm font-semibold text-slate-950" : "bg-panel px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"}
                  aria-pressed={gpuMode === button.mode}
                  onClick={() => setGpuMode(button.mode)}
                  data-testid={button.testId}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </div>
          <div className="w-40">
            <label className="field-label" htmlFor="gpu-layers">GPU layers</label>
            <input id="gpu-layers" data-testid="gpu-layers" type="number" min={0} max={9999} className="input disabled:cursor-not-allowed disabled:opacity-60" value={Number.isFinite(gpuLayers) ? gpuLayers : 999} disabled={gpuMode !== "manual"} onChange={(e) => setGpuLayers(Number(e.target.value))} />
          </div>
          <p className="min-w-64 flex-1 text-xs text-slate-400" data-testid="gpu-offload-summary">
            {describeGpuOffload(config)}. Auto fit omits <code>--n-gpu-layers</code>; full/manual modes pass it explicitly.
          </p>
        </div>
      </div>

      <LogPanel logs={logs} onClear={() => controller.clearLogs("server")} emptyText="Start the server to see its output here." />
    </div>
  );
}
