// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compressOpenAiRequest } from "@/runtime/compression";
import { evaluateTokenBudget } from "@/runtime/tokenBudget";
import { defaultConfig } from "@/config/defaults";
import { findAgentProfile } from "@/runtime/profiles";

describe("automatic prompt compression", () => {
  it("compresses oversized chat requests under the active profile budget", () => {
    const profile = findAgentProfile(defaultConfig());
    const huge = "token ".repeat(140000);
    const compressed = compressOpenAiRequest(
      {
        model: "atlas/local",
        messages: [
          { role: "system", content: "You are a coding agent." },
          { role: "user", content: huge },
        ],
        max_tokens: 1024,
      },
      profile.requestPolicy.maxPromptTokens,
    );

    expect(compressed.compressed).toBe(true);
    expect(compressed.estimatedAfterTokens).toBeLessThan(compressed.estimatedBeforeTokens);
    const budget = evaluateTokenBudget(
      {
        systemText: "You are a coding agent.",
        promptText: JSON.stringify(compressed.body.messages),
        requestedOutputTokens: 1024,
      },
      profile.requestPolicy,
    );
    expect(budget.ok).toBe(true);
  });

  it("summarizes older messages and keeps recent turns", () => {
    const profile = findAgentProfile(defaultConfig());
    const messages = Array.from({ length: 12 }, (_, i) => ({ role: "user", content: `turn ${i} ${"detail ".repeat(2000)}` }));
    const compressed = compressOpenAiRequest({ messages }, profile.requestPolicy.maxPromptTokens);

    expect(compressed.compressed).toBe(true);
    expect(JSON.stringify(compressed.body)).toContain("Atlas automatic compression summary");
    expect((compressed.body.messages as unknown[]).length).toBeLessThan(messages.length);
  });
});
