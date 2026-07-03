# Review Report: settings-flags (contract-audit)

## Review

- Feature: settings-flags
- Review type: contract-audit
- Verdict: APPROVED

Verdict: APPROVED

## Evidence Checked

- Product constitution: docs/product_constitution.md ("every llama.cpp server flag is controllable through a GUI widget", modern UI, handwave bans, acceptance laws).
- Spec: specs/feature-settings-flags.md
- Acceptance contract: docs/acceptance_contract.json feature `settings-flags`
- Traceability: verification/traceability.md settings-flags rows
- Tests: tests/flagBuilder.test.ts, tests/ui/SettingsTab.test.tsx
- Evidence file: verification/evidence/settings-flags.md

## Findings

- Every llama.cpp server flag in the `SERVER_FLAGS` catalog renders a widget (SettingsTab test asserts a `flag-<id>` element for every flag except host/port, which are owned by the Server tab).
- Changing a widget updates the flag passed on next launch (flagBuilder tests: `--ctx-size 4096`, `--n-gpu-layers 20`; SettingsTab test asserts `config.save` receives the new value).
- Flag values persist across reopen (config round-trip + SettingsTab persisted-value render test).
- Reset to Defaults restores defaults (SettingsTab reset test asserts the value returns to the catalog default).
- Each flag has a plain-language tooltip (SettingsTab test asserts the tooltip text equals the catalog help for every flag).
- The constitution handwave ban is honored: every widget maps to a real `buildServerArgs` argument.

## Approval Criteria

APPROVED: every contract entry point and acceptance criterion is wired to real implementation and proven by a passing test, with no constitution conflict.
