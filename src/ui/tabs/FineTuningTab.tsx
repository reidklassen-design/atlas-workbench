import { useAppController, useControllerState } from "@/state/reactBinding";
import { FilePicker } from "@/ui/components/FilePicker";
import { FlagWidget } from "@/ui/components/FlagWidget";
import { StatusIndicator } from "@/ui/components/StatusIndicator";
import { LogPanel } from "@/ui/components/LogPanel";
import { FINETUNE_PARAMS } from "@/config/flagCatalog";
import type { FinetuneParamDef } from "@/config/types";

const PRIMARY_IDS = ["train-data", "lora-out", "learning-rate", "epochs", "batch-size"];
const PRIMARY = FINETUNE_PARAMS.filter((p) => PRIMARY_IDS.includes(p.id));
const ADVANCED = FINETUNE_PARAMS.filter((p) => !PRIMARY_IDS.includes(p.id));

function setParam(controller: ReturnType<typeof useAppController>, id: string, value: string | number | boolean): void {
  void controller.updateConfig((cfg) => ({ ...cfg, finetune: { ...cfg.finetune, [id]: value } }));
}

export function FineTuningTab(): JSX.Element {
  const controller = useAppController();
  const config = useControllerState((c) => c.config);
  const status = useControllerState((c) => c.training);
  const logs = useControllerState((c) => c.trainingLogs);
  const running = status.state === "running" || status.state === "starting";

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Fine-tuning</h2>
          <StatusIndicator status={status} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {PRIMARY.map((p) => {
            const def = p as unknown as FinetuneParamDef & { section: string };
            if (p.type === "path") {
              return (
                <FilePicker
                  key={p.id}
                  value={String(config.finetune[p.id] ?? "")}
                  onChange={(v) => setParam(controller, p.id, v)}
                  label={p.label}
                  help={p.help}
                  testId={`finetune-${p.id}`}
                />
              );
            }
            return (
              <div key={p.id}>
                <FlagWidget def={{ ...def, section: "Fine-tuning", flag: p.flag }} value={config.finetune[p.id] ?? p.default} onChange={(v) => setParam(controller, p.id, v)} />
              </div>
            );
          })}
        </div>

        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">Advanced parameters</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ADVANCED.map((p) => (
              <FlagWidget
                key={p.id}
                def={{ ...p, section: "Fine-tuning" }}
                value={config.finetune[p.id] ?? p.default}
                onChange={(v) => setParam(controller, p.id, v)}
              />
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-primary" disabled={running} onClick={() => void controller.startTraining()} data-testid="start-training">
            Start Training
          </button>
          <button type="button" className="btn-danger" disabled={!running} onClick={() => void controller.stopTraining()} data-testid="stop-training">
            Stop Training
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Training launches the finetune binary with the parameters above. A LoRA adapter/output artifact is written to the output path on success.
        </p>
      </div>

      <LogPanel logs={logs} onClear={() => controller.clearLogs("finetune")} emptyText="Start training to see its output here." />
    </div>
  );
}
