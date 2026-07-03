import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { CONFIG_SCHEMA_VERSION, defaultConfig, mergeConfigs } from "./defaults";
import type { AppConfig } from "./types";

export const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "atlas-workbench");
export const DEFAULT_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, "config.json");

export interface ConfigStore {
  path: string;
  load: () => Promise<AppConfig>;
  save: (config: AppConfig) => Promise<void>;
  exists: () => Promise<boolean>;
  reset: () => Promise<void>;
}

export function createConfigStore(configPath: string = DEFAULT_CONFIG_PATH): ConfigStore {
  async function ensureDir(): Promise<void> {
    await fs.mkdir(dirname(configPath), { recursive: true });
  }

  return {
    path: configPath,

    async load(): Promise<AppConfig> {
      try {
        const raw = await fs.readFile(configPath, "utf8");
        const parsed = JSON.parse(raw) as Partial<AppConfig>;
        return mergeConfigs(parsed, defaultConfig());
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return defaultConfig();
        if (err instanceof SyntaxError) {
          return defaultConfig();
        }
        throw err;
      }
    },

    async save(config: AppConfig): Promise<void> {
      await ensureDir();
      const toWrite: AppConfig = { ...config, schemaVersion: CONFIG_SCHEMA_VERSION };
      const tmp = `${configPath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(toWrite, null, 2), "utf8");
      await fs.rename(tmp, configPath);
    },

    async exists(): Promise<boolean> {
      try {
        await fs.access(configPath);
        return true;
      } catch {
        return false;
      }
    },

    async reset(): Promise<void> {
      try {
        await fs.unlink(configPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
    },
  };
}
