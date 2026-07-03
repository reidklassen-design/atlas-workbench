# Feature: Settings & Flags Tab

## Goal

A tab exposing every llama.cpp server flag as a modern widget — dropdowns, sliders, toggles, and text inputs — organized in a clean layout.

## Context

This feature belongs to the generated Dark Factory plan and must follow
docs/architecture.md, docs/architecture.json, and docs/conventions.md.

Dependencies: server-control.

## Requirements

1. MUST expose every llama.cpp server flag as an appropriate widget (dropdown for enum-like flags, slider for numeric ranges, toggle for booleans, text input for strings)
2. MUST group flags into logical sections (e.g., Performance, Context, Sampling, GPU/Acceleration)
3. MUST show the current value of each flag in its widget
4. MUST pass all configured flag values to the server binary on launch
5. MUST persist all flag values between sessions
6. MUST provide a Reset to Defaults button for each section or globally
7. MUST show a tooltip or help text for each flag explaining what it does in plain language

## Entry Points

- Settings tab in the main tab layout
- Flag widgets (dropdowns, sliders, toggles, text inputs)
- Reset to Defaults button
- Flag section headers

## Acceptance Criteria

1. Every llama.cpp server flag has a corresponding widget
2. Changing a widget value updates the flag passed to the server on next launch
3. Flag values persist after closing and reopening the app
4. Reset to Defaults restores all flags to their default values
5. Each flag has a tooltip with a plain-language description

## Required Verification

- Scenario test: change context size to 4096, start server, assert server log shows --ctx-size 4096
- Scenario test: enable GPU offload with a slider value of 20, start server, assert server log shows --n-gpu-layers 20
- Scenario test: change settings, close app, reopen app, assert all previously set values are restored

## Functional Wiring Contract

Every visible control, command, route, menu item, form field, API endpoint,
scheduled job, or shortcut added for this feature MUST be wired to real
implementation behavior. It MUST have executable verification evidence.
Do not mark this feature done if any introduced entry point is decorative,
stubbed, disconnected, silently ignored, or only logs a fake success message.

## Constraints

- MUST not require the user to know flag names — widgets must use human-readable labels
- MUST validate numeric inputs are within acceptable ranges before passing to the server

## Edge Cases

- User enters an invalid numeric value for a flag
- User sets conflicting flags (e.g., CPU-only mode with GPU layers > 0)
- llama.cpp adds a new flag not yet in the GUI

## Non-Goals

- Does not dynamically discover flags from the binary — the flag set is defined in the app and must be updated when llama.cpp changes
- Does not apply settings to a running server — the server must be restarted to apply changed flags
