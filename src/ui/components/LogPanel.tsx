import { useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { ProcessLogLine } from "@/config/types";

interface LogPanelProps {
  logs: ProcessLogLine[];
  onClear?: () => void;
  emptyText?: string;
}

export function LogPanel({ logs, onClear, emptyText = "Waiting for output…" }: LogPanelProps): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // auto-scroll only when the user is already near the bottom
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="card flex flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="section-kicker">Log</span>
        {onClear ? (
          <button type="button" className="rounded px-2 py-1 text-xs text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-200" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>
      <div ref={containerRef} className="log-panel" role="log" aria-live="polite">
        {logs.length === 0 ? <div className="text-slate-500">{emptyText}</div> : null}
        {logs.map((line, idx) => (
          <div key={idx} className={clsx("whitespace-pre-wrap", line.stream === "stderr" ? "text-rose-300" : "text-slate-200")}>
            <span className="select-none text-slate-600">{new Date(line.ts).toLocaleTimeString()} </span>
            {line.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
