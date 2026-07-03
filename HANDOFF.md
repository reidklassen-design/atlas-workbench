# Handoff

This is the operating manual for `atlas-workbench`.

## Agent Autostart Directive

If you are an AI coding agent reading this file, the user has already delegated the build to you. Begin now.

Do not ask "what would you like me to do?" Do not ask whether to start the automated loop. Do not wait for the human to type "begin", "continue", or "proceed".

Keep working through the Autonomous Build Loop until every feature in feature_list.json has status `done` and `bash verify.sh` exits 0. After finishing one feature, immediately pick the next pending feature whose dependencies are satisfied.

Stop only when the Definition of Done is met, a feature is genuinely blocked after the documented retry limit, required credentials/files are missing, or the environment requires human approval for a command you cannot run. Normal checkpoints, completed reviews, completed features, and passing partial tests are not stop conditions.

## Project Overview

A modern Linux desktop control panel that wraps the user's existing llama.cpp binary, exposing every server flag, model operation, and fine-tuning parameter through clean widgets instead of command-line memorization.

## Quick Start (Human)

1. Open this folder in your editor.
2. Open a terminal in this folder and run `bash init.sh` (or `./init.sh`).
3. Point your coding agent at this file and paste the kickoff prompt below.

## Kickoff Prompt

```text
You are the Dark Factory orchestrator for this project. Read AGENTS.md and HANDOFF.md in full, then execute the Autonomous Build Loop until every feature in feature_list.json has status "done" and verify.sh exits 0. Work autonomously; do not ask for begin/proceed confirmation. After each feature, immediately continue to the next pending feature until the Definition of Done is met or a true blocker is reached. Do not claim success until every visible button, command, route, form, API endpoint, and user workflow is wired to real behavior and covered by executable evidence.
```

## How This Works

The project is built one feature at a time from specs. Implementation and
quality review do not inspect holdout scenarios. Functional review may use
scenarios to score behavior.

## Execution Modes

Delegated mode is preferred when the agent can spawn subagents. Use separate
implementer, quality reviewer, and functional reviewer contexts.

Single-agent mode is allowed when delegation is unavailable. The agent must
still switch roles and preserve train/test separation.

## Autonomous Build Loop

1. Read AGENTS.md, docs/operating_model.md, docs/product_constitution.md, docs/architecture.md, docs/conventions.md, docs/specs.md, and docs/verification.md.
2. Read docs/mission_control.md, docs/intent_ledger.md, docs/acceptance.md, docs/acceptance_contract.json, verification/test_strategy.md, and verification/traceability.md.
3. Pick the next pending feature whose dependencies are done.
4. Set it in_progress in feature_list.json.
5. Copy verification/plans/TEMPLATE.md to verification/plans/<feature-id>.md and fill a concrete implementation plan before coding.
6. Implement from its spec and acceptance contract only.
7. Run `bash verify.sh` and fix failures.
8. Run contract-audit, quality, red-team, and product-owner reviews. Store them under verification/reviews/.
9. Run a wiring audit: list every visible entry point added or touched by the feature, trace it to implementation code, and confirm a test/scenario proves it works.
10. Copy verification/evidence/TEMPLATE.md to verification/evidence/<feature-id>.md and fill it with real commands, tests, scenarios, wiring paths, and known gaps.
11. Run functional review with scenarios and require at least 90% pass.
12. Mark the feature done only when verification, all reviews, evidence file, and wiring audit all pass.
13. After marking a feature done, immediately return to step 3. Do not stop to ask whether to continue.
14. When every feature is done, complete verification/final_gauntlet.md and run `bash verify.sh` again.

## Stop Conditions

Stop only when the Definition of Done is met, a feature is genuinely blocked after the documented retry limit, required credentials/files are missing, or a command needs human approval that the environment cannot grant. Feature boundaries, checkpoints, successful reviews, and partial green test runs are progress signals, not reasons to stop.

## Definition of Done

Every feature is done, `bash verify.sh` exits 0, scenario scoring meets the
threshold in docs/verification.md, and the final report includes wiring
evidence for each user-visible entry point. `bash verify.sh` must still pass
after feature_list.json statuses are marked done.
