# Feature: System Monitor Tab

## Goal

A tab showing real-time CPU, RAM, and GPU usage metrics so the user can see exactly what is happening with their system while the server or training runs.

## Context

This feature belongs to the generated Dark Factory plan and must follow
docs/architecture.md, docs/architecture.json, and docs/conventions.md.

Dependencies: none.

## Requirements

1. MUST display real-time CPU usage (overall percentage and per-core if available)
2. MUST display real-time RAM usage (used/total)
3. MUST display real-time GPU usage if a GPU is detected
4. MUST update metrics at least once per second without freezing the UI
5. MUST show a clear 'GPU not detected' message if no GPU is available
6. MUST show the llama.cpp child process resource usage separately if the server or training is running

## Entry Points

- System Monitor tab in the main tab layout
- CPU usage display
- RAM usage display
- GPU usage display
- Process resource usage display

## Acceptance Criteria

1. CPU and RAM metrics update at least once per second
2. GPU metrics display when a GPU is present, or a 'GPU not detected' message when not
3. When the server is running, the llama.cpp process resource usage is visible
4. The UI does not freeze or stutter while metrics update

## Required Verification

- Scenario test: open System Monitor tab, assert CPU and RAM values update within 2 seconds, assert no UI freeze
- Scenario test: start server, open System Monitor, assert llama.cpp process appears in the process resource display
- Scenario test: run on a machine without a GPU, assert 'GPU not detected' message is shown

## Functional Wiring Contract

Every visible control, command, route, menu item, form field, API endpoint,
scheduled job, or shortcut added for this feature MUST be wired to real
implementation behavior. It MUST have executable verification evidence.
Do not mark this feature done if any introduced entry point is decorative,
stubbed, disconnected, silently ignored, or only logs a fake success message.

## Constraints

- MUST use the sysinfo Rust crate or equivalent for cross-distro Linux compatibility
- MUST not spawn external processes to gather metrics

## Edge Cases

- No GPU present on the system
- Multiple GPUs present
- System under extreme load causing metric collection to lag

## Non-Goals

- Does not provide historical graphs or long-term logging in the first version — real-time display only
- Does not monitor remote systems — local machine only
