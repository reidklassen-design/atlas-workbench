import { useState } from "react";
import { clsx } from "clsx";
import { AppProvider, useControllerState } from "@/state/reactBinding";
import { BinarySetupDialog } from "@/ui/components/BinarySetupDialog";
import { ServerTab } from "@/ui/tabs/ServerTab";
import { ModelsTab } from "@/ui/tabs/ModelsTab";
import { SettingsTab } from "@/ui/tabs/SettingsTab";
import { FineTuningTab } from "@/ui/tabs/FineTuningTab";
import { SystemMonitorTab } from "@/ui/tabs/SystemMonitorTab";
import { AgentRuntimeTab } from "@/ui/tabs/AgentRuntimeTab";

type TabId = "server" | "models" | "agent-runtime" | "settings" | "fine-tuning" | "system-monitor";

const TABS: { id: TabId; label: string }[] = [
  { id: "server", label: "Server" },
  { id: "models", label: "Models" },
  { id: "agent-runtime", label: "Agent Runtime" },
  { id: "settings", label: "Settings" },
  { id: "fine-tuning", label: "Fine-tuning" },
  { id: "system-monitor", label: "System Monitor" },
];

export function Shell(): JSX.Element {
  const [active, setActive] = useState<TabId>("server");
  const needsBinarySetup = useControllerState((c) => c.needsBinarySetup);
  const loaded = useControllerState((c) => c.loaded);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-800 bg-panel/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-7 w-7 rounded-lg bg-gradient-to-br from-accent to-accent2" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-white">Atlas Workbench</h1>
          </div>
          <span className="text-xs text-slate-500">llama.cpp control panel</span>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-slate-800 bg-panel/70 px-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            data-testid={`tab-${tab.id}`}
            className={clsx(
              "border-b-2 px-4 py-3 text-sm font-medium transition",
              active === tab.id ? "tab-active" : "border-transparent text-slate-400 hover:text-slate-200",
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-6xl space-y-4">
          {loaded ? (
            <>
              {active === "server" ? <ServerTab /> : null}
              {active === "models" ? <ModelsTab /> : null}
              {active === "agent-runtime" ? <AgentRuntimeTab /> : null}
              {active === "settings" ? <SettingsTab /> : null}
              {active === "fine-tuning" ? <FineTuningTab /> : null}
              {active === "system-monitor" ? <SystemMonitorTab /> : null}
            </>
          ) : (
            <div className="card p-4 text-sm text-slate-400">Loading configuration…</div>
          )}
        </div>
      </main>

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
