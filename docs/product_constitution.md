# Product Constitution

This is the compiled user intent. It is higher priority than implementation convenience.

If any downstream plan, spec, test, review, or code path conflicts with this file, the constitution wins.

## Thesis

Atlas Workbench is a professional Linux desktop control panel that gives you every llama.cpp capability — server, models, settings, fine-tuning, monitoring — through clean modern widgets, with zero command-line memorization.

## Excellent Outcome

I open Atlas Workbench, browse to my GGUF model, click Start, watch the server come alive in the log panel, tweak every flag through dropdowns and sliders, fine-tune a model with form controls, monitor my hardware in real time, and when something breaks I get a clear message telling me exactly what to fix — all without ever touching a terminal.

## Unacceptable Outcomes

- Any llama.cpp flag that is not exposed as a widget, forcing the user back to the terminal
- Fine-tuning runs but produces no usable model or fails without a clear error message
- The UI looks dated, unprofessional, or uses legacy widget aesthetics
- The server process crashes or hangs and the user receives no feedback
- Settings do not persist between sessions

## Non-Negotiable Promises

- Every llama.cpp server flag is controllable through a GUI widget — no terminal needed for any flag
- Fine-tuning must complete end-to-end and produce a trained model file at the specified output path
- Errors are always shown as clear in-app messages in plain language, never silently swallowed
- Settings persist between sessions via a config file
- The app is distributed as a .deb or AppImage and appears in the Linux app menu

## User Workflows

### Start server with a loaded model
- Trigger: User selects a GGUF model file, configures server settings, and clicks Start
- Happy path: The app launches the llama.cpp server binary as a child process with the selected model and all configured flags, the server starts successfully, the log panel shows stdout/stderr output, and the System Monitor tab begins showing real-time metrics
- Proof: Scenario test: select model, set port and host, click Start, assert server process is running, assert log panel shows server startup output, assert server responds on the configured port

### Fine-tune a model
- Trigger: User navigates to the Fine-tuning tab, selects a dataset, sets learning rate and epochs, specifies an output path, and clicks Start Training
- Happy path: The app launches the llama.cpp finetune binary with all specified parameters, training progresses, and a trained model file is produced at the output path
- Proof: Scenario test: configure finetune parameters, start training, assert process runs, assert output model file exists at the specified path after completion

### Recover from an error
- Trigger: User points to a nonexistent model file or the server crashes mid-run
- Happy path: The app shows a clear in-app error message in plain language explaining what went wrong, the user fixes the issue, and retries successfully
- Proof: Scenario test: point to a nonexistent GGUF file, click Start, assert a visible error message appears, fix the path, click Start again, assert server starts

## Risky Assumptions

- Assumption: The user has a working llama.cpp build with both the server and finetune binaries available on their Linux machine
  Risk: If the binary is missing or broken, the app cannot function and must detect and report this clearly
  Validation: On first launch, the app checks that the configured binary path exists and is executable; if not, it prompts the user to locate it with a clear message
- Assumption: The llama.cpp server and finetune binaries accept flags via command-line arguments that can be mapped to widgets
  Risk: If llama.cpp changes its flag interface, widgets may pass invalid arguments
  Validation: Integration test: launch the server with a representative set of flags and verify it starts without error; document the llama.cpp version the app is tested against
- Assumption: GPU metrics are readable on Linux via sysinfo or a similar mechanism
  Risk: If GPU monitoring is not available, the System Monitor tab may show incomplete data
  Validation: Test on a machine with and without a GPU; if GPU metrics are unavailable, show a clear 'GPU not detected' message instead of a blank panel
- Assumption: GGUF model files are stored in a user-specified directory that the app can browse
  Risk: If the directory is invalid or inaccessible, model browsing fails silently
  Validation: Test with a valid directory, an empty directory, and a nonexistent path; each must produce appropriate UI feedback

## Handwave Bans

- Agents must not create a widget that does not wire to a real llama.cpp flag — every dropdown, slider, and input must map to an actual command-line argument passed to the binary
- Agents must not stub the fine-tuning workflow — it must launch the real finetune binary and produce a real output model file
- Agents must not use a legacy or default-looking widget toolkit — the UI must use modern React/Tailwind components with professional styling
- Agents must not silently swallow errors — every process failure, missing file, or invalid configuration must surface as a visible in-app message

## Acceptance Laws

- Every visible control must be wired to real behavior — clicking it must change a llama.cpp argument, launch a process, or update persisted settings
- Fine-tuning is only accepted as done when a trained model file exists at the specified output path after the process completes
- The app is only accepted as installable when it can be packaged as a .deb or AppImage and launched from the Linux app menu
- Settings are only accepted as persistent when closing and reopening the app restores all previously saved configuration values

## Evidence Laws

- Every feature must be proven by a scenario test with pass/fail evidence — no feature is done based on visual inspection alone
- Server launch must be proven by asserting the child process is running and the configured port responds
- Fine-tuning must be proven by asserting the output model file exists after training completes
- Error handling must be proven by triggering a known failure condition and asserting a visible error message appears in the UI
