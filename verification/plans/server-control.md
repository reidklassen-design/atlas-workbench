# Feature Implementation Plan: server-control

## Feature

- ID: server-control
- Spec: specs/feature-server-control.md
- Product constitution slice: "Start server with a loaded model" workflow; acceptance law that every visible control is wired to real behavior; evidence law "Server launch must be proven by asserting the child process is running and the configured port responds".
- Acceptance contract slice: docs/acceptance_contract.json feature `server-control`.

## Implementation Strategy

- `src/process/flagBuilder.ts` — `buildServerArgs(config)` produces the real argv (`--host`, `--port`, `--model`, plus every configured flag).
- `src/process/processManager.ts` — `startServer` spawns the binary with stdio pipes, streams stdout/stderr line-by-line via `log` events, tracks `running/exited` status and exit codes, and `stop` gracefully terminates via SIGTERM with a SIGKILL fallback.
- `src/ipc/backend.ts` — `server.start` pre-checks the model file exists, persists config, spawns, and emits `log`/`status`/`error` events; `server.stop` and `server.status` round out the command set.
- `src/ui/tabs/ServerTab.tsx` — host/port inputs, Start/Stop buttons with correct disabled states, `StatusIndicator`, and a real-time `LogPanel`.

## Constitution Coverage

- Honors the user workflow "Start server with a loaded model" by launching the real binary and streaming its output.
- Honors the evidence law by proving the child process is running and the configured port responds (HTTP health check in tests).
- Honors the error-handling law by emitting a crash event with exit code and stderr when the server exits non-zero.
- Honors the acceptance law that every visible control maps to real behavior (Start launches, Stop terminates, host/port change the flags).

## Public Tests To Add

- `tests/flagBuilder.test.ts`: `--host`/`--port` always emitted; `--model` emitted when selected; flags at defaults are not emitted; booleans emitted only when true.
- `tests/processManager.test.ts`: start streams logs, HTTP responds on the configured port, stop terminates; crash reports exit code 137 and stderr; port-in-use detected via stderr; empty binary path rejects.
- `tests/backend.test.ts`: end-to-end start/respond/stop through the Backend command layer; missing model file yields a `CommandError`.
- `tests/ui/ServerTab.test.tsx`: host/port bound to config and persisted on change; Start disabled while running, Stop disabled while stopped; logs stream into the panel.

## Wiring Plan

| Entry Point | Target Implementation | Test Evidence Planned |
|---|---|---|
| Server tab in the main tab layout | src/ui/App.tsx tabs -> src/ui/tabs/ServerTab.tsx | tests/ui/App.test.tsx, tests/ui/ServerTab.test.tsx |
| Start Server button | ServerTab -> AppController.startServer -> backend `server.start` -> ProcessManager.startServer | tests/processManager.test.ts, tests/backend.test.ts |
| Stop Server button | ServerTab -> AppController.stopServer -> backend `server.stop` -> ProcessManager.stop | tests/processManager.test.ts, tests/backend.test.ts |
| Host input field | ServerTab -> AppController.updateConfig -> backend `config.save` -> flagBuilder `--host` | tests/flagBuilder.test.ts, tests/ui/ServerTab.test.tsx |
| Port input field | ServerTab -> AppController.updateConfig -> backend `config.save` -> flagBuilder `--port` | tests/flagBuilder.test.ts, tests/ui/ServerTab.test.tsx |
| Log panel | LogPanel subscribes to `log` events from ProcessManager | tests/processManager.test.ts, tests/ui/ServerTab.test.tsx |

## Risks

- Port already in use — mitigated by stderr pattern detection and a clear error message.
- Process killed by signal before spawn resolves — mitigated by the `settled` guard that rejects the start promise and marks the process dead.

## Rollback Plan

- Server launch is isolated behind the `server.start`/`server.stop` commands and `ProcessManager`; the UI tab can be hidden without affecting other layers.

## Definition Of Done

- `bash verify.sh` exits 0; every acceptance criterion has a passing test; evidence lists real commands and wiring; no known gaps.
