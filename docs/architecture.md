# Atlas Workbench Architecture

## Overview

A modern Linux desktop control panel that wraps the user's existing llama.cpp binary, exposing every server flag, model operation, and fine-tuning parameter through clean widgets instead of command-line memorization.

## Layers

### ui
React/TypeScript frontend with Tailwind CSS — renders tabs, widgets, log panels, error messages, and system monitor displays
May depend on: state.

### state
Frontend state management — holds current settings, server status, model selection, training status, and error state; communicates with backend via Tauri IPC
May depend on: ipc.

### ipc
Tauri command layer — Rust functions exposed to the frontend for launching/stopping processes, reading config, and fetching system metrics
May depend on: process, config, monitor.

### process
Rust process management — spawns llama.cpp server and finetune binaries as child processes, captures stdout/stderr, monitors exit codes, and reports status
May depend on: config.

### config
Rust config persistence — reads and writes binary paths, model directory, all flag values, and fine-tuning settings to a config file in ~/.config/atlas-workbench
May depend on: none.

### monitor
Rust system monitoring — uses sysinfo crate to collect CPU, RAM, GPU, and process metrics; polled by the IPC layer
May depend on: none.

## Data Flow

- User interacts with UI widget → state updates → IPC command sent to Rust backend → process layer spawns/restarts child process with flags from config layer
- Child process stdout/stderr → process layer captures → IPC sends to frontend → state updates → log panel renders output
- System monitor tab → frontend sends IPC request → monitor layer collects metrics via sysinfo → IPC returns metrics → UI renders
- Config changes → IPC command → config layer writes to file → on next launch, config layer reads file → state initialized from persisted values
- Process crash or error → process layer reports error → IPC sends error to frontend → error message displayed in UI → user fixes and retries

## Design Patterns

- Child process wrapper pattern — all llama.cpp interaction is via spawning binaries with flags, not linking or embedding
- Command pattern for IPC — each user action maps to a discrete Tauri command with typed inputs and outputs
- Observer pattern for process output — the process layer streams stdout/stderr to the frontend via Tauri events
- Repository pattern for config — all persistence goes through the config layer, never direct file I/O from the frontend

## Directory Structure

```text
atlas-workbench/
├── docs/
├── specs/
├── scenarios/
├── prompts/
├── tests/
├── AGENTS.md
├── HANDOFF.md
├── init.sh
└── verify.sh
```
