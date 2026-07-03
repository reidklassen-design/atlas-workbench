# Feature Evidence: error-handling

## Feature

- ID: error-handling
- Spec: specs/feature-error-handling.md
- Status: done
- Constitution coverage: Honors the product constitution promise that errors are always shown as clear in-app messages in plain language and never silently swallowed.

## Verification Commands Run

- `npm test`: exit 0 — vitest ran 110 tests across 17 files.
- `npm run typecheck`: exit 0 — TypeScript clean.
- `npm run build`: exit 0 — production Vite build completed.
- `cd src-tauri && cargo check --target-dir /tmp/atlas-workbench-target`: exit 0 — Rust/Tauri backend clean.
- `bash verify.sh`: exit 0 — Dark Factory verification passed after the model-load crash feedback update.
- `npx vitest run tests/errorMapper.test.ts tests/backend.test.ts tests/controller.test.ts tests/processManager.test.ts tests/ui/ErrorBanner.test.tsx tests/transport.test.ts tests/tauriCapabilities.test.ts`: error mapping, crash events, missing files, child-process stream/tail capture, logging, retry, dismiss, event ACL surfacing, and Tauri event capability tests passing.

## Wiring Audit

| Entry Point | Implementation Path | Test/Scenario Evidence |
|---|---|---|
| Error message dialog or banner | src/ui/components/ErrorBanner.tsx renders controller.errors | tests/ui/ErrorBanner.test.tsx |
| Retry button in the error message | ErrorBanner -> AppError.retry set by AppController failure handlers | tests/ui/ErrorBanner.test.tsx, tests/controller.test.ts |
| Dismiss button in the error message | ErrorBanner -> AppController.dismissError | tests/ui/ErrorBanner.test.tsx |
| Server crash during model loading | Tauri readiness watcher observes the child process while health polling; if the process exits, it emits an AppError with stderr tail | cargo check covers Rust wiring; tests/processManager.test.ts covers tail capture before exited status |
| Tauri event bridge failure | createTauriTransport catches `listen` ACL failures and delivers a visible AppError through the error listener; `src-tauri/capabilities/default.json` grants `core:event:default` | tests/transport.test.ts, tests/tauriCapabilities.test.ts |

## Acceptance Criteria Evidence

| Criterion | Evidence |
|---|---|
| When the server binary crashes, an error message appears with the exit code and relevant stderr output | tests/backend.test.ts external crash emits exit code 137; tests/processManager.test.ts captures stderr before exited status; tests/errorMapper.test.ts maps stderr tail |
| When a model file does not exist, an error message appears explaining the file was not found | tests/backend.test.ts missing model and tests/controller.test.ts missing model push error |
| Clicking Start with no selected model produces immediate in-app feedback | tests/controller.test.ts asserts controller stops, pushes a "No model selected" error, and writes the reason to server logs |
| If the event bridge is mispackaged, the UI receives a visible error instead of a hidden unhandled rejection | tests/transport.test.ts simulates `Command plugin:event\|listen not allowed by ACL`; tests/tauriCapabilities.test.ts asserts event permission is packaged |
| When fine-tuning fails, an error message appears explaining the failure reason | tests/backend.test.ts missing dataset; tests/processManager.test.ts failure exit code/stderr; tests/errorMapper.test.ts invalid dataset |
| Every error message includes a plain-language explanation and a suggested fix | tests/errorMapper.test.ts asserts title/message/fix; tests/ui/ErrorBanner.test.tsx renders the fix |
| The user can dismiss the error and retry the operation | tests/ui/ErrorBanner.test.tsx asserts Retry callback fires and Dismiss removes the banner |

## Constitution Evidence

| Constitutional Promise/Law | Evidence |
|---|---|
| Errors always shown in-app, never silently swallowed | AppController pushes AppError objects into ErrorBanner for failures and crash events |
| Errors are plain language with suggested fix | errorMapper returns title, message, fix for each failure class |
| User can fix and retry | Retry re-runs the failed action; Dismiss clears the message |
| Errors are logged for diagnostics | errorLog writes JSON lines and backend test asserts the log contains the error |

## Scenario Review

- Scenario pass rate: 1/1 (100%) — server-crash-error-message: crash emits exit code/stderr, banner renders plain-language message, user can dismiss and retry.
- Failed scenarios: none

## Known Gaps

none
