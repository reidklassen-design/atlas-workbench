#!/usr/bin/env node
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
function getFlag(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const host = getFlag("--host") || "127.0.0.1";
const port = Number(getFlag("--port") || "8080");
const model = getFlag("--model") || "";
const mode = process.env.FAKE_SERVER_MODE || "serve";

if (mode === "crash") {
  process.stderr.write("fatal: simulated crash before binding\n");
  process.exit(137);
}

if (mode === "bad-port") {
  process.stderr.write("listen: bind: address already in use\n");
  process.exit(1);
}

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", model }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
});

server.on("error", (err) => {
  process.stderr.write(`server error: ${err.message}\n`);
  process.exit(1);
});

server.listen(port, host, () => {
  process.stdout.write(`llama.cpp server listening on http://${host}:${port}\n`);
  if (model) process.stdout.write(`loaded model: ${model}\n`);
  process.stdout.write(`server ready (pid ${process.pid})\n`);
});

const shutdown = () => {
  process.stdout.write("server shutting down\n");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 200);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// keep the process alive
setInterval(() => {
  if (mode === "write-file") {
    const out = process.env.FAKE_SERVER_OUTPUT;
    if (out) writeFileSync(out, "server side file\n");
  }
}, 1000);
