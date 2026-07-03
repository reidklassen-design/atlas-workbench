# Mission Control

This is the product-quality target. The build is not successful unless it
delivers this experience, not merely code that runs.

Product Constitution: docs/product_constitution.md is the highest-priority
intent contract. Mission Control explains the target; the constitution is
the law.

## Project

- Name: Atlas Workbench
- Purpose: A modern Linux desktop control panel that wraps the user's existing llama.cpp binary, exposing every server flag, model operation, and fine-tuning parameter through clean widgets instead of command-line memorization.
- Runs as: Linux desktop, installed via .deb or AppImage, launches as a native window wrapping the user's existing llama.cpp server and finetune binaries as child processes
- Stack: Tauri, Rust, React, TypeScript, Tailwind CSS, sysinfo (Rust crate), serde, tauri-plugin-store, vitest, cargo

## North Star

I sit down, click a model, start the server, tweak every setting through widgets, fine-tune a model, and never once open a terminal or look up a flag — everything just works and looks professional doing it.

## Non-Negotiables

- Every llama.cpp server flag must be exposed as a widget — no flag requires terminal access
- Fine-tuning must actually run end-to-end and produce a trained model, not just launch a process
- The UI must look modern and professional — no dated widget toolkit aesthetics
- Errors must be shown as clear in-app messages in plain language so the user can fix and retry
- Settings must persist between sessions so the user does not reconfigure on every launch

## Quality Bar

- Every visible control must map to real llama.cpp functionality — no placeholder buttons
- Scenario tests prove the critical workflows: server start/stop, model load/unload, settings tweak, fine-tune run, system monitor display
- The app launches the llama.cpp server as a child process and reads stdout/stderr for the log panel
- System monitor shows real-time CPU, RAM, and GPU metrics that update without freezing the UI
- The app is installable as a .deb or AppImage and appears in the app menu

## Failure Modes To Prevent

- A widget exists but does not actually pass its value to the llama.cpp binary — the flag is silently ignored
- Fine-tuning appears to start but fails silently or produces no usable output model
- The UI looks dated or uses a legacy widget toolkit that feels like a Windows XP application
- The server crashes and the user sees no error message, only a frozen or blank panel
- Settings reset on every launch, forcing the user to reconfigure from scratch

## Operating Principle

If a requirement cannot be proven by a test, scenario, or concrete wiring
audit, it is not done. If a feature feels half-built to the user, it is not
done even if `bash verify.sh` passes.
