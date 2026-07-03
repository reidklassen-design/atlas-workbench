# Feature: Server Control Tab

## Goal

A tab where the user starts and stops the llama.cpp server, configures host and port, and sees real-time server stdout/stderr in a log panel.

## Context

This feature belongs to the generated Dark Factory plan and must follow
docs/architecture.md, docs/architecture.json, and docs/conventions.md.

Dependencies: binary-config.

## Requirements

1. MUST provide a Start button that launches the llama.cpp server binary as a child process with the currently configured flags
2. MUST provide a Stop button that gracefully terminates the server child process
3. MUST provide host and port input fields that map to the --host and --port flags
4. MUST display server stdout and stderr in a scrollable log panel in real time
5. MUST show server status (running/stopped) as a visible indicator
6. MUST disable the Start button when the server is already running and disable Stop when it is not

## Entry Points

- Server tab in the main tab layout
- Start Server button
- Stop Server button
- Host input field
- Port input field
- Log panel

## Acceptance Criteria

1. Clicking Start launches the server process and the log panel shows startup output
2. Clicking Stop terminates the server process and the status indicator changes to stopped
3. Changing host and port values changes the flags passed to the server binary on next launch
4. The log panel updates in real time as the server writes to stdout/stderr

## Required Verification

- Scenario test: configure host=127.0.0.1 port=8080, click Start, assert process is running, assert HTTP response on port 8080, click Stop, assert process is terminated
- Scenario test: start server, verify log panel contains expected server startup text within 5 seconds

## Functional Wiring Contract

Every visible control, command, route, menu item, form field, API endpoint,
scheduled job, or shortcut added for this feature MUST be wired to real
implementation behavior. It MUST have executable verification evidence.
Do not mark this feature done if any introduced entry point is decorative,
stubbed, disconnected, silently ignored, or only logs a fake success message.

## Constraints

- MUST not block the UI thread while the server is running
- MUST handle the case where the port is already in use with a clear error message

## Edge Cases

- Port already in use by another process
- Server binary crashes immediately after launch
- User clicks Stop while server is still starting up

## Non-Goals

- Does not manage multiple server instances — one server at a time
- Does not auto-restart the server on crash — the user must click Start again after reading the error
