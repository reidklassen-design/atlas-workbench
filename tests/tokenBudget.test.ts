// @vitest-environment node
import { describe, expect, it } from "vitest";
import { findAgentProfile } from "@/runtime/profiles";
import { evaluateTokenBudget, estimateTokens, usablePromptTokens } from "@/runtime/tokenBudget";
import { defaultConfig } from "@/config/defaults";

describe("token budget policy", () => {
  it("estimates tokens conservatively from text", () => {
    expect(estimateTokens("one two three four")).toBeGreaterThanOrEqual(4);
    expect(estimateTokens("")).toBe(0);
  });

  it("computes usable prompt budget after output, system, and safety reserves", () => {
    const policy = findAgentProfile(defaultConfig()).requestPolicy;
    expect(usablePromptTokens(policy)).toBe(77824);
  });

  it("allows bounded coding requests through", () => {
    const policy = findAgentProfile(defaultConfig()).requestPolicy;
    const result = evaluateTokenBudget(
      {
        systemText: "You are a local coding agent.",
        promptText: "Fix the failing test.",
        fileTexts: ["export function add(a: number, b: number) { return a + b; }"],
        requestedOutputTokens: 2048,
      },
      policy,
    );
    expect(result.ok).toBe(true);
    expect(result.action).toBe("forward");
    expect(result.reasons).toEqual([]);
  });

  it("blocks oversized requests before they reach llama.cpp", () => {
    const policy = findAgentProfile(defaultConfig()).requestPolicy;
    const hugeText = "token ".repeat(usablePromptTokens(policy) + 1000);
    const result = evaluateTokenBudget({ promptText: hugeText }, policy);
    expect(result.ok).toBe(false);
    expect(result.action).toBe("reject");
    expect(result.overflowTokens).toBeGreaterThan(0);
    expect(result.reasons.join(" ")).toMatch(/exceeds usable context/i);
  });

  it("routes compression profile overloads to compression policy", () => {
    const runtime = defaultConfig().agentRuntime;
    const compression = findAgentProfile(runtime, "compression-sidecar");
    const hugeLog = "line\n".repeat(compression.requestPolicy.maxLogTokens + 1000);
    const result = evaluateTokenBudget({ logText: hugeLog }, compression.requestPolicy);
    expect(result.ok).toBe(false);
    expect(result.action).toBe("compress");
  });
});
