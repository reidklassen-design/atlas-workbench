// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defaultConfig } from "@/config/defaults";
import { applyAgentProfile, defaultAgentRuntimeConfig, findAgentProfile } from "@/runtime/profiles";
import { buildServerArgs } from "@/process/flagBuilder";

describe("agent runtime profiles", () => {
  it("ships main, compression, and rescue profiles", () => {
    const runtime = defaultAgentRuntimeConfig();
    expect(runtime.activeProfileId).toBe("3090-ti-ornith-35b-96k-always-on");
    expect(runtime.profiles[0]?.modelPath).toContain("ornith-1.0-35b-Q4_K_M.gguf");
    expect(runtime.profiles[1]?.id).toBe("3090-ti-ornith-35b-125k-max-context");
    expect(runtime.profiles[2]?.modelPath).toContain("Qwen3.6-27B-Q4_K_M.gguf");
    expect(runtime.profiles[3]?.modelPath).toContain("ornith-1.0-9b-Q8_0.gguf");
    expect(runtime.profiles.map((profile) => profile.role)).toContain("main-coding");
    expect(runtime.profiles.map((profile) => profile.role)).toContain("compression");
    expect(runtime.profiles.map((profile) => profile.role)).toContain("rescue");
  });

  it("applies a profile to real llama.cpp server flags", () => {
    const config = applyAgentProfile(defaultConfig(), "3090-ti-ornith-35b-96k-always-on");
    const args = buildServerArgs(config);
    expect(config.agentRuntime.activeProfileId).toBe("3090-ti-ornith-35b-96k-always-on");
    expect(config.model.selectedModel).toContain("ornith-1.0-35b-Q4_K_M.gguf");
    expect(args[args.indexOf("--ctx-size") + 1]).toBe("98304");
    expect(args[args.indexOf("--batch-size") + 1]).toBe("1024");
    expect(args[args.indexOf("--ubatch-size") + 1]).toBe("256");
    expect(args[args.indexOf("--cache-type-k") + 1]).toBe("q8_0");
    expect(args[args.indexOf("--cache-type-v") + 1]).toBe("q8_0");
    expect(args[args.indexOf("--reasoning") + 1]).toBe("off");
    expect(args[args.indexOf("--reasoning-budget") + 1]).toBe("0");
    expect(args).toContain("--metrics");
    expect(args).toContain("--context-shift");
  });

  it("switches the selected model when applying alternate hardware profiles", () => {
    const maxContext = applyAgentProfile(defaultConfig(), "3090-ti-ornith-35b-125k-max-context");
    expect(maxContext.serverFlags["ctx-size"]).toBe(125000);

    const qwen = applyAgentProfile(defaultConfig(), "3090-ti-qwen-3-6-27b-96k-coder");
    expect(qwen.model.selectedModel).toBe("/home/reid/Downloads/Qwen3.6-27B-Q4_K_M.gguf");
    expect(qwen.serverFlags.alias).toBe("Qwen3.6-27B");

    const ornith9b = applyAgentProfile(defaultConfig(), "3090-ti-ornith-9b-64k-fast");
    expect(ornith9b.model.selectedModel).toContain("ornith-1.0-9b-Q8_0.gguf");
    expect(ornith9b.serverFlags.alias).toBe("Ornith1-9B");
  });

  it("falls back to the active profile when an unknown profile id is requested", () => {
    const config = defaultConfig();
    const profile = findAgentProfile(config, "missing-profile");
    expect(profile.id).toBe(config.agentRuntime.activeProfileId);
  });
});
