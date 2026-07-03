// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { AppController } from "@/state/appController";
import { createBackendTransport } from "@/ipc/backendTransport";
import {
  makeBackend,
  mkTempDir,
  rmrf,
  makeGguf,
  makeFile,
  join,
  FAKE_SERVER,
  FAKE_FINETUNE,
  type BackendHarness,
} from "./helpers/backendHarness";

const harnesses: BackendHarness[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.cleanup();
  for (const d of dirs.splice(0)) await rmrf(d);
});

async function waitFor<T>(fn: () => T | Promise<T>, predicate: (v: T) => boolean, timeoutMs = 6000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (predicate(value)) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out (${timeoutMs}ms)`);
    await new Promise((r) => setTimeout(r, 30));
  }
}

function makeController(h: BackendHarness): AppController {
  const transport = createBackendTransport(h.backend);
  return new AppController({
    invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => transport.invoke(cmd, args) as Promise<T>,
    onEvent: (event, listener) => transport.on(event, listener),
  });
}

describe("AppController", () => {
  it("loads config and reports needsBinarySetup when no server binary is set", async () => {
    const h = await makeBackend({ config: { binaryPaths: { server: "", finetune: "" } } });
    harnesses.push(h);
    const controller = makeController(h);
    await controller.init();
    expect(controller.loaded).toBe(true);
    expect(controller.needsBinarySetup).toBe(true);
    controller.dispose();
  });

  it("clears needsBinarySetup after valid binary paths are saved", async () => {
    const h = await makeBackend({ config: { binaryPaths: { server: "", finetune: "" } } });
    harnesses.push(h);
    const controller = makeController(h);
    await controller.init();
    const ok = await controller.setBinaryPaths({ server: FAKE_SERVER, finetune: FAKE_FINETUNE });
    expect(ok).toBe(true);
    expect(controller.needsBinarySetup).toBe(false);
    expect(controller.config.binaryPaths.server).toBe(FAKE_SERVER);
    controller.dispose();
  });

  it("persists config changes across a reload", async () => {
    const h = await makeBackend();
    harnesses.push(h);
    const controller = makeController(h);
    await controller.init();
    await controller.updateConfig((cfg) => ({ ...cfg, server: { ...cfg.server, port: 7373 }, serverFlags: { ...cfg.serverFlags, "ctx-size": 4096 } }));
    controller.dispose();

    const controller2 = makeController(h);
    await controller2.init();
    expect(controller2.config.server.port).toBe(7373);
    expect(controller2.config.serverFlags["ctx-size"]).toBe(4096);
    controller2.dispose();
  });

  it("lists models and selects one, then unloads", async () => {
    const dir = await mkTempDir();
    dirs.push(dir);
    await makeGguf(dir, "model.gguf");
    const h = await makeBackend();
    harnesses.push(h);
    const controller = makeController(h);
    await controller.init();
    await controller.setModelDirectory(dir);
    expect(controller.models.files).toEqual(["model.gguf"]);
    await controller.selectModel("model.gguf");
    expect(controller.config.model.selectedModel).toBe(join(dir, "model.gguf"));
    await controller.unloadModel();
    expect(controller.config.model.selectedModel).toBe("");
    controller.dispose();
  });

  it("shows an immediate error when Start is clicked without a selected model", async () => {
    const h = await makeBackend();
    harnesses.push(h);
    const controller = makeController(h);
    await controller.init();
    await controller.startServer();
    expect(controller.server.state).toBe("stopped");
    expect(controller.errors.length).toBe(1);
    expect(controller.errors[0].title).toMatch(/no model selected/i);
    expect(controller.serverLogs.some((line) => /No model selected/.test(line.text))).toBe(true);
    controller.dispose();
  });

  it("surfaces a server start failure as an error with a retry callback", async () => {
    const h = await makeBackend();
    harnesses.push(h);
    const controller = makeController(h);
    await controller.init();
    await controller.updateConfig((cfg) => ({ ...cfg, model: { ...cfg.model, selectedModel: "/no/such/missing.gguf" } }));
    await controller.startServer();
    expect(controller.errors.length).toBe(1);
    expect(controller.errors[0].message).toMatch(/not found/i);
    expect(typeof controller.errors[0].retry).toBe("function");
    controller.dismissError(controller.errors[0].id);
    expect(controller.errors.length).toBe(0);
    controller.dispose();
  });

  it("records training completion when the output file exists", async () => {
    const dir = await mkTempDir();
    dirs.push(dir);
    const outPath = join(dir, "trained.bin");
    const dataset = await makeFile(dir, "data.jsonl", false, "{}");
    const h = await makeBackend({ config: { finetune: { "lora-out": outPath, "train-data": dataset, epochs: 1 } }, env: { FAKE_FINETUNE_DELAY_MS: "10" } });
    harnesses.push(h);
    const controller = makeController(h);
    await controller.init();
    await controller.startTraining();
    await waitFor(() => controller.lastTraining !== null, (v) => v, 6000);
    expect(controller.lastTraining?.exists).toBe(true);
    expect(controller.lastTraining?.outputPath).toBe(outPath);
    expect(existsSync(outPath)).toBe(true);
    controller.dispose();
  });

  it("collects metrics during init", async () => {
    const h = await makeBackend();
    harnesses.push(h);
    const controller = makeController(h);
    await controller.init();
    await waitFor(() => controller.metrics !== null, (v) => v, 4000);
    expect(controller.metrics?.gpu.detected).toBe(false);
    expect(controller.metrics?.cpu.perCore.length).toBeGreaterThan(0);
    controller.dispose();
  });
});
