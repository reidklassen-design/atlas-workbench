import type { FlagDef, FinetuneParamDef, FlagValues } from "./types";

/**
 * The authoritative llama.cpp `llama-server` flag set for Atlas Workbench.
 * Per the settings-flags spec non-goal, the flag set is defined in the app and
 * updated when llama.cpp changes; every entry here gets a real widget and is
 * converted into an actual command-line argument by the process layer.
 */
export const SERVER_FLAGS: FlagDef[] = [
  // ---- Server ----
  { id: "host", flag: "--host", label: "Host", section: "Server", type: "string", default: "127.0.0.1", help: "Network address the server binds to. Use 0.0.0.0 to expose it to other machines on your network.", alwaysEmit: true },
  { id: "port", flag: "--port", label: "Port", section: "Server", type: "number", default: 8080, min: 1, max: 65535, step: 1, help: "TCP port the HTTP server listens on.", alwaysEmit: true },
  { id: "path", flag: "--path", label: "Static Files Path", section: "Server", type: "path", default: "", help: "Folder of static files served by the built-in web UI. Leave empty for the default embedded UI." },
  { id: "api-key", flag: "--api-key", label: "API Key", section: "Server", type: "string", default: "", help: "Secret key required in the Authorization header. Set this to lock down your server." },
  { id: "alias", flag: "--alias", label: "Model Alias", section: "Server", type: "string", default: "Qwen3-Coder-30B-A3B", help: "Name shown to clients for this model in the OpenAI-compatible API.", alwaysEmit: true },
  { id: "parallel", flag: "--parallel", label: "Parallel Slots", section: "Server", type: "number", default: 1, min: 1, max: 256, step: 1, help: "Number of concurrent requests (slots) the server can process at once.", alwaysEmit: true },
  { id: "cont-batching", flag: "--cont-batching", negatedFlag: "--no-cont-batching", label: "Continuous Batching", section: "Server", type: "boolean", default: true, help: "Reorder and serve new requests while others are generating for higher throughput." },
  { id: "slots", flag: "--slots", negatedFlag: "--no-slots", label: "Slots Endpoint", section: "Server", type: "boolean", default: true, help: "Expose the /slots endpoint so clients can inspect slot state." },
  { id: "metrics", flag: "--metrics", label: "Prometheus Metrics", section: "Server", type: "boolean", default: true, help: "Expose a /metrics endpoint with Prometheus-style statistics.", alwaysEmit: true },
  { id: "webui", flag: "--webui", negatedFlag: "--no-webui", label: "Embedded Web UI", section: "Server", type: "boolean", default: true, help: "Serve the built-in chat web UI at the server root." },
  { id: "log-prefix", flag: "--log-prefix", negatedFlag: "--no-log-prefix", label: "Log Prefix Timestamps", section: "Server", type: "boolean", default: true, help: "Prefix each log line with a timestamp." },

  // ---- Model Loading ----
  { id: "n-gpu-layers", flag: "--n-gpu-layers", label: "GPU Layers (Offload)", section: "Model Loading", type: "number", default: 999, min: 0, max: 9999, step: 1, help: "Number of model layers offloaded to the GPU. 999 offloads the whole model when VRAM allows.", alwaysEmit: true },
  { id: "device", flag: "--device", label: "Device", section: "Model Loading", type: "string", default: "", help: "Comma-separated devices to use, e.g. 0,1 or CUDA:0. Leave empty for default." },
  { id: "split-mode", flag: "--split-mode", label: "Split Mode", section: "Model Loading", type: "enum", default: "layer", options: ["none", "layer", "row"], help: "How to split the model across multiple GPUs: layer (default), row, or none." },
  { id: "main-gpu", flag: "--main-gpu", label: "Main GPU", section: "Model Loading", type: "number", default: 0, min: 0, max: 63, step: 1, help: "Index of the GPU that holds the first layer and runs the non-split work." },
  { id: "tensor-split", flag: "--tensor-split", label: "Tensor Split Ratio", section: "Model Loading", type: "string", default: "", help: "Fraction of work assigned to each GPU, e.g. 3,1 gives GPU0 three parts and GPU1 one." },
  { id: "mlock", flag: "--mlock", label: "Lock Model In RAM", section: "Model Loading", type: "boolean", default: false, help: "Prevent the OS from swapping the model to disk. Needs sufficient RAM." },
  { id: "no-mmap", flag: "--no-mmap", label: "Disable Memory Mapping", section: "Model Loading", type: "boolean", default: false, help: "Load the whole model into RAM instead of memory-mapping the file." },
  { id: "numa", flag: "--numa", label: "NUMA Strategy", section: "Model Loading", type: "enum", default: "disabled", options: ["disabled", "distribute", "isolate", "numactl", "mirror"], help: "How threads are placed across NUMA nodes for multi-socket machines." },
  { id: "flash-attn", flag: "--flash-attn", label: "Flash Attention", section: "Model Loading", type: "enum", default: "on", options: ["on", "off", "auto"], help: "Use flash attention for lower memory use and faster long-context generation.", alwaysEmit: true },
  { id: "warmup", flag: "--warmup", negatedFlag: "--no-warmup", label: "Warmup", section: "Model Loading", type: "boolean", default: true, help: "Run the warmup pass so the first request is not the slowest." },
  { id: "no-perf", flag: "--no-perf", label: "Disable Timing Logs", section: "Model Loading", type: "boolean", default: false, help: "Suppress prompt / generation timing reports in the log." },
  { id: "draft-model", flag: "--model-draft", label: "Draft Model Path", section: "Model Loading", type: "path", default: "", help: "Path to a small draft model used for speculative decoding speedups." },
  { id: "draft-max", flag: "--draft-max", label: "Max Draft Tokens", section: "Model Loading", type: "number", default: 16, min: 0, max: 1024, step: 1, help: "Maximum number of tokens the draft model may propose per step." },
  { id: "draft-min", flag: "--draft-min", label: "Min Draft Tokens", section: "Model Loading", type: "number", default: 5, min: 0, max: 1024, step: 1, help: "Minimum draft tokens required before speculative decoding is used." },
  { id: "draft-p-min", flag: "--draft-p-min", label: "Min Draft Probability", section: "Model Loading", type: "number", default: 0.9, min: 0, max: 1, step: 0.01, help: "Discard draft tokens whose probability is below this threshold." },

  // ---- Context & Batching ----
  { id: "ctx-size", flag: "--ctx-size", label: "Context Size", section: "Context & Batching", type: "number", default: 188000, min: 64, max: 1048576, step: 1024, help: "Total context window in tokens shared across all parallel slots. Optimized default is the measured 188K full-GPU Qwen3-Coder profile on this RTX 3090 Ti.", alwaysEmit: true },
  { id: "batch-size", flag: "--batch-size", label: "Logical Batch Size", section: "Context & Batching", type: "number", default: 1024, min: 1, max: 65536, step: 1, help: "Maximum tokens processed in one prompt batch during evaluation. 1024 was fastest in the Qwen3-Coder prompt-ingest sweep.", alwaysEmit: true },
  { id: "ubatch-size", flag: "--ubatch-size", label: "Physical Batch Size", section: "Context & Batching", type: "number", default: 256, min: 1, max: 65536, step: 1, help: "Tokens processed in one physical compute step. 256 was fastest in the Qwen3-Coder prompt-ingest sweep.", alwaysEmit: true },
  { id: "keep", flag: "--keep", label: "Tokens To Keep", section: "Context & Batching", type: "number", default: 0, min: 0, max: 1048576, step: 1, help: "Number of tokens retained when the context shifts. 0 keeps all but the system prompt." },
  { id: "threads", flag: "--threads", label: "Threads", section: "Context & Batching", type: "number", default: 16, min: 1, max: 1024, step: 1, help: "Number of CPU threads used for generation. Optimized for the i9-12900KS performance cores plus headroom.", alwaysEmit: true },
  { id: "threads-batch", flag: "--threads-batch", label: "Batch Threads", section: "Context & Batching", type: "number", default: 16, min: 1, max: 1024, step: 1, help: "Number of CPU threads used for prompt and batch processing.", alwaysEmit: true },
  { id: "predict", flag: "--n-predict", label: "Max Tokens To Predict", section: "Context & Batching", type: "number", default: 8192, min: -1, max: 1048576, step: 1, help: "Maximum tokens the server generates per request. Capping this prevents runaway agent calls from monopolizing the model.", alwaysEmit: true },
  { id: "cache-type-k", flag: "--cache-type-k", label: "KV Cache Type (K)", section: "Context & Batching", type: "enum", default: "q4_0", options: ["f16", "f32", "q8_0", "q4_0", "q4_1", "q5_0", "q5_1", "iq4_nl"], help: "Quantization of the key cache. q4_0 preserves VRAM for large-context agentic coding on the Qwen3-Coder profile.", alwaysEmit: true },
  { id: "cache-type-v", flag: "--cache-type-v", label: "KV Cache Type (V)", section: "Context & Batching", type: "enum", default: "q4_0", options: ["f16", "f32", "q8_0", "q4_0", "q4_1", "q5_0", "q5_1", "iq4_nl"], help: "Quantization of the value cache. q4_0 preserves VRAM for large-context agentic coding on the Qwen3-Coder profile.", alwaysEmit: true },
  { id: "defrag-thold", flag: "--defrag-thold", label: "KV Defrag Threshold", section: "Context & Batching", type: "number", default: 0.1, min: 0, max: 1, step: 0.01, help: "Fragmentation ratio at which the KV cache is defragmented." },
  { id: "context-shift", flag: "--context-shift", negatedFlag: "--no-context-shift", label: "Context Shift", section: "Context & Batching", type: "boolean", default: false, help: "Shift the KV cache when context overflows instead of failing long conversations." },
  { id: "cache-reuse", flag: "--cache-reuse", label: "Cache Reuse Window", section: "Context & Batching", type: "number", default: 0, min: 0, max: 1048576, step: 1, help: "Tokens of prompt cache eligible for reuse across requests." },

  // ---- Sampling ----
  { id: "temp", flag: "--temp", label: "Temperature", section: "Sampling", type: "number", default: 0.2, min: 0, max: 2, step: 0.01, help: "Randomness of sampling. 0.2 keeps the main Qwen3-Coder profile focused for code generation.", alwaysEmit: true },
  { id: "top-k", flag: "--top-k", label: "Top K", section: "Sampling", type: "number", default: 20, min: 0, max: 100000, step: 1, help: "Keep only the K most likely tokens before sampling. 20 matches the Qwen3-Coder profile.", alwaysEmit: true },
  { id: "top-p", flag: "--top-p", label: "Top P", section: "Sampling", type: "number", default: 0.8, min: 0, max: 1, step: 0.01, help: "Nucleus sampling: 0.8 matches the Qwen3-Coder profile.", alwaysEmit: true },
  { id: "min-p", flag: "--min-p", label: "Min P", section: "Sampling", type: "number", default: 0.05, min: 0, max: 1, step: 0.01, help: "Discard tokens whose probability is below this fraction of the top token." },
  { id: "typical-p", flag: "--typical-p", label: "Typical P", section: "Sampling", type: "number", default: 1.0, min: 0, max: 1, step: 0.01, help: "Keeps tokens with typical (expected) information content." },
  { id: "repeat-penalty", flag: "--repeat-penalty", label: "Repeat Penalty", section: "Sampling", type: "number", default: 1.05, min: 0, max: 4, step: 0.01, help: "Penalty applied to tokens that already appeared. 1.05 matches the Qwen3-Coder profile.", alwaysEmit: true },
  { id: "repeat-last-n", flag: "--repeat-last-n", label: "Repeat Window", section: "Sampling", type: "number", default: 64, min: -1, max: 1048576, step: 1, help: "How many recent tokens the repeat penalty looks at. -1 means whole context." },
  { id: "presence-penalty", flag: "--presence-penalty", label: "Presence Penalty", section: "Sampling", type: "number", default: 0, min: -2, max: 2, step: 0.01, help: "Penalize any token that has appeared at least once." },
  { id: "frequency-penalty", flag: "--frequency-penalty", label: "Frequency Penalty", section: "Sampling", type: "number", default: 0, min: -2, max: 2, step: 0.01, help: "Penalize tokens in proportion to how often they appeared." },
  { id: "mirostat", flag: "--mirostat", label: "Mirostat Mode", section: "Sampling", type: "enum", default: "0", options: ["0", "1", "2"], help: "Adaptive sampling that targets a target surprise. 0 disables." },
  { id: "mirostat-lr", flag: "--mirostat-lr", label: "Mirostat Learning Rate", section: "Sampling", type: "number", default: 0.1, min: 0, max: 1, step: 0.01, help: "How fast Mirostat adjusts to its target surprise." },
  { id: "mirostat-ent", flag: "--mirostat-ent", label: "Mirostat Target Entropy", section: "Sampling", type: "number", default: 5.0, min: 0, max: 10, step: 0.01, help: "Target surprise (entropy) Mirostat tries to maintain." },
  { id: "dynatemp-range", flag: "--dynatemp-range", label: "Dynamic Temp Range", section: "Sampling", type: "number", default: 0.0, min: 0, max: 5, step: 0.01, help: "Range of dynamic temperature scaling around the base temperature." },
  { id: "dynatemp-exp", flag: "--dynatemp-exp", label: "Dynamic Temp Exponent", section: "Sampling", type: "number", default: 1.0, min: 0, max: 5, step: 0.01, help: "Exponent shaping the dynamic temperature curve." },
  { id: "top-nsigma", flag: "--top-nsigma", label: "Top N Sigma", section: "Sampling", type: "number", default: -1, min: -1, max: 10, step: 0.01, help: "Keeps tokens within N standard deviations of the top logit. -1 disables." },
  { id: "xtc-probability", flag: "--xtc-probability", label: "XTC Probability", section: "Sampling", type: "number", default: 0.0, min: 0, max: 1, step: 0.01, help: "Chance of applying XTC (replacing top token with a lower-ranked one)." },
  { id: "xtc-threshold", flag: "--xtc-threshold", label: "XTC Threshold", section: "Sampling", type: "number", default: 0.1, min: 0, max: 1, step: 0.01, help: "Probability threshold below which XTC can swap the top token." },
  { id: "samplers", flag: "--samplers", label: "Samplers Order", section: "Sampling", type: "string", default: "top_k;typ_p;top_p;min_p;temperature", help: "Semicolon-separated sampler names applied in order during generation." },
  { id: "seed", flag: "--seed", label: "Random Seed", section: "Sampling", type: "number", default: -1, min: -1, max: 2147483647, step: 1, help: "Fixed seed for reproducible output. -1 uses a random seed each run." },
  { id: "ignore-eos", flag: "--ignore-eos", label: "Ignore End Of Sequence", section: "Sampling", type: "boolean", default: false, help: "Never stop on the end-of-sequence token (useful for benchmarking)." },
  { id: "logit-bias", flag: "--logit-bias", label: "Logit Bias", section: "Sampling", type: "string", default: "", help: "Bias specific token ids, e.g. \"12843:+1\" to boost that token." },

  // ---- Prompts & Templates ----
  { id: "chat-template", flag: "--chat-template", label: "Chat Template", section: "Prompts & Templates", type: "string", default: "", help: "Chat template name or inline Jinja template. Leave empty to use the model's built-in template." },
  { id: "jinja", flag: "--jinja", label: "Use Jinja Templates", section: "Prompts & Templates", type: "boolean", default: false, help: "Apply Jinja2 chat templates from the model's tokenizer config." },
  { id: "reasoning", flag: "--reasoning", label: "Reasoning Mode", section: "Prompts & Templates", type: "enum", default: "off", options: ["auto", "on", "off"], help: "Controls llama.cpp thinking mode. The main Qwen3-Coder profile is an instruct model and runs with reasoning disabled.", alwaysEmit: true },
  { id: "reasoning-format", flag: "--reasoning-format", label: "Reasoning Format", section: "Prompts & Templates", type: "enum", default: "deepseek", options: ["deepseek", "falcon", "gemma"], help: "How reasoning/thinking tokens are formatted in responses." },
  { id: "reasoning-budget", flag: "--reasoning-budget", label: "Reasoning Budget", section: "Prompts & Templates", type: "number", default: 0, min: -1, max: 1048576, step: 1, help: "Maximum tokens the model may spend on reasoning. 0 disables thinking budgets for the main Qwen3-Coder profile.", alwaysEmit: true },
  { id: "escape", flag: "--escape", label: "Escape Special Chars", section: "Prompts & Templates", type: "boolean", default: false, help: "Interpret backslash escapes (\\n, \\t) in prompt strings." },
  { id: "grammar", flag: "--grammar", label: "Grammar (Inline)", section: "Prompts & Templates", type: "string", default: "", help: "Inline GBNF grammar constraining output to a structure such as JSON." },
  { id: "grammar-file", flag: "--grammar-file", label: "Grammar File", section: "Prompts & Templates", type: "path", default: "", help: "Path to a .gbnf grammar file that constrains model output." },

  // ---- Position Encoding ----
  { id: "rope-scaling", flag: "--rope-scaling", label: "RoPE Scaling", section: "Position Encoding", type: "enum", default: "none", options: ["none", "yarn"], help: "Method used to extend the model's context beyond its training length." },
  { id: "rope-freq-base", flag: "--rope-freq-base", label: "RoPE Frequency Base", section: "Position Encoding", type: "number", default: 0.0, min: 0, max: 1000000, step: 1, help: "Base frequency for rotary position embeddings. 0 uses the model default." },
  { id: "rope-freq-scale", flag: "--rope-freq-scale", label: "RoPE Frequency Scale", section: "Position Encoding", type: "number", default: 1.0, min: 0, max: 10, step: 0.0001, help: "Scales RoPE frequencies. Values below 1 extend context." },
  { id: "yarn-orig-ctx", flag: "--yarn-orig-ctx", label: "YaRN Original Context", section: "Position Encoding", type: "number", default: 0, min: 0, max: 1048576, step: 1, help: "Original context the model was trained for, used by YaRN scaling." },
  { id: "yarn-ext-factor", flag: "--yarn-ext-factor", label: "YaRN Extent Factor", section: "Position Encoding", type: "number", default: -1.0, min: -1, max: 10, step: 0.01, help: "Extrapolation mix factor for YaRN. -1 uses the default." },
  { id: "yarn-attn-factor", flag: "--yarn-attn-factor", label: "YaRN Attention Factor", section: "Position Encoding", type: "number", default: 1.0, min: 0, max: 10, step: 0.01, help: "Attention scaling factor applied by YaRN." },
  { id: "yarn-beta-fast", flag: "--yarn-beta-fast", label: "YaRN Beta Fast", section: "Position Encoding", type: "number", default: 32.0, min: 0, max: 256, step: 0.01, help: "YaRN interpolation curve steepness at low frequencies." },
  { id: "yarn-beta-slow", flag: "--yarn-beta-slow", label: "YaRN Beta Slow", section: "Position Encoding", type: "number", default: 1.0, min: 0, max: 256, step: 0.01, help: "YaRN interpolation curve steepness at high frequencies." },

  // ---- Embeddings & Special ----
  { id: "embedding", flag: "--embedding", label: "Embeddings Endpoint", section: "Embeddings & Special", type: "boolean", default: false, help: "Enable the /v1/embeddings endpoint for text vector generation." },
  { id: "pooling", flag: "--pooling", label: "Pooling Mode", section: "Embeddings & Special", type: "enum", default: "mean", options: ["none", "mean", "cls", "last"], help: "How token embeddings are combined into a single sentence vector." },
  { id: "reranking", flag: "--reranking", label: "Reranking Endpoint", section: "Embeddings & Special", type: "boolean", default: false, help: "Enable the /v1/rerank endpoint for reordering documents by relevance." },
  { id: "embd-normalize", flag: "--embd-normalize", label: "Embedding Normalization", section: "Embeddings & Special", type: "number", default: -1, min: -1, max: 2, step: 1, help: "Vector normalization level. -1 uses the model default." },

  // ---- LoRA & Control Vectors ----
  { id: "lora", flag: "--lora", label: "LoRA Adapter", section: "LoRA & Control Vectors", type: "path", default: "", help: "Path to a LoRA adapter applied on top of the base model." },
  { id: "lora-scaled", flag: "--lora-scaled", label: "Scaled LoRA Adapter", section: "LoRA & Control Vectors", type: "string", default: "", help: "Path and scale for a LoRA adapter, e.g. \"path:0.8\"." },
  { id: "control-vector", flag: "--control-vector", label: "Control Vector", section: "LoRA & Control Vectors", type: "path", default: "", help: "Path to a control vector file that steers generation behavior." },

  // ---- SSL & Advanced ----
  { id: "ssl-key-file", flag: "--ssl-key-file", label: "SSL Key File", section: "SSL & Advanced", type: "path", default: "", help: "Path to a private key file to enable HTTPS." },
  { id: "ssl-cert-file", flag: "--ssl-cert-file", label: "SSL Certificate File", section: "SSL & Advanced", type: "path", default: "", help: "Path to the SSL certificate file matching the key." },
  { id: "override-tensor", flag: "--override-tensor", label: "Override Tensor Type", section: "SSL & Advanced", type: "string", default: "", help: "Force a quantization type for specific tensors, e.g. \"blk.0.ffn_.*=q8_0\"." },
];

