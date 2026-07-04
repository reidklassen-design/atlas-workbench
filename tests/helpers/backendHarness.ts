import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Backend } from "@/ipc/backend";
import { createConfigStore } from "@/config/configStore";
import { ProcessManager } from "@/process/processManager";
import { SystemMonitor } from "@/monitor/systemMonitor";
import { createErrorLog } from "@/errors/errorLog";
import { createNoGpuProbe } from "@/monitor/gpuProbe";
import { defaultConfig } from "@/config/defaults";
import type { AppConfig } from "@/config/types";

const here = dirname(fileURLToPath(import.meta.url));
export const FAKE_SERVER = join(here, "..", "fixtures", "fake-server.js");
export const FAKE_FINETUNE = join(here, "..", "fixtures", "fake-finetune.js");

export async function mkTempDir(prefix = "atlas-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function rmrf(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export interface BackendHarness {
  backend: Backend;
  tmpDir: string;
  configPath: string;
  logPath: string;
  cleanup: () => Promise<void>;
}

export async function makeBackend(opts: { config?: Partial<AppConfig>; withGpu?: boolean; env?: Record<string, string> } = {}): Promise<BackendHarness> {
  const tmpDir = await mkTempDir();
  const configPath = join(tmpDir, "config.json");
  const logPath = join(tmpDir, "error.log");
  const configStore = createConfigStore(configPath);
  const errorLog = createErrorLog(logPath);
  const processManager = new ProcessManager({ env: opts.env });
  const monitor = new SystemMonitor({ gpuProbe: opts.withGpu ? undefined : createNoGpuProbe("GPU not detected") });

  const base = defaultConfig();
  base.binaryPaths = { server: FAKE_SERVER, finetune: FAKE_FINETUNE };
  const config: AppConfig = {
    ...base,
    ...opts.config,
    binaryPaths: { ...base.binaryPaths, ...(opts.config?.binaryPaths ?? {}) },
    gpu: { ...base.gpu, ...(opts.config?.gpu ?? {}) },
    server: { ...base.server, ...(opts.config?.server ?? {}) },
    model: { ...base.model, ...(opts.config?.model ?? {}) },
    serverFlags: { ...base.serverFlags, ...(opts.config?.serverFlags ?? {}) },
    finetune: { ...base.finetune, ...(opts.config?.finetune ?? {}) },
    agentRuntime: {
      ...base.agentRuntime,
      ...(opts.config?.agentRuntime ?? {}),
      gateway: { ...base.agentRuntime.gateway, ...(opts.config?.agentRuntime?.gateway ?? {}) },
      profiles: opts.config?.agentRuntime?.profiles ?? base.agentRuntime.profiles,
    },
  };
  await configStore.save(config);

  const backend = new Backend({ configStore, processManager, monitor, errorLog });

  return {
    backend,
    tmpDir,
    configPath,
    logPath,
    cleanup: async () => {
      try {
        await backend.processManager.stop("server");
      } catch {
        // ignore
      }
      try {
        await backend.processManager.stop("finetune");
      } catch {
        // ignore
      }
      try {
        await backend.gateway.stop();
      } catch {
        // ignore
      }
      await rmrf(tmpDir);
    },
  };
}

export async function makeFile(dir: string, name: string, executable = false, content = "data"): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  if (executable) await chmod(path, 0o755);
  return path;
}

export async function makeGguf(dir: string, name: string): Promise<string> {
  return makeFile(dir, name, false, "gguf-model-data");
}

export async function makeSubDir(parent: string, name: string): Promise<string> {
  const path = join(parent, name);
  await mkdir(path, { recursive: true });
  return path;
}

export { join, dirname };
