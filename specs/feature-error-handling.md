# Feature: Error Handling & Recovery

## Goal

A cross-cutting feature ensuring that every process failure, missing file, invalid configuration, or crash surfaces as a clear in-app error message in plain language, allowing the user to fix the issue and retry.

## Context

This feature belongs to the generated Dark Factory plan and must follow
docs/architecture.md, docs/architecture.json, and docs/conventions.md.

Dependencies: server-control, model-management, fine-tuning, binary-config.

## Requirements

1. MUST show a visible in-app error message (not a terminal or console log) for every failure condition
2. MUST write error messages in plain language that explains what went wrong and suggests a fix
3. MUST not silently swallow errors or hide them in logs only
4. MUST allow the user to dismiss the error and retry the operation
5. MUST log errors to an internal log file for diagnostics in addition to showing them in the UI
6. MUST handle child process crashes by showing an error message with the process exit code and last stderr output

## Entry Points

- Error message dialog or banner (appears in any tab when an error occurs)
- Retry button in the error message
- Dismiss button in the error message

## Acceptance Criteria

1. When the server binary crashes, an error message appears with the exit code and relevant stderr output
2. When a model file does not exist, an error message appears explaining the file was not found
3. When fine-tuning fails, an error message appears explaining the failure reason
4. Every error message includes a plain-language explanation and a suggested fix
5. The user can dismiss the error and retry the operation

## Required Verification

- Scenario test: point to a nonexistent model file, click Start, assert error message appears with 'file not found' explanation
- Scenario test: kill the server process externally, assert the app shows an error message with the exit code
- Scenario test: start fine-tuning with an invalid dataset, assert error message appears with explanation

## Functional Wiring Contract

Every visible control, command, route, menu item, form field, API endpoint,
scheduled job, or shortcut added for this feature MUST be wired to real
implementation behavior. It MUST have executable verification evidence.
Do not mark this feature done if any introduced entry point is decorative,
stubbed, disconnected, silently ignored, or only logs a fake success message.

## Constraints

- MUST not auto-retry or auto-recover — the user stays in control and must explicitly retry
- MUST not show raw stack traces or internal error codes without a plain-language explanation

## Edge Cases

- Multiple errors occur simultaneously
- Error occurs while another error message is already displayed
- Process crashes with no stderr output

## Non-Goals

- Does not automatically restart crashed processes
- Does not send error reports or telemetry
