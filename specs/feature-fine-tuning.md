# Feature: Fine-Tuning Tab

## Goal

A tab where the user configures and runs llama.cpp fine-tuning with form controls for dataset path, learning rate, epochs, output path, and other training parameters.

## Context

This feature belongs to the generated Dark Factory plan and must follow
docs/architecture.md, docs/architecture.json, and docs/conventions.md.

Dependencies: binary-config.

## Requirements

1. MUST provide a file picker for the training dataset path
2. MUST provide a file picker or text input for the output model path
3. MUST provide form controls for learning rate, epochs, batch size, and other finetune binary parameters
4. MUST launch the llama.cpp finetune binary as a child process with all configured parameters
5. MUST display training progress and logs in a real-time log panel
6. MUST show a clear success message when training completes and the output model file exists
7. MUST show a clear error message if training fails, with plain-language explanation
8. MUST provide a Stop Training button to terminate the finetune process
9. MUST persist fine-tuning configuration between sessions

## Entry Points

- Fine-tuning tab in the main tab layout
- Dataset path file picker
- Output path file picker
- Learning rate input
- Epochs input
- Batch size input
- Start Training button
- Stop Training button
- Training log panel

## Acceptance Criteria

1. Configuring all parameters and clicking Start Training launches the finetune binary
2. Training logs appear in real time in the log panel
3. When training completes, the output model file exists at the specified path
4. If training fails, a clear error message appears in the UI
5. Clicking Stop Training terminates the finetune process
6. Fine-tuning settings persist after closing and reopening the app

## Required Verification

- Scenario test: configure a small dataset, set 1 epoch, set output path, click Start Training, wait for completion, assert output model file exists at the specified path
- Scenario test: point to a nonexistent dataset, click Start Training, assert a clear error message appears
- Scenario test: start training, click Stop Training, assert the finetune process is terminated

## Functional Wiring Contract

Every visible control, command, route, menu item, form field, API endpoint,
scheduled job, or shortcut added for this feature MUST be wired to real
implementation behavior. It MUST have executable verification evidence.
Do not mark this feature done if any introduced entry point is decorative,
stubbed, disconnected, silently ignored, or only logs a fake success message.

## Constraints

- MUST not mark fine-tuning as done until the output model file is verified to exist
- MUST not block the UI thread during training
- MUST validate that the dataset file exists before launching training

## Edge Cases

- Dataset file does not exist or is not readable
- Output path is not writable
- Training fails midway through due to OOM or invalid data
- User clicks Stop Training during a critical write operation

## Non-Goals

- Does not support distributed or multi-GPU training configurations in the first version
- Does not validate dataset format compatibility — the user is responsible for providing a valid format
