import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { ServerTab } from "@/ui/tabs/ServerTab";
import { renderApp, baselineConfig, baselineHandlers, defaultServerFlags } from "./helpers";
import type { AppConfig } from "@/config/types";

describe("ServerTab", () => {
  it("shows host and port inputs bound to config and Start/Stop buttons", async () => {
    const { controller } = await renderApp(<ServerTab />);
    expect((screen.getByTestId("server-host") as HTMLInputElement)).toBeDefined();
    expect((screen.getByTestId("start-server") as HTMLButtonElement)).toBeDefined();
    expect((screen.getByTestId("stop-server") as HTMLButtonElement)).toBeDefined();
    expect(screen.getByTestId("server-log-file").textContent).toContain("server.log");
    expect((screen.getByTestId("server-host") as HTMLInputElement).value).toBe("127.0.0.1");
    expect((screen.getByTestId("server-port") as HTMLInputElement).value).toBe("8099");
    controller.dispose();
  });

  it("changing host/port updates the flags passed on next launch", async () => {
    const saved: AppConfig[] = [];
    const handlers = baselineHandlers({
      "config.save": (args) => {
        saved.push(args.config as AppConfig);
        return args.config as AppConfig;
      },
    });
    const { controller } = await renderApp(<ServerTab />, handlers);
    fireEvent.change(screen.getByTestId("server-host"), { target: { value: "0.0.0.0" } });
    fireEvent.change(screen.getByTestId("server-port"), { target: { value: "9000" } });
    await new Promise((r) => setTimeout(r, 10));
    expect(saved[saved.length - 1].server.host).toBe("0.0.0.0");
    expect(saved[saved.length - 1].server.port).toBe(9000);
    controller.dispose();
  });

  it("disables Start when running and Stop when stopped", async () => {
    const { controller, emit } = await renderApp(<ServerTab />);
    expect((screen.getByTestId("start-server") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("stop-server") as HTMLButtonElement).disabled).toBe(true);

    emit("status", { kind: "server", state: "running", pid: 123, startedAt: Date.now() });
    await new Promise((r) => setTimeout(r, 10));
    expect((screen.getByTestId("start-server") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("stop-server") as HTMLButtonElement).disabled).toBe(false);

    emit("status", { kind: "server", state: "exited", exitCode: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect((screen.getByTestId("start-server") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("stop-server") as HTMLButtonElement).disabled).toBe(true);
    controller.dispose();
  });

  it("shows model-loading status while the server is starting without a fake progress bar", async () => {
    const handlers = baselineHandlers({
      "config.load": () => baselineConfig({ model: { directory: "/models", selectedModel: "/models/alpha.gguf" } }),
    });
    const { controller, emit } = await renderApp(<ServerTab />, handlers);
    emit("status", { kind: "server", state: "starting", pid: 123, startedAt: Date.now() - 2000 });
    emit("log", { kind: "server", stream: "stdout", text: "Waiting for llama-server health at http://127.0.0.1:8099/health", ts: Date.now() });
    await new Promise((r) => setTimeout(r, 10));

    expect(screen.getByTestId("server-launch-progress").textContent).toMatch(/loading model/i);
    expect(screen.getByTestId("server-launch-phase").textContent).toMatch(/health endpoint/i);
    expect(screen.getByTestId("server-launch-model").textContent).toBe("alpha.gguf");
    expect(screen.getByTestId("server-launch-endpoint").textContent).toBe("http://127.0.0.1:8099/health");
    expect(screen.getByTestId("server-launch-pid").textContent).toMatch(/pid 123/);
    expect(screen.getByTestId("server-launch-command").textContent).toContain("--model /models/alpha.gguf");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect((screen.getByTestId("start-server") as HTMLButtonElement).disabled).toBe(true);
    controller.dispose();
  });

  it("uses loopback for the launch health probe when the server listens on all interfaces", async () => {
    const handlers = baselineHandlers({
      "config.load": () => baselineConfig({ server: { host: "0.0.0.0", port: 8099 }, model: { directory: "/models", selectedModel: "/models/alpha.gguf" } }),
    });
    const { controller, emit } = await renderApp(<ServerTab />, handlers);
    emit("status", { kind: "server", state: "starting", pid: 123, startedAt: Date.now() - 2000 });
    await new Promise((r) => setTimeout(r, 10));

    expect(screen.getByTestId("server-launch-endpoint").textContent).toBe("http://127.0.0.1:8099/health");
    expect(screen.getByTestId("server-launch-elapsed").textContent).toMatch(/before timeout/i);
    controller.dispose();
  });

  it("streams logs into the log panel in real time", async () => {
    const { controller, emit } = await renderApp(<ServerTab />);
    emit("log", { kind: "server", stream: "stdout", text: "llama.cpp server listening on http://127.0.0.1:8080", ts: Date.now() });
    emit("log", { kind: "server", stream: "stderr", text: "a warning", ts: Date.now() });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText(/llama.cpp server listening/)).toBeDefined();
    controller.dispose();
  });

  it("replaces live model loading progress instead of stacking stale percentages", async () => {
    const { controller, emit } = await renderApp(<ServerTab />);
    emit("log", { kind: "server", stream: "stdout", text: "Model loading: 10%...", replaceKey: "server:model-loading", ts: Date.now() });
    emit("log", { kind: "server", stream: "stdout", text: "Model loading: 42%...", replaceKey: "server:model-loading", ts: Date.now() });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("Model loading: 10%...")).toBeNull();
    expect(screen.getByText("Model loading: 42%...")).toBeDefined();
    controller.dispose();
  });

  it("shows the exact generated launch command with changed context length", async () => {
    const handlers = baselineHandlers({
      "config.load": () => baselineConfig({ serverFlags: { ...defaultServerFlags(), "ctx-size": 4096 } }),
    });
    const { controller } = await renderApp(<ServerTab />, handlers);
    expect(screen.getByTestId("server-command-preview").textContent).toContain("--ctx-size 4096");
    controller.dispose();
  });

  it("defaults GPU loading to auto-fit and only emits GPU layers for explicit modes", async () => {
    const saved: AppConfig[] = [];
    const handlers = baselineHandlers({
      "config.save": (args) => {
        saved.push(args.config as AppConfig);
        return args.config as AppConfig;
      },
    });
    const { controller } = await renderApp(<ServerTab />, handlers);

    expect(screen.getByTestId("gpu-mode-auto").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("server-command-preview").textContent).not.toContain("--n-gpu-layers 999");

    fireEvent.click(screen.getByTestId("gpu-mode-full"));
    await new Promise((r) => setTimeout(r, 10));
    expect(saved[saved.length - 1].gpu.offloadMode).toBe("full");
    expect(screen.getByTestId("server-command-preview").textContent).toContain("--n-gpu-layers 999");

    fireEvent.click(screen.getByTestId("gpu-mode-auto"));
    await new Promise((r) => setTimeout(r, 10));
    expect(saved[saved.length - 1].gpu.offloadMode).toBe("auto");
    expect(screen.getByTestId("server-command-preview").textContent).not.toContain("--n-gpu-layers 999");
    controller.dispose();
  });

  it("extracts tokens/sec from llama.cpp timing logs", async () => {
    const { controller, emit } = await renderApp(<ServerTab />);
    emit("log", { kind: "server", stream: "stdout", text: "llama_perf_sampler_print: sampled 32 tokens at 48.25 tokens per second", ts: Date.now() });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId("tokens-per-second").textContent).toBe("48.25");
    controller.dispose();
  });
});
