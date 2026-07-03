import { cpus, freemem, totalmem } from "node:os";
import { createLinuxGpuProbe, type GpuProbe } from "./gpuProbe";
import type { CpuMetrics, ProcessResource, RamMetrics, SystemMetrics } from "@/config/types";

const CLK_TCK = 100;
const PAGE_SIZE = 4096;

interface CpuSample {
  perCore: { idle: number; total: number }[];
  ts: number;
}

interface ProcSample {
  utime: number;
  stime: number;
  ts: number;
}

export interface SystemMonitorOptions {
  gpuProbe?: GpuProbe;
  readFile?: (p: string) => Promise<string | null>;
  initialDelayMs?: number;
}

function readCpus(): { idle: number; total: number }[] {
  return cpus().map((c) => {
    const { user, nice, sys, idle, irq } = c.times;
    const total = user + nice + sys + idle + irq;
    return { idle, total };
  });
}

function deltaCpu(prev: CpuSample, curr: CpuSample): CpuMetrics {
  const perCore: number[] = [];
  const n = Math.min(prev.perCore.length, curr.perCore.length);
  for (let i = 0; i < n; i++) {
    const dTotal = curr.perCore[i].total - prev.perCore[i].total;
    const dIdle = curr.perCore[i].idle - prev.perCore[i].idle;
    if (dTotal <= 0) {
      perCore.push(0);
      continue;
    }
    const used = ((dTotal - dIdle) / dTotal) * 100;
    perCore.push(Math.max(0, Math.min(100, used)));
  }
  const overall = perCore.length ? perCore.reduce((a, b) => a + b, 0) / perCore.length : 0;
  return { overall, perCore };
}

export class SystemMonitor {
  private gpuProbe: GpuProbe;
  private readFile: (p: string) => Promise<string | null>;
  private prevCpu: CpuSample | null = null;
  private prevProc = new Map<number, ProcSample>();
  private initialDelayMs: number;

  constructor(opts: SystemMonitorOptions = {}) {
    this.gpuProbe = opts.gpuProbe ?? createLinuxGpuProbe(opts.readFile);
    this.readFile = opts.readFile ?? (async () => null);
    this.initialDelayMs = opts.initialDelayMs ?? 100;
  }

  private async sampleCpu(): Promise<CpuMetrics> {
    if (!this.prevCpu) {
      const first = { perCore: readCpus(), ts: Date.now() };
      await new Promise((r) => setTimeout(r, this.initialDelayMs));
      const second = { perCore: readCpus(), ts: Date.now() };
      this.prevCpu = second;
      return deltaCpu(first, second);
    }
    const curr = { perCore: readCpus(), ts: Date.now() };
    const result = deltaCpu(this.prevCpu, curr);
    this.prevCpu = curr;
    return result;
  }

  private sampleRam(): RamMetrics {
    const total = totalmem();
    const free = freemem();
    const used = total - free;
    return { used, total, percent: total > 0 ? (used / total) * 100 : 0 };
  }

  private async readProcessResource(pid: number, name: string): Promise<ProcessResource> {
    const statRaw = await this.readFile(`/proc/${pid}/stat`);
    const statmRaw = await this.readFile(`/proc/${pid}/statm`);
    let utime = 0;
    let stime = 0;
    let memoryBytes = 0;
    if (statmRaw) {
      const parts = statmRaw.trim().split(/\s+/);
      const resident = Number(parts[1] ?? 0);
      memoryBytes = resident * PAGE_SIZE;
    }
    if (statRaw) {
      // /proc/<pid>/stat fields after comm are 1-indexed from the comm field's closing paren.
      const commEnd = statRaw.lastIndexOf(")");
      const afterComm = statRaw.slice(commEnd + 1).trim().split(/\s+/);
      utime = Number(afterComm[11] ?? 0); // field 14 -> index 11 after comm
      stime = Number(afterComm[12] ?? 0); // field 15 -> index 12 after comm
    }
    const now = Date.now();
    const ticks = utime + stime;
    const prev = this.prevProc.get(pid);
    let cpuPercent = 0;
    if (prev) {
      const dTicks = ticks - (prev.utime + prev.stime);
      const dt = (now - prev.ts) / 1000;
      if (dt > 0) cpuPercent = (dTicks / CLK_TCK / dt) * 100;
    }
    this.prevProc.set(pid, { utime, stime, ts: now });
    return { pid, name, cpuPercent: Math.max(0, cpuPercent), memoryBytes };
  }

  async collect(pids: { pid: number; name: string }[] = []): Promise<SystemMetrics> {
    const [cpu, ram, gpu] = await Promise.all([this.sampleCpu(), Promise.resolve(this.sampleRam()), this.gpuProbe.detect()]);
    const processes: ProcessResource[] = [];
    for (const { pid, name } of pids) {
      try {
        processes.push(await this.readProcessResource(pid, name));
      } catch {
        // process vanished between samples; skip it
      }
    }
    return { cpu, ram, gpu, processes, ts: Date.now() };
  }

  reset(): void {
    this.prevCpu = null;
    this.prevProc.clear();
  }
}
