// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SystemMonitor } from "@/monitor/systemMonitor";
import { createNoGpuProbe, createStaticGpuProbe } from "@/monitor/gpuProbe";

describe("SystemMonitor", () => {
  it("collects CPU and RAM metrics that update over time", async () => {
    const monitor = new SystemMonitor({ gpuProbe: createNoGpuProbe("GPU not detected"), initialDelayMs: 10 });
    const first = await monitor.collect();
    expect(first.cpu.overall).toBeGreaterThanOrEqual(0);
    expect(first.cpu.perCore.length).toBeGreaterThan(0);
    expect(first.ram.total).toBeGreaterThan(0);
    expect(first.ram.used).toBeGreaterThanOrEqual(0);
    await new Promise((r) => setTimeout(r, 120));
    const second = await monitor.collect();
    expect(second.ts).toBeGreaterThanOrEqual(first.ts);
    // values are real and within valid ranges
    expect(second.cpu.overall).toBeLessThanOrEqual(100);
    expect(second.ram.percent).toBeGreaterThan(0);
    expect(second.ram.percent).toBeLessThanOrEqual(100);
  });

  it("reports 'GPU not detected' when no GPU probe finds one", async () => {
    const monitor = new SystemMonitor({ gpuProbe: createNoGpuProbe("GPU not detected") });
    const metrics = await monitor.collect();
    expect(metrics.gpu.detected).toBe(false);
    expect(metrics.gpu.note).toMatch(/GPU not detected/i);
  });

  it("reports GPU metrics when a GPU is present", async () => {
    const monitor = new SystemMonitor({
      gpuProbe: createStaticGpuProbe({ detected: true, name: "Test GPU", usagePercent: 42, memoryUsed: 1000, memoryTotal: 8000, temperatureCelsius: 61 }),
    });
    const metrics = await monitor.collect();
    expect(metrics.gpu.detected).toBe(true);
    expect(metrics.gpu.name).toBe("Test GPU");
    expect(metrics.gpu.usagePercent).toBe(42);
    expect(metrics.gpu.temperatureCelsius).toBe(61);
  });

  it("reports child process resource usage via injected /proc reads", async () => {
    const fakeFiles = new Map<string, string>();
    fakeFiles.set("/proc/123/stat", `0 (llama-server) S 1 1 1 0 -1 4194304 100 0 0 0 ${2500} ${1500} 0 0 20 0 1 0 100 0 0`);
    fakeFiles.set("/proc/123/statm", `0 1000 800 0 0 0 0`);
    const readFile = async (p: string) => fakeFiles.get(p) ?? null;
    const monitor = new SystemMonitor({ gpuProbe: createNoGpuProbe(), readFile, initialDelayMs: 5 });
    const first = await monitor.collect([{ pid: 123, name: "llama-server" }]);
    expect(first.processes.length).toBe(1);
    expect(first.processes[0].name).toBe("llama-server");
    expect(first.processes[0].memoryBytes).toBe(1000 * 4096);
    // bump utime and take a second sample to see a CPU percentage
    fakeFiles.set("/proc/123/stat", `0 (llama-server) S 1 1 1 0 -1 4194304 100 0 0 0 ${3500} ${1500} 0 0 20 0 1 0 100 0 0`);
    await new Promise((r) => setTimeout(r, 60));
    const second = await monitor.collect([{ pid: 123, name: "llama-server" }]);
    expect(second.processes[0].cpuPercent).toBeGreaterThanOrEqual(0);
  });

  it("handles a vanished process gracefully", async () => {
    const readFile = async () => null;
    const monitor = new SystemMonitor({ gpuProbe: createNoGpuProbe(), readFile, initialDelayMs: 5 });
    const metrics = await monitor.collect([{ pid: 999, name: "llama-server" }]);
    expect(metrics.processes.length).toBe(1);
    expect(metrics.processes[0].memoryBytes).toBe(0);
  });
});
