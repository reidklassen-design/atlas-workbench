# Final Gauntlet

Run after every feature is marked done. The product is complete only when every line below is true.

## Release Checks

- [x] `bash verify.sh` passes after all feature statuses are `done`.
- [x] docs/product_constitution.md still describes the product that was built.
- [x] docs/mission_control.md still matches the product that was built.
- [x] Every constitutional promise/law has evidence or an approved rationale in feature evidence.
- [x] Every docs/intent_ledger.md promise maps to implementation and evidence.
- [x] Every docs/acceptance_contract.json feature has evidence and review reports.
- [x] No verification/evidence/*.md file lists known gaps beyond `none`.
- [x] No verification/traceability.md row for a done feature contains unfinished text or pending status.
- [x] Manual launch/run instructions were followed through executable verification: `npm test` (110 tests across 17 files), `npm run typecheck`, `npm run build`, and `cargo check --target-dir /tmp/atlas-workbench-target`.
- [x] The product has no known dead buttons, fake success paths, or disconnected workflows.

## Feature Checklist

- [x] server-control evidence, traceability, reviews, and acceptance criteria are complete.
- [x] model-management evidence, traceability, reviews, and acceptance criteria are complete.
- [x] settings-flags evidence, traceability, reviews, and acceptance criteria are complete.
- [x] fine-tuning evidence, traceability, reviews, and acceptance criteria are complete.
- [x] system-monitor evidence, traceability, reviews, and acceptance criteria are complete.
- [x] binary-config evidence, traceability, reviews, and acceptance criteria are complete.
- [x] error-handling evidence, traceability, reviews, and acceptance criteria are complete.
