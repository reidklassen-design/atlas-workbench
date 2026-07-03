# Review Report: settings-flags (red-team)

## Review

- Feature: settings-flags
- Review type: red-team
- Verdict: APPROVED

Verdict: APPROVED

## Evidence Checked

- Spec: specs/feature-settings-flags.md
- Tests: tests/flagBuilder.test.ts, tests/ui/SettingsTab.test.tsx
- Evidence file: verification/evidence/settings-flags.md

## Findings

- Fake-green attempt: a widget that does not change the flag — the flagBuilder test asserts the exact argument value (`--ctx-size 4096`, `--n-gpu-layers 20`), so a disconnected widget cannot pass.
- Missing-widget attempt: the SettingsTab test iterates every catalog flag and asserts a widget exists, so an uncovered flag fails the test.
- Missing-tooltip attempt: the test asserts the tooltip text equals the catalog help for every flag, so a flag without a plain-language description fails.
- Reset-regression attempt: changing a value then clicking Reset asserts the value returns to the catalog default.
- Default-emission attempt: flags left at default are not emitted (flagBuilder test), preventing noisy argv.

## Approval Criteria

APPROVED: no fake-green, missing-widget, missing-tooltip, or reset-regression path survives the adversarial tests.
