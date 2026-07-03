import { useControllerState } from "@/state/reactBinding";
import { clsx } from "clsx";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function Bar({ value, color = "bg-accent" }: { value: number; color?: string }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full rounded-full bg-slate-700">
      <div className={clsx("h-2 rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SystemMonitorTab(): JSX.Element {
  const metrics = useControllerState((c) => c.metrics);

  if (!metrics) {
    return (
      <div className="card p-4 text-sm text-slate-400" data-testid="system-monitor">
        Collecting system metrics…
      </div>
    );
  }

  const ramColor = metrics.ram.percent > 90 ? "bg-err" : metrics.ram.percent > 70 ? "bg-warn" : "bg-ok";

  return (
    <div className="space-y-4" data-testid="system-monitor">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">CPU</h2>
            <span className="text-2xl font-semibold text-white" data-testid="cpu-overall">{metrics.cpu.overall.toFixed(1)}%</span>
          </div>
          <Bar value={metrics.cpu.overall} />
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8" data-testid="cpu-cores">
            {metrics.cpu.perCore.map((core, i) => (
              <div key={i} className="rounded bg-panel p-1 text-center">
                <div className="text-[10px] text-slate-500">#{i}</div>
                <div className="text-xs font-medium text-slate-200">{core.toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">RAM</h2>
            <span className="text-2xl font-semibold text-white" data-testid="ram-overall">{metrics.ram.percent.toFixed(1)}%</span>
          </div>
          <Bar value={metrics.ram.percent} color={ramColor} />
          <p className="mt-3 text-sm text-slate-300" data-testid="ram-detail">
            {formatBytes(metrics.ram.used)} used of {formatBytes(metrics.ram.total)}
          </p>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">GPU</h2>
        {metrics.gpu.detected ? (
          <div data-testid="gpu-metrics">
            <p className="text-sm text-slate-200">{metrics.gpu.name ?? "GPU"}</p>
            {metrics.gpu.usagePercent !== undefined ? (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-slate-400"><span>Utilization</span><span>{metrics.gpu.usagePercent.toFixed(0)}%</span></div>
                <Bar value={metrics.gpu.usagePercent} color="bg-accent2" />
              </div>
            ) : null}
            {metrics.gpu.memoryTotal !== undefined ? (
              <p className="mt-2 text-xs text-slate-400">
                {formatBytes(metrics.gpu.memoryUsed ?? 0)} / {formatBytes(metrics.gpu.memoryTotal)} VRAM
              </p>
            ) : null}
            {metrics.gpu.note ? <p className="mt-2 text-xs text-slate-500">{metrics.gpu.note}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-amber-300" data-testid="gpu-not-detected">
            {metrics.gpu.note ?? "GPU not detected"}
          </p>
        )}
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">llama.cpp process</h2>
        {metrics.processes.length === 0 ? (
          <p className="text-sm text-slate-400" data-testid="no-process">No llama.cpp process is running.</p>
        ) : (
          <table className="w-full text-sm" data-testid="process-table">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1">Process</th>
                <th className="py-1">PID</th>
                <th className="py-1">CPU</th>
                <th className="py-1">Memory</th>
              </tr>
            </thead>
            <tbody>
              {metrics.processes.map((p) => (
                <tr key={p.pid} className="border-t border-slate-800">
                  <td className="py-2 text-slate-200">{p.name}</td>
                  <td className="py-2 text-slate-400">{p.pid}</td>
                  <td className="py-2 text-slate-200">{p.cpuPercent.toFixed(1)}%</td>
                  <td className="py-2 text-slate-200">{formatBytes(p.memoryBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
