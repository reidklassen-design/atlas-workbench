import { promises as fs } from "node:fs";
import { realpath } from "node:fs/promises";
import { access } from "node:fs/promises";

export interface BinaryValidationResult {
  path: string;
  resolved?: string;
  ok: boolean;
  reason?: string;
}

/**
 * Validate that a path points to an existing, executable file. Symlinks are
 * resolved to their target. Returns a plain-language reason on failure so the
 * UI can surface it directly to the user.
 */
export async function validateBinary(path: string): Promise<BinaryValidationResult> {
  const trimmed = path.trim();
  if (!trimmed) {
    return { path, ok: false, reason: "No path was provided. Choose the llama.cpp server or finetune binary." };
  }
  try {
    const stat = await fs.stat(trimmed);
    if (stat.isDirectory()) {
      return { path: trimmed, ok: false, reason: `“${trimmed}” is a folder, not an executable file. Select the binary file itself.` };
    }
    if (!stat.isFile()) {
      return { path: trimmed, ok: false, reason: `“${trimmed}” is not a regular file.` };
    }
    await access(trimmed, fs.constants.X_OK);
    let resolved: string | undefined;
    try {
      resolved = await realpath(trimmed);
    } catch {
      resolved = trimmed;
    }
    return { path: trimmed, resolved, ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { path: trimmed, ok: false, reason: `“${trimmed}” was not found. Check the path and try again.` };
    }
    if (code === "EACCES") {
      return { path: trimmed, ok: false, reason: `“${trimmed}” is not executable. Run chmod +x on it or pick a different file.` };
    }
    return { path: trimmed, ok: false, reason: `Could not access “${trimmed}”: ${code ?? "unknown error"}` };
  }
}
