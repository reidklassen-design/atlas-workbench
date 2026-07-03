import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createConfigStore } from "@/config/configStore";
import { defaultConfig, mergeConfigs } from "@/config/defaults";
import { SERVER_FLAGS, defaultServerFlags } from "@/config/flagCatalog";
import type { AppConfig } from "@/config/types";
import { mkTempDir, rmrf, join } from "./helpers/backendHarness";

describe("configStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkTempDir();
  });
  afterEach(async () => {
    await rmrf(dir);
  });

  it("returns defaults when no config file exists", async () => {
    const store = createConfigStore(join(dir, "config.json"));
    const config = await store.load();
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.port).toBe(8080);
    expect(config.binaryPaths.server).toBe("");
    expect(config.serverFlags["ctx-size"]).toBe(131072);
    expect(config.serverFlags["flash-attn"]).toBe("on");
    expect(config.serverFlags["cache-type-k"]).toBe("q8_0");
    expect(config.serverFlags["cache-type-v"]).toBe("q8_0");
    expect(config.gpu.offloadMode).toBe("auto");
  });

  it("round-trips a saved config", async () => {
    const path = join(dir, "config.json");
    const store = createConfigStore(path);
    const config = await store.load();
    config.server.host = "0.0.0.0";
    config.server.port = 1234;
    config.serverFlags["ctx-size"] = 4096;
    config.serverFlags["n-gpu-layers"] = 20;
    config.binaryPaths.server = "/usr/bin/llama-server";
    config.model.directory = "/models";
    config.model.selectedModel = "/models/foo.gguf";
    await store.save(config);

    const reloaded = await createConfigStore(path).load();
    expect(reloaded.server.host).toBe("0.0.0.0");
    expect(reloaded.server.port).toBe(1234);
    expect(reloaded.serverFlags["ctx-size"]).toBe(4096);
    expect(reloaded.serverFlags["n-gpu-layers"]).toBe(20);
    expect(reloaded.binaryPaths.server).toBe("/usr/bin/llama-server");
    expect(reloaded.model.selectedModel).toBe("/models/foo.gguf");
  });

  it("exists() reports false then true after save", async () => {
    const path = join(dir, "config.json");
    const store = createConfigStore(path);
    expect(await store.exists()).toBe(false);
    await store.save(await store.load());
    expect(await store.exists()).toBe(true);
  });

  it("reset removes the config file", async () => {
    const path = join(dir, "config.json");
    const store = createConfigStore(path);
    await store.save(await store.load());
    await store.reset();
    expect(await store.exists()).toBe(false);
  });

  it("preserves saved values when new flag defaults are added (backward compatible)", async () => {
    const base = defaultConfig();
    const saved: Partial<AppConfig> = {
      schemaVersion: 1,
      binaryPaths: { server: "/x/server", finetune: "" },
      server: { host: "1.2.3.4", port: 9999 },
      serverFlags: { "ctx-size": 8192 },
    };
    const merged = mergeConfigs(saved, base);
    expect(merged.serverFlags["ctx-size"]).toBe(8192);
    // new flags not present in saved appear with defaults
    expect(merged.serverFlags["n-gpu-layers"]).toBe(999);
    expect(merged.gpu.offloadMode).toBe("auto");
    expect(merged.server.host).toBe("1.2.3.4");
    expect(merged.binaryPaths.server).toBe("/x/server");
  });

  it("corrupted config falls back to defaults instead of crashing", async () => {
    const path = join(dir, "config.json");
    const { promises: fs } = await import("node:fs");
    await fs.writeFile(path, "{ not valid json", "utf8");
    const config = await createConfigStore(path).load();
    expect(config.server.host).toBe("127.0.0.1");
  });

  it("every catalog flag has a default in defaultServerFlags", () => {
    const defs = defaultServerFlags();
    for (const flag of SERVER_FLAGS) {
      expect(defs[flag.id]).toBeDefined();
    }
  });
});
