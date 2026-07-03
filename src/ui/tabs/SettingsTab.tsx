import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { useAppController, useControllerState } from "@/state/reactBinding";
import { FilePicker } from "@/ui/components/FilePicker";
import { FlagWidget } from "@/ui/components/FlagWidget";
import { SERVER_FLAGS } from "@/config/flagCatalog";
import { defaultServerFlags } from "@/config/flagCatalog";
import type { FlagDef, FlagSection, FlagValues } from "@/config/types";

const SECTIONS: FlagSection[] = [
  "Server",
  "Model Loading",
  "Context & Batching",
  "Sampling",
  "Prompts & Templates",
  "Position Encoding",
  "Embeddings & Special",
  "LoRA & Control Vectors",
  "SSL & Advanced",
];

const SERVER_TAB_OWNED = new Set(["host", "port", "n-gpu-layers"]);

function flagsForSection(section: FlagSection): FlagDef[] {
  return SERVER_FLAGS.filter((f) => f.section === section && !SERVER_TAB_OWNED.has(f.id));
}

export function SettingsTab(): JSX.Element {
  const controller = useAppController();
  const config = useControllerState((c) => c.config);
  const [serverPath, setServerPath] = useState(config.binaryPaths.server);
  const [finetunePath, setFinetunePath] = useState(config.binaryPaths.finetune);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [flagDraft, setFlagDraft] = useState<FlagValues>(config.serverFlags);
  const [flagSaveState, setFlagSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");

  const grouped = useMemo(() => SECTIONS.map((section) => ({ section, flags: flagsForSection(section) })), []);

  useEffect(() => {
    setFlagDraft(config.serverFlags);
  }, [config.serverFlags]);

  function setFlag(id: string, value: string | number | boolean): void {
    setFlagDraft((draft) => ({ ...draft, [id]: value }));
    setFlagSaveState("dirty");
  }

  function resetSection(section: FlagSection): void {
    const defs = defaultServerFlags();
    setFlagDraft((draft) => {
      const next = { ...draft };
      for (const f of flagsForSection(section)) next[f.id] = defs[f.id];
      return next;
    });
    setFlagSaveState("dirty");
  }

  function resetAll(): void {
    setFlagDraft(defaultServerFlags());
    setFlagSaveState("dirty");
  }

  async function applyFlags(): Promise<void> {
    setFlagSaveState("saving");
    const ok = await controller.applyServerFlags(flagDraft);
    setFlagSaveState(ok ? "saved" : "error");
  }

  async function saveBinaryPaths(): Promise<void> {
    setSaveState("saving");
    const ok = await controller.setBinaryPaths({ server: serverPath, finetune: finetunePath });
    if (ok) {
      setServerPath(controller.config.binaryPaths.server);
      setFinetunePath(controller.config.binaryPaths.finetune);
      setSaveState("saved");
      return;
    }
    setSaveState("error");
  }

  return (
    <div className="space-y-4">
      <div className="card p-4" data-testid="binary-settings-section">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Binary paths</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FilePicker value={serverPath} onChange={(value) => { setServerPath(value); setSaveState("idle"); }} label="Server binary" help="Path to your llama-server executable, or the folder containing it." kind="file-or-directory" testId="settings-server-binary" />
          <FilePicker value={finetunePath} onChange={(value) => { setFinetunePath(value); setSaveState("idle"); }} label="Finetune binary" help="Optional path to your llama-finetune executable, or the folder containing it." kind="file-or-directory" testId="settings-finetune-binary" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={saveState === "saving"} onClick={() => void saveBinaryPaths()} data-testid="save-binary-paths">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save binary paths"}
          </button>
          {saveState === "saved" ? <span className="text-sm text-emerald-300" role="status">Saved and verified. Resolved paths are shown above.</span> : null}
          {saveState === "error" ? <span className="text-sm text-red-300" role="alert">Save failed. Review the log panel for details.</span> : null}
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Server flags</h2>
          <div className="flex flex-wrap items-center gap-2">
            {flagSaveState === "dirty" ? <span className="text-xs text-amber-300" role="status">Unsaved flag changes</span> : null}
            {flagSaveState === "saved" ? <span className="text-xs text-emerald-300" role="status">Server flags applied</span> : null}
            {flagSaveState === "error" ? <span className="text-xs text-red-300" role="alert">Apply failed</span> : null}
            <button type="button" className="btn-primary" disabled={flagSaveState === "saving" || flagSaveState === "idle" || flagSaveState === "saved"} onClick={() => void applyFlags()} data-testid="apply-server-flags">
              {flagSaveState === "saving" ? "Applying…" : "Apply server flags"}
            </button>
            <button type="button" className="btn-ghost" onClick={resetAll} data-testid="reset-all-flags">
              Reset all to defaults
            </button>
          </div>
        </div>
        <p className="mb-4 text-xs text-slate-400">
          Advanced llama.cpp server flags are exposed below. Host, port, and GPU layer offload are controlled from the Server tab.
        </p>
        <div className="space-y-6">
          {grouped.map(({ section, flags }) => (
            <section key={section}>
              <div className="mb-3 flex items-center justify-between border-b border-slate-700/60 pb-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-accent" data-testid={`flag-section-${section}`}>
                  {section}
                </h3>
                <button type="button" className="text-xs text-slate-400 hover:text-slate-200" onClick={() => resetSection(section)} data-testid={`reset-section-${section}`}>
                  Reset section
                </button>
              </div>
              <div className={clsx("grid gap-4", "sm:grid-cols-2 lg:grid-cols-3")}>
                {flags.map((def) => (
                  <FlagWidget
                    key={def.id}
                    def={def}
                    value={flagDraft[def.id] ?? def.default}
                    onChange={(v) => setFlag(def.id, v)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
