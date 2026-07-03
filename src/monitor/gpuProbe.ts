import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import type { GpuMetrics } from "@/config/types";

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

/**
 * Detect a GPU and read whatever utilization/memory metrics the Linux kernel
 * exposes through sysfs/procfs. No external processes are spawned, honoring
 * the system-monitor spec constraint. When no GPU is found, a clear
 * "GPU not detected" result is returned.
 */
export function createLinuxGpuProbe(readFile: (p: string) => Promise<string | null> = readFileSafe): GpuProbe {
  return {
    async detect(): Promise<GpuMetrics> {
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
        const name = nameFile ? trimLines(nameFile)[0] ?? "GPU" : "GPU";
        return {
          detected: true,
          name,
          usagePercent: busy ? Number(trimLines(busy)[0]) : undefined,
          memoryUsed: memBusy ? Number(trimLines(memBusy)[0]) : undefined,
          memoryTotal: memTotal ? Number(trimLines(memTotal)[0]) : undefined,
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
