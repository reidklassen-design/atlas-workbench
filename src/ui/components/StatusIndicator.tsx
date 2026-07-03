import { clsx } from "clsx";
import type { ProcessStatus } from "@/config/types";

const STYLES: Record<ProcessStatus["state"], { dot: string; label: string }> = {
  stopped: { dot: "bg-slate-500", label: "Stopped" },
  starting: { dot: "bg-warn animate-pulse", label: "Starting" },
  running: { dot: "bg-ok animate-pulse", label: "Running" },
  exited: { dot: "bg-err", label: "Exited" },
};

export function StatusIndicator({ status }: { status: ProcessStatus }): JSX.Element {
  const style = STYLES[status.state] ?? STYLES.stopped;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-panel px-3 py-1 text-sm">
      <span className={clsx("h-2.5 w-2.5 rounded-full", style.dot)} aria-hidden="true" />
      <span className="font-medium text-slate-200">{style.label}</span>
      {status.external ? <span className="text-xs text-amber-300">external</span> : null}
      {status.pid ? <span className="text-xs text-slate-400">pid {status.pid}</span> : null}
    </span>
  );
}
