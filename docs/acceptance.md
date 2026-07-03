# Acceptance Contract

This file is the build contract. If the interview said the product must do something, it belongs here as an acceptance criterion.

A feature is not done until every listed entry point is wired to real implementation code and every acceptance criterion has executable evidence.

## server-control - Server Control Tab

A tab where the user starts and stops the llama.cpp server, configures host and port, and sees real-time server stdout/stderr in a log panel.

### Entry Points
- Server tab in the main tab layout
- Start Server button
- Stop Server button
- Host input field
- Port input field
- Log panel

### Acceptance Criteria
1. Clicking Start launches the server process and the log panel shows startup output
2. Clicking Stop terminates the server process and the status indicator changes to stopped
3. Changing host and port values changes the flags passed to the server binary on next launch
4. The log panel updates in real time as the server writes to stdout/stderr

### Required Verification
- Scenario test: configure host=127.0.0.1 port=8080, click Start, assert process is running, assert HTTP response on port 8080, click Stop, assert process is terminated
- Scenario test: start server, verify log panel contains expected server startup text within 5 seconds

## model-management - Model Management Tab

A tab where the user browses for GGUF model files, loads a model into the server, and unloads it.

### Entry Points
- Models tab in the main tab layout
- Browse directory button
- Model file list
- Load Model button
- Unload Model button
- Currently loaded model indicator

### Acceptance Criteria
1. Browsing to a directory lists all .gguf files in that directory
2. Selecting a model and clicking Load sets it as the active model for the server
3. The loaded model name is visible in the UI
4. Clicking Unload clears the model selection
5. Closing and reopening the app restores the last model directory and selection

### Required Verification
- Scenario test: browse to a directory with GGUF files, assert files are listed, select one, click Load, start server, assert server log shows the correct model path
- Scenario test: point to a nonexistent directory, assert a clear error message appears

## settings-flags - Settings & Flags Tab

A tab exposing every llama.cpp server flag as a modern widget — dropdowns, sliders, toggles, and text inputs — organized in a clean layout.

### Entry Points
- Settings tab in the main tab layout
- Flag widgets (dropdowns, sliders, toggles, text inputs)
- Reset to Defaults button
- Flag section headers

### Acceptance Criteria
1. Every llama.cpp server flag has a corresponding widget
2. Changing a widget value updates the flag passed to the server on next launch
3. Flag values persist after closing and reopening the app
4. Reset to Defaults restores all flags to their default values
5. Each flag has a tooltip with a plain-language description

### Required Verification
- Scenario test: change context size to 4096, start server, assert server log shows --ctx-size 4096
- Scenario test: enable GPU offload with a slider value of 20, start server, assert server log shows --n-gpu-layers 20
- Scenario test: change settings, close app, reopen app, assert all previously set values are restored

## fine-tuning - Fine-Tuning Tab

A tab where the user configures and runs llama.cpp fine-tuning with form controls for dataset path, learning rate, epochs, output path, and other training parameters.

### Entry Points
- Fine-tuning tab in the main tab layout
- Dataset path file picker
- Output path file picker
- Learning rate input
- Epochs input
- Batch size input
- Start Training button
- Stop Training button
- Training log panel

### Acceptance Criteria
1. Configuring all parameters and clicking Start Training launches the finetune binary
2. Training logs appear in real time in the log panel
3. When training completes, the output model file exists at the specified path
4. If training fails, a clear error message appears in the UI
5. Clicking Stop Training terminates the finetune process
6. Fine-tuning settings persist after closing and reopening the app

### Required Verification
- Scenario test: configure a small dataset, set 1 epoch, set output path, click Start Training, wait for completion, assert output model file exists at the specified path
- Scenario test: point to a nonexistent dataset, click Start Training, assert a clear error message appears
- Scenario test: start training, click Stop Training, assert the finetune process is terminated

## system-monitor - System Monitor Tab

A tab showing real-time CPU, RAM, and GPU usage metrics so the user can see exactly what is happening with their system while the server or training runs.

### Entry Points
- System Monitor tab in the main tab layout
- CPU usage display
- RAM usage display
- GPU usage display
- Process resource usage display

### Acceptance Criteria
1. CPU and RAM metrics update at least once per second
2. GPU metrics display when a GPU is present, or a 'GPU not detected' message when not
3. When the server is running, the llama.cpp process resource usage is visible
4. The UI does not freeze or stutter while metrics update

### Required Verification
- Scenario test: open System Monitor tab, assert CPU and RAM values update within 2 seconds, assert no UI freeze
- Scenario test: start server, open System Monitor, assert llama.cpp process appears in the process resource display
- Scenario test: run on a machine without a GPU, assert 'GPU not detected' message is shown

## binary-config - Binary Configuration & First Launch

On first launch, the app detects whether the llama.cpp binary path is configured. If not, it prompts the user to locate the server and finetune binaries, validates they are executable, and persists the paths.

### Entry Points
- First-launch binary path prompt dialog
- Binary path settings section (accessible from Settings tab or a menu)

### Acceptance Criteria
1. On first launch with no config, the app prompts for the server binary path
2. Selecting a valid executable path is accepted and persisted
3. Selecting a nonexistent or non-executable file shows a clear error and re-prompts
4. Closing and reopening the app does not re-prompt if valid paths were previously saved
5. The user can change the binary path from the settings section at any time

### Required Verification
- Scenario test: delete config file, launch app, assert binary path prompt appears, provide valid path, assert prompt does not reappear on next launch
- Scenario test: provide a nonexistent file path, assert error message appears and prompt re-shows
- Scenario test: provide a non-executable file, assert error message appears

## error-handling - Error Handling & Recovery

A cross-cutting feature ensuring that every process failure, missing file, invalid configuration, or crash surfaces as a clear in-app error message in plain language, allowing the user to fix the issue and retry.

### Entry Points
- Error message dialog or banner (appears in any tab when an error occurs)
- Retry button in the error message
- Dismiss button in the error message

### Acceptance Criteria
1. When the server binary crashes, an error message appears with the exit code and relevant stderr output
2. When a model file does not exist, an error message appears explaining the file was not found
3. When fine-tuning fails, an error message appears explaining the failure reason
4. Every error message includes a plain-language explanation and a suggested fix
5. The user can dismiss the error and retry the operation

### Required Verification
- Scenario test: point to a nonexistent model file, click Start, assert error message appears with 'file not found' explanation
- Scenario test: kill the server process externally, assert the app shows an error message with the exit code
- Scenario test: start fine-tuning with an invalid dataset, assert error message appears with explanation
