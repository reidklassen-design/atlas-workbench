# Qwen3-Coder Runtime Profiles Evidence

## Model

- GGUF: `/home/reid/Downloads/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf`
- Alias: `Qwen3-Coder-30B-A3B`
- Hardware: NVIDIA GeForce RTX 3090 Ti, 24 GB class VRAM

## Throughput Sweep

Command family:

```bash
llama-bench -m /home/reid/Downloads/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf \
  -ngl 999 -fa on -ctk q4_0 -ctv q4_0 -t 16 -p 8192 -n 256 -r 2 -o md
```

Results:

- `batch=512`, `ubatch=128`: `pp8192 2019.39 tok/s`, `tg256 201.26 tok/s`
- `batch=512`, `ubatch=256`: `pp8192 2968.04 tok/s`, `tg256 201.17 tok/s`
- `batch=1024`, `ubatch=128`: `pp8192 2023.18 tok/s`, `tg256 201.51 tok/s`
- `batch=1024`, `ubatch=256`: `pp8192 2977.30 tok/s`, `tg256 202.17 tok/s`

Decision: use `batch=1024`, `ubatch=256` for the Qwen3-Coder runtime profiles.

## Context Fit

Startup tests used `llama-server` with `flash-attn on`, `cache-type-k q4_0`, `cache-type-v q4_0`, `parallel 1`, and the measured `1024/256` batching.

- `131072`, forced full GPU: started, about `21476 MiB` GPU memory used.
- `180000`, forced full GPU: started, about `22892 MiB` GPU memory used.
- `188000`, forced full GPU: started, about `23120 MiB` GPU memory used.
- `192000`, forced full GPU: failed to fit with `n_gpu_layers` set to `999`.
- `196608`, auto-fit: started, about `23122 MiB` GPU memory used, with CPU tensor spill warning.
- `262144`, auto-fit: started, about `23056 MiB` GPU memory used, with CPU tensor spill warning.

Decision:

- Default profile: `188000` context, `gpuOffloadMode=full`.
- Max-context profile: `262144` context, `gpuOffloadMode=auto`.
- Headroom profile: `131072` context, `gpuOffloadMode=full`.

## Functional Smoke

Started the `188000` full-GPU profile and sent an OpenAI-compatible chat request:

```text
Write a TypeScript function add(a: number, b: number): number. Return only code.
```

Observed response contained:

```typescript
function add(a: number, b: number): number {
    return a + b;
}
```
