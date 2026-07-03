# Public Test Strategy

These tests are implementer-visible. They must prove the acceptance contract without exposing holdout scenario details.

## server-control - Server Control Tab

### Tests To Add
- Add an executable test proving: Clicking Start launches the server process and the log panel shows startup output
- Add an executable test proving: Clicking Stop terminates the server process and the status indicator changes to stopped
- Add an executable test proving: Changing host and port values changes the flags passed to the server binary on next launch
- Add an executable test proving: The log panel updates in real time as the server writes to stdout/stderr

### Entry Point Coverage
- Exercise entry point end-to-end: Server tab in the main tab layout
- Exercise entry point end-to-end: Start Server button
- Exercise entry point end-to-end: Stop Server button
- Exercise entry point end-to-end: Host input field
- Exercise entry point end-to-end: Port input field
- Exercise entry point end-to-end: Log panel

### Failure Cases
- Add at least one negative/error-path test for this feature.

## model-management - Model Management Tab

### Tests To Add
- Add an executable test proving: Browsing to a directory lists all .gguf files in that directory
- Add an executable test proving: Selecting a model and clicking Load sets it as the active model for the server
- Add an executable test proving: The loaded model name is visible in the UI
- Add an executable test proving: Clicking Unload clears the model selection
- Add an executable test proving: Closing and reopening the app restores the last model directory and selection

### Entry Point Coverage
- Exercise entry point end-to-end: Models tab in the main tab layout
- Exercise entry point end-to-end: Browse directory button
- Exercise entry point end-to-end: Model file list
- Exercise entry point end-to-end: Load Model button
- Exercise entry point end-to-end: Unload Model button
- Exercise entry point end-to-end: Currently loaded model indicator

### Failure Cases
- Add at least one negative/error-path test for this feature.

## settings-flags - Settings & Flags Tab

### Tests To Add
- Add an executable test proving: Every llama.cpp server flag has a corresponding widget
- Add an executable test proving: Changing a widget value updates the flag passed to the server on next launch
- Add an executable test proving: Flag values persist after closing and reopening the app
- Add an executable test proving: Reset to Defaults restores all flags to their default values
- Add an executable test proving: Each flag has a tooltip with a plain-language description

### Entry Point Coverage
- Exercise entry point end-to-end: Settings tab in the main tab layout
- Exercise entry point end-to-end: Flag widgets (dropdowns, sliders, toggles, text inputs)
- Exercise entry point end-to-end: Reset to Defaults button
- Exercise entry point end-to-end: Flag section headers

### Failure Cases
- Add at least one negative/error-path test for this feature.

## fine-tuning - Fine-Tuning Tab

### Tests To Add
- Add an executable test proving: Configuring all parameters and clicking Start Training launches the finetune binary
- Add an executable test proving: Training logs appear in real time in the log panel
- Add an executable test proving: When training completes, the output model file exists at the specified path
- Add an executable test proving: If training fails, a clear error message appears in the UI
- Add an executable test proving: Clicking Stop Training terminates the finetune process
- Add an executable test proving: Fine-tuning settings persist after closing and reopening the app

### Entry Point Coverage
- Exercise entry point end-to-end: Fine-tuning tab in the main tab layout
- Exercise entry point end-to-end: Dataset path file picker
- Exercise entry point end-to-end: Output path file picker
- Exercise entry point end-to-end: Learning rate input
- Exercise entry point end-to-end: Epochs input
- Exercise entry point end-to-end: Batch size input
- Exercise entry point end-to-end: Start Training button
- Exercise entry point end-to-end: Stop Training button
- Exercise entry point end-to-end: Training log panel

### Failure Cases
- Add at least one negative/error-path test for this feature.

## system-monitor - System Monitor Tab

### Tests To Add
- Add an executable test proving: CPU and RAM metrics update at least once per second
- Add an executable test proving: GPU metrics display when a GPU is present, or a 'GPU not detected' message when not
- Add an executable test proving: When the server is running, the llama.cpp process resource usage is visible
- Add an executable test proving: The UI does not freeze or stutter while metrics update

### Entry Point Coverage
- Exercise entry point end-to-end: System Monitor tab in the main tab layout
- Exercise entry point end-to-end: CPU usage display
- Exercise entry point end-to-end: RAM usage display
- Exercise entry point end-to-end: GPU usage display
- Exercise entry point end-to-end: Process resource usage display

### Failure Cases
- Add at least one negative/error-path test for this feature.

## binary-config - Binary Configuration & First Launch

### Tests To Add
- Add an executable test proving: On first launch with no config, the app prompts for the server binary path
- Add an executable test proving: Selecting a valid executable path is accepted and persisted
- Add an executable test proving: Selecting a nonexistent or non-executable file shows a clear error and re-prompts
- Add an executable test proving: Closing and reopening the app does not re-prompt if valid paths were previously saved
- Add an executable test proving: The user can change the binary path from the settings section at any time

### Entry Point Coverage
- Exercise entry point end-to-end: First-launch binary path prompt dialog
- Exercise entry point end-to-end: Binary path settings section (accessible from Settings tab or a menu)

### Failure Cases
- Add at least one negative/error-path test for this feature.

## error-handling - Error Handling & Recovery

### Tests To Add
- Add an executable test proving: When the server binary crashes, an error message appears with the exit code and relevant stderr output
- Add an executable test proving: When a model file does not exist, an error message appears explaining the file was not found
- Add an executable test proving: When fine-tuning fails, an error message appears explaining the failure reason
- Add an executable test proving: Every error message includes a plain-language explanation and a suggested fix
- Add an executable test proving: The user can dismiss the error and retry the operation

### Entry Point Coverage
- Exercise entry point end-to-end: Error message dialog or banner (appears in any tab when an error occurs)
- Exercise entry point end-to-end: Retry button in the error message
- Exercise entry point end-to-end: Dismiss button in the error message

### Failure Cases
- Add at least one negative/error-path test for this feature.
