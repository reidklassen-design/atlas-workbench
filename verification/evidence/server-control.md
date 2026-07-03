# Feature Evidence: server-control

## Feature

- ID: server-control
- Spec: specs/feature-server-control.md
- Status: done
- Constitution coverage: Honors the product constitution "Start server with a loaded model" workflow, the acceptance law that every visible control is wired to real behavior, and the evidence law that server launch is proven by asserting the child process is running and the configured port responds.

## Verification Commands Run

- `npm test`: exit 0 — vitest ran 110 tests across 17 files.
- `npm run typecheck`: exit 0 — TypeScript clean.
- `npm run build`: exit 0 — production Vite build completed.
- `cd src-tauri && cargo check --target-dir /tmp/atlas-workbench-target`: exit 0 — Rust/Tauri backend clean.
- `bash verify.sh`: exit 0 — Dark Factory verification passed after the model-loading feedback and crash-handling updates.
- `npx vitest run tests/processManager.test.ts tests/backend.test.ts tests/flagBuilder.test.ts tests/ui/ServerTab.test.tsx tests/tauriCapabilities.test.ts`: server lifecycle, HTTP response when localhost is available, crash, port-in-use, child-process stream capture, flag emission, launch telemetry UI, wildcard-host health probe display, and Tauri event capability tests passing.

## Wiring Audit

| Entry Point | Implementation Path | Test/Scenario Evidence |
|---|---|---|
| Server tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/ServerTab.tsx | tests/ui/App.test.tsx (tab present and switches) |
| Start Server button | ServerTab -> AppController.startServer -> backend `server.start` -> ProcessManager.startServer | tests/processManager.test.ts + tests/backend.test.ts (process running, HTTP 200) |
| Stop Server button | ServerTab -> AppController.stopServer -> backend `server.stop` -> ProcessManager.stop | tests/processManager.test.ts + tests/backend.test.ts (state exited, isRunning false) |
| Host input field | ServerTab -> updateConfig -> flagBuilder `--host` | tests/flagBuilder.test.ts + tests/ui/ServerTab.test.tsx |
| Port input field | ServerTab -> updateConfig -> flagBuilder `--port` | tests/flagBuilder.test.ts + tests/ui/ServerTab.test.tsx |
| Log panel | LogPanel subscribes to ProcessManager `log` events; Rust process layer also persists stdout/stderr to `~/.config/atlas-workbench/logs/server.log` | tests/processManager.test.ts + tests/ui/ServerTab.test.tsx (streamed lines render and log file path is visible) |
| Model-loading progress panel | Tauri `server_start` returns starting -> background readiness watcher emits running/error -> ServerLaunchProgress renders phase, health probe URL, pid, model, exact command, elapsed time, timeout countdown, and latest output | tests/ui/ServerTab.test.tsx ("shows model-loading progress while the server is starting") |
| Health probe for `0.0.0.0` listen host | Rust readiness watcher maps wildcard listen hosts to loopback for local `/health` polling; UI displays the same loopback probe URL | tests/ui/ServerTab.test.tsx ("uses loopback for the launch health probe when the server listens on all interfaces"), cargo check |

## Acceptance Criteria Evidence

| Criterion | Evidence |
|---|---|
| Clicking Start launches the server process and the log panel shows startup output | tests/processManager.test.ts: start resolves running, "listening" log appears; backend test: HTTP 200 on the configured port |
| Clicking Start gives visible loading feedback while a model is loading | tests/ui/ServerTab.test.tsx asserts the Loading Model panel, health phase, health probe URL, pid, command, selected model, timeout countdown, and disabled Start button while state is `starting` |
| Clicking Stop terminates the server process and the status indicator changes to stopped | tests/processManager.test.ts + tests/backend.test.ts: stop returns exited, isRunning false |
| Changing host and port values changes the flags passed on next launch | tests/flagBuilder.test.ts: --host/--port emitted with configured values; tests/ui/ServerTab.test.tsx: config.save receives new values |
| The log panel updates in real time as the server writes to stdout/stderr and health polling progresses | tests/processManager.test.ts streams stdout/stderr; Rust readiness watcher emits periodic health-probe logs; tests/ui/ServerTab.test.tsx asserts streamed lines render and the persistent `server.log` path is visible |

## Constitution Evidence

| Constitutional Promise/Law | Evidence |
|---|---|
| Server launch proven by asserting the child process is running and the configured port responds | tests/processManager.test.ts + tests/backend.test.ts assert a real PID and an HTTP 200 on the port |
| Every visible control is wired to real behavior | Start/Stop/host/port each map to real commands or flag emission |
| Errors are shown as clear in-app messages | crash and port-in-use map to error events/messages with exit code and stderr |

## Scenario Review

- Scenario pass rate: 4/4 (100%) — start-server-with-model (launch + HTTP 200), stop-running-server (terminated + Stop disabled), server-control-restart-persistence (settings restored across reopen via config round-trip), server-control-wiring-audit (every control reaches real code).
- Failed scenarios: none

## Known Gaps

none
