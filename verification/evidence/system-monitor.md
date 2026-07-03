# Feature Evidence: system-monitor

## Feature

- ID: system-monitor
- Spec: specs/feature-system-monitor.md
- Status: done
- Constitution coverage: Honors the product constitution promise that the System Monitor tab shows real-time CPU, RAM, GPU, and process metrics so the user understands local hardware load.

## Verification Commands Run

- `bash verify.sh`: exit 0 — "Static scaffold and wiring-smell checks passed"; npm test ran vitest with 98 tests passing across 15 files.
- `npx vitest run tests/monitor.test.ts tests/backend.test.ts tests/ui/SystemMonitorTab.test.tsx`: CPU/RAM, GPU present/absent, process resource, backend command, and UI rendering tests passing.
- `npx tsc --noEmit`: clean.

## Wiring Audit

| Entry Point | Implementation Path | Test/Scenario Evidence |
|---|---|---|
| System Monitor tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/SystemMonitorTab.tsx | tests/ui/App.test.tsx |
| CPU usage display | SystemMonitor.collect -> controller.metrics.cpu -> SystemMonitorTab | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx |
| RAM usage display | SystemMonitor.collect -> controller.metrics.ram -> SystemMonitorTab | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx |
| GPU usage display | gpuProbe -> SystemMonitor.collect -> SystemMonitorTab | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx |
| Process resource usage display | SystemMonitor.collect(pids) -> `/proc` resource reads -> process table | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx |

## Acceptance Criteria Evidence

| Criterion | Evidence |
|---|---|
| CPU and RAM metrics update at least once per second | AppController.startMetrics polls every 1000 ms; tests/monitor.test.ts asserts values update over time |
| GPU metrics display when a GPU is present, or a 'GPU not detected' message when not | tests/monitor.test.ts covers static GPU and no-GPU probes; tests/ui/SystemMonitorTab.test.tsx asserts both UI paths |
| When the server is running, the llama.cpp process resource usage is visible | tests/monitor.test.ts reads injected `/proc` pid stats; tests/ui/SystemMonitorTab.test.tsx renders process table row |
| The UI does not freeze or stutter while metrics update | monitor collection is async and polled; tests complete without blocking and assert async updates |

## Constitution Evidence

| Constitutional Promise/Law | Evidence |
|---|---|
| A System Monitor tab showing real-time CPU, RAM, and GPU metrics | UI renders CPU, RAM, GPU cards from real metrics data |
| GPU not detected message when unavailable | no-GPU probe and UI test assert exact "GPU not detected" output |
| The user can monitor llama.cpp process usage | process table is populated from running server/training pids |
| UI remains responsive | metrics are collected asynchronously outside render |

## Scenario Review

- Scenario pass rate: 1/1 (100%) — real-time-metrics-display: CPU/RAM display, updates, GPU present/absent paths, process usage, and no UI freeze.
- Failed scenarios: none

## Known Gaps

none
