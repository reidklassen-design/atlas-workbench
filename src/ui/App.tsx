import { useMemo, useState, type ReactNode } from "react";
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

const TABS: { id: TabId; label: string; glyph: string }[] = [
  { id: "dashboard", label: "Dashboard", glyph: "◆" },
  { id: "server", label: "Server", glyph: "▶" },
  { id: "models", label: "Models", glyph: "◈" },
  { id: "agent-runtime", label: "Runtime", glyph: "⌁" },
  { id: "settings", label: "Settings", glyph: "⚙" },
  { id: "fine-tuning", label: "Fine-tune", glyph: "✦" },
  { id: "system-monitor", label: "Monitor", glyph: "▣" },
  { id: "logs", label: "Logs", glyph: "≡" },
];

const GRAPH_LINES = [
  { name: "Tokens/sec", color: "#7CFF2B", points: "0,92 42,80 86,84 128,56 168,62 210,34 250,42 292,22 334,30 376,18" },
  { name: "VRAM", color: "#39FF14", points: "0,112 42,104 86,96 128,74 168,70 210,64 250,58 292,50 334,46 376,44" },
  { name: "GPU temp", color: "#FFD166", points: "0,126 42,120 86,118 128,110 168,98 210,94 250,86 292,88 334,80 376,74" },
];

function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "--";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatModelName(path: string): string {
  return path.split("/").filter(Boolean).pop() || "No model selected";
}

function latestTokensPerSecond(logs: { text: string }[]): number | null {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const match = logs[i].text.match(/([0-9]+(?:\.[0-9]+)?)\s+tokens?\s*(?:per\s*second|\/s|t\/s)/i);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
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

function NeoPerformanceGraph(): JSX.Element {
  return (
    <NeoCard className="neo-graph-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="neo-section-kicker">Performance Over Time</div>
          <h2 className="text-lg font-semibold text-[#E8FFF0]">Local runtime telemetry</h2>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-[#8FA99A]">
          {GRAPH_LINES.map((line) => (
            <span key={line.name} className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: line.color }} />
              {line.name}
            </span>
          ))}
        </div>
      </div>
      <svg className="mt-4 h-48 w-full overflow-visible" viewBox="0 0 376 150" preserveAspectRatio="none" aria-hidden="true">
        {[0, 1, 2, 3].map((line) => (
          <line key={`h-${line}`} x1="0" x2="376" y1={24 + line * 32} y2={24 + line * 32} stroke="#1B3B25" strokeWidth="1" opacity="0.8" />
        ))}
        {[0, 1, 2, 3, 4, 5].map((line) => (
          <line key={`v-${line}`} x1={line * 75.2} x2={line * 75.2} y1="14" y2="138" stroke="#102A1B" strokeWidth="1" opacity="0.8" />
        ))}
        {GRAPH_LINES.map((line) => (
          <polyline key={line.name} points={line.points} fill="none" stroke={line.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" opacity="0.92" />
        ))}
      </svg>
    </NeoCard>
  );
}

function NeoHeader({ server, gateway }: { server: ProcessStatus; gateway: GatewayStatus }): JSX.Element {
  const runtimeLabel = gateway.running ? `Gateway ${gateway.port}` : `Server ${server.state}`;

  return (
    <header className="neo-header">
      <div className="neo-header-left">
        <button type="button" className="neo-icon-button" aria-label="Menu">☰</button>
        <span className="neo-pill">LOCAL MODE</span>
      </div>
      <div className="neo-brand" aria-label="Atlas Core">
        <span className="neo-brand-mark" aria-hidden="true">
          <span />
        </span>
        <div className="text-center">
          <div className="neo-brand-title">ATLAS CORE</div>
          <div className="neo-brand-subtitle">LOCAL LLAMA.CPP OPERATIONS</div>
        </div>
      </div>
      <div className="neo-header-right">
        <span className="neo-status-pill">
          <span className={clsx("h-2 w-2 rounded-full", gateway.running || server.state === "running" ? "bg-[#39FF14]" : "bg-[#31513a]")} />
          {runtimeLabel}
        </span>
        <span className="neo-pill hidden sm:inline-flex">V2</span>
      </div>
    </header>
  );
}

function NeoSidebar({ active, onSelect }: { active: TabId; onSelect: (tab: TabId) => void }): JSX.Element {
  return (
    <aside className="neo-sidebar" aria-label="Primary navigation">
      <div className="neo-sidebar-rail" aria-hidden="true" />
      <nav className="space-y-2">
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
  const tokensPerSecond = useMemo(() => latestTokensPerSecond(logs), [logs]);
  const memoryUsed = metrics?.gpu.memoryUsed;
  const memoryTotal = metrics?.gpu.memoryTotal;
  const vramPct = memoryUsed !== undefined && memoryTotal ? (memoryUsed / memoryTotal) * 100 : metrics?.gpu.usagePercent ?? 0;
  const vramValue = memoryUsed !== undefined ? (memoryUsed / 1024 / 1024 / 1024).toFixed(1) : "--";
  const vramUnit = memoryUsed !== undefined ? "GB" : "";
  const vramSubtext = memoryTotal ? `${vramPct.toFixed(0)}% of ${formatBytes(memoryTotal)}` : metrics?.gpu.detected ? "VRAM telemetry pending" : "GPU not detected";

  return (
    <div className="space-y-5" data-testid="dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="neo-section-kicker">Command Center</div>
          <h1 className="text-2xl font-semibold text-[#E8FFF0]">Local AI cockpit</h1>
          <p className="mt-1 text-sm text-[#8FA99A]">Optimized for always-on llama.cpp agent work.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[#1B3B25] bg-[#07130D] px-3 py-2 text-sm text-[#8FA99A]">
          <span className={clsx("h-2.5 w-2.5 rounded-full", statusTone(server.state))} />
          <span className="capitalize">{gateway.running ? "gateway running" : server.state}</span>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <NeoGauge label="VRAM USAGE" value={vramValue} unit={vramUnit} subtext={vramSubtext} progress={vramPct} />
            <NeoGauge
              label="TOKENS / SEC"
              value={tokensPerSecond === null ? "--" : tokensPerSecond.toFixed(tokensPerSecond % 1 === 0 ? 0 : 1)}
              unit="tok/s"
              subtext={tokensPerSecond === null ? "Waiting for generation" : "latest llama.cpp timing"}
              progress={tokensPerSecond === null ? 0 : Math.min(100, (tokensPerSecond / 120) * 100)}
            />
            <NeoGauge label="GPU TEMP" value="--" unit="°C" subtext={metrics?.gpu.detected ? "sensor pending" : "GPU not detected"} progress={0} />
          </div>

          <NeoPerformanceGraph />

          <div className="grid gap-4 md:grid-cols-3">
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
        <NeoSidebar active={active} onSelect={setActive} />
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
