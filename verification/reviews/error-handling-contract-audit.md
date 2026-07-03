# Review Report: error-handling (contract-audit)

## Review

- Feature: error-handling
- Review type: contract-audit
- Verdict: APPROVED

Verdict: APPROVED

## Evidence Checked

- Product constitution: docs/product_constitution.md ("Errors are always shown as clear in-app messages in plain language, never silently swallowed"; evidence law for triggering a known failure).
- Spec: specs/feature-error-handling.md
- Acceptance contract: docs/acceptance_contract.json feature `error-handling`
- Traceability: verification/traceability.md error-handling rows
- Tests: tests/errorMapper.test.ts, tests/backend.test.ts, tests/controller.test.ts, tests/ui/ErrorBanner.test.tsx
- Evidence file: verification/evidence/error-handling.md

## Findings

- Server crash shows an error with exit code and stderr (backend test: external crash emits an error event with exit code 137; errorMapper test covers exit code + stderr tail).
- Missing model file shows a "not found" explanation (backend + controller tests).
- Fine-tuning failure shows an explanation (missing dataset throws `CommandError`; failure mode maps exit code and stderr).
- Every error includes a plain-language explanation and a suggested fix (errorMapper always sets `fix`; UI test asserts the fix renders).
- The user can dismiss and retry (UI test: Dismiss removes; Retry re-runs the operation; controller attaches `retry`).
- Errors are also written to the on-disk error log (backend `error.log` test).

## Approval Criteria

APPROVED: every contract entry point and acceptance criterion is wired to real implementation and proven by a passing test, with no constitution conflict.
