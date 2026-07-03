# Traceability Matrix

| Feature | Entry Point | Implementation Path | Test/Scenario Evidence | Status |
|---|---|---|---|---|
| server-control | Server tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/ServerTab.tsx | tests/ui/App.test.tsx, tests/ui/ServerTab.test.tsx | done |
| server-control | Start Server button | ServerTab -> AppController.startServer -> backend `server.start` -> ProcessManager.startServer | tests/processManager.test.ts, tests/backend.test.ts, scenario-start-server-with-model | done |
| server-control | Stop Server button | ServerTab -> AppController.stopServer -> backend `server.stop` -> ProcessManager.stop | tests/processManager.test.ts, tests/backend.test.ts, scenario-stop-running-server | done |
| server-control | Host input field | ServerTab -> AppController.updateConfig -> flagBuilder `--host` | tests/flagBuilder.test.ts, tests/ui/ServerTab.test.tsx | done |
| server-control | Port input field | ServerTab -> AppController.updateConfig -> flagBuilder `--port` | tests/flagBuilder.test.ts, tests/ui/ServerTab.test.tsx | done |
| server-control | Log panel and persistent server log | ProcessManager/Rust log events -> AppController -> LogPanel; Rust `emit_log` appends stdout/stderr to `~/.config/atlas-workbench/logs/server.log` | tests/processManager.test.ts, tests/ui/ServerTab.test.tsx, cargo check | done |
| server-control | Model-loading progress panel | Tauri `server_start` returns `starting` -> readiness watcher emits status/error/health-probe logs -> ServerLaunchProgress | tests/ui/ServerTab.test.tsx, tests/controller.test.ts, tests/processManager.test.ts | done |
| server-control | Launch health probe URL | Wildcard listen hosts (`0.0.0.0`, `::`, `*`) are probed through loopback for local `/health` readiness | tests/ui/ServerTab.test.tsx, cargo check | done |
| server-control | Tauri event capability for live logs/status | src-tauri/capabilities/default.json grants `core:default` and `core:event:default` to the main window | tests/tauriCapabilities.test.ts, tests/transport.test.ts | done |
| server-control | Acceptance: Clicking Start launches the server process and the log panel shows startup output | ProcessManager.startServer spawns executable and streams stdout | tests/processManager.test.ts, tests/backend.test.ts | done |
| server-control | Acceptance: Clicking Start gives visible feedback while model loading is in progress | AppController.startServer sets starting state and ServerLaunchProgress renders phase, health probe, pid, model, exact command, timeout countdown, and latest output | tests/ui/ServerTab.test.tsx | done |
| server-control | Acceptance: Clicking Stop terminates the server process and the status indicator changes to stopped | ProcessManager.stop sends SIGTERM/SIGKILL fallback and emits status | tests/processManager.test.ts, tests/backend.test.ts | done |
| server-control | Acceptance: Changing host and port values changes the flags passed to the server binary on next launch | ServerTab saves config; buildServerArgs emits --host/--port | tests/flagBuilder.test.ts, tests/ui/ServerTab.test.tsx | done |
| server-control | Acceptance: The log panel updates in real time as the server writes to stdout/stderr | stdout/stderr line buffers -> log events -> LogPanel | tests/processManager.test.ts, tests/ui/ServerTab.test.tsx | done |
| model-management | Models tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/ModelsTab.tsx | tests/ui/App.test.tsx, tests/ui/ModelsTab.test.tsx | done |
| model-management | Browse directory button | ModelsTab FilePicker -> AppController.setModelDirectory -> backend `model.list` | tests/backend.test.ts, tests/ui/ModelsTab.test.tsx | done |
| model-management | Model file list | ModelsTab renders AppController.models | tests/ui/ModelsTab.test.tsx | done |
| model-management | Load Model button | ModelsTab -> AppController.selectModel -> config.model.selectedModel, with saving/saved feedback state | tests/controller.test.ts, tests/ui/ModelsTab.test.tsx | done |
| model-management | Unload Model button | ModelsTab -> AppController.unloadModel | tests/controller.test.ts, tests/ui/ModelsTab.test.tsx | done |
| model-management | Currently loaded model indicator | ModelsTab indicator from config.model.selectedModel | tests/ui/ModelsTab.test.tsx | done |
| model-management | Acceptance: Browsing to a directory lists all .gguf files in that directory | backend `model.list` filters .gguf entries | tests/backend.test.ts, scenario-browse-and-load-model | done |
| model-management | Acceptance: Selecting a model and clicking Load sets it as the active model for the server | AppController.selectModel and buildServerArgs `--model` | tests/controller.test.ts, tests/flagBuilder.test.ts | done |
| model-management | Acceptance: The loaded model name is visible in the UI | ModelsTab loaded indicator | tests/ui/ModelsTab.test.tsx | done |
| model-management | Acceptance: Clicking Unload clears the model selection | AppController.unloadModel clears selectedModel | tests/controller.test.ts, tests/ui/ModelsTab.test.tsx | done |
| model-management | Acceptance: Closing and reopening the app restores the last model directory and selection | configStore save/load merge | tests/config.test.ts, tests/controller.test.ts | done |
| settings-flags | Settings tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/SettingsTab.tsx | tests/ui/App.test.tsx, tests/ui/SettingsTab.test.tsx | done |
| settings-flags | Flag widgets (dropdowns, sliders, toggles, text inputs) | SERVER_FLAGS -> FlagWidget -> AppController.updateConfig -> buildServerArgs | tests/ui/SettingsTab.test.tsx, tests/flagBuilder.test.ts | done |
| settings-flags | Reset to Defaults button | SettingsTab resetAll/resetSection -> defaultServerFlags -> config.save | tests/ui/SettingsTab.test.tsx | done |
| settings-flags | Flag section headers | SettingsTab groups by FlagSection | tests/ui/SettingsTab.test.tsx | done |
| settings-flags | Acceptance: Every llama.cpp server flag has a corresponding widget | SERVER_FLAGS rendered one-for-one, host/port owned by Server tab | tests/ui/SettingsTab.test.tsx | done |
| settings-flags | Acceptance: Changing a widget value updates the flag passed to the server on next launch | buildServerArgs emits changed values | tests/flagBuilder.test.ts, scenario-change-context-size-flag | done |
| settings-flags | Acceptance: Flag values persist after closing and reopening the app | configStore round-trip and persisted render | tests/config.test.ts, tests/ui/SettingsTab.test.tsx | done |
| settings-flags | Acceptance: Reset to Defaults restores all flags to their default values | SettingsTab reset test | tests/ui/SettingsTab.test.tsx | done |
| settings-flags | Acceptance: Each flag has a tooltip with a plain-language description | FlagWidget renders help text and title from catalog | tests/ui/SettingsTab.test.tsx | done |
| fine-tuning | Fine-tuning tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/FineTuningTab.tsx | tests/ui/FineTuningTab.test.tsx | done |
| fine-tuning | Dataset path file picker | FineTuningTab FilePicker -> config.finetune["train-data"] -> backend dataset check | tests/backend.test.ts, tests/ui/FineTuningTab.test.tsx | done |
| fine-tuning | Output path file picker | FineTuningTab FilePicker -> config.finetune["lora-out"] -> output check | tests/backend.test.ts | done |
| fine-tuning | Learning rate input | FlagWidget -> config.finetune["learning-rate"] -> buildFinetuneArgs | tests/flagBuilder.test.ts | done |
| fine-tuning | Epochs input | FlagWidget -> config.finetune["epochs"] -> buildFinetuneArgs | tests/flagBuilder.test.ts | done |
| fine-tuning | Batch size input | FlagWidget -> config.finetune["batch-size"] -> buildFinetuneArgs | tests/flagBuilder.test.ts | done |
| fine-tuning | Start Training button | FineTuningTab -> AppController.startTraining -> backend `training.start` -> ProcessManager.startFinetune | tests/processManager.test.ts, tests/backend.test.ts | done |
| fine-tuning | Stop Training button | FineTuningTab -> AppController.stopTraining -> backend `training.stop` -> ProcessManager.stop | tests/processManager.test.ts, tests/backend.test.ts | done |
| fine-tuning | Training log panel | ProcessManager finetune log events -> LogPanel | tests/processManager.test.ts | done |
| fine-tuning | Acceptance: Configuring all parameters and clicking Start Training launches the finetune binary | buildFinetuneArgs + ProcessManager.startFinetune | tests/flagBuilder.test.ts, tests/processManager.test.ts | done |
| fine-tuning | Acceptance: Training logs appear in real time in the log panel | stdout/stderr line buffers -> log events | tests/processManager.test.ts | done |
| fine-tuning | Acceptance: When training completes, the output model file exists at the specified path | backend completion check and filesystem assertion | tests/backend.test.ts, scenario-run-finetune-success | done |
| fine-tuning | Acceptance: If training fails, a clear error message appears in the UI | errorMapper + ErrorBanner | tests/errorMapper.test.ts, tests/ui/ErrorBanner.test.tsx | done |
| fine-tuning | Acceptance: Clicking Stop Training terminates the finetune process | ProcessManager.stop for finetune | tests/processManager.test.ts, tests/backend.test.ts | done |
| fine-tuning | Acceptance: Fine-tuning settings persist after closing and reopening the app | configStore save/load | tests/config.test.ts, tests/controller.test.ts | done |
| system-monitor | System Monitor tab in the main tab layout | src/ui/App.tsx -> src/ui/tabs/SystemMonitorTab.tsx | tests/ui/App.test.tsx, tests/ui/SystemMonitorTab.test.tsx | done |
| system-monitor | CPU usage display | SystemMonitor.collect cpu -> controller.metrics -> SystemMonitorTab | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx | done |
| system-monitor | RAM usage display | SystemMonitor.collect ram -> controller.metrics -> SystemMonitorTab | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx | done |
| system-monitor | GPU usage display | gpuProbe -> SystemMonitor.collect -> SystemMonitorTab | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx | done |
| system-monitor | Process resource usage display | SystemMonitor.collect pids -> `/proc` reads -> process table | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx | done |
| system-monitor | Acceptance: CPU and RAM metrics update at least once per second | AppController.startMetrics interval and monitor delta sampling | tests/monitor.test.ts, scenario-real-time-metrics-display | done |
| system-monitor | Acceptance: GPU metrics display when a GPU is present, or a 'GPU not detected' message when not | gpuProbe present/absent paths | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx | done |
| system-monitor | Acceptance: When the server is running, the llama.cpp process resource usage is visible | controller passes running pids to monitor | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx | done |
| system-monitor | Acceptance: The UI does not freeze or stutter while metrics update | async monitor collection and UI tests complete without blocking | tests/monitor.test.ts, tests/ui/SystemMonitorTab.test.tsx | done |
| binary-config | First-launch binary path prompt dialog | BinarySetupDialog -> AppController.setBinaryPaths -> backend `binary.set` | tests/ui/App.test.tsx, scenario-first-launch-binary-prompt | done |
| binary-config | Binary path settings section (accessible from Settings tab or a menu) | SettingsTab "Binary paths" -> AppController.setBinaryPaths | tests/ui/SettingsTab.test.tsx | done |
| binary-config | Acceptance: On first launch with no config, the app prompts for the server binary path | needsBinarySetup from config load -> BinarySetupDialog | tests/ui/App.test.tsx | done |
| binary-config | Acceptance: Selecting a valid executable path is accepted and persisted | validateBinary + binary.set + configStore.save | tests/binaryValidation.test.ts, tests/backend.test.ts | done |
| binary-config | Acceptance: Selecting a nonexistent or non-executable file shows a clear error and re-prompts | validateBinary failure -> CommandError -> ErrorBanner | tests/binaryValidation.test.ts, tests/backend.test.ts | done |
| binary-config | Acceptance: Closing and reopening the app does not re-prompt if valid paths were previously saved | configStore reload preserves paths | tests/backend.test.ts, tests/ui/App.test.tsx | done |
| binary-config | Acceptance: The user can change the binary path from the settings section at any time | SettingsTab binary section save | tests/ui/SettingsTab.test.tsx | done |
| error-handling | Error message dialog or banner (appears in any tab when an error occurs) | ErrorBanner renders AppController.errors | tests/ui/ErrorBanner.test.tsx | done |
| error-handling | Retry button in the error message | ErrorBanner -> AppError.retry from AppController | tests/ui/ErrorBanner.test.tsx, tests/controller.test.ts | done |
| error-handling | Dismiss button in the error message | ErrorBanner -> AppController.dismissError | tests/ui/ErrorBanner.test.tsx | done |
| error-handling | Acceptance: When the server binary crashes, an error message appears with the exit code and relevant stderr output | backend crash event -> errorMapper -> ErrorBanner | tests/backend.test.ts, tests/errorMapper.test.ts | done |
| error-handling | Acceptance: Server exits during model loading surface stderr instead of timing out silently | Rust readiness watcher watches child process during health polling and emits AppError with stderr tail; ProcessManager captures stream tails before exited status | src-tauri cargo check, tests/processManager.test.ts | done |
| error-handling | Acceptance: Event subscription failures surface in-app instead of hidden logs | createTauriTransport catches Tauri `listen` failures and returns an AppError through the error listener; main capability grants event permissions | tests/transport.test.ts, tests/tauriCapabilities.test.ts | done |
| error-handling | Acceptance: When a model file does not exist, an error message appears explaining the file was not found | backend missing model check -> CommandError | tests/backend.test.ts, tests/controller.test.ts | done |
| error-handling | Acceptance: Starting without a selected model surfaces immediate in-app guidance | AppController.startServer preflight -> ErrorBanner retryable AppError + server log line | tests/controller.test.ts | done |
| error-handling | Acceptance: When fine-tuning fails, an error message appears explaining the failure reason | backend dataset check and finetune failure mapping | tests/backend.test.ts, tests/errorMapper.test.ts | done |
| error-handling | Acceptance: Every error message includes a plain-language explanation and a suggested fix | errorMapper title/message/fix, ErrorBanner renders fix | tests/errorMapper.test.ts, tests/ui/ErrorBanner.test.tsx | done |
| error-handling | Acceptance: The user can dismiss the error and retry the operation | ErrorBanner Dismiss and Retry actions | tests/ui/ErrorBanner.test.tsx | done |
