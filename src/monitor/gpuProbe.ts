import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { GpuMetrics } from "@/config/types";

const execFileAsync = promisify(execFile);

export interface GpuProbe {
  detect(): Promise<GpuMetrics>;
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return null;
  }
}

function trimLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

async function queryNvidiaSmi(): Promise<GpuMetrics | null> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total",
      "--format=csv,noheader,nounits",
    ], { timeout: 1500 });
    const line = trimLines(stdout)[0];
    if (!line) return null;
    const parts = line.split(",").map((part) => part.trim());
    if (!parts[0]) return null;
    return {
      detected: true,
      name: parts[0],
      usagePercent: parts[1] ? Number(parts[1]) : undefined,
      temperatureCelsius: parts[2] ? Number(parts[2]) : undefined,
      memoryUsed: parts[3] ? Number(parts[3]) * 1024 * 1024 : undefined,
      memoryTotal: parts[4] ? Number(parts[4]) * 1024 * 1024 : undefined,
      note: "Detected with nvidia-smi",
    };
  } catch {
    return null;
  }
}

async function readHwmonTemperatureCelsius(devicePath: string, readFile: (p: string) => Promise<string | null>): Promise<number | undefined> {
  try {
    const entries = await fs.readdir(`${devicePath}/hwmon`);
    for (const entry of entries) {
      const raw = await readFile(`${devicePath}/hwmon/${entry}/temp1_input`);
      const milliCelsius = raw ? Number(trimLines(raw)[0]) : NaN;
      if (Number.isFinite(milliCelsius)) return milliCelsius / 1000;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Detect a GPU and read utilization, temperature, and memory counters.
 * NVIDIA systems use nvidia-smi for the counters the kernel does not expose
 * consistently; other GPUs fall back to sysfs/procfs where available.
 */
export function createLinuxGpuProbe(readFile: (p: string) => Promise<string | null> = readFileSafe): GpuProbe {
  return {
    async detect(): Promise<GpuMetrics> {
      const nvidiaSmi = await queryNvidiaSmi();
      if (nvidiaSmi) return nvidiaSmi;

      // NVIDIA presence via procfs (no nvidia-smi invocation).
      const nvidiaInfo = await readFile("/proc/driver/nvidia/gpus/0000:01:00.0/information");
      if (nvidiaInfo) {
        const nameMatch = nvidiaInfo.match(/Model:\s*(.+)/);
        return {
          detected: true,
          name: nameMatch ? nameMatch[1].trim() : "NVIDIA GPU",
          note: "NVIDIA GPU detected. Utilization requires the vendor driver counters.",
        };
      }

      // AMD / Intel / generic DRM cards via sysfs.
      const drmBase = "/sys/class/drm";
      let cards: string[] = [];
      try {
        const entries = await fs.readdir(drmBase);
        cards = entries.filter((e) => /^card\d+$/.test(e));
      } catch {
        cards = [];
      }

      for (const card of cards) {
        const uevent = await readFile(`${drmBase}/${card}/device/uevent`);
        if (!uevent) continue;
        const isRenderGpu = /DRIVER=amdgpu|DRIVER=i915|DRIVER=xe|DRIVER=nvidia/.test(uevent) || /DRIVER=amdgpu/.test(uevent);
        if (!isRenderGpu) continue;
        const nameFile = await readFile(`${drmBase}/${card}/device/product_name`);
        const busy = await readFile(`${drmBase}/${card}/device/gpu_busy_percent`);
        const memBusy = await readFile(`${drmBase}/${card}/device/mem_info_vram_used`);
        const memTotal = await readFile(`${drmBase}/${card}/device/mem_info_vram_total`);
        const temperatureCelsius = await readHwmonTemperatureCelsius(`${drmBase}/${card}/device`, readFile);
        const name = nameFile ? trimLines(nameFile)[0] ?? "GPU" : "GPU";
        return {
          detected: true,
          name,
          usagePercent: busy ? Number(trimLines(busy)[0]) : undefined,
          memoryUsed: memBusy ? Number(trimLines(memBusy)[0]) : undefined,
          memoryTotal: memTotal ? Number(trimLines(memTotal)[0]) : undefined,
          temperatureCelsius,
        };
      }

      return { detected: false, note: "GPU not detected" };
    },
  };
}

/** A probe that always reports no GPU (used on machines without one and in tests). */
export function createNoGpuProbe(note = "GPU not detected"): GpuProbe {
  return {
    async detect(): Promise<GpuMetrics> {
      return { detected: false, note };
    },
  };
}

/** A probe that reports a specific GPU (used in tests to exercise the present path). */
export function createStaticGpuProbe(metrics: GpuMetrics): GpuProbe {
  return {
    async detect(): Promise<GpuMetrics> {
      return { ...metrics };
    },
  };
}

export const _diagnosticHomedir = homedir();
