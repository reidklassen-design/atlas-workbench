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
    expect(config.server.port).toBe(8099);
    expect(config.binaryPaths.server).toBe("/home/reid/.local/bin/llama-server");
    expect(config.model.selectedModel).toContain("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf");
    expect(config.serverFlags.alias).toBe("Qwen3-Coder-30B-A3B");
    expect(config.serverFlags["ctx-size"]).toBe(188000);
    expect(config.serverFlags["flash-attn"]).toBe("on");
    expect(config.serverFlags["cache-type-k"]).toBe("q4_0");
    expect(config.serverFlags["cache-type-v"]).toBe("q4_0");
    expect(config.systemPrompt).toBe("");
    expect(config.gpu.offloadMode).toBe("full");
    expect(config.agentRuntime.activeProfileId).toBe("3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu");
    expect(config.agentRuntime.gateway.host).toBe("0.0.0.0");
    expect(config.agentRuntime.gateway.port).toBe(18080);
    expect(config.agentRuntime.profiles.some((profile) => profile.id === "compression-sidecar")).toBe(true);
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
    config.systemPrompt = "You are Atlas.";
    config.model.directory = "/models";
    config.model.selectedModel = "/models/foo.gguf";
    await store.save(config);

    const reloaded = await createConfigStore(path).load();
    expect(reloaded.server.host).toBe("0.0.0.0");
    expect(reloaded.server.port).toBe(1234);
    expect(reloaded.serverFlags["ctx-size"]).toBe(4096);
    expect(reloaded.serverFlags["n-gpu-layers"]).toBe(20);
    expect(reloaded.binaryPaths.server).toBe("/usr/bin/llama-server");
    expect(reloaded.systemPrompt).toBe("You are Atlas.");
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
      systemPrompt: "Stay terse.",
      serverFlags: { "ctx-size": 8192 },
    };
    const merged = mergeConfigs(saved, base);
    expect(merged.serverFlags["ctx-size"]).toBe(8192);
    // new flags not present in saved appear with defaults
    expect(merged.serverFlags["n-gpu-layers"]).toBe(999);
    expect(merged.gpu.offloadMode).toBe("full");
    expect(merged.server.host).toBe("1.2.3.4");
    expect(merged.systemPrompt).toBe("Stay terse.");
    expect(merged.binaryPaths.server).toBe("/x/server");
    expect(merged.agentRuntime.activeProfileId).toBe("3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu");
    expect(merged.agentRuntime.profiles.length).toBeGreaterThan(0);
  });

  it("refreshes stale optimized runtime profiles to the current main coder", async () => {
    const base = defaultConfig();
    const stale: AppConfig = JSON.parse(JSON.stringify(base));
    stale.gpu.optimizedProfileVersion = 7;
    stale.model.selectedModel = "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF/ornith-1.0-35b-Q4_K_M.gguf";
    stale.agentRuntime.activeProfileId = "3090-ti-ornith-35b-96k-always-on";
    stale.agentRuntime.gateway.modelAlias = "Ornith1";
    stale.agentRuntime.profiles = [
      {
        ...base.agentRuntime.profiles[3],
        id: "3090-ti-ornith-35b-96k-always-on",
        name: "3090 Ti Ornith 35B 96K Always-On",
        modelPath: "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF/ornith-1.0-35b-Q4_K_M.gguf",
      },
    ];

    const merged = mergeConfigs(stale, base);

    expect(merged.gpu.optimizedProfileVersion).toBe(9);
    expect(merged.agentRuntime.activeProfileId).toBe("3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu");
    expect(merged.agentRuntime.gateway.modelAlias).toBe("Qwen3-Coder-30B-A3B");
    expect(merged.agentRuntime.profiles[0]?.id).toBe("3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu");
    expect(merged.agentRuntime.profiles[1]?.id).toBe("3090-ti-qwen3-coder-30b-a3b-q4-xl-262k-max-context");
    expect(merged.agentRuntime.profiles[2]?.id).toBe("3090-ti-qwen3-coder-30b-a3b-q4-xl-131k-headroom");
    expect(merged.model.selectedModel).toContain("Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf");
    expect(merged.serverFlags["ctx-size"]).toBe(188000);
    expect(merged.serverFlags["batch-size"]).toBe(1024);
    expect(merged.serverFlags["ubatch-size"]).toBe(256);
    expect(merged.serverFlags["cache-type-k"]).toBe("q4_0");
    expect(merged.serverFlags["cache-type-v"]).toBe("q4_0");
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
