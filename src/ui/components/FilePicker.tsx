import { useRef } from "react";
import { invoke } from "@/ipc/transport";

interface FilePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  help?: string;
  kind?: "file" | "directory" | "file-or-directory";
  testId?: string;
}

export function FilePicker({ value, onChange, label, help, kind = "file", testId }: FilePickerProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  async function browse(pickKind: "file" | "directory"): Promise<void> {
    try {
      const result = await invoke<string | null>("dialog.open", { kind: pickKind });
      if (typeof result === "string" && result.length > 0) onChange(result);
    } catch {
      // No native dialog available in this environment; the user can type a path instead.
    }
  }

  return (
    <div>
      {label ? <label className="field-label" htmlFor={`${testId ?? label ?? "file"}-input`}>{label}</label> : null}
      <div className="flex gap-2">
        <input
          id={`${testId ?? label ?? "file"}-input`}
          ref={inputRef}
          data-testid={testId}
          className="input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {kind === "file-or-directory" ? (
          <>
            <button type="button" className="btn-ghost shrink-0" onClick={() => void browse("file")} data-testid={`${testId ?? "file"}-browse-file`}>
              File
            </button>
            <button type="button" className="btn-ghost shrink-0" onClick={() => void browse("directory")} data-testid={`${testId ?? "file"}-browse-directory`}>
              Folder
            </button>
          </>
        ) : (
          <button type="button" className="btn-ghost shrink-0" onClick={() => void browse(kind)} data-testid={`${testId ?? "file"}-browse`}>
            Browse
          </button>
        )}
      </div>
      {help ? <p className="mt-1 text-xs text-slate-400">{help}</p> : null}
    </div>
  );
}
