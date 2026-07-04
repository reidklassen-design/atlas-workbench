import { estimateTokens } from "@/runtime/tokenBudget";

export interface CompressionResult {
  body: Record<string, unknown>;
  compressed: boolean;
  estimatedBeforeTokens: number;
  estimatedAfterTokens: number;
  note: string;
}

function cloneBody(body: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

function clipText(text: string, targetTokens: number): string {
  if (estimateTokens(text) <= targetTokens) return text;
  const charBudget = Math.max(400, targetTokens * 4);
  if (text.length <= charBudget) return text;
  const headChars = Math.floor(charBudget * 0.58);
  const tailChars = Math.floor(charBudget * 0.32);
  const omittedChars = Math.max(0, text.length - headChars - tailChars);
  return [
    text.slice(0, headChars).trimEnd(),
    "",
    `[Atlas automatic compression: omitted ${omittedChars} middle characters to keep this local request inside the active context budget.]`,
    "",
    text.slice(text.length - tailChars).trimStart(),
  ].join("\n");
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") return (item as { text: string }).text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function estimateOpenAiBody(body: Record<string, unknown>): number {
  const parts: string[] = [];
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (message && typeof message === "object") parts.push(textFromContent((message as Record<string, unknown>).content));
    }
  }
  if (typeof body.prompt === "string") parts.push(body.prompt);
  return estimateTokens(parts.join("\n"));
}

export function compressOpenAiRequest(body: Record<string, unknown>, usablePromptTokens: number): CompressionResult {
  const estimatedBeforeTokens = estimateOpenAiBody(body);
  const targetTokens = Math.max(1024, Math.floor(usablePromptTokens * 0.82));
  const next = cloneBody(body);
  let compressed = false;

  if (typeof next.prompt === "string") {
    const clipped = clipText(next.prompt, targetTokens);
    compressed = clipped !== next.prompt;
    next.prompt = clipped;
  }

  if (Array.isArray(next.messages)) {
    const messages = next.messages.filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === "object");
    const systemMessages = messages.filter((message) => message.role === "system" || message.role === "developer");
    const conversationMessages = messages.filter((message) => message.role !== "system" && message.role !== "developer");
    const recentMessages = conversationMessages.slice(-6);
    const olderMessages = conversationMessages.slice(0, Math.max(0, conversationMessages.length - recentMessages.length));
    const olderText = olderMessages
      .map((message) => `${String(message.role ?? "message")}: ${textFromContent(message.content)}`)
      .filter((text) => estimateTokens(text) > 0)
      .join("\n\n");
    const perRecentBudget = Math.max(768, Math.floor(targetTokens / Math.max(2, recentMessages.length + 2)));
    const compressedMessages: Record<string, unknown>[] = [...systemMessages];

    if (olderText) {
      compressed = true;
      compressedMessages.push({
        role: "developer",
        content: [
          "Atlas automatic compression summary of older conversation context.",
          clipText(olderText, Math.max(1024, Math.floor(targetTokens * 0.22))),
        ].join("\n\n"),
      });
    }

    for (const message of recentMessages) {
      const original = textFromContent(message.content);
      const clipped = clipText(original, perRecentBudget);
      if (clipped !== original) compressed = true;
      compressedMessages.push({ ...message, content: clipped });
    }
    next.messages = compressedMessages;
  }

  const estimatedAfterTokens = estimateOpenAiBody(next);
  return {
    body: next,
    compressed,
    estimatedBeforeTokens,
    estimatedAfterTokens,
    note: compressed
      ? `Compressed prompt estimate from ${estimatedBeforeTokens} to ${estimatedAfterTokens} tokens.`
      : "Request did not require compression.",
  };
}