export const SERVER_FLAG_IDS = SERVER_FLAGS.map((f) => f.id);

export function defaultServerFlags(): FlagValues {
  const out: FlagValues = {};
  for (const f of SERVER_FLAGS) out[f.id] = f.default;
  return out;
}

/**
 * llama.cpp `llama-finetune` parameters. Each entry maps to a real argument
 * passed to the finetune binary by the process layer.
 */
export const FINETUNE_PARAMS: FinetuneParamDef[] = [
  { id: "model-base", flag: "--model", label: "Base Model", type: "path", default: "", help: "Path to the base GGUF model that will be fine-tuned." },
  { id: "train-data", flag: "--train-data", label: "Training Dataset", type: "path", default: "", help: "Path to the training data file (GGUF or JSONL format)." },
  { id: "checkpoint-in", flag: "--checkpoint-in", label: "Checkpoint In", type: "path", default: "", help: "Path to a checkpoint file to resume training from." },
  { id: "checkpoint-out", flag: "--checkpoint-out", label: "Checkpoint Out", type: "path", default: "ckpt.bin", help: "Where training checkpoints are written." },
  { id: "lora-out", flag: "--lora-out", label: "Output LoRA Adapter", type: "path", default: "lora-out.bin", help: "Path where the trained LoRA adapter is written on completion." },
  { id: "learning-rate", flag: "--learning-rate", label: "Learning Rate", type: "number", default: 1e-4, min: 0, max: 1, step: 1e-6, help: "Step size for optimizer updates. Smaller is more stable." },
  { id: "epochs", flag: "--epochs", label: "Epochs", type: "number", default: 1, min: 1, max: 1000, step: 1, help: "Number of full passes over the training dataset." },
  { id: "batch-size", flag: "--batch-size", label: "Batch Size", type: "number", default: 8, min: 1, max: 4096, step: 1, help: "Samples processed together before each optimizer step." },
  { id: "grad-acc", flag: "--grad-acc", label: "Gradient Accumulation", type: "number", default: 1, min: 1, max: 4096, step: 1, help: "Accumulate gradients over this many batches before updating weights." },
  { id: "lora-r", flag: "--lora-r", label: "LoRA Rank", type: "number", default: 8, min: 1, max: 1024, step: 1, help: "Rank of the LoRA adapter matrices. Higher fits more, uses more memory." },
  { id: "lora-alpha", flag: "--lora-alpha", label: "LoRA Alpha", type: "number", default: 16, min: 1, max: 4096, step: 1, help: "Scaling factor for the LoRA adapter. Often set to 2x the rank." },
  { id: "n-threads", flag: "--threads", label: "Threads", type: "number", default: 4, min: 1, max: 1024, step: 1, help: "Number of CPU threads used during training." },
  { id: "seed", flag: "--seed", label: "Random Seed", type: "number", default: -1, min: -1, max: 2147483647, step: 1, help: "Fixed seed for reproducible training runs. -1 picks a random seed." },
  { id: "optimizer", flag: "--optimizer", label: "Optimizer", type: "enum", default: "adam", options: ["adam", "sgd"], help: "Optimization algorithm used to update weights." },
  { id: "use-gpu", flag: "--use-gpu", label: "Use GPU", type: "boolean", default: false, help: "Run training computations on the GPU when one is available." },
  { id: "save-every", flag: "--save-every", label: "Save Every N Steps", type: "number", default: 10, min: 1, max: 100000, step: 1, help: "Write a checkpoint after this many optimizer steps." },
];

export const FINETUNE_PARAM_IDS = FINETUNE_PARAMS.map((p) => p.id);

export function defaultFinetuneParams(): FlagValues {
  const out: FlagValues = {};
  for (const p of FINETUNE_PARAMS) out[p.id] = p.default;
  return out;
}
