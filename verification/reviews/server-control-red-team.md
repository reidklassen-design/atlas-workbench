# Review Report: server-control (red-team)

## Review

- Feature: server-control
- Review type: red-team
- Verdict: APPROVED

Verdict: APPROVED

## Evidence Checked

- Spec: specs/feature-server-control.md
- Tests: tests/processManager.test.ts, tests/backend.test.ts, tests/ui/ServerTab.test.tsx
- Evidence file: verification/evidence/server-control.md

## Findings

- Fake-green attempt: clicking Start without spawning — the test asserts a real child PID and an HTTP 200 on the configured port, so a non-launching Start cannot pass.
- Crash attempt: `FAKE_SERVER_MODE=crash` makes the binary exit 137 before binding; the test asserts exit code 137 and stderr is captured, and the backend emits an error event.
- Port-in-use attempt: `FAKE_SERVER_MODE=bad-port` makes the bind fail; stderr is matched to "address already in use" and mapped to a clear error.
- Empty binary path attempt: start rejects with "not configured" instead of silently doing nothing.
- Dead-button attempt: Stop on a non-running server returns stopped and disables correctly; Start on a running server is disabled.

## Approval Criteria

APPROVED: no fake-green, silent-crash, dead-button, or missing-error path survives the adversarial tests.
