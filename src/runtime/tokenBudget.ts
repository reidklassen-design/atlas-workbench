import type { AgentRequestPolicy } from "@/config/types";

export interface TokenBudgetInput {
  systemText?: string;
  promptText?: string;
  fileTexts?: string[];
  logText?: string;
  requestedOutputTokens?: number;
}

export interface TokenBudgetResult {
  ok: boolean;
  estimatedPromptTokens: number;
  requestedOutputTokens: number;
  usablePromptTokens: number;
  overflowTokens: number;
  action: "forward" | "reject" | "compress" | "retrieve";
  reasons: string[];
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const wordish = trimmed.split(/\s+/).filter(Boolean).length;
  const charEstimate = Math.ceil(trimmed.length / 4);
  return Math.max(wordish, charEstimate);
}

export function usablePromptTokens(policy: AgentRequestPolicy): number {
  return Math.max(
    0,
    policy.contextWindowTokens -
      policy.reservedOutputTokens -
      policy.reservedSystemTokens -
      policy.safetyMarginTokens,
  );
}

export function evaluateTokenBudget(input: TokenBudgetInput, policy: AgentRequestPolicy): TokenBudgetResult {
  const systemTokens = estimateTokens(input.systemText ?? "");
  const promptTokens = estimateTokens(input.promptText ?? "");
  const fileTokens = (input.fileTexts ?? []).reduce((total, text) => total + estimateTokens(text), 0);
  const logTokens = estimateTokens(input.logText ?? "");
  const estimatedPromptTokens = systemTokens + promptTokens + fileTokens + logTokens;
  const requestedOutputTokens = Math.min(
    Math.max(0, input.requestedOutputTokens ?? policy.maxOutputTokens),
    policy.maxOutputTokens,
  );
  const usable = Math.min(policy.maxPromptTokens, usablePromptTokens(policy));
  const reasons: string[] = [];

  if (fileTokens > policy.maxSingleFileTokens) {
    reasons.push(`File context is ${fileTokens} tokens; profile allows ${policy.maxSingleFileTokens}.`);
  }
  if (logTokens > policy.maxLogTokens) {
    reasons.push(`Log context is ${logTokens} tokens; profile allows ${policy.maxLogTokens}.`);
  }
  if (requestedOutputTokens > policy.reservedOutputTokens) {
    reasons.push(`Requested output needs ${requestedOutputTokens} tokens; profile reserves ${policy.reservedOutputTokens}.`);
  }

  const overflowTokens = Math.max(0, estimatedPromptTokens - usable);
  if (overflowTokens > 0) {
    reasons.push(`Prompt estimate exceeds usable context by ${overflowTokens} tokens.`);
  }

  const ok = overflowTokens === 0 && fileTokens <= policy.maxSingleFileTokens && logTokens <= policy.maxLogTokens;
  let action: TokenBudgetResult["action"] = "forward";
  if (!ok) {
    action = policy.overloadBehavior;
  }

  return {
    ok,
    estimatedPromptTokens,
    requestedOutputTokens,
    usablePromptTokens: usable,
    overflowTokens,
    action,
    reasons,
  };
}
