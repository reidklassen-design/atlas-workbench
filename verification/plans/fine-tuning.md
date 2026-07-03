# Feature Implementation Plan: fine-tuning

## Feature

- ID: fine-tuning
- Spec: specs/feature-fine-tuning.md
- Product constitution slice: "Fine-tuning must complete end-to-end and produce a trained model file at the specified output path"; evidence law "Fine-tuning must be proven by asserting the output model file exists after training completes".
- Acceptance contract slice: docs/acceptance_contract.json feature `fine-tuning`.

## Implementation Strategy

- `src/config/flagCatalog.ts` — `FINETUNE_PARAMS` with dataset, output, learning rate, epochs, batch size, and advanced parameters, each mapping to a real finetune-binary argument.
- `src/process/flagBuilder.ts` — `buildFinetuneArgs` emits the real argv.
- `src/process/processManager.ts` — `startFinetune`/`stop` spawn and manage the finetune binary with streaming logs and exit handling.
- `src/ipc/backend.ts` — `training.start` validates the dataset exists, persists config, spawns, and on exit code 0 verifies the output model file exists and emits `training-complete` with `{exists}`; `training.stop` terminates.
- `src/ui/tabs/FineTuningTab.tsx` — dataset/output `FilePicker`s, learning rate/epochs/batch size inputs, advanced parameters, Start/Stop buttons, status, and a training log panel.

## Constitution Coverage

- Honors the non-negotiable promise that fine-tuning runs end-to-end and produces a trained model file at the output path — the backend verifies the file exists before signaling success.
- Honors the evidence law by asserting the output file exists after completion in tests.
- Honors the error-handling law — missing dataset, failure, or missing output file all surface clear in-app messages.
- Honors the persistence law — fine-tuning settings save and restore across reopen.

## Public Tests To Add

- `tests/flagBuilder.test.ts`: dataset, output, learning rate, epochs, batch size emitted as real arguments.
- `tests/processManager.test.ts`: training runs to completion and writes the output file; stop terminates; failure reports exit code and stderr.
- `tests/backend.test.ts`: completion verifies the output file and emits `training-complete` with `exists: true`; missing dataset yields a `CommandError`; stop terminates.
- `tests/controller.test.ts`: a success notice appears when training completes and the output file exists.
- `tests/ui/FineTuningTab.test.tsx`: all entry-point controls render; Start/Stop disabled states follow the training status.

## Wiring Plan

| Entry Point | Target Implementation | Test Evidence Planned |
|---|---|---|
| Fine-tuning tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/FineTuningTab.tsx | tests/ui/FineTuningTab.test.tsx |
| Dataset path file picker | FineTuningTab FilePicker -> config.finetune["train-data"] | tests/ui/FineTuningTab.test.tsx, tests/flagBuilder.test.ts |
| Output path file picker | FineTuningTab FilePicker -> config.finetune["lora-out"] -> output existence check | tests/backend.test.ts |
| Learning rate / Epochs / Batch size inputs | FlagWidget -> config.finetune -> buildFinetuneArgs | tests/flagBuilder.test.ts, tests/ui/FineTuningTab.test.tsx |
| Start Training button | FineTuningTab -> AppController.startTraining -> backend `training.start` | tests/processManager.test.ts, tests/backend.test.ts |
| Stop Training button | FineTuningTab -> AppController.stopTraining -> backend `training.stop` | tests/processManager.test.ts, tests/backend.test.ts |
| Training log panel | LogPanel subscribes to `log` events for the finetune process | tests/processManager.test.ts |

## Risks

- Output path not writable — the completion check reports `exists: false` and the controller shows a clear "produced no output model" message.
- Training stopped mid-write — `stop` terminates the process; the completion handler only runs on a natural exit code 0.

## Rollback Plan

- Fine-tuning is isolated behind `training.start`/`training.stop` and the tab; removing the tab leaves the config schema intact.

## Definition Of Done

- `bash verify.sh` exits 0; every acceptance criterion has a passing test; evidence lists real commands and wiring; no known gaps.
