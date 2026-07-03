import { useState } from "react";
import { useAppController } from "@/state/reactBinding";
import { FilePicker } from "./FilePicker";

export function BinarySetupDialog(): JSX.Element {
  const controller = useAppController();
  const [server, setServer] = useState("");
  const [finetune, setFinetune] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    const ok = await controller.setBinaryPaths({ server, finetune });
    setSaving(false);
    if (ok) controller.refreshConfig();
  }

  const canSave = server.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" data-testid="binary-setup-dialog">
      <div className="card w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold text-white">Welcome to Atlas Workbench</h2>
        <p className="mt-2 text-sm text-slate-300">
          Point the app at your existing llama.cpp binaries. Atlas Workbench never downloads or builds llama.cpp — it only launches the binaries you already have.
        </p>

        <div className="mt-4 space-y-4">
          <FilePicker value={server} onChange={setServer} label="llama.cpp server binary" help="The llama-server executable, or the folder containing it." kind="file-or-directory" testId="server-binary" />
          <FilePicker value={finetune} onChange={setFinetune} label="llama.cpp finetune binary" help="Optional. Set this only if you have a llama-finetune executable." kind="file-or-directory" testId="finetune-binary" />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn-primary" disabled={!canSave || saving} onClick={() => void save()} data-testid="binary-setup-save">
            {saving ? "Saving…" : "Save and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
