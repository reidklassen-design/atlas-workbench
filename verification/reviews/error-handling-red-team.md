# Review Report: error-handling (red-team)

## Review

- Feature: error-handling
- Review type: red-team
- Verdict: APPROVED

Verdict: APPROVED

## Evidence Checked

- Spec: specs/feature-error-handling.md
- Tests: tests/errorMapper.test.ts, tests/backend.test.ts, tests/controller.test.ts, tests/ui/ErrorBanner.test.tsx
- Evidence file: verification/evidence/error-handling.md

## Findings

- Silent-swallow attempt: a missing model file — the backend throws `CommandError`, the controller pushes an `AppError`, and the banner renders it; nothing is hidden in logs only (the error log is in addition to the UI).
- Crash attempt: externally killing the server — the backend emits an error event with exit code 137 and the stderr tail; the test asserts the exit code.
- No-stderr crash attempt: `errorMapper` provides a no-stderr fix message (errorMapper test "crash with no stderr").
- Retry attempt: clicking Retry re-invokes the failed operation (UI test asserts the callback fires).
- Dismiss attempt: clicking Dismiss removes the error from the list (UI test).

## Approval Criteria

APPROVED: no silent-swallow, hidden-crash, or dead-retry/dismiss path survives the adversarial tests.
