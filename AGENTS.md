# Agents

HANDOFF.md is the entry point and operating manual for `atlas-workbench`.
If you are an AI coding agent reading this repository, open HANDOFF.md and begin the Autonomous Build Loop. Do not ask whether to start, and do not pause after a feature waiting for "continue" or "proceed".

## Project Overview

A modern Linux desktop control panel that wraps the user's existing llama.cpp binary, exposing every server flag, model operation, and fine-tuning parameter through clean widgets instead of command-line memorization.

## Hard Rule

MUST NOT read, reference, or access the scenarios/ directory while
implementing or quality reviewing.

## Build And Test

- Initialize from the project folder: `bash init.sh` (or `./init.sh`)
- Verify: `bash verify.sh`

## Workflow

Work one feature at a time in feature_list.json dependency order. Follow
docs/architecture.json boundaries and docs/conventions.md.
After completing one feature, immediately pick the next pending feature
whose dependencies are done. Continue until every feature is done and
`bash verify.sh` exits 0.

docs/acceptance_contract.json is the source of truth for promised
behavior. Implement every acceptance criterion, keep
verification/traceability.md current, and write
verification/evidence/<feature-id>.md before marking a feature done.

docs/product_constitution.md is the highest-priority product law. If
any downstream file conflicts with it, stop and repair the downstream
file instead of watering down the user's intent.

docs/mission_control.md and docs/intent_ledger.md explain what the user
actually cares about. Preserve those promises even when making technical
tradeoffs.

Never mark a feature done until every user-visible control, command,
route, form, API endpoint, and background job introduced by that feature
reaches real behavior and has executable test/scenario evidence.

Stop only for Definition of Done, a genuine blocker after documented
retries, missing credentials/files, or a command requiring human
approval. Do not stop at normal checkpoints or feature boundaries.
