# Feature Implementation Plan: model-management

## Feature

- ID: model-management
- Spec: specs/feature-model-management.md
- Product constitution slice: "Start server with a loaded model" workflow (model selection); acceptance law that every visible control is wired to real behavior; settings persistence law.
- Acceptance contract slice: docs/acceptance_contract.json feature `model-management`.

## Implementation Strategy

- `src/ipc/backend.ts` — `model.list` reads a directory and returns the `.gguf` files (sorted), a message for empty folders, or a `CommandError` for missing/inaccessible directories.
- `src/state/appController.ts` — `setModelDirectory`, `selectModel` (joins directory + name into the `--model` path), and `unloadModel` persist through `updateConfig`.
- `src/process/flagBuilder.ts` — `buildServerArgs` emits `--model <path>` when a model is selected.
- `src/ui/tabs/ModelsTab.tsx` — directory `FilePicker`, model list, Load/Unload buttons, and a "Loaded" indicator.

## Constitution Coverage

- Honors the user workflow "Start server with a loaded model" — the selected model path is passed to the server as `--model`.
- Honors the persistence law — the last directory and selected model are saved and restored across reopen.
- Honors the error-handling law — nonexistent directories surface a clear message, not a silent failure.
- Honors the handwave ban — the Load control changes a real llama.cpp argument, it is not decorative.

## Public Tests To Add

- `tests/backend.test.ts`: lists `.gguf` files (and ignores non-model files); empty directory message; nonexistent directory error.
- `tests/flagBuilder.test.ts`: `--model` emitted with the selected path, including paths with spaces.
- `tests/controller.test.ts`: `setModelDirectory` lists models; `selectModel` sets the path; `unloadModel` clears it; selection persists across reload.
- `tests/ui/ModelsTab.test.tsx`: list renders; empty message; error message; Load sets the active model and shows the indicator; Unload clears it.

## Wiring Plan

| Entry Point | Target Implementation | Test Evidence Planned |
|---|---|---|
| Models tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/ModelsTab.tsx | tests/ui/App.test.tsx |
| Browse directory button | ModelsTab FilePicker -> AppController.setModelDirectory -> backend `model.list` | tests/backend.test.ts, tests/ui/ModelsTab.test.tsx |
| Model file list | ModelsTab list from AppController.models | tests/ui/ModelsTab.test.tsx |
| Load Model button | ModelsTab -> AppController.selectModel -> config.model.selectedModel -> flagBuilder `--model` | tests/flagBuilder.test.ts, tests/ui/ModelsTab.test.tsx |
| Unload Model button | ModelsTab -> AppController.unloadModel -> clears selectedModel | tests/controller.test.ts, tests/ui/ModelsTab.test.tsx |
| Currently loaded model indicator | ModelsTab indicator from config.model.selectedModel | tests/ui/ModelsTab.test.tsx |

## Risks

- Directory with spaces or special characters — mitigated by passing args as an array.
- Model deleted after selection — mitigated by the server-start existence pre-check that surfaces "not found".

## Rollback Plan

- Model selection is stored in `config.model`; the tab can be removed with no schema change, and the server simply launches without `--model`.

## Definition Of Done

- `bash verify.sh` exits 0; every acceptance criterion has a passing test; evidence lists real commands and wiring; no known gaps.
