#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
function getFlag(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const outputPath = getFlag("--lora-out") || "lora-out.bin";
const epochs = Number(getFlag("--epochs") || "1");
const mode = process.env.FAKE_FINETUNE_MODE || "train";
const delayMs = Number(process.env.FAKE_FINETUNE_DELAY_MS || "30");

if (mode === "fail") {
  process.stderr.write("training error: dataset format invalid\n");
  process.exit(2);
}

if (mode === "fail-no-output") {
  process.stdout.write("training step 1/1\n");
  process.stdout.write("training failed: out of memory\n");
  process.exit(1);
}

const steps = Math.max(1, epochs);
let step = 0;
const timer = setInterval(() => {
  step += 1;
  process.stdout.write(`training step ${step}/${steps}\n`);
  if (step >= steps) {
    clearInterval(timer);
    writeFileSync(outputPath, "trained-lora-adapter\n");
    process.stdout.write(`training complete; wrote ${outputPath}\n`);
    process.exit(0);
  }
}, delayMs);

process.on("SIGTERM", () => {
  clearInterval(timer);
  process.stdout.write("training stopped by user\n");
  process.exit(0);
});
process.on("SIGINT", () => {
  clearInterval(timer);
  process.exit(0);
});
