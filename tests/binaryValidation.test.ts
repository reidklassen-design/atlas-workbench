import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateBinary } from "@/config/binaryValidation";
import { mkTempDir, rmrf, makeFile, join, FAKE_SERVER } from "./helpers/backendHarness";

describe("validateBinary", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkTempDir();
  });
  afterEach(async () => {
    await rmrf(dir);
  });

  it("accepts an existing executable file", async () => {
    const result = await validateBinary(FAKE_SERVER);
    expect(result.ok).toBe(true);
    expect(result.resolved).toBeDefined();
  });

  it("rejects a nonexistent file with a plain-language reason", async () => {
    const result = await validateBinary(join(dir, "missing-binary"));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not found/i);
  });

  it("rejects a non-executable file", async () => {
    const file = await makeFile(dir, "notexec", false);
    const result = await validateBinary(file);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not executable|executable/i);
  });

  it("rejects a directory with a clear message", async () => {
    const result = await validateBinary(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/folder|directory/i);
  });

  it("rejects an empty path", async () => {
    const result = await validateBinary("");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no path/i);
  });

  it("handles paths with spaces", async () => {
    const file = await makeFile(dir, "with space.sh", true);
    const result = await validateBinary(file);
    expect(result.ok).toBe(true);
  });

  it("resolves symlinks to their target", async () => {
    const target = await makeFile(dir, "real-binary", true);
    const link = join(dir, "link-binary");
    const { symlink } = await import("node:fs/promises");
    await symlink(target, link);
    const result = await validateBinary(link);
    expect(result.ok).toBe(true);
    expect(result.resolved).toBe(target);
  });
});
