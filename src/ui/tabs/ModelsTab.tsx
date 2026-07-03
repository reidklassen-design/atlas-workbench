import { useState } from "react";
import { clsx } from "clsx";
import { useAppController, useControllerState } from "@/state/reactBinding";
import { FilePicker } from "@/ui/components/FilePicker";

export function ModelsTab(): JSX.Element {
  const controller = useAppController();
  const config = useControllerState((c) => c.config);
  const models = useControllerState((c) => c.models);
  const [selected, setSelected] = useState<string>("");
  const [selectionState, setSelectionState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const selectedName = config.model.selectedModel.split("/").pop() || config.model.selectedModel;

  async function onBrowse(directory: string): Promise<void> {
    setSelected("");
    setSelectionState("idle");
    await controller.setModelDirectory(directory);
  }

  async function loadModel(): Promise<void> {
    if (!selected) return;
    setSelectionState("saving");
    const saved = await controller.selectModel(selected);
    setSelectionState(saved ? "saved" : "error");
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <FilePicker
          value={config.model.directory}
          onChange={(v) => void onBrowse(v)}
          label="Model directory"
          help="Pick a folder that contains your .gguf model files."
          kind="directory"
          testId="model-directory"
        />

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="field-label mb-0">Models</span>
            {selectedName ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-accent/50 bg-accent/10 px-3 py-1 text-xs text-sky-200" data-testid="loaded-model-indicator">
                Selected for launch: {selectedName}
              </span>
            ) : (
              <span className="text-xs text-slate-400" data-testid="loaded-model-indicator">No model selected</span>
            )}
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-slate-700 bg-panel">
            {models.error ? (
              <div className="p-3 text-sm text-rose-300" data-testid="model-list-error">{models.error}</div>
            ) : models.files.length === 0 ? (
              <div className="p-3 text-sm text-slate-400" data-testid="model-list-empty">
                {models.message ?? "Choose a directory to list your models."}
              </div>
            ) : (
              <ul className="divide-y divide-slate-800" data-testid="model-list">
                {models.files.map((name) => {
                  const active = (selected || selectedName) === name;
                  return (
                    <li key={name}>
                      <label className={clsx("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-800/50", active && "bg-slate-800/70")}>
                        <input type="radio" name="model" checked={active} onChange={() => setSelected(name)} data-testid={`model-radio-${name}`} />
                        <span className="text-slate-200">{name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-primary" disabled={!selected || selectionState === "saving"} onClick={() => void loadModel()} data-testid="load-model">
            {selectionState === "saving" ? "Saving…" : "Use for Server Launch"}
          </button>
          <button type="button" className="btn-ghost" disabled={!config.model.selectedModel} onClick={() => void controller.unloadModel()} data-testid="unload-model">
            Clear Selection
          </button>
        </div>
        {selectionState !== "idle" ? (
          <p className={clsx("mt-2 text-sm", selectionState === "error" ? "text-rose-300" : "text-slate-300")} role="status" data-testid="model-selection-status">
            {selectionState === "saving" ? "Saving model selection…" : selectionState === "saved" ? "Model selection saved for the next server launch." : "Model selection could not be saved. Review the server log and try again."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
