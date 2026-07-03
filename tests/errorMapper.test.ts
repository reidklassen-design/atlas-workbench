import { describe, it, expect } from "vitest";
import {
  fromDirectoryError,
  fromInvalidDataset,
  fromMissingFile,
  fromProcessExit,
  fromProcessStartError,
  isGpuMemoryError,
  isPortInUse,
} from "@/errors/errorMapper";
import { ProcessStartError } from "@/process/processManager";

describe("errorMapper", () => {
  it("maps a port-in-use exit to a clear message and fix", () => {
    const err = fromProcessExit("server-control", "server", 1, "listen: bind: address already in use");
    expect(err.title).toMatch(/port already in use/i);
    expect(err.fix).toMatch(/port/i);
    expect(isPortInUse("EADDRINUSE")).toBe(true);
  });

  it("maps a crash exit code with stderr tail", () => {
    const err = fromProcessExit("server-control", "server", 137, "fatal: out of memory");
    expect(err.exitCode).toBe(137);
    expect(err.message).toMatch(/137/);
    expect(err.fix).toMatch(/out of memory/);
  });

  it("maps CUDA KV-cache allocation failures to a direct GPU memory message", () => {
    const tail = "cudaMalloc failed: out of memory\nfailed to allocate buffer for kv cache";
    const err = fromProcessExit("server-control", "server", null, tail);
    expect(isGpuMemoryError(tail)).toBe(true);
    expect(err.title).toMatch(/gpu memory/i);
    expect(err.fix).toMatch(/Auto fit/i);
    expect(err.fix).toMatch(/Context Size/i);
  });

  it("maps a crash with no stderr", () => {
    const err = fromProcessExit("fine-tuning", "finetune", 1, "");
    expect(err.fix).toMatch(/no error output/i);
  });

  it("maps a missing model file", () => {
    const err = fromMissingFile("server-control", "Model file", "/x/missing.gguf");
    expect(err.title).toMatch(/model file not found/i);
    expect(err.message).toMatch(/\/x\/missing.gguf/);
    expect(err.fix).toMatch(/try again/i);
  });

  it("maps an invalid dataset", () => {
    const err = fromInvalidDataset("fine-tuning", "/no/data.jsonl");
    expect(err.title).toMatch(/dataset missing/i);
    expect(err.message).toMatch(/\/no\/data.jsonl/);
  });

  it("maps a process start error (empty binary path)", () => {
    const start = new ProcessStartError("server", "The server binary path is not configured.", "Open Settings and pick the binary.");
    const err = fromProcessStartError("server-control", start);
    expect(err.message).toMatch(/not configured/i);
    expect(err.fix).toMatch(/settings/i);
  });

  it("maps a directory error", () => {
    const err = fromDirectoryError("model-management", "/no/such/dir");
    expect(err.title).toMatch(/could not open directory/i);
    expect(err.fix).toMatch(/different folder/i);
  });
});
