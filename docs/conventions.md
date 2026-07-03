# Coding Conventions

## Stack

Language/runtime: Rust (backend) + TypeScript (frontend)

## Commands

- Init/check: `cargo install && npm install`
- Lint: `cargo clippy && npm run lint`
- Type check: `tsc --noEmit`
- Tests: `cargo test && npm run test`

## Rules

- Every Tauri IPC command must have typed inputs and outputs defined in both Rust and TypeScript
- No direct file system access from the frontend — all file operations go through Tauri IPC commands
- All child process spawning must handle errors and report them to the frontend — no unwrap() on process operations
- All config reads/writes must go through the config layer — no scattered file I/O
- UI components must use Tailwind CSS classes — no inline styles or legacy CSS frameworks
- Every feature must have at least one scenario test proving the critical workflow
- Agent must not modify the llama.cpp binary or its source — the app only wraps and launches it
- Agent must confirm with the user before modifying any existing config file structure or breaking previous settings format

## Commits

Use concise imperative commit messages that include the feature id when possible.
