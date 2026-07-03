import { clsx } from "clsx";
import type { FlagDef } from "@/config/types";
import { FilePicker } from "./FilePicker";

interface FlagWidgetProps {
  def: FlagDef;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx("relative h-6 w-11 rounded-full transition", checked ? "bg-accent" : "bg-slate-600")}
    >
      <span
        className={clsx(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition",
          checked ? "left-0.5 translate-x-5" : "left-0.5",
        )}
      />
    </button>
  );
}

export function FlagWidget({ def, value, onChange }: FlagWidgetProps): JSX.Element {
  const helpId = `flag-${def.id}-help`;
  return (
    <div className="flex flex-col gap-1" data-testid={`flag-${def.id}`}>
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-slate-200" title={def.help}>
          {def.label}
          <span className="ml-1 cursor-help text-slate-500" title={def.help} aria-hidden="true">
            ⓘ
          </span>
        </label>
        <span className="font-mono text-xs text-slate-500" title={`Command-line flag: ${def.flag}`}>
          {def.flag}
        </span>
      </div>

      {def.type === "boolean" ? (
        <div className="pt-1">
          <Toggle checked={Boolean(value)} onChange={(v) => onChange(v)} label={def.label} />
        </div>
      ) : null}

      {def.type === "enum" ? (
        <select
          className="input"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={helpId}
        >
          {def.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : null}

      {def.type === "string" ? (
        <input
          className="input"
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={helpId}
        />
      ) : null}

      {def.type === "path" ? (
        <FilePicker value={String(value ?? "")} onChange={(v) => onChange(v)} help={def.help} testId={`flag-${def.id}-picker`} />
      ) : null}

      {def.type === "number" ? (
        <div className="flex items-center gap-3">
          <input
            type="range"
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-slate-600 accent-accent"
            min={def.min}
            max={def.max}
            step={def.step}
            value={Number(value)}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-describedby={helpId}
          />
          <input
            type="number"
            className="input w-28"
            min={def.min}
            max={def.max}
            step={def.step}
            value={Number(value)}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={`${def.label} value`}
          />
        </div>
      ) : null}

      <p id={helpId} className="text-xs text-slate-400" data-testid={`flag-${def.id}-tooltip`}>
        {def.help}
      </p>
    </div>
  );
}
