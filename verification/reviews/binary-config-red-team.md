# Review Report: binary-config (red-team)

## Review

- Feature: binary-config
- Review type: red-team
- Verdict: APPROVED

Verdict: APPROVED

## Evidence Checked

- Spec: specs/feature-binary-config.md
- Tests: tests/binaryValidation.test.ts, tests/config.test.ts, tests/backend.test.ts, tests/ui/App.test.tsx
- Evidence file: verification/evidence/binary-config.md

## Findings

- Attempted fake-green path: saving an invalid path and asserting success — the test "rejects a nonexistent binary path" proves `binary.set` throws and the path is not persisted.
- Attempted silent failure: pointing at a directory or non-executable file — `validateBinary` returns `ok: false` with a reason, and the UI surfaces it; no silent acceptance.
- Attempted re-prompt regression: after a valid save, a new Backend instance loads the persisted path and `needsBinarySetup` is false (test "persists binary paths across a reopen").
- Attempted corrupted-config crash: writing invalid JSON to the config file still loads defaults instead of throwing (test "corrupted config falls back to defaults").
- No decorative controls found: the Save button triggers validation and persistence; the FilePicker Browse button calls the dialog command.

## Approval Criteria

APPROVED: no fake-green, silent-failure, decorative-control, or regression path survives the adversarial tests.
