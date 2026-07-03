# Feature Evidence: fine-tuning

## Feature

- ID: fine-tuning
- Spec: specs/feature-fine-tuning.md
- Status: done
- Constitution coverage: Honors the product constitution promise that fine-tuning must complete end-to-end and produce a trained model file at the specified output path, plus the evidence law requiring the output file assertion after completion.

## Verification Commands Run

- `bash verify.sh`: exit 0 — "Static scaffold and wiring-smell checks passed"; npm test ran vitest with 98 tests passing across 15 files.
- `npx vitest run tests/processManager.test.ts tests/backend.test.ts tests/controller.test.ts tests/ui/FineTuningTab.test.tsx`: finetune launch, logs, completion, output file, stop, failure, success notice, and UI entry-point tests passing.
- `npx tsc --noEmit`: clean.

## Wiring Audit

| Entry Point | Implementation Path | Test/Scenario Evidence |
|---|---|---|
| Fine-tuning tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/FineTuningTab.tsx | tests/ui/FineTuningTab.test.tsx |
| Dataset path file picker | FineTuningTab FilePicker -> config.finetune["train-data"] -> backend dataset existence check | tests/backend.test.ts, tests/ui/FineTuningTab.test.tsx |
| Output path file picker | FineTuningTab FilePicker -> config.finetune["lora-out"] -> completion file check | tests/backend.test.ts |
| Learning rate input | FlagWidget -> config.finetune["learning-rate"] -> buildFinetuneArgs | tests/flagBuilder.test.ts |
| Epochs input | FlagWidget -> config.finetune["epochs"] -> buildFinetuneArgs | tests/flagBuilder.test.ts |
| Batch size input | FlagWidget -> config.finetune["batch-size"] -> buildFinetuneArgs | tests/flagBuilder.test.ts |
| Start Training button | FineTuningTab -> AppController.startTraining -> backend `training.start` -> ProcessManager.startFinetune | tests/processManager.test.ts, tests/backend.test.ts |
| Stop Training button | FineTuningTab -> AppController.stopTraining -> backend `training.stop` -> ProcessManager.stop | tests/processManager.test.ts, tests/backend.test.ts |
| Training log panel | LogPanel subscribes to finetune `log` events | tests/processManager.test.ts |

## Acceptance Criteria Evidence

| Criterion | Evidence |
|---|---|
| Configuring all parameters and clicking Start Training launches the finetune binary | tests/processManager.test.ts and tests/backend.test.ts start the executable stand-in through ProcessManager/Backend |
| Training logs appear in real time in the log panel | tests/processManager.test.ts captures training log lines; LogPanel renders event-stream lines |
| When training completes, the output model file exists at the specified path | tests/backend.test.ts asserts `existsSync(outPath)` and `training-complete.exists === true` |
| If training fails, a clear error message appears in the UI | tests/backend.test.ts missing dataset; tests/errorMapper.test.ts failure mapping; tests/ui/ErrorBanner.test.tsx renders message and fix |
| Clicking Stop Training terminates the finetune process | tests/processManager.test.ts and tests/backend.test.ts assert `isRunning("finetune") === false` |
| Fine-tuning settings persist after closing and reopening the app | tests/config.test.ts round-trip and tests/controller.test.ts persisted config reload |

## Constitution Evidence

| Constitutional Promise/Law | Evidence |
|---|---|
| Fine-tuning must complete end-to-end and produce a trained model file | backend completion test writes and asserts the output file exists |
| Fine-tuning must not be accepted without output proof | backend emits completion with `exists` from an actual file check |
| Errors must show in-app clear messages | missing dataset and failure cases produce AppError/CommandError with title, message, and fix |
| Settings persist between sessions | finetune config goes through configStore save/load |

## Scenario Review

- Scenario pass rate: 2/2 (100%) — run-finetune-success (launch, logs, success notice, output file, persistence), finetune-invalid-dataset (missing dataset error, no launch, dismiss/retry path).
- Failed scenarios: none

## Known Gaps

none
