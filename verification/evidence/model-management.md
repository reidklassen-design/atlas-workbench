# Feature Evidence: model-management

## Feature

- ID: model-management
- Spec: specs/feature-model-management.md
- Status: done
- Constitution coverage: Honors the product constitution "Start server with a loaded model" workflow and the persistence law, the acceptance law that every visible control is wired to real behavior, and the error-handling law for missing directories.

## Verification Commands Run

- `npm test`: exit 0 — vitest ran 107 tests across 15 files.
- `npm run typecheck`: exit 0 — TypeScript clean.
- `npm run build`: exit 0 — production Vite build completed.
- `bash verify.sh`: exit 0 — Dark Factory verification passed after the model-selection feedback update.
- `npx vitest run tests/backend.test.ts tests/flagBuilder.test.ts tests/controller.test.ts tests/ui/ModelsTab.test.tsx`: model listing, --model emission, selection persistence, and UI tests passing.

## Wiring Audit

| Entry Point | Implementation Path | Test/Scenario Evidence |
|---|---|---|
| Models tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/ModelsTab.tsx | tests/ui/App.test.tsx |
| Browse directory button | ModelsTab FilePicker -> AppController.setModelDirectory -> backend `model.list` | tests/backend.test.ts + tests/ui/ModelsTab.test.tsx |
| Model file list | ModelsTab list from AppController.models | tests/ui/ModelsTab.test.tsx (alpha/beta listed, non-model excluded) |
| Load Model button | ModelsTab -> AppController.selectModel -> config.model.selectedModel -> flagBuilder `--model`; button shows saving feedback while the selection is persisted | tests/flagBuilder.test.ts + tests/ui/ModelsTab.test.tsx |
| Unload Model button | ModelsTab -> AppController.unloadModel -> clears selectedModel | tests/controller.test.ts + tests/ui/ModelsTab.test.tsx |
| Currently loaded model indicator | ModelsTab indicator from config.model.selectedModel | tests/ui/ModelsTab.test.tsx (updates after Load, clears after Unload) |

## Acceptance Criteria Evidence

| Criterion | Evidence |
|---|---|
| Browsing to a directory lists all .gguf files in that directory | tests/backend.test.ts: lists alpha.gguf/beta.gguf, ignores non-model files |
| Selecting a model and clicking Load sets it as the active model for the server | tests/flagBuilder.test.ts: --model emitted with the selected path; tests/ui/ModelsTab.test.tsx: Load updates selectedModel |
| The loaded model name is visible in the UI | tests/ui/ModelsTab.test.tsx: loaded indicator shows the model name |
| Clicking Unload clears the model selection | tests/controller.test.ts + tests/ui/ModelsTab.test.tsx: selectedModel cleared, indicator shows "No model loaded" |
| Closing and reopening the app restores the last model directory and selection | tests/config.test.ts (round-trip) + tests/controller.test.ts (selection persists across reload) |

## Constitution Evidence

| Constitutional Promise/Law | Evidence |
|---|---|
| Start server with a loaded model | The selected model path is passed to the server as --model |
| Settings persist between sessions | directory and selectedModel saved and restored across reopen |
| Errors are shown as clear in-app messages | nonexistent directory surfaces a CommandError and a UI error message |

## Scenario Review

- Scenario pass rate: 2/2 (100%) — browse-and-load-model (list, Load, indicator, persistence), nonexistent-model-directory (clear error, no list).
- Failed scenarios: none

## Known Gaps

none
