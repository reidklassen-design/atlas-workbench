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

function searchableFlagText(flag: FlagDef): string {
  return [
    flag.id,
    flag.flag,
    flag.negatedFlag,
    flag.label,
    flag.section,
    flag.type,
    flag.help,
    ...(flag.options ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function SettingsTab(): JSX.Element {
  const controller = useAppController();
  const config = useControllerState((c) => c.config);
  const [serverPath, setServerPath] = useState(config.binaryPaths.server);
  const [finetunePath, setFinetunePath] = useState(config.binaryPaths.finetune);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [systemPromptDraft, setSystemPromptDraft] = useState(config.systemPrompt);
  const [systemPromptSaveState, setSystemPromptSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [flagDraft, setFlagDraft] = useState<FlagValues>(config.serverFlags);
  const [flagSaveState, setFlagSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [flagSearch, setFlagSearch] = useState("");
  const [activeSection, setActiveSection] = useState<FlagSection>("Server");

  const grouped = useMemo(() => SECTIONS.map((section) => ({ section, flags: flagsForSection(section) })), []);
  const searchableFlagCount = useMemo(() => grouped.reduce((total, group) => total + group.flags.length, 0), [grouped]);
  const activeGroup = useMemo(() => grouped.find((group) => group.section === activeSection) ?? grouped[0], [activeSection, grouped]);
  const filteredGroups = useMemo(() => {
    const query = flagSearch.trim().toLowerCase();
    if (!query) return grouped;
    const terms = query.split(/\s+/).filter(Boolean);
    return grouped
      .map(({ section, flags }) => ({
        section,
        flags: flags.filter((flag) => {
          const haystack = searchableFlagText(flag);
          return terms.every((term) => haystack.includes(term));
        }),
      }))
      .filter(({ flags }) => flags.length > 0);
  }, [grouped, flagSearch]);
  const searchActive = flagSearch.trim().length > 0;
  const visibleGroups = searchActive ? filteredGroups : activeGroup ? [activeGroup] : [];
  const visibleFlagCount = useMemo(() => visibleGroups.reduce((total, group) => total + group.flags.length, 0), [visibleGroups]);

  useEffect(() => {
    setFlagDraft(config.serverFlags);
  }, [config.serverFlags]);

  useEffect(() => {
    setSystemPromptDraft(config.systemPrompt);
  }, [config.systemPrompt]);

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

  async function applySystemPrompt(): Promise<void> {
    setSystemPromptSaveState("saving");
    const ok = await controller.applySystemPrompt(systemPromptDraft);
    setSystemPromptSaveState(ok ? "saved" : "error");
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
        <div className="mb-4 flex gap-2 overflow-x-auto border-b border-white/10 pb-3" role="tablist" aria-label="Settings sections">
          {grouped.map(({ section, flags }) => {
            const active = !searchActive && section === activeSection;
            return (
              <button
                key={section}
                type="button"
                role="tab"
                aria-selected={active}
                className={clsx(
                  "shrink-0 rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition",
                  active
                    ? "border-[#7CFF2B]/70 bg-[#102A1B] text-[#E8FFF0] shadow-[0_0_18px_rgba(57,255,20,0.16)]"
                    : "border-white/10 bg-white/[0.03] text-[#8FA99A] hover:border-[#3D7A32]/70 hover:text-[#E8FFF0]",
                )}
                onClick={() => {
                  setActiveSection(section);
                  setFlagSearch("");
                }}
                data-testid={`settings-section-tab-${section}`}
              >
                {section}
                <span className="ml-2 text-[#7CFF2B]">{flags.length}</span>
              </button>
            );
          })}
        </div>
        <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <label className="min-w-0 flex-1">
              <span className="section-kicker">Search All Settings</span>
              <input
                type="search"
                className="input mt-2"
                value={flagSearch}
                onChange={(event) => setFlagSearch(event.target.value)}
                aria-label="Find any setting by name, command, section, option, or help text"
                data-testid="settings-flag-search"
              />
            </label>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span data-testid="settings-search-count">
                {searchActive ? `${visibleFlagCount} of ${searchableFlagCount} settings` : `${visibleFlagCount} ${activeSection} settings`}
              </span>
              {searchActive ? (
                <button type="button" className="btn-ghost" onClick={() => setFlagSearch("")} data-testid="settings-search-clear">
                  Clear search
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          {visibleGroups.map(({ section, flags }) => (
            <section key={section}>
              <div className="mb-3 flex items-center justify-between border-b border-slate-700/60 pb-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-accent" data-testid={`flag-section-${section}`}>
                  {section}
                </h3>
                <button type="button" className="text-xs text-slate-400 hover:text-slate-200" onClick={() => resetSection(section)} data-testid={`reset-section-${section}`}>
                  Reset section
                </button>
              </div>
              {section === "Prompts & Templates" ? (
                <div className="mb-4 rounded-lg border border-[#3D7A32]/50 bg-[#07130D]/60 p-4" data-testid="system-prompt-settings-section">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold text-white">System prompt</h4>
                      <p className="mt-1 text-sm text-slate-400">Atlas inserts this as the first system message for chat requests sent through the gateway.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {systemPromptSaveState === "dirty" ? <span className="text-xs text-amber-300" role="status">Unsaved prompt changes</span> : null}
                      {systemPromptSaveState === "saved" ? <span className="text-xs text-emerald-300" role="status">System prompt applied</span> : null}
                      {systemPromptSaveState === "error" ? <span className="text-xs text-red-300" role="alert">Apply failed</span> : null}
                      <button type="button" className="btn-primary" disabled={systemPromptSaveState === "saving" || systemPromptSaveState === "idle" || systemPromptSaveState === "saved"} onClick={() => void applySystemPrompt()} data-testid="apply-system-prompt">
                        {systemPromptSaveState === "saving" ? "Applying…" : "Apply system prompt"}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => {
                          setSystemPromptDraft("");
                          setSystemPromptSaveState("dirty");
                        }}
                        data-testid="clear-system-prompt"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <label htmlFor="settings-system-prompt" className="field-label">Prompt text</label>
                  <textarea
                    id="settings-system-prompt"
                    className="input min-h-48 w-full resize-y"
                    value={systemPromptDraft}
                    onChange={(event) => {
                      setSystemPromptDraft(event.target.value);
                      setSystemPromptSaveState("dirty");
                    }}
                    data-testid="settings-system-prompt"
                  />
                  <p className="mt-2 text-xs text-slate-400">Apply saves the prompt and injects it into new chat requests through Atlas Gateway. The model server is left running; unload and reload it separately whenever you choose.</p>
                </div>
              ) : null}
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
          {searchActive && visibleFlagCount === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400" data-testid="settings-search-empty">
              No settings match “{flagSearch.trim()}”.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
