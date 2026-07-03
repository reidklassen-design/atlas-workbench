# Roadmap

- **Server Control Tab** (high): A tab where the user starts and stops the llama.cpp server, configures host and port, and sees real-time server stdout/stderr in a log panel.
- **Model Management Tab** (high): A tab where the user browses for GGUF model files, loads a model into the server, and unloads it.
- **Settings & Flags Tab** (high): A tab exposing every llama.cpp server flag as a modern widget — dropdowns, sliders, toggles, and text inputs — organized in a clean layout.
- **Fine-Tuning Tab** (high): A tab where the user configures and runs llama.cpp fine-tuning with form controls for dataset path, learning rate, epochs, output path, and other training parameters.
- **System Monitor Tab** (medium): A tab showing real-time CPU, RAM, and GPU usage metrics so the user can see exactly what is happening with their system while the server or training runs.
- **Binary Configuration & First Launch** (high): On first launch, the app detects whether the llama.cpp binary path is configured. If not, it prompts the user to locate the server and finetune binaries, validates they are executable, and persists the paths.
- **Error Handling & Recovery** (high): A cross-cutting feature ensuring that every process failure, missing file, invalid configuration, or crash surfaces as a clear in-app error message in plain language, allowing the user to fix the issue and retry.
