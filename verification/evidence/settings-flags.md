# Feature Evidence: settings-flags

## Feature

- ID: settings-flags
- Spec: specs/feature-settings-flags.md
- Status: done
- Constitution coverage: Honors the product constitution non-negotiable promise that every llama.cpp server flag is controllable through a GUI widget, the modern-UI promise, the handwave ban against widgets that do not map to a real flag, and the persistence law.

## Verification Commands Run

- `bash verify.sh`: exit 0 — "Static scaffold and wiring-smell checks passed"; npm test ran vitest with 98 tests passing across 15 files.
- `npx vitest run tests/flagBuilder.test.ts tests/ui/SettingsTab.test.tsx`: flag emission and widget/tooltip/reset tests passing.
- `npx tsc --noEmit`: clean.

## Wiring Audit

| Entry Point | Implementation Path | Test/Scenario Evidence |
|---|---|---|
| Settings tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/SettingsTab.tsx | tests/ui/App.test.tsx + tests/ui/SettingsTab.test.tsx |
| Flag widgets (dropdowns, sliders, toggles, text inputs) | FlagWidget per SERVER_FLAGS entry -> updateConfig -> buildServerArgs | tests/ui/SettingsTab.test.tsx (widget per flag) + tests/flagBuilder.test.ts (arg emission) |
| Reset to Defaults button | SettingsTab resetAll/resetSection -> defaultServerFlags -> config.save | tests/ui/SettingsTab.test.tsx (value returns to default) |
| Flag section headers | SettingsTab groups by FlagSection | tests/ui/SettingsTab.test.tsx (section headers render) |

## Acceptance Criteria Evidence

| Criterion | Evidence |
|---|---|
| Every llama.cpp server flag has a corresponding widget | tests/ui/SettingsTab.test.tsx: asserts a flag-<id> element for every SERVER_FLAGS entry except host/port (owned by the Server tab) |
| Changing a widget value updates the flag passed to the server on next launch | tests/flagBuilder.test.ts: --ctx-size 4096 and --n-gpu-layers 20 emitted; tests/ui/SettingsTab.test.tsx: config.save receives the new value |
| Flag values persist after closing and reopening the app | tests/config.test.ts (round-trip) + tests/ui/SettingsTab.test.tsx (persisted value renders) |
| Reset to Defaults restores all flags to their default values | tests/ui/SettingsTab.test.tsx: reset restores the catalog default |
| Each flag has a tooltip with a plain-language description | tests/ui/SettingsTab.test.tsx: tooltip text equals the catalog help for every flag |

## Constitution Evidence

| Constitutional Promise/Law | Evidence |
|---|---|
| Every llama.cpp server flag is controllable through a GUI widget | The flagCatalog is the single source of truth; every entry renders a widget and feeds buildServerArgs |
| Modern React/Tailwind UI, no legacy widget aesthetics | Sliders, toggles, dropdowns, and sectioned layout styled with Tailwind |
| No widget that does not map to a real flag | flagBuilder tests assert the exact argument for each changed flag |
| Settings persist between sessions | values saved on change and restored on reopen |

## Scenario Review

- Scenario pass rate: 1/1 (100%) — change-context-size-flag: widget change to 4096 produces --ctx-size 4096 and persists across reopen.
- Failed scenarios: none

## Known Gaps

none
