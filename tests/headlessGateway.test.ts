import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

function waitForOutput(child: ChildProcess, text: string): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for headless gateway output: ${text}`)), 10_000);
    const onData = (chunk: Buffer): void => {
      if (!chunk.toString().includes(text)) return;
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      resolveWait();
    };
    child.stdout?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Headless gateway exited before startup with code ${code}`));
    });
  });
}

describe("headless Atlas gateway", () => {
  const children: ChildProcess[] = [];
  const servers: Server[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const child of children.splice(0)) child.kill("SIGTERM");
    for (const server of servers.splice(0)) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("prepends the configured system prompt to chat requests", async () => {
    const upstreamPort = await freePort();
    const gatewayPort = await freePort();
    const seenBodies: Array<Record<string, unknown>> = [];
    const upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        seenBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "proxied" } }] }));
      });
    });
    servers.push(upstream);
    await new Promise<void>((resolveListen) => upstream.listen(upstreamPort, "127.0.0.1", resolveListen));

    const dir = await mkdtemp(join(tmpdir(), "atlas-headless-gateway-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      systemPrompt: "  You are Atlas. Be direct.  ",
      server: { host: "127.0.0.1", port: upstreamPort },
      agentRuntime: {
        activeProfileId: "test",
        profiles: [{ id: "test", requestPolicy: { maxPromptTokens: 8192 } }],
        gateway: { host: "127.0.0.1", port: gatewayPort, apiKey: "", modelAlias: "atlas/test" },
      },
    }), "utf8");

    const child = spawn(process.execPath, [resolve("scripts/atlas-gateway.mjs")], {
      env: { ...process.env, ATLAS_CONFIG: configPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    await waitForOutput(child, "Atlas headless gateway listening");

    const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "What model is loaded?" }] }),
    });

    expect(response.status).toBe(200);
    const forwarded = seenBodies[0] as { messages: Array<Record<string, unknown>> };
    expect(forwarded.messages[0]).toEqual({ role: "system", content: "You are Atlas. Be direct." });
    expect(forwarded.messages[1]).toEqual({ role: "user", content: "What model is loaded?" });
  });
});
