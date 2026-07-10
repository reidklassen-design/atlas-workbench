import { clsx } from "clsx";
import type { ProcessStatus } from "@/config/types";

const STYLES: Record<ProcessStatus["state"], { dot: string; label: string }> = {
  stopped: { dot: "bg-slate-500", label: "Stopped" },
  starting: { dot: "bg-warn shadow-[0_0_14px_rgba(245,158,11,0.55)] animate-pulse", label: "Starting" },
  running: { dot: "bg-ok shadow-[0_0_14px_rgba(34,197,94,0.55)] animate-pulse", label: "Running" },
  exited: { dot: "bg-err", label: "Exited" },
};

export function StatusIndicator({ status }: { status: ProcessStatus }): JSX.Element {
  const style = STYLES[status.state] ?? STYLES.stopped;
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm shadow-sm shadow-black/20">
      <span className={clsx("h-2.5 w-2.5 rounded-full", style.dot)} aria-hidden="true" />
      <span className="font-medium text-slate-200">{style.label}</span>
      {status.external ? <span className="text-xs text-amber-300">external</span> : null}
      {status.pid ? <span className="text-xs text-slate-400">pid {status.pid}</span> : null}
    </span>
  );
}
