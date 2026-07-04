import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import { clsx } from "clsx";
import { AppProvider, useAppController, useControllerState } from "@/state/reactBinding";
import { BinarySetupDialog } from "@/ui/components/BinarySetupDialog";
import { LogPanel } from "@/ui/components/LogPanel";
import { ServerTab } from "@/ui/tabs/ServerTab";
import { ModelsTab } from "@/ui/tabs/ModelsTab";
import { SettingsTab } from "@/ui/tabs/SettingsTab";
import { FineTuningTab } from "@/ui/tabs/FineTuningTab";
import { SystemMonitorTab } from "@/ui/tabs/SystemMonitorTab";
import { AgentRuntimeTab } from "@/ui/tabs/AgentRuntimeTab";
import type { AppConfig, GatewayStatus, ProcessLogLine, ProcessStatus, SystemMetrics } from "@/config/types";

type TabId = "dashboard" | "server" | "models" | "agent-runtime" | "settings" | "fine-tuning" | "system-monitor" | "logs";
const atlasCoreBadge = new URL("./assets/atlas-core-badge.png", import.meta.url).href;

const TABS: { id: TabId; label: string; glyph: string }[] = [
  { id: "dashboard", label: "Dashboard", glyph: "⌂" },
  { id: "server", label: "Server", glyph: "▱" },
  { id: "models", label: "Models", glyph: "⬡" },
  { id: "agent-runtime", label: "Runtime", glyph: "⌘" },
  { id: "settings", label: "Settings", glyph: "⚙" },
  { id: "fine-tuning", label: "Fine-tune", glyph: "✦" },
  { id: "system-monitor", label: "Monitor", glyph: "▣" },
  { id: "logs", label: "Logs", glyph: "☷" },
];

interface RuntimeGraphPoint {
  ts: number;
  tokensPerSecond: number | null;
  vramPercent: number | null;
  gpuPercent: number | null;
  gpuTemperatureCelsius: number | null;
  cpuPercent: number;
  ramPercent: number;
}

interface RuntimeGraphSeries {
  name: string;
  color: string;
  points: string;
  latest: string;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "--";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatModelName(path: string): string {
  return path.split("/").filter(Boolean).pop() || "No model selected";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function latestTokensPerSecond(logs: { text: string }[]): number | null {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const match = logs[i].text.match(/([0-9]+(?:\.[0-9]+)?)\s+tokens?\s*(?:per\s*second|\/s|t\/s)/i);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

function currentTauriWindow(): TauriWindow | null {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  return getCurrentWindow();
}

function runWindowAction(action: (appWindow: TauriWindow) => Promise<void>): void {
  const appWindow = currentTauriWindow();
  if (!appWindow) return;
  void action(appWindow).catch(() => undefined);
}

function isInteractiveHeaderTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("button, a, input, select, textarea, [data-no-drag]"));
}

function useRuntimeGraphHistory(metrics: SystemMetrics | null, tokensPerSecond: number | null): RuntimeGraphPoint[] {
  const [history, setHistory] = useState<RuntimeGraphPoint[]>([]);

  useEffect(() => {
    if (!metrics) return;
    const memoryUsed = finiteNumber(metrics.gpu.memoryUsed);
    const memoryTotal = finiteNumber(metrics.gpu.memoryTotal);
    const vramPercent = memoryUsed !== undefined && memoryTotal ? Math.max(0, Math.min(100, (memoryUsed / memoryTotal) * 100)) : null;
    const point: RuntimeGraphPoint = {
      ts: metrics.ts,
      tokensPerSecond,
      vramPercent,
      gpuPercent: finiteNumber(metrics.gpu.usagePercent) ?? null,
      gpuTemperatureCelsius: finiteNumber(metrics.gpu.temperatureCelsius) ?? null,
      cpuPercent: metrics.cpu.overall,
      ramPercent: metrics.ram.percent,
    };

    setHistory((current) => {
      const previous = current[current.length - 1];
      if (
        previous &&
        previous.ts === point.ts &&
        previous.tokensPerSecond === point.tokensPerSecond &&
        previous.vramPercent === point.vramPercent &&
        previous.gpuPercent === point.gpuPercent &&
        previous.gpuTemperatureCelsius === point.gpuTemperatureCelsius
      ) {
        return current;
      }
      const cutoff = point.ts - 5 * 60 * 1000;
      return current.concat(point).filter((item) => item.ts >= cutoff).slice(-300);
    });
  }, [metrics, tokensPerSecond]);

  return history;
}

function statusTone(status: ProcessStatus["state"]): string {
  if (status === "running") return "bg-[#39FF14] shadow-[0_0_16px_rgba(57,255,20,0.8)]";
  if (status === "starting") return "bg-[#FFD166] shadow-[0_0_16px_rgba(255,209,102,0.55)]";
  if (status === "exited") return "bg-[#FF4D4D]";
  return "bg-[#31513a]";
}

function NeoCard({ children, className = "" }: { children: ReactNode; className?: string }): JSX.Element {
  return <section className={clsx("neo-card", className)}>{children}</section>;
}

function NeoGauge({
  label,
  value,
  unit,
  subtext,
  progress,
}: {
  label: string;
  value: string;
  unit: string;
  subtext: string;
  progress: number;
}): JSX.Element {
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, progress));
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="neo-gauge">
      <svg className="neo-gauge-ring" viewBox="0 0 180 180" role="img" aria-label={`${label}: ${value} ${unit}`}>
        <defs>
          <filter id={`glow-${label.replace(/\W/g, "")}`}>
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="90" cy="90" r="76" fill="#030806" stroke="#102A1B" strokeWidth="1.5" />
        <circle cx="90" cy="90" r={radius} fill="none" stroke="#14331f" strokeWidth="12" />
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke="#39FF14"
          strokeLinecap="round"
          strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 90 90)"
          filter={`url(#glow-${label.replace(/\W/g, "")})`}
        />
        <circle cx="90" cy="90" r="46" fill="#07130D" stroke="#1B3B25" strokeWidth="1" />
      </svg>
      <div className="neo-gauge-copy">
        <div className="neo-gauge-label">{label}</div>
        <div className="neo-gauge-value">{value}</div>
        <div className="neo-gauge-unit">{unit}</div>
        <div className="neo-gauge-subtext">{subtext}</div>
      </div>
    </div>
  );
}

