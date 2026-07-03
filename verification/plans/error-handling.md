# Feature Implementation Plan: error-handling

## Feature

- ID: error-handling
- Spec: specs/feature-error-handling.md
- Product constitution slice: "Errors are always shown as clear in-app messages in plain language, never silently swallowed"; evidence law "Error handling must be proven by triggering a known failure condition and asserting a visible error message appears in the UI".
- Acceptance contract slice: docs/acceptance_contract.json feature `error-handling`.

## Implementation Strategy

- `src/errors/errorMapper.ts` — maps process exits, missing files, invalid datasets, directory errors, and start failures to `AppError` objects with a plain-language `title`, `message`, and `fix`; detects "address already in use".
- `src/errors/errorLog.ts` — appends every error to `~/.config/atlas-workbench/logs/error.log` for diagnostics.
- `src/ipc/backend.ts` — records errors to the log, emits `error` events on crashes (with exit code and stderr tail), and throws `CommandError` (converted to `AppError` at the transport boundary) for synchronous failures.
- `src/state/appController.ts` — attaches a `retry` callback to failures so the user can retry the exact operation; exposes `dismissError`.
- `src/ui/components/ErrorBanner.tsx` — a cross-tab banner with title, message, fix, stderr tail, and Retry/Dismiss buttons.

## Constitution Coverage

- Honors the non-negotiable promise that errors are always shown in-app in plain language and never silently swallowed — every failure path produces an `AppError` and renders in the banner.
- Honors the evidence law by triggering known failure conditions (missing model, missing dataset, external crash) and asserting a visible message.
- Honors the acceptance law — Retry and Dismiss are wired to real behavior (re-run the operation / remove the error).
- Honors the requirement to log errors to an internal log file in addition to showing them.

## Public Tests To Add

- `tests/errorMapper.test.ts`: port-in-use, crash with exit code and stderr, crash with no stderr, missing model, invalid dataset, start error, directory error.
- `tests/backend.test.ts`: missing model file throws a `CommandError`; missing dataset throws; external crash emits an `error` event with exit code 137; `error.log` appends to the on-disk log.
- `tests/ui/ErrorBanner.test.tsx`: title/message/fix/Retry/Dismiss render; Dismiss removes the error; Retry re-runs the failed operation.

## Wiring Plan

| Entry Point | Target Implementation | Test Evidence Planned |
|---|---|---|
| Error message dialog or banner | src/ui/components/ErrorBanner.tsx from controller.errors | tests/ui/ErrorBanner.test.tsx |
| Retry button in the error message | ErrorBanner -> error.retry (set by AppController) | tests/ui/ErrorBanner.test.tsx, tests/controller.test.ts |
| Dismiss button in the error message | ErrorBanner -> AppController.dismissError | tests/ui/ErrorBanner.test.tsx |

## Risks

- An error occurs while another is displayed — the controller stores errors in a list so multiple are shown and dismissable independently.
- Process crashes with no stderr — `errorMapper` provides a no-stderr fix message.

## Rollback Plan

- Error handling is cross-cutting via the `AppError` type and the banner; removing the banner leaves the log file and `CommandError` throws intact.

## Definition Of Done

- `bash verify.sh` exits 0; every acceptance criterion has a passing test; evidence lists real commands and wiring; no known gaps.
