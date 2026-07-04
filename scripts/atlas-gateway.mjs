#!/usr/bin/env node
import http from "node:http";
import { readFileSync } from "node:fs";

const CONFIG_PATH = process.env.ATLAS_CONFIG ?? `${process.env.HOME}/.config/atlas-workbench/config.json`;
const DEFAULT_GATEWAY_PORT = 18080;
const DEFAULT_UPSTREAM_PORT = 8099;

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function clientHost(host) {
  const trimmed = String(host ?? "").trim();
  return !trimmed || trimmed === "0.0.0.0" || trimmed === "::" || trimmed === "*" ? "127.0.0.1" : trimmed.replace(/^\[|\]$/g, "");
}

function estimateTokens(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return 0;
  return Math.max(trimmed.split(/\s+/).filter(Boolean).length, Math.ceil(trimmed.length / 4));
}

function textFromContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromContent).join("\n");
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    return Object.values(value).map(textFromContent).join("\n");
  }
  return "";
}

function estimateBody(body) {
  const parts = [];
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) parts.push(textFromContent(message?.content));
  }
  if (typeof body.prompt === "string") parts.push(body.prompt);
  return estimateTokens(parts.join("\n"));
}

function activeProfile(config) {
  const runtime = config.agentRuntime ?? {};
  const id = runtime.activeProfileId;
  return runtime.profiles?.find((profile) => profile.id === id) ?? runtime.profiles?.[0] ?? {};
}

function maxPromptTokens(config) {
  return activeProfile(config).requestPolicy?.maxPromptTokens ?? 77824;
}

function clipText(text, targetTokens) {
  if (estimateTokens(text) <= targetTokens) return text;
  const charBudget = Math.max(400, targetTokens * 4);
  if (text.length <= charBudget) return text;
  const headChars = Math.floor(charBudget * 0.58);
  const tailChars = Math.floor(charBudget * 0.32);
  const omitted = Math.max(0, text.length - headChars - tailChars);
  return [
    text.slice(0, headChars).trimEnd(),
    "",
    `[Atlas automatic compression: omitted ${omitted} middle characters to keep this local request inside the active context budget.]`,
    "",
    text.slice(text.length - tailChars).trimStart(),
  ].join("\n");
}

function compressBody(body, usablePromptTokens) {
  const before = estimateBody(body);
  const target = Math.max(1024, Math.floor(usablePromptTokens * 0.82));
  const next = JSON.parse(JSON.stringify(body));
  let compressed = false;

  if (typeof next.prompt === "string") {
    const clipped = clipText(next.prompt, target);
    compressed = compressed || clipped !== next.prompt;
    next.prompt = clipped;
  }

  if (Array.isArray(next.messages)) {
    const messages = next.messages.filter((message) => message && typeof message === "object");
    const system = messages.filter((message) => message.role === "system" || message.role === "developer");
    const convo = messages.filter((message) => message.role !== "system" && message.role !== "developer");
    const recent = convo.slice(-6);
    const older = convo.slice(0, Math.max(0, convo.length - recent.length));
    const olderText = older.map((message) => `${message.role ?? "message"}: ${textFromContent(message.content)}`).join("\n\n");
    const compressedMessages = [...system];
    if (olderText.trim()) {
      compressed = true;
      compressedMessages.push({
        role: "developer",
        content: `Atlas automatic compression summary of older conversation context.\n\n${clipText(olderText, Math.max(1024, Math.floor(target * 0.22)))}`,
      });
    }
    const perRecent = Math.max(768, Math.floor(target / Math.max(2, recent.length + 2)));
    for (const message of recent) {
      const original = textFromContent(message.content);
      const clipped = clipText(original, perRecent);
      compressed = compressed || clipped !== original;
      compressedMessages.push({ ...message, content: clipped });
    }
    next.messages = compressedMessages;
  }

  return { body: next, compressed, before, after: estimateBody(next) };
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024 * 1024) throw new Error("Request body exceeds 64 MiB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(raw) });
  res.end(raw);
}

function configuredApiKey(config) {
  return String(config.agentRuntime?.gateway?.apiKey ?? "").trim();
}

