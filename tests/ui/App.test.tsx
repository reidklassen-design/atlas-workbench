import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Shell } from "@/ui/App";
import { renderApp, baselineConfig, baselineHandlers } from "./helpers";

describe("App shell", () => {
  it("renders all tabs and switches between them", async () => {
    const { controller } = await renderApp(<Shell />);
    expect(screen.getByTestId("tab-server")).toBeDefined();
    expect(screen.getByTestId("tab-models")).toBeDefined();
    expect(screen.getByTestId("tab-settings")).toBeDefined();
    expect(screen.getByTestId("tab-fine-tuning")).toBeDefined();
    expect(screen.getByTestId("tab-system-monitor")).toBeDefined();
    expect(screen.getByTestId("tab-agent-runtime")).toBeDefined();
    expect(screen.getByTestId("tab-logs")).toBeDefined();
    expect(screen.queryByLabelText("Menu")).toBeNull();
    expect(screen.queryByText("New Chat")).toBeNull();

    await userEvent.click(screen.getByTestId("tab-system-monitor"));
    expect(screen.getByTestId("gpu-not-detected")).toBeDefined();

    await userEvent.click(screen.getByTestId("tab-settings"));
    expect(screen.getByTestId("binary-settings-section")).toBeDefined();

    await userEvent.click(screen.getByTestId("tab-agent-runtime"));
    expect(screen.getByTestId("snippet-opencode")).toBeDefined();
    expect(screen.getByTestId("snippet-codex")).toBeDefined();
    controller.dispose();
  });

  it("shows live dashboard throughput and GPU temperature from monitor metrics", async () => {
    const handlers = baselineHandlers({
      "monitor.collect": () => ({
        cpu: { overall: 22, perCore: [20, 24] },
        ram: { used: 4_000_000_000, total: 16_000_000_000, percent: 25 },
        gpu: { detected: true, name: "RTX Test", usagePercent: 55, memoryUsed: 8_000_000_000, memoryTotal: 16_000_000_000, temperatureCelsius: 61 },
        runtime: { source: "llama.cpp", generationTokensPerSecond: 72.4, promptTokensPerSecond: 1300, requestsProcessing: 0, requestsDeferred: 0 },
        processes: [],
        ts: Date.now(),
      }),
    });
    const { controller } = await renderApp(<Shell />, handlers);

    expect(screen.getByTestId("dashboard").textContent).toContain("72.4");
    expect(screen.getByTestId("dashboard").textContent).toContain("61");
    expect(screen.getByText(/Tokens\/sec: 72.4 tok\/s/i)).toBeDefined();
    expect(screen.getByText(/GPU temp: 61 °C/i)).toBeDefined();
    controller.dispose();
  });

  it("keeps dashboard throughput visible from llama.cpp average timing when live delta is idle", async () => {
    const handlers = baselineHandlers({
      "monitor.collect": () => ({
        cpu: { overall: 22, perCore: [20, 24] },
        ram: { used: 4_000_000_000, total: 16_000_000_000, percent: 25 },
        gpu: { detected: true, name: "RTX Test", usagePercent: 55, memoryUsed: 8_000_000_000, memoryTotal: 16_000_000_000, temperatureCelsius: 61 },
        runtime: { source: "llama.cpp", generationTokensPerSecond: 0, averageGenerationTokensPerSecond: 117.2, requestsProcessing: 0, requestsDeferred: 0 },
        processes: [],
        ts: Date.now(),
      }),
    });
    const { controller } = await renderApp(<Shell />, handlers);

    expect(screen.getByText(/Tokens\/sec: 117.2 tok\/s/i)).toBeDefined();
    controller.dispose();
  });

  it("shows live gateway context budget and compaction status in the bottom bar", async () => {
    const handlers = baselineHandlers({
      "monitor.collect": () => ({
        cpu: { overall: 22, perCore: [20, 24] },
        ram: { used: 4_000_000_000, total: 16_000_000_000, percent: 25 },
        gpu: { detected: true, name: "RTX Test", usagePercent: 55, memoryUsed: 8_000_000_000, memoryTotal: 16_000_000_000, temperatureCelsius: 61 },
        runtime: { source: "llama.cpp", contextTokens: 35935, contextWindowTokens: 98304, requestsProcessing: 0, requestsDeferred: 0 },
        processes: [],
        ts: Date.now(),
      }),
      "gateway.status": () => ({
        running: true,
        external: false,
        host: "127.0.0.1",
        port: 18080,
        upstream: "http://127.0.0.1:8099",
        modelAlias: "atlas/local",
        activeProfileId: "3090-ti-ornith-35b-96k-always-on",
        requestCount: 3,
        rejectedCount: 0,
        compressedCount: 1,
        compactionActive: true,
        lastCompression: { beforeTokens: 120000, afterTokens: 60000, savedTokens: 60000, ts: Date.now() },
        lastBudget: {
          ok: true,
          estimatedPromptTokens: 60000,
          requestedOutputTokens: 1024,
          usablePromptTokens: 77824,
          overflowTokens: 0,
          action: "compress",
          reasons: [],
        },
      }),
    });
    const { controller } = await renderApp(<Shell />, handlers);

    expect(screen.getByText("Context Usage")).toBeDefined();
    expect(screen.getByText(/35,935 \/ 98,304 prompt tokens/i)).toBeDefined();
    expect(screen.getByText("Compacting now")).toBeDefined();
    expect(screen.getByText("System Status")).toBeDefined();
    expect(screen.getAllByText("Online").length).toBeGreaterThan(0);
    controller.dispose();
  });

  it("shows the first-launch binary prompt when no server binary is configured", async () => {
    const handlers = baselineHandlers({}, () => baselineConfig({ binaryPaths: { server: "", finetune: "" } }));
    const { controller } = await renderApp(<Shell />, handlers);
    expect(screen.getByTestId("binary-setup-dialog")).toBeDefined();
    controller.dispose();
  });

  it("lets the user save binary paths from the first-launch dialog", async () => {
    const saved: { server: string; finetune: string }[] = [];
    const handlers = baselineHandlers({
      "binary.set": (args) => {
        saved.push({ server: String(args.server), finetune: String(args.finetune) });
        return baselineConfig({ binaryPaths: { server: String(args.server), finetune: String(args.finetune) } });
      },
    }, () => baselineConfig({ binaryPaths: { server: "", finetune: "" } }));
    const { controller } = await renderApp(<Shell />, handlers);

    const serverInput = screen.getByTestId("server-binary");
    await userEvent.type(serverInput, "/usr/bin/llama-server");
    await userEvent.click(screen.getByTestId("binary-setup-save"));

    expect(saved[0]?.server).toBe("/usr/bin/llama-server");
    controller.dispose();
  });

  it("does not re-prompt when valid binary paths are already saved", async () => {
    const { controller } = await renderApp(<Shell />);
    expect(screen.queryByTestId("binary-setup-dialog")).toBeNull();
    controller.dispose();
  });

  it("does not render top-level notification or error banners", async () => {
    const { controller, emit } = await renderApp(<Shell />);
    emit("notice", { id: "n1", title: "Binary paths saved", message: "Server path saved.", ts: Date.now() });
    emit("training-complete", { outputPath: "/out/trained.bin", exists: true, exitCode: 0 });
    emit("error", { id: "e1", scope: "server-control", title: "Server stopped unexpectedly", message: "The server exited.", fix: "Review the log.", ts: Date.now() });
    await new Promise((r) => setTimeout(r, 10));

    expect(screen.queryByText(/Binary paths saved/)).toBeNull();
    expect(screen.queryByText(/Server path saved/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Server stopped unexpectedly/)).toBeDefined();
    controller.dispose();
  });
});
