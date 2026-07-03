# Feature: Model Management Tab

## Goal

A tab where the user browses for GGUF model files, loads a model into the server, and unloads it.

## Context

This feature belongs to the generated Dark Factory plan and must follow
docs/architecture.md, docs/architecture.json, and docs/conventions.md.

Dependencies: server-control, binary-config.

## Requirements

1. MUST provide a file browser or directory picker to select a folder containing GGUF model files
2. MUST list all .gguf files found in the selected directory
3. MUST allow the user to select a model file to load
4. MUST pass the selected model path to the server as the --model flag
5. MUST show which model is currently loaded
6. MUST provide an Unload button that clears the current model selection
7. MUST persist the last-used model directory and selected model between sessions

## Entry Points

- Models tab in the main tab layout
- Browse directory button
- Model file list
- Load Model button
- Unload Model button
- Currently loaded model indicator

## Acceptance Criteria

1. Browsing to a directory lists all .gguf files in that directory
2. Selecting a model and clicking Load sets it as the active model for the server
3. The loaded model name is visible in the UI
4. Clicking Unload clears the model selection
5. Closing and reopening the app restores the last model directory and selection

## Required Verification

- Scenario test: browse to a directory with GGUF files, assert files are listed, select one, click Load, start server, assert server log shows the correct model path
- Scenario test: point to a nonexistent directory, assert a clear error message appears

## Functional Wiring Contract

Every visible control, command, route, menu item, form field, API endpoint,
scheduled job, or shortcut added for this feature MUST be wired to real
implementation behavior. It MUST have executable verification evidence.
Do not mark this feature done if any introduced entry point is decorative,
stubbed, disconnected, silently ignored, or only logs a fake success message.

## Constraints

- MUST handle empty directories with a 'No models found' message
- MUST handle nonexistent directories with a clear error message

## Edge Cases

- Directory contains no .gguf files
- Selected model file is deleted after selection but before server start
- Model file path contains spaces or special characters

## Non-Goals

- Does not download or build models — only loads existing GGUF files
- Does not validate model compatibility with the llama.cpp version
