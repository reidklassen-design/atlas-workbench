# Review Report: binary-config (contract-audit)

## Review

- Feature: binary-config
- Review type: contract-audit
- Verdict: APPROVED

Verdict: APPROVED

## Evidence Checked

- Product constitution: docs/product_constitution.md and docs/product_constitution.json (binary-config intent, acceptance laws, evidence laws).
- Spec: specs/feature-binary-config.md
- Acceptance contract: docs/acceptance_contract.json feature `binary-config`
- Traceability: verification/traceability.md binary-config rows
- Tests: tests/binaryValidation.test.ts, tests/config.test.ts, tests/backend.test.ts, tests/ui/App.test.tsx
- Evidence file: verification/evidence/binary-config.md

## Findings

- Every acceptance criterion in the contract maps to executable behavior: first-launch prompt (BinarySetupDialog shown when `needsBinarySetup`), valid path accepted and persisted (`binary.set` + config round-trip test), invalid path rejected with a plain-language reason (`validateBinary` returns a reason; `binary.set` throws `CommandError`), no re-prompt after valid save (config persists across a new Backend instance), and the path is changeable from the Settings section (SettingsTab "Binary paths" Save button).
- The constitution promise "the app never downloads or builds llama.cpp" is preserved — only `validateBinary` and persistence exist; there is no download/build code path.
- The acceptance law "every visible control is wired to real behavior" is satisfied: the dialog and settings Save buttons call `setBinaryPaths`, which validates and writes through the config layer.

## Approval Criteria

APPROVED: every contract entry point and acceptance criterion is wired to real implementation code and covered by a passing test, with no constitution conflict.