function requestToken(req) {
  const raw = req.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return "";
  const trimmed = value.trim();
  if (/^bearer\s+/i.test(trimmed)) return trimmed.replace(/^bearer\s+/i, "").trim();
  if (/^basic\s+/i.test(trimmed)) {
    try {
      const decoded = Buffer.from(trimmed.replace(/^basic\s+/i, "").trim(), "base64").toString("utf8");
      return decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : decoded;
    } catch {
      return "";
    }
  }
  return trimmed;
}

function isAuthorized(req, config) {
  const apiKey = configuredApiKey(config);
  return !apiKey || requestToken(req) === apiKey;
}

async function proxy(req, res, config, path, body) {
  const upstreamHost = clientHost(config.server?.host);
  const upstreamPort = Number(config.server?.port ?? DEFAULT_UPSTREAM_PORT);
  const upstream = await fetch(`http://${upstreamHost}:${upstreamPort}${path}`, {
    method: req.method,
    headers: {
      "content-type": req.headers["content-type"] ?? "application/json",
      accept: req.headers.accept ?? "application/json",
    },
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
  res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
  if (!upstream.body) {
    res.end();
    return;
  }
  for await (const chunk of upstream.body) res.write(Buffer.from(chunk));
  res.end();
}

function start() {
  const initial = loadConfig();
  const gateway = initial.agentRuntime?.gateway ?? {};
  const host = gateway.host ?? "0.0.0.0";
  const port = Number(process.env.ATLAS_GATEWAY_PORT ?? gateway.port ?? DEFAULT_GATEWAY_PORT);
  let requestCount = 0;
  let compressedCount = 0;
  let rejectedCount = 0;
  const startedAt = Date.now();

  const server = http.createServer(async (req, res) => {
    const config = loadConfig();
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/health") {
        sendJson(res, 200, {
          status: "ok",
          gateway: {
            running: true,
            host,
            port,
            upstream: `http://${clientHost(config.server?.host)}:${Number(config.server?.port ?? DEFAULT_UPSTREAM_PORT)}`,
            modelAlias: config.agentRuntime?.gateway?.modelAlias,
            activeProfileId: config.agentRuntime?.activeProfileId,
            startedAt,
            requestCount,
            compressedCount,
            rejectedCount,
          },
        });
        return;
      }
      if (req.method === "GET" && path === "/v1/models") {
        if (!isAuthorized(req, config)) {
          rejectedCount += 1;
          sendJson(res, 401, { error: { type: "unauthorized", message: "Atlas Gateway requires Authorization: Bearer <api key>." } });
          return;
        }
        requestCount += 1;
        await proxy(req, res, config, "/v1/models");
        return;
      }
      if (req.method === "POST" && (path === "/v1/chat/completions" || path === "/v1/completions")) {
        if (!isAuthorized(req, config)) {
          rejectedCount += 1;
          sendJson(res, 401, { error: { type: "unauthorized", message: "Atlas Gateway requires Authorization: Bearer <api key>." } });
          return;
        }
        requestCount += 1;
        const raw = await readBody(req);
        const body = JSON.parse(raw);
        const maxPrompt = maxPromptTokens(config);
        const estimate = estimateBody(body);
        let forwarded = raw;
        if (estimate > maxPrompt) {
          const compressed = compressBody(body, maxPrompt);
          if (compressed.compressed && compressed.after <= maxPrompt) {
            compressedCount += 1;
            forwarded = JSON.stringify(compressed.body);
          } else {
            rejectedCount += 1;
            sendJson(res, 413, {
              error: {
                type: "atlas_context_budget_exceeded",
                message: `Atlas could not compress this request enough to fit the active profile budget. Estimate went from ${compressed.before} to ${compressed.after}, budget ${maxPrompt}.`,
              },
            });
            return;
          }
        }
        await proxy(req, res, config, path, forwarded);
        return;
      }
      sendJson(res, 404, { error: { type: "not_found", message: `Atlas Gateway route not found: ${path}` } });
    } catch (err) {
      sendJson(res, 502, { error: { type: "atlas_gateway_error", message: err instanceof Error ? err.message : String(err) } });
    }
  });

  server.listen(port, host, () => {
    console.log(`Atlas headless gateway listening at http://${host}:${port}/v1`);
  });
}

start();
