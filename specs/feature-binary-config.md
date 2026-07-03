# Feature: Binary Configuration & First Launch

## Goal

On first launch, the app detects whether the llama.cpp binary path is configured. If not, it prompts the user to locate the server and finetune binaries, validates they are executable, and persists the paths.

## Context

This feature belongs to the generated Dark Factory plan and must follow
docs/architecture.md, docs/architecture.json, and docs/conventions.md.

Dependencies: none.

## Requirements

1. MUST check on launch whether the llama.cpp server binary path is configured and exists
2. MUST prompt the user with a file picker to locate the server binary if it is not configured
3. MUST also prompt for the finetune binary path (may be the same binary or a separate one)
4. MUST validate that the selected files exist and are executable before accepting them
5. MUST persist the binary paths in a config file between sessions
6. MUST show a clear error message if the binary is not executable or does not exist
7. MUST allow the user to change the binary path later from a Settings section

## Entry Points

- First-launch binary path prompt dialog
- Binary path settings section (accessible from Settings tab or a menu)

## Acceptance Criteria

1. On first launch with no config, the app prompts for the server binary path
2. Selecting a valid executable path is accepted and persisted
3. Selecting a nonexistent or non-executable file shows a clear error and re-prompts
4. Closing and reopening the app does not re-prompt if valid paths were previously saved
5. The user can change the binary path from the settings section at any time

## Required Verification

- Scenario test: delete config file, launch app, assert binary path prompt appears, provide valid path, assert prompt does not reappear on next launch
- Scenario test: provide a nonexistent file path, assert error message appears and prompt re-shows
- Scenario test: provide a non-executable file, assert error message appears

## Functional Wiring Contract

Every visible control, command, route, menu item, form field, API endpoint,
scheduled job, or shortcut added for this feature MUST be wired to real
implementation behavior. It MUST have executable verification evidence.
Do not mark this feature done if any introduced entry point is decorative,
stubbed, disconnected, silently ignored, or only logs a fake success message.

## Constraints

- MUST not assume a default binary location — the user must explicitly configure it
- MUST store config in a standard Linux config directory (e.g., ~/.config/atlas-workbench)

## Edge Cases

- User selects a file that is not the llama.cpp binary but is executable
- Binary path contains spaces
- Binary is a symlink to another location

## Non-Goals

- Does not download or build llama.cpp — only points to an existing binary
- Does not verify the binary is the correct version of llama.cpp
