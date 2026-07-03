# Review Report: error-handling (product-owner)

## Review

- Feature: error-handling
- Review type: product-owner
- Verdict: APPROVED

Verdict: APPROVED

## Evidence Checked

- Product constitution: docs/product_constitution.md ("Show a clear error message and let you fix it and try again"; "the server process crashes or hangs and the user receives no feedback" is an unacceptable outcome).
- Spec: specs/feature-error-handling.md
- Acceptance contract: docs/acceptance_contract.json feature `error-handling`
- Tests: tests/ui/ErrorBanner.test.tsx, tests/backend.test.ts
- Evidence file: verification/evidence/error-handling.md

## Findings

- Matches the intent "keeps you in control; the app explains what went wrong in plain language so you can adjust and retry" — every error shows a title, message, and a Fix suggestion, with Retry and Dismiss actions.
- Prevents the unacceptable outcome of a crash with no feedback — crashes surface with the exit code and last stderr output.
- The banner appears across all tabs, so errors are never trapped in a single view.
- Errors are also logged to disk for diagnostics, supporting the user without exposing raw stack traces.

## Approval Criteria

APPROVED: the feature delivers the constitution-promised error-and-recovery experience the user asked for.
