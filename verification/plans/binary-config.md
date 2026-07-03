# Feature Implementation Plan: binary-config

## Feature

- ID: binary-config
- Spec: specs/feature-binary-config.md
- Product constitution slice: "The app points to the user's existing llama.cpp binary — it does not download or build it"; acceptance law "Every visible control must be wired to real behavior"; evidence law for first-launch detection.
- Acceptance contract slice: docs/acceptance_contract.json feature `binary-config` (entry points, requirements, acceptance criteria).

## Implementation Strategy

- `src/config/binaryValidation.ts` — `validateBinary(path)` checks existence, file type, and the executable bit via `fs.constants.X_OK`; resolves symlinks through `realpath`; returns a plain-language reason on failure.
- `src/config/configStore.ts` — persists `binaryPaths` (server + finetune) to `~/.config/atlas-workbench/config.json` with atomic tmp+rename writes; backward-compatible merge in `src/config/defaults.ts`.
- `src/ipc/backend.ts` — `binary.validate` and `binary.set` commands; `binary.set` validates both paths before accepting and saving, throwing `CommandError` with the validation reason on failure.
- `src/ui/components/BinarySetupDialog.tsx` — first-launch modal shown when `needsBinarySetup` is true; server + finetune `FilePicker`s, "use same binary" option, Save button calling `setBinaryPaths`.
- `src/ui/tabs/SettingsTab.tsx` — a "Binary paths" section with both `FilePicker`s and a Save button so the user can change paths at any time.

## Constitution Coverage

- Honors the handwave ban "Agents must not create a widget that does not wire to a real llama.cpp flag" by ensuring binary path widgets map to the persisted path used to launch the real binary.
- Honors the acceptance law "Every visible control must be wired to real behavior" — Save writes to the config layer and is validated.
- Honors the intent-ledger promise "First launch prompts for the binary path; the app never downloads or builds llama.cpp".
- Honors the error-handling law by surfacing invalid paths as clear in-app messages, never silently.

## Public Tests To Add

- `tests/binaryValidation.test.ts`: valid executable accepted; nonexistent rejected with "not found"; non-executable rejected; directory rejected; empty path rejected; spaces handled; symlink resolved.
- `tests/config.test.ts`: defaults returned when no file; round-trip save/load; persists across reopen; backward-compatible merge adds new fields.
- `tests/backend.test.ts`: `binary.set` persists across a new Backend instance; rejects a nonexistent path with a `CommandError`.
- `tests/ui/App.test.tsx`: first-launch dialog appears when no server binary is configured; saving binary paths works; no re-prompt when valid paths are saved.

## Wiring Plan

| Entry Point | Target Implementation | Test Evidence Planned |
|---|---|---|
| First-launch binary path prompt dialog | src/ui/components/BinarySetupDialog.tsx -> AppController.setBinaryPaths -> backend `binary.set` | tests/ui/App.test.tsx |
| Binary path settings section | src/ui/tabs/SettingsTab.tsx "Binary paths" -> AppController.setBinaryPaths | tests/ui/App.test.tsx, tests/ui/SettingsTab.test.tsx |

## Risks

- Path with spaces or symlinks could break spawning — mitigated by `validateBinary` symlink resolution and passing args as an array (no shell).
- Corrupted config could block launch — mitigated by `configStore.load` falling back to defaults on parse errors.

## Rollback Plan

- All behavior lives behind the `binary.validate` / `binary.set` commands and the `BinarySetupDialog`; removing the dialog reverts to the settings section only, with no change to the config schema.

## Definition Of Done

- `bash verify.sh` exits 0; every acceptance criterion has a passing test; evidence file lists real commands and wiring; no known gaps.
