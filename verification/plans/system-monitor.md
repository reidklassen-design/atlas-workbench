# Feature Implementation Plan: system-monitor

## Feature

- ID: system-monitor
- Spec: specs/feature-system-monitor.md
- Product constitution slice: "A System Monitor tab showing real-time CPU, RAM, and GPU metrics"; assumption validation that a "GPU not detected" message appears when no GPU is available.
- Acceptance contract slice: docs/acceptance_contract.json feature `system-monitor`.

## Implementation Strategy

- `src/monitor/gpuProbe.ts` — `createLinuxGpuProbe` detects GPUs through `/proc/driver/nvidia` and `/sys/class/drm` sysfs (no external processes spawned, per the spec constraint); `createNoGpuProbe` returns the "GPU not detected" result.
- `src/monitor/systemMonitor.ts` — `collect()` samples CPU (overall + per-core via `os.cpus()` deltas), RAM (`os.totalmem`/`freemem`), GPU (via the probe), and child-process resource usage via injected `/proc/<pid>/stat` and `/proc/<pid>/statm` reads; updates at least once per second without blocking.
- `src/ipc/backend.ts` — `monitor.collect` accepts the current llama.cpp pids and returns `SystemMetrics`.
- `src/state/appController.ts` — polls `monitor.collect` every 1000 ms with the running server/training pids.
- `src/ui/tabs/SystemMonitorTab.tsx` — CPU, RAM, GPU, and process resource displays.

## Constitution Coverage

- Honors the non-negotiable promise of real-time CPU, RAM, and GPU metrics.
- Honors the assumption validation by showing "GPU not detected" when no GPU is available.
- Honors the modern-UI promise with a clean dashboard layout.
- Honors the acceptance law — every display reads from real metrics collected by the monitor layer.

## Public Tests To Add

- `tests/monitor.test.ts`: CPU/RAM collected and update over time; "GPU not detected" with the no-GPU probe; GPU metrics with a static probe; child-process resource usage via injected `/proc` reads; vanished process handled gracefully.
- `tests/backend.test.ts`: `monitor.collect` reports GPU not detected and CPU per-core.
- `tests/ui/SystemMonitorTab.test.tsx`: "GPU not detected" shown when absent; GPU metrics shown when present; llama.cpp process row shown when running; no-process message when idle.

## Wiring Plan

| Entry Point | Target Implementation | Test Evidence Planned |
|---|---|---|
| System Monitor tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/SystemMonitorTab.tsx | tests/ui/App.test.tsx |
| CPU usage display | SystemMonitorTab from controller.metrics.cpu | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx |
| RAM usage display | SystemMonitorTab from controller.metrics.ram | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx |
| GPU usage display | SystemMonitorTab from controller.metrics.gpu (probe) | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx |
| Process resource usage display | SystemMonitorTab from controller.metrics.processes | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx |

## Risks

- No GPU readable without vendor tools — mitigated by the "GPU not detected" fallback and the no-spawn constraint.
- Metric collection lag under load — mitigated by a 1 s poll and async collection that does not block the UI.

## Rollback Plan

- The monitor is polled by the controller and rendered by the tab; removing the tab stops polling with no effect on other features.

## Definition Of Done

- `bash verify.sh` exits 0; every acceptance criterion has a passing test; evidence lists real commands and wiring; no known gaps.
