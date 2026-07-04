import { describe, it, expect } from "vitest";
import { buildRedactedServerCommandString, buildServerArgs, buildFinetuneArgs, describeGpuOffload } from "@/process/flagBuilder";
import { defaultConfig } from "@/config/defaults";
import { SERVER_FLAGS } from "@/config/flagCatalog";
import type { AppConfig } from "@/config/types";

function cfg(over: Partial<AppConfig> = {}): AppConfig {
  const base = defaultConfig();
  base.binaryPaths = { server: "llama-server", finetune: "llama-finetune" };
  return {
    ...base,
    ...over,
    gpu: { ...base.gpu, ...(over.gpu ?? {}) },
    server: { ...base.server, ...(over.server ?? {}) },
    model: { ...base.model, ...(over.model ?? {}) },
    serverFlags: { ...base.serverFlags, ...(over.serverFlags ?? {}) },
    finetune: { ...base.finetune, ...(over.finetune ?? {}) },
  };
}

describe("buildServerArgs", () => {
  it("always emits --host and --port", () => {
    const args = buildServerArgs(cfg({ server: { host: "127.0.0.1", port: 8080 } }));
    expect(args).toContain("--host");
    expect(args[args.indexOf("--host") + 1]).toBe("127.0.0.1");
    expect(args[args.indexOf("--port") + 1]).toBe("8080");
  });

  it("emits --model when a model is selected", () => {
    const args = buildServerArgs(cfg({ model: { directory: "/m", selectedModel: "/m/foo.gguf" } }));
    expect(args[args.indexOf("--model") + 1]).toBe("/m/foo.gguf");
  });

  it("emits --ctx-size when changed from optimized default", () => {
    const args = buildServerArgs(cfg({ serverFlags: { "ctx-size": 4096 } }));
    expect(args[args.indexOf("--ctx-size") + 1]).toBe("4096");
  });

  it("emits negative flags for default-on switches when disabled", () => {
    const args = buildServerArgs(cfg({ serverFlags: { webui: false, slots: false, "cont-batching": false } }));
    expect(args).toContain("--no-webui");
    expect(args).toContain("--no-slots");
    expect(args).toContain("--no-cont-batching");
  });

  it("redacts api keys in displayed command preview", () => {
    const command = buildRedactedServerCommandString(cfg({ serverFlags: { "api-key": "secret-token" } }));
    expect(command).toContain("--api-key [redacted]");
    expect(command).not.toContain("secret-token");
  });

  it("optimized defaults let llama.cpp auto-fit GPU offload instead of forcing all layers", () => {
    const args = buildServerArgs(cfg());
    expect(args[args.indexOf("--ctx-size") + 1]).toBe("98304");
    expect(args).not.toContain("--n-gpu-layers");
    expect(describeGpuOffload(cfg())).toMatch(/auto-fit/i);
    expect(args[args.indexOf("--alias") + 1]).toBe("Ornith1");
    expect(args[args.indexOf("--batch-size") + 1]).toBe("1024");
    expect(args[args.indexOf("--ubatch-size") + 1]).toBe("256");
    expect(args[args.indexOf("--n-predict") + 1]).toBe("8192");
    expect(args[args.indexOf("--flash-attn") + 1]).toBe("on");
    expect(args[args.indexOf("--cache-type-k") + 1]).toBe("q8_0");
    expect(args[args.indexOf("--cache-type-v") + 1]).toBe("q8_0");
    expect(args[args.indexOf("--threads") + 1]).toBe("16");
    expect(args[args.indexOf("--threads-batch") + 1]).toBe("16");
    expect(args).not.toContain("--reasoning");
    expect(args).not.toContain("--reasoning-budget");
  });

  it("emits --n-gpu-layers when changed from default", () => {
    const args = buildServerArgs(cfg({ gpu: { ...defaultConfig().gpu, offloadMode: "manual" }, serverFlags: { "n-gpu-layers": 20 } }));
    expect(args[args.indexOf("--n-gpu-layers") + 1]).toBe("20");
  });

  it("emits forced full offload only when GPU mode explicitly requests it", () => {
    const args = buildServerArgs(cfg({ gpu: { ...defaultConfig().gpu, offloadMode: "full" }, serverFlags: { "n-gpu-layers": 999 } }));
    expect(args[args.indexOf("--n-gpu-layers") + 1]).toBe("999");
  });

  it("emits CPU-only GPU layers when requested", () => {
    const args = buildServerArgs(cfg({ gpu: { ...defaultConfig().gpu, offloadMode: "cpu" }, serverFlags: { "n-gpu-layers": 999 } }));
    expect(args[args.indexOf("--n-gpu-layers") + 1]).toBe("0");
  });

  it("emits optimized default flags but omits ordinary unchanged defaults", () => {
    const args = buildServerArgs(cfg());
    expect(args[args.indexOf("--ctx-size") + 1]).toBe("98304");
    expect(args).not.toContain("--n-gpu-layers");
    expect(args[args.indexOf("--flash-attn") + 1]).toBe("on");
    expect(args).not.toContain("--mlock");
    expect(args).toContain("--metrics");
  });

  it("emits value-based flash attention syntax when changed", () => {
    const args = buildServerArgs(cfg({ serverFlags: { "flash-attn": "off" } }));
    expect(args[args.indexOf("--flash-attn") + 1]).toBe("off");
  });

  it("emits enum flags with their value", () => {
    const args = buildServerArgs(cfg({ serverFlags: { "split-mode": "row" } }));
    expect(args[args.indexOf("--split-mode") + 1]).toBe("row");
  });

  it("does not duplicate host/port from the generic flag catalog", () => {
    const args = buildServerArgs(cfg({ server: { host: "0.0.0.0", port: 9000 } }));
    const hostCount = args.filter((a) => a === "--host").length;
    const portCount = args.filter((a) => a === "--port").length;
    expect(hostCount).toBe(1);
    expect(portCount).toBe(1);
  });

  it("every catalog flag is representable (build never throws)", () => {
    for (const flag of SERVER_FLAGS) {
      const c = cfg({ serverFlags: { [flag.id]: flag.default } });
      expect(() => buildServerArgs(c)).not.toThrow();
    }
  });

  it("handles spaces in paths", () => {
    const args = buildServerArgs(cfg({ model: { directory: "/m dir", selectedModel: "/m dir/foo bar.gguf" } }));
    expect(args[args.indexOf("--model") + 1]).toBe("/m dir/foo bar.gguf");
  });
});

describe("buildFinetuneArgs", () => {
  it("emits learning rate, epochs, batch size, dataset and output", () => {
    const args = buildFinetuneArgs(
      cfg({ finetune: { "train-data": "/data.jsonl", "lora-out": "/out.bin", "learning-rate": 0.001, epochs: 3, "batch-size": 16 } }),
    );
    expect(args[args.indexOf("--train-data") + 1]).toBe("/data.jsonl");
    expect(args[args.indexOf("--lora-out") + 1]).toBe("/out.bin");
    expect(args[args.indexOf("--learning-rate") + 1]).toBe("0.001");
    expect(args[args.indexOf("--epochs") + 1]).toBe("3");
    expect(args[args.indexOf("--batch-size") + 1]).toBe("16");
  });

  it("emits boolean finetune flags only when true", () => {
    const args = buildFinetuneArgs(cfg({ finetune: { "use-gpu": true } }));
    expect(args).toContain("--use-gpu");
  });
});
