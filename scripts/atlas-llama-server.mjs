#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const CONFIG_PATH = process.env.ATLAS_CONFIG ?? `${process.env.HOME}/.config/atlas-workbench/config.json`;
const DEFAULT_BINARY = `${process.env.HOME}/.local/bin/llama-server`;
const DEFAULT_MODEL = "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF/ornith-1.0-35b-Q4_K_M.gguf";
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8099;

const FLAG_NAMES = {
  "draft-model": "--model-draft",
  predict: "--n-predict",
};

const NEGATED_FLAGS = {
  "cont-batching": "--no-cont-batching",
  slots: "--no-slots",
  webui: "--no-webui",
  "log-prefix": "--no-log-prefix",
  warmup: "--no-warmup",
  "context-shift": "--no-context-shift",
};

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function activeProfile(config) {
  const runtime = config.agentRuntime ?? {};
  const id = runtime.activeProfileId;
  return runtime.profiles?.find((profile) => profile.id === id) ?? runtime.profiles?.[0] ?? {};
}

function flagName(id) {
  return FLAG_NAMES[id] ?? `--${id}`;
}

function pushFlag(args, id, value) {
  if (value === undefined || value === null) return;
  if (typeof value === "boolean") {
    if (value) args.push(flagName(id));
    else if (NEGATED_FLAGS[id]) args.push(NEGATED_FLAGS[id]);
    return;
  }
  const text = String(value);
  if (text === "") return;
  args.push(flagName(id), text);
}

function gpuOffloadMode(config, profile) {
  const mode = profile.gpuOffloadMode ?? config.gpu?.offloadMode;
  if (mode === "auto" || mode === "full" || mode === "manual" || mode === "cpu") return mode;
  const layers = Number(config.serverFlags?.["n-gpu-layers"] ?? profile.serverFlagOverrides?.["n-gpu-layers"] ?? 999);
  if (!Number.isFinite(layers)) return "auto";
  if (layers <= 0) return "cpu";
  if (layers >= 999) return "auto";
  return "manual";
}

function buildCommand(config) {
  const profile = activeProfile(config);
  const binary = config.binaryPaths?.server || DEFAULT_BINARY;
  const host = process.env.ATLAS_LLAMA_HOST ?? config.server?.host ?? DEFAULT_HOST;
  const port = Number(process.env.ATLAS_LLAMA_PORT ?? config.server?.port ?? DEFAULT_PORT);
  const model = profile.modelPath ?? config.model?.selectedModel ?? DEFAULT_MODEL;
  const flags = { ...(config.serverFlags ?? {}), ...(profile.serverFlagOverrides ?? {}) };
  const mode = gpuOffloadMode(config, profile);
  const args = ["--host", String(host), "--port", String(port), "--model", model];

  for (const [id, value] of Object.entries(flags)) {
    if (id === "host" || id === "port" || id === "model") continue;
    if (id === "n-gpu-layers") {
      if (mode === "auto") continue;
      if (mode === "cpu") pushFlag(args, id, 0);
      else pushFlag(args, id, Number(value) > 0 ? value : 999);
      continue;
    }
    pushFlag(args, id, value);
  }

  return { binary, args, profileId: profile.id ?? "", model };
}

function main() {
  const config = loadConfig();
  const command = buildCommand(config);
  if (!existsSync(command.binary)) {
    console.error(`Atlas llama supervisor could not find llama-server at ${command.binary}`);
    process.exit(127);
  }
  if (!existsSync(command.model)) {
    console.error(`Atlas llama supervisor could not find model at ${command.model}`);
    process.exit(66);
  }
  if (process.env.ATLAS_LLAMA_DRY_RUN === "1") {
    console.log(JSON.stringify(command, null, 2));
    return;
  }

  console.log(`Atlas llama supervisor starting ${command.profileId || "active profile"}`);
  console.log([command.binary, ...command.args].map((part) => (part.includes(" ") ? `"${part}"` : part)).join(" "));
  const child = spawn(command.binary, command.args, { stdio: "inherit" });
  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGTERM", () => forward("SIGTERM"));
  process.on("SIGINT", () => forward("SIGINT"));
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main();
