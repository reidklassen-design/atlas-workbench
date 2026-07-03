import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { AppError } from "@/config/types";

export const DEFAULT_LOG_DIR = join(homedir(), ".config", "atlas-workbench", "logs");
export const DEFAULT_ERROR_LOG_PATH = join(DEFAULT_LOG_DIR, "error.log");

export interface ErrorLog {
  path: string;
  append: (error: AppError) => Promise<void>;
  read: () => Promise<string>;
}

export function createErrorLog(logPath: string = DEFAULT_ERROR_LOG_PATH): ErrorLog {
  async function ensureDir(): Promise<void> {
    await fs.mkdir(dirname(logPath), { recursive: true });
  }

  return {
    path: logPath,
    async append(error: AppError): Promise<void> {
      await ensureDir();
      const entry = JSON.stringify({
        id: error.id,
        ts: error.ts,
        scope: error.scope,
        title: error.title,
        message: error.message,
        fix: error.fix,
        exitCode: error.exitCode ?? null,
        stderrTail: error.stderrTail ?? null,
      }) + "\n";
      await fs.appendFile(logPath, entry, "utf8");
    },
    async read(): Promise<string> {
      try {
        return await fs.readFile(logPath, "utf8");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return "";
        throw err;
      }
    },
  };
}
