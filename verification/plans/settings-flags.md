# Feature Implementation Plan: settings-flags

## Feature

- ID: settings-flags
- Spec: specs/feature-settings-flags.md
- Product constitution slice: "Every llama.cpp server flag is controllable through a GUI widget — no terminal needed for any flag"; modern React/Tailwind UI; handwave ban against widgets that do not map to a real flag.
- Acceptance contract slice: docs/acceptance_contract.json feature `settings-flags`.

## Implementation Strategy

- `src/config/flagCatalog.ts` — the authoritative `SERVER_FLAGS` array (every llama.cpp server flag with id, cli flag, section, type, default, range/options, and plain-language help) plus `defaultServerFlags()`.
- `src/process/flagBuilder.ts` — `buildServerArgs` iterates the catalog and emits each non-default value as a real argument (booleans as presence flags, enums/strings/paths/numbers with values).
- `src/ui/components/FlagWidget.tsx` — renders a slider+number for numeric ranges, a toggle for booleans, a dropdown for enums, a text input for strings, and a `FilePicker` for paths; each widget shows a tooltip (`title`) and a help line sourced from the catalog.
- `src/ui/tabs/SettingsTab.tsx` — groups flags into section headers, renders one `FlagWidget` per flag, and provides per-section and global "Reset to Defaults" buttons plus the binary-path section.

## Constitution Coverage

- Honors the non-negotiable promise that every server flag is controllable through a widget — the catalog is the single source of truth and every entry renders a widget and feeds `buildServerArgs`.
- Honors the handwave ban — every widget maps to a real command-line argument; no decorative controls.
- Honors the modern-UI promise — React + Tailwind components with sliders, toggles, dropdowns, and sectioned layout.
- Honors the persistence law — flag values save on change and restore on reopen.

## Public Tests To Add

- `tests/flagBuilder.test.ts`: `--ctx-size 4096` and `--n-gpu-layers 20` emitted when changed; defaults not emitted; booleans only when true; enum value emitted; every catalog flag builds without throwing.
- `tests/ui/SettingsTab.test.tsx`: a widget exists for every flag (except host/port, owned by the Server tab); every flag has a tooltip matching its help text; section headers render; changing a widget calls `config.save` with the new value; Reset restores defaults; persisted values render from config.

## Wiring Plan

| Entry Point | Target Implementation | Test Evidence Planned |
|---|---|---|
| Settings tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/SettingsTab.tsx | tests/ui/App.test.tsx, tests/ui/SettingsTab.test.tsx |
| Flag widgets | FlagWidget per SERVER_FLAGS entry -> AppController.updateConfig -> flagBuilder | tests/ui/SettingsTab.test.tsx, tests/flagBuilder.test.ts |
| Reset to Defaults button | SettingsTab resetAll/resetSection -> defaultServerFlags -> config.save | tests/ui/SettingsTab.test.tsx |
| Flag section headers | SettingsTab section groups by FlagSection | tests/ui/SettingsTab.test.tsx |

## Risks

- A new llama.cpp flag is not yet in the catalog — by spec non-goal the catalog is app-defined and updated when llama.cpp changes; every catalog flag is still covered.
- Conflicting flags (CPU-only with GPU layers > 0) — the spec marks this an edge case; values are passed verbatim and the binary reports any conflict via stderr, surfaced by error-handling.

## Rollback Plan

- The catalog is a single data module; removing a flag removes its widget and its emission with no schema change (defaults fill in via merge).

## Definition Of Done

- `bash verify.sh` exits 0; every acceptance criterion has a passing test; evidence lists real commands and wiring; no known gaps.
