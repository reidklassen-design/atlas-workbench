import { randomUUID } from "node:crypto";
import type { AppError } from "@/config/types";
import { ProcessStartError } from "@/process/processManager";

function newError(partial: Omit<AppError, "id" | "ts">): AppError {
  return { id: randomUUID(), ts: Date.now(), ...partial };
}

/** Detect common "port in use" phrasing across llama.cpp builds. */
export function isPortInUse(stderrTail: string): boolean {
  return /address already in use|bind: address already in use|EADDRINUSE/i.test(stderrTail);
}

export function isGpuMemoryError(stderrTail: string): boolean {
  return /cudaMalloc failed: out of memory|failed to allocate buffer for kv cache|failed to initialize the context|failed to fit params to free device memory/i.test(stderrTail);
}

export function fromProcessStartError(scope: string, err: ProcessStartError): AppError {
  return newError({
    scope,
    title: "Could not start the process",
    message: err.message,
    fix: err.fix,
  });
}

export function fromProcessExit(scope: string, kind: "server" | "finetune", exitCode: number | null, stderrTail: string): AppError {
  if (isPortInUse(stderrTail)) {
    return newError({
      scope,
      title: "Port already in use",
      message: `The ${kind} could not bind to its port because another process is already using it.`,
      fix: "Change the port in the Server tab, or stop the other program using that port, then click Start again.",
      exitCode,
      stderrTail,
    });
  }
  if (kind === "server" && isGpuMemoryError(stderrTail)) {
    return newError({
      scope,
      title: "GPU memory allocation failed",
      message: "llama-server could not fit the model, KV cache, and compute buffers into available GPU memory.",
      fix: "Use GPU Loading > Auto fit, lower Context Size, switch KV cache to q4_0/q5_0, or choose a smaller/lower-quant model, then click Start again.",
      exitCode,
      stderrTail,
    });
  }
  const tail = stderrTail.trim();
  const message =
    exitCode === null
      ? `The ${kind} process was terminated unexpectedly.`
      : `The ${kind} process exited with code ${exitCode}.`;
  const fix = tail
    ? `Review the last log lines below, correct the configuration, and click Start again. Common causes: a missing or invalid model file, an unsupported flag, or out-of-memory. Last output: ${tail.slice(-400)}`
    : `The ${kind} produced no error output. Check that your model and binary are compatible, then try again.`;
  return newError({
    scope,
    title: `${kind === "server" ? "Server" : "Training"} stopped unexpectedly`,
    message,
    fix,
    exitCode,
    stderrTail: tail,
  });
}

export function fromMissingFile(scope: string, what: string, path: string): AppError {
  return newError({
    scope,
    title: `${what} not found`,
    message: `The ${what.toLowerCase()} “${path}” was not found.`,
    fix: `Pick a valid ${what.toLowerCase()} file and try again. If you moved or renamed it, update the path.`,
  });
}

export function fromDirectoryError(scope: string, path: string): AppError {
  return newError({
    scope,
    title: "Could not open directory",
    message: `The directory “${path}” could not be read. It may not exist or you may not have permission to access it.`,
    fix: "Choose a different folder that exists and contains your model files, then try again.",
  });
}

export function fromEmptyDirectory(scope: string, path: string): AppError {
  return newError({
    scope,
    title: "No models found",
    message: `No .gguf files were found in “${path}”.`,
    fix: "Pick a folder that contains GGUF model files, or download a model into that folder first.",
  });
}

export function fromInvalidDataset(scope: string, path: string): AppError {
  return newError({
    scope,
    title: "Training dataset missing",
    message: `The training dataset “${path}” does not exist or is not readable.`,
    fix: "Choose a valid training data file (GGUF or JSONL) and try again.",
  });
}

export function fromGeneric(scope: string, title: string, message: string, fix: string): AppError {
  return newError({ scope, title, message, fix });
}
