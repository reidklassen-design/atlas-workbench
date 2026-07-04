import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { SystemMonitorTab } from "@/ui/tabs/SystemMonitorTab";
import { renderApp, baselineHandlers } from "./helpers";

describe("SystemMonitorTab", () => {
  it("shows 'GPU not detected' when no GPU is present", async () => {
    const handlers = baselineHandlers({
      "monitor.collect": () => ({
        cpu: { overall: 10, perCore: [10] },
        ram: { used: 1e9, total: 8e9, percent: 12.5 },
        gpu: { detected: false, note: "GPU not detected" },
        processes: [],
        ts: Date.now(),
      }),
    });
    const { controller } = await renderApp(<SystemMonitorTab />, handlers);
    expect(screen.getByTestId("gpu-not-detected").textContent).toMatch(/GPU not detected/i);
    controller.dispose();
  });

  it("shows GPU metrics when a GPU is present", async () => {
    const handlers = baselineHandlers({
      "monitor.collect": () => ({
        cpu: { overall: 10, perCore: [10] },
        ram: { used: 1e9, total: 8e9, percent: 12.5 },
        gpu: { detected: true, name: "AMD Radeon", usagePercent: 55, memoryUsed: 2_000_000_000, memoryTotal: 8_000_000_000, temperatureCelsius: 63 },
        processes: [],
        ts: Date.now(),
      }),
    });
    const { controller } = await renderApp(<SystemMonitorTab />, handlers);
    expect(screen.getByTestId("gpu-metrics").textContent).toMatch(/AMD Radeon/);
    expect(screen.getByTestId("gpu-temperature").textContent).toMatch(/63 °C/);
    controller.dispose();
  });

  it("shows the llama.cpp process when the server is running", async () => {
    const handlers = baselineHandlers({
      "monitor.collect": () => ({
        cpu: { overall: 10, perCore: [10] },
        ram: { used: 1e9, total: 8e9, percent: 12.5 },
        gpu: { detected: false, note: "GPU not detected" },
        processes: [{ pid: 123, name: "llama-server", cpuPercent: 42, memoryBytes: 1_000_000_000 }],
        ts: Date.now(),
      }),
    });
    const { controller } = await renderApp(<SystemMonitorTab />, handlers);
    expect(screen.getByTestId("process-table").textContent).toMatch(/llama-server/);
    expect(screen.getByTestId("process-table").textContent).toMatch(/123/);
    controller.dispose();
  });

  it("shows a no-process message when nothing is running", async () => {
    const handlers = baselineHandlers({
      "monitor.collect": () => ({
        cpu: { overall: 10, perCore: [10] },
        ram: { used: 1e9, total: 8e9, percent: 12.5 },
        gpu: { detected: false, note: "GPU not detected" },
        processes: [],
        ts: Date.now(),
      }),
    });
    const { controller } = await renderApp(<SystemMonitorTab />, handlers);
    expect(screen.getByTestId("no-process").textContent).toMatch(/no llama.cpp process/i);
    controller.dispose();
  });
});
