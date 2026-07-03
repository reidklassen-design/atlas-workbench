# Feature Evidence: binary-config

## Feature

- ID: binary-config
- Spec: specs/feature-binary-config.md
- Status: done
- Constitution coverage: Honors the product constitution promise that the app points to the user's existing llama.cpp binary and never downloads or builds it, the acceptance law that every visible control is wired to real behavior, and the evidence law that first-launch detection is proven.

## Verification Commands Run

- `bash verify.sh`: exit 0 — "Static scaffold and wiring-smell checks passed"; npm test ran vitest with 98 tests passing across 15 files.
- `npx vitest run tests/binaryValidation.test.ts tests/config.test.ts`: 14 tests passing.
- `npx tsc --noEmit`: clean (no type errors).

## Wiring Audit

| Entry Point | Implementation Path | Test/Scenario Evidence |
|---|---|---|
| First-launch binary path prompt dialog | src/ui/components/BinarySetupDialog.tsx -> AppController.setBinaryPaths -> backend `binary.set` -> validateBinary + configStore.save | tests/ui/App.test.tsx (dialog appears, save works, no re-prompt) |
| Binary path settings section | src/ui/tabs/SettingsTab.tsx "Binary paths" -> AppController.setBinaryPaths -> backend `binary.set` | tests/ui/SettingsTab.test.tsx (section renders with Save), tests/backend.test.ts (persists across reopen) |

## Acceptance Criteria Evidence

| Criterion | Evidence |
|---|---|
| On first launch with no config, the app prompts for the server binary path | tests/ui/App.test.tsx: dialog renders when binaryPaths.server is empty |
| Selecting a valid executable path is accepted and persisted | tests/binaryValidation.test.ts (valid executable ok) + tests/backend.test.ts (binary.set persists across a new Backend instance) |
| Selecting a nonexistent or non-executable file shows a clear error and re-prompts | tests/binaryValidation.test.ts (nonexistent/non-executable/directory rejected with reason) + tests/backend.test.ts (binary.set throws CommandError) |
| Closing and reopening the app does not re-prompt if valid paths were saved | tests/backend.test.ts (reopen loads persisted path) + tests/ui/App.test.tsx (no dialog when paths saved) |
| The user can change the binary path from the settings section at any time | tests/ui/SettingsTab.test.tsx (binary settings section + Save button) |

## Constitution Evidence

| Constitutional Promise/Law | Evidence |
|---|---|
| The app points to the user's existing binary and never downloads or builds llama.cpp | Only validateBinary + persistence exist; no download/build code path |
| Every visible control is wired to real behavior | Save button validates and persists through the config layer |
| Errors are shown as clear in-app messages, never silently swallowed | Invalid paths return a plain-language reason and surface as a CommandError/banner |

## Scenario Review

- Scenario pass rate: 1/1 (100%) — scenario-first-launch-binary-prompt: prompt appears, valid path saved with no re-prompt, invalid path shows an error and the dialog re-shows.
- Failed scenarios: none

## Known Gaps

none