function graphPath(points: RuntimeGraphPoint[], pickValue: (point: RuntimeGraphPoint) => number | null, maxValue: number): string {
  const values = points.map((point) => pickValue(point));
  const available = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (points.length < 2 || available.length < 2 || maxValue <= 0) return "";

  const width = 376;
  const top = 16;
  const bottom = 132;
  const height = bottom - top;
  const start = points[0]?.ts ?? Date.now();
  const end = points[points.length - 1]?.ts ?? start + 1;
  const span = Math.max(1, end - start);

  return points
    .map((point) => {
      const value = pickValue(point);
      if (value === null || !Number.isFinite(value)) return null;
      const x = ((point.ts - start) / span) * width;
      const y = bottom - Math.max(0, Math.min(1, value / maxValue)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((point): point is string => point !== null)
    .join(" ");
}

function formatGraphTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function NeoPerformanceGraph({ history }: { history: RuntimeGraphPoint[] }): JSX.Element {
  const tokenMax = Math.max(30, ...history.map((point) => point.tokensPerSecond ?? 0)) * 1.15;
  const rawSeries: RuntimeGraphSeries[] = [
    {
      name: "Tokens/sec",
      color: "#7CFF2B",
      points: graphPath(history, (point) => point.tokensPerSecond, tokenMax),
      latest: history.at(-1)?.tokensPerSecond !== null && history.at(-1)?.tokensPerSecond !== undefined ? `${history.at(-1)?.tokensPerSecond?.toFixed(1)} tok/s` : "waiting",
    },
    {
      name: "VRAM %",
      color: "#39FF14",
      points: graphPath(history, (point) => point.vramPercent, 100),
      latest: history.at(-1)?.vramPercent !== null && history.at(-1)?.vramPercent !== undefined ? `${history.at(-1)?.vramPercent?.toFixed(0)}%` : "waiting",
    },
    {
      name: "GPU temp",
      color: "#FFD166",
      points: graphPath(history, (point) => point.gpuTemperatureCelsius, 100),
      latest: history.at(-1)?.gpuTemperatureCelsius !== null && history.at(-1)?.gpuTemperatureCelsius !== undefined ? `${history.at(-1)?.gpuTemperatureCelsius?.toFixed(0)} °C` : "waiting",
    },
    {
      name: "CPU load",
      color: "#8FA99A",
      points: graphPath(history, (point) => point.cpuPercent, 100),
      latest: history.at(-1) ? `${history.at(-1)?.cpuPercent.toFixed(0)}%` : "waiting",
    },
  ];
  const series = rawSeries.filter((item) => item.points);
  const latestPoint = history.at(-1);

  return (
    <NeoCard className="neo-graph-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="neo-section-kicker">Performance Over Time</div>
          <h2 className="text-lg font-semibold text-[#E8FFF0]">Live runtime telemetry</h2>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-[#8FA99A]">
          {rawSeries.map((line) => (
            <span key={line.name} className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: line.color }} />
              {line.name}: {line.latest}
            </span>
          ))}
        </div>
      </div>
      <svg className="mt-4 h-48 w-full overflow-visible" viewBox="0 0 376 150" preserveAspectRatio="none" aria-label="Live runtime performance graph" role="img">
        {[0, 1, 2, 3].map((line) => (
          <line key={`h-${line}`} x1="0" x2="376" y1={24 + line * 32} y2={24 + line * 32} stroke="#1B3B25" strokeWidth="1" opacity="0.8" />
        ))}
        {[0, 1, 2, 3, 4, 5].map((line) => (
          <line key={`v-${line}`} x1={line * 75.2} x2={line * 75.2} y1="14" y2="138" stroke="#102A1B" strokeWidth="1" opacity="0.8" />
        ))}
        {series.map((line) => (
          <polyline key={line.name} points={line.points} fill="none" stroke={line.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" opacity="0.92" />
        ))}
        {series.length === 0 ? (
          <text x="188" y="78" textAnchor="middle" fill="#8FA99A" fontSize="10">
            Collecting live runtime data
          </text>
        ) : null}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-[#8FA99A]">
        <span>{history[0] ? formatGraphTime(history[0].ts) : "waiting"}</span>
        <span>{latestPoint ? formatGraphTime(latestPoint.ts) : "waiting"}</span>
      </div>
    </NeoCard>
  );
}

function NeoHeader({ server, gateway }: { server: ProcessStatus; gateway: GatewayStatus }): JSX.Element {
  const runtimeLabel = gateway.running ? `Gateway ${gateway.port}` : `Server ${server.state}`;
  const startWindowDrag = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.detail > 1 || isInteractiveHeaderTarget(event.target)) return;
    runWindowAction((appWindow) => appWindow.startDragging());
  };
  const toggleWindowMaximize = (event: MouseEvent<HTMLElement>) => {
    if (isInteractiveHeaderTarget(event.target)) return;
    runWindowAction((appWindow) => appWindow.toggleMaximize());
  };

  return (
    <header className="neo-header" data-tauri-drag-region onMouseDown={startWindowDrag} onDoubleClick={toggleWindowMaximize}>
      <div className="neo-header-left">
        <button type="button" className="neo-icon-button" aria-label="Menu" data-no-drag>☰</button>
        <span className="neo-pill">LOCAL MODE</span>
      </div>
      <div className="neo-brand" aria-label="Atlas Core">
        <img className="neo-brand-mark" src={atlasCoreBadge} alt="" aria-hidden="true" />
        <div className="neo-brand-subtitle">LOCAL LLAMA.CPP OPERATIONS</div>
      </div>
      <div className="neo-header-right">
        <span className="neo-status-pill">
          <span className={clsx("h-2 w-2 rounded-full", gateway.running || server.state === "running" ? "bg-[#39FF14]" : "bg-[#31513a]")} />
          {runtimeLabel}
        </span>
        <div className="neo-window-controls">
          <button type="button" aria-label="Minimize window" onClick={() => runWindowAction((appWindow) => appWindow.minimize())} data-no-drag>−</button>
          <button type="button" aria-label="Maximize or restore window" onClick={() => runWindowAction((appWindow) => appWindow.toggleMaximize())} data-no-drag>□</button>
          <button type="button" aria-label="Close window" onClick={() => runWindowAction((appWindow) => appWindow.close())} data-no-drag>×</button>
        </div>
      </div>
    </header>
  );
}

function NeoSidebar({ active, onSelect, server }: { active: TabId; onSelect: (tab: TabId) => void; server: ProcessStatus }): JSX.Element {
  return (
    <aside className="neo-sidebar" aria-label="Primary navigation">
      <div className="neo-sidebar-rail" aria-hidden="true" />
      <nav className="space-y-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            data-testid={`tab-${tab.id}`}
            className={clsx("neo-nav-item", active === tab.id && "neo-nav-item-active")}
          >
            <span className="neo-nav-glyph">{tab.glyph}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
      <div className="neo-sidebar-status">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#8FA99A]">
          <span className={clsx("h-2 w-2 rounded-full", statusTone(server.state))} />
          System Status
        </div>
        <div className="mt-4 text-2xl font-semibold uppercase text-[#39FF14]">{server.state === "running" ? "Online" : server.state}</div>
        <p className="mt-2 text-sm text-[#8FA99A]">{server.state === "running" ? "All systems operational." : "Local runtime standing by."}</p>
        <div className="mt-4 flex gap-1" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((item) => <span key={item} className="h-1.5 w-5 skew-x-[-32deg] rounded-sm bg-[#7CFF2B]" />)}
        </div>
      </div>
    </aside>
  );
}

function NeoBottomBar({ config, metrics, server, gateway }: { config: AppConfig; metrics: SystemMetrics | null; server: ProcessStatus; gateway: GatewayStatus }): JSX.Element {
  const activeProfile = config.agentRuntime.profiles.find((profile) => profile.id === config.agentRuntime.activeProfileId);
  const contextWindow = Number(activeProfile?.requestPolicy.contextWindowTokens ?? config.serverFlags["ctx-size"] ?? 0);
  const usedContext = gateway.lastBudget?.estimatedPromptTokens ?? 0;
  const pct = contextWindow > 0 ? Math.max(0, Math.min(100, (usedContext / contextWindow) * 100)) : 0;
  const sessionName = activeProfile?.name ?? formatModelName(config.model.selectedModel);
  const status = gateway.running ? "Gateway online" : server.state === "running" ? "llama.cpp online" : "Runtime idle";

  return (
    <footer className="neo-bottom-bar">
      <div className="min-w-0">
        <div className="text-xs uppercase text-[#8FA99A]">Active Session</div>
        <div className="truncate text-sm font-semibold text-[#E8FFF0]">Chat with {sessionName}</div>
      </div>
      <div className="min-w-[220px] flex-1">
        <div className="mb-1 flex justify-between text-xs text-[#8FA99A]">
          <span>Context Usage</span>
          <span>{usedContext.toLocaleString()} / {contextWindow ? contextWindow.toLocaleString() : "--"} tokens</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#102A1B]">
          <div className="h-full rounded-full bg-[#39FF14] shadow-[0_0_16px_rgba(57,255,20,0.65)]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="hidden text-right text-xs text-[#8FA99A] lg:block">
        <div>{status}</div>
        <div>{metrics?.gpu.detected ? metrics.gpu.name ?? "GPU detected" : "GPU telemetry pending"}</div>
      </div>
      <button type="button" className="neo-action-button">New Chat</button>
    </footer>
  );
}

function SystemOverview({ config, metrics, server, gateway }: { config: AppConfig; metrics: SystemMetrics | null; server: ProcessStatus; gateway: GatewayStatus }): JSX.Element {
  const activeProfile = config.agentRuntime.profiles.find((profile) => profile.id === config.agentRuntime.activeProfileId);
  const rows = [
    ["Model", formatModelName(config.model.selectedModel || activeProfile?.modelPath || "")],
    ["Context Window", `${Number(activeProfile?.requestPolicy.contextWindowTokens ?? config.serverFlags["ctx-size"] ?? 0).toLocaleString()} tokens`],
    ["Backend", "llama.cpp"],
    ["GPU", metrics?.gpu.detected ? metrics.gpu.name ?? "Detected GPU" : "Not detected"],
    ["Server", gateway.running ? `gateway :${gateway.port}` : server.state],
    ["Runtime", config.agentRuntime.gateway.autoCompressionEnabled ? "local + compression guard" : "local"],
  ];

  return (
    <NeoCard>
      <div className="neo-section-kicker">System Overview</div>
      <div className="mt-4 space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="neo-overview-row">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </NeoCard>
  );
}

function RecentActivity({ logs }: { logs: ProcessLogLine[] }): JSX.Element {
  const rows = logs
    .filter((line) => line.text.trim())
    .slice(-5)
    .reverse()
    .map((line) => ({ label: line.text.split("\n")[0], ts: line.ts }));
  const fallback = [
    "Model selection ready",
    "Local runtime initialized",
    "System metrics collecting",
    "GPU telemetry available",
  ].map((label, index) => ({ label, ts: Date.now() - index * 60_000 }));
  const activity = rows.length > 0 ? rows : fallback;

  return (
    <NeoCard>
      <div className="neo-section-kicker">Recent Activity</div>
      <div className="mt-4 space-y-3">
        {activity.map((row) => (
          <div key={`${row.label}-${row.ts}`} className="neo-activity-row">
            <span className="h-2 w-2 rounded-full bg-[#39FF14] shadow-[0_0_10px_rgba(57,255,20,0.7)]" />
            <span className="min-w-0 flex-1 truncate text-[#E8FFF0]">{row.label}</span>
            <time className="text-xs text-[#8FA99A]">{new Date(row.ts).toLocaleTimeString()}</time>
          </div>
        ))}
      </div>
    </NeoCard>
  );
}

function DashboardPage(): JSX.Element {
  const config = useControllerState((c) => c.config);
  const metrics = useControllerState((c) => c.metrics);
  const server = useControllerState((c) => c.server);
  const gateway = useControllerState((c) => c.gateway);
  const logs = useControllerState((c) => c.serverLogs);
  const fallbackTokensPerSecond = useMemo(() => latestTokensPerSecond(logs), [logs]);
  const tokensPerSecond = metrics?.runtime?.generationTokensPerSecond ?? fallbackTokensPerSecond;
  const graphHistory = useRuntimeGraphHistory(metrics, tokensPerSecond);
  const memoryUsed = finiteNumber(metrics?.gpu.memoryUsed);
  const memoryTotal = finiteNumber(metrics?.gpu.memoryTotal);
  const gpuUsage = finiteNumber(metrics?.gpu.usagePercent);
  const vramPct = memoryUsed !== undefined && memoryTotal ? (memoryUsed / memoryTotal) * 100 : gpuUsage ?? 0;
  const vramValue = memoryUsed !== undefined ? (memoryUsed / 1024 / 1024 / 1024).toFixed(1) : "--";
  const vramUnit = memoryUsed !== undefined ? "GB" : "";
  const vramSubtext = memoryTotal ? `${vramPct.toFixed(0)}% of ${formatBytes(memoryTotal)}` : metrics?.gpu.detected ? "VRAM telemetry pending" : "GPU not detected";
  const gpuTemp = finiteNumber(metrics?.gpu.temperatureCelsius);
  const now = useMemo(() => new Date(), []);

  return (
    <div className="space-y-5" data-testid="dashboard">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <NeoCard className="neo-dashboard-card">
            <div className="neo-dashboard-heading">
              <div>
                <h1 className="text-2xl font-semibold text-[#E8FFF0]">Dashboard</h1>
                <p className="mt-1 text-sm text-[#8FA99A]">Overview of your local AI system performance.</p>
              </div>
              <div className="neo-clock-card">
                <span className="text-lg text-[#39FF14]">◷</span>
                <div>
                  <div className="font-mono text-sm font-semibold text-[#7CFF2B]">{now.toLocaleTimeString()}</div>
                  <div className="text-xs text-[#8FA99A]">{now.toLocaleDateString()}</div>
                </div>
              </div>
            </div>
            <div className="neo-dashboard-divider" />
            <div className="grid gap-4 md:grid-cols-3">
              <NeoGauge label="VRAM USAGE" value={vramValue} unit={vramUnit} subtext={vramSubtext} progress={vramPct} />
              <NeoGauge
                label="TOKENS / SECOND"
                value={tokensPerSecond === null ? "--" : tokensPerSecond.toFixed(tokensPerSecond % 1 === 0 ? 0 : 1)}
                unit="tok/s"
                subtext={tokensPerSecond === null ? "Waiting for generation" : "latest llama.cpp timing"}
                progress={tokensPerSecond === null ? 0 : Math.min(100, (tokensPerSecond / 120) * 100)}
              />
              <NeoGauge
                label="GPU TEMP"
                value={gpuTemp === undefined ? "--" : gpuTemp.toFixed(0)}
                unit="°C"
                subtext={gpuTemp === undefined ? (metrics?.gpu.detected ? "temperature telemetry pending" : "GPU not detected") : "live GPU sensor"}
                progress={gpuTemp === undefined ? 0 : Math.min(100, (gpuTemp / 90) * 100)}
              />
            </div>
          </NeoCard>

          <NeoPerformanceGraph history={graphHistory} />

          <NeoCard>
            <div className="neo-section-kicker">System Load</div>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className="neo-load-tile">
                <span>CPU Usage</span>
                <strong>{metrics ? `${metrics.cpu.overall.toFixed(0)}%` : "--"}</strong>
                <div><i style={{ width: `${metrics?.cpu.overall ?? 0}%` }} /></div>
              </div>
              <div className="neo-load-tile">
                <span>RAM Usage</span>
                <strong>{metrics ? `${formatBytes(metrics.ram.used)} / ${formatBytes(metrics.ram.total)}` : "--"}</strong>
                <div><i style={{ width: `${metrics?.ram.percent ?? 0}%` }} /></div>
              </div>
              <div className="neo-load-tile">
                <span>Gateway</span>
                <strong>{gateway.running ? "Online" : "Offline"}</strong>
                <div><i style={{ width: gateway.running ? "100%" : "12%" }} /></div>
              </div>
              <div className="neo-load-tile">
                <span>Requests</span>
                <strong>{gateway.requestCount.toLocaleString()}</strong>
                <p>{gateway.rejectedCount.toLocaleString()} rejected</p>
              </div>
            </div>
          </NeoCard>

          <div className="grid gap-4 md:grid-cols-3 xl:hidden">
            <NeoCard>
              <div className="neo-section-kicker">Gateway</div>
              <div className="mt-3 text-2xl font-semibold text-[#E8FFF0]">{gateway.running ? "Online" : "Offline"}</div>
              <p className="mt-1 text-sm text-[#8FA99A]">{gateway.modelAlias || "atlas/local"}</p>
            </NeoCard>
            <NeoCard>
              <div className="neo-section-kicker">Requests</div>
              <div className="mt-3 text-2xl font-semibold text-[#E8FFF0]">{gateway.requestCount.toLocaleString()}</div>
              <p className="mt-1 text-sm text-[#8FA99A]">{gateway.rejectedCount.toLocaleString()} rejected</p>
            </NeoCard>
            <NeoCard>
              <div className="neo-section-kicker">CPU / RAM</div>
              <div className="mt-3 text-2xl font-semibold text-[#E8FFF0]">{metrics ? `${metrics.cpu.overall.toFixed(0)}% / ${metrics.ram.percent.toFixed(0)}%` : "--"}</div>
              <p className="mt-1 text-sm text-[#8FA99A]">host load</p>
            </NeoCard>
          </div>
        </div>

        <aside className="space-y-5">
          <SystemOverview config={config} metrics={metrics} server={server} gateway={gateway} />
          <RecentActivity logs={logs} />
        </aside>
      </div>
    </div>
  );
}

function LogsPage(): JSX.Element {
  const controller = useAppController();
  const serverLogs = useControllerState((c) => c.serverLogs);
  const trainingLogs = useControllerState((c) => c.trainingLogs);

  return (
    <div className="space-y-5">
      <LogPanel logs={serverLogs} onClear={() => controller.clearLogs("server")} emptyText="Server output will appear here." />
      <LogPanel logs={trainingLogs} onClear={() => controller.clearLogs("finetune")} emptyText="Fine-tuning output will appear here." />
    </div>
  );
}

export function Shell(): JSX.Element {
  const [active, setActive] = useState<TabId>("dashboard");
  const needsBinarySetup = useControllerState((c) => c.needsBinarySetup);
  const loaded = useControllerState((c) => c.loaded);
  const config = useControllerState((c) => c.config);
  const metrics = useControllerState((c) => c.metrics);
  const server = useControllerState((c) => c.server);
  const gateway = useControllerState((c) => c.gateway);

  return (
    <div className="neo-shell">
      <NeoHeader server={server} gateway={gateway} />
      <div className="neo-body">
        <NeoSidebar active={active} onSelect={setActive} server={server} />
        <main className="neo-main">
          {loaded ? (
            <div className="mx-auto max-w-[1500px]">
              {active === "dashboard" ? <DashboardPage /> : null}
              {active === "server" ? <ServerTab /> : null}
              {active === "models" ? <ModelsTab /> : null}
              {active === "agent-runtime" ? <AgentRuntimeTab /> : null}
              {active === "settings" ? <SettingsTab /> : null}
              {active === "fine-tuning" ? <FineTuningTab /> : null}
              {active === "system-monitor" ? <SystemMonitorTab /> : null}
              {active === "logs" ? <LogsPage /> : null}
            </div>
          ) : (
            <NeoCard className="p-4 text-sm text-[#8FA99A]">Loading configuration...</NeoCard>
          )}
        </main>
      </div>
      <NeoBottomBar config={config} metrics={metrics} server={server} gateway={gateway} />

      {needsBinarySetup ? <BinarySetupDialog /> : null}
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
