use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    backtrace::Backtrace,
    collections::{HashMap, HashSet},
    env,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream, ToSocketAddrs},
    os::unix::{fs::PermissionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use uuid::Uuid;

const SERVER_READY_TIMEOUT_SECS: u64 = 600;
const HEALTH_PROGRESS_LOG_SECS: u64 = 5;
const PROCESS_LOG_MAX_BYTES: u64 = 10 * 1024 * 1024;
const OPTIMIZED_PROFILE_VERSION: i64 = 9;
const VISUAL_LOCATOR_KIND: &str = "visual-locator";

#[derive(Default)]
struct AppState {
    children: Arc<Mutex<HashMap<String, Child>>>,
    log_tails: Arc<Mutex<HashMap<String, Vec<String>>>>,
    proc_samples: Mutex<HashMap<usize, ProcSample>>,
    cpu_sample: Mutex<Option<CpuTickSample>>,
    runtime_sample: Mutex<Option<RuntimeCounterSample>>,
    gateway: Arc<Mutex<Option<GatewayRuntime>>>,
    gateway_stats: Arc<Mutex<GatewayStats>>,
}

struct GatewayRuntime {
    shutdown: mpsc::Sender<()>,
    started_at: u128,
    host: String,
    port: i64,
}

#[derive(Default, Clone)]
struct GatewayStats {
    request_count: i64,
    rejected_count: i64,
    compressed_count: i64,
    compaction_active: bool,
    last_error: Option<String>,
    last_budget: Option<Value>,
    last_compression: Option<Value>,
}

#[derive(Clone, Copy)]
struct ProcSample {
    ticks: u64,
    ts: u128,
}

#[derive(Clone)]
struct CpuTickSample {
    per_core: Vec<CpuTicks>,
}

#[derive(Clone, Copy)]
struct CpuTicks {
    idle: u64,
    total: u64,
}

#[derive(Clone, Copy)]
struct RuntimeCounterSample {
    generation_tokens_total: Option<f64>,
    prompt_tokens_total: Option<f64>,
    observed_at_ms: u128,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppError {
    id: String,
    scope: String,
    title: String,
    message: String,
    fix: String,
    ts: u128,
    #[serde(rename = "exitCode", skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(rename = "stderrTail", skip_serializing_if = "Option::is_none")]
    stderr_tail: Option<String>,
}

#[derive(Debug, Serialize)]
struct BinaryValidationResult {
    path: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolved: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

fn now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn app_error(scope: &str, title: &str, message: impl Into<String>, fix: &str) -> AppError {
    AppError {
        id: Uuid::new_v4().to_string(),
        scope: scope.to_string(),
        title: title.to_string(),
        message: message.into(),
        fix: fix.to_string(),
        ts: now(),
        exit_code: None,
        stderr_tail: None,
    }
}

fn config_dir() -> Result<PathBuf, AppError> {
    dirs::config_dir()
        .map(|p| p.join("atlas-workbench"))
        .ok_or_else(|| app_error("config", "Config directory unavailable", "Could not locate the Linux config directory.", "Check your HOME environment and try again."))
}

fn config_path() -> Result<PathBuf, AppError> {
    Ok(config_dir()?.join("config.json"))
}

fn default_config() -> Value {
    json!({
        "schemaVersion": 1,
        "binaryPaths": { "server": "/home/reid/.local/bin/llama-server", "finetune": "/home/reid/.local/bin/llama-finetune" },
        "gpu": { "autoOffloadInitialized": false, "optimizedProfileVersion": OPTIMIZED_PROFILE_VERSION, "offloadMode": "full" },
        "model": {
            "directory": "/home/reid/Downloads",
            "selectedModel": "/home/reid/Downloads/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf"
        },
        "server": { "host": "127.0.0.1", "port": 8099 },
        "serverFlags": {
            "alias": "Qwen3-Coder-30B-A3B",
            "ctx-size": 188000,
            "n-gpu-layers": 999,
            "threads": 16,
            "threads-batch": 16,
            "batch-size": 1024,
            "ubatch-size": 256,
            "parallel": 1,
            "cont-batching": true,
            "slots": true,
            "metrics": true,
            "context-shift": true,
            "predict": 8192,
            "reasoning": "off",
            "reasoning-budget": 0,
            "temp": 0.2,
            "top-k": 20,
            "top-p": 0.8,
            "repeat-penalty": 1.05,
            "flash-attn": "on",
            "cache-type-k": "q4_0",
            "cache-type-v": "q4_0",
            "mlock": false,
            "no-mmap": false
        },
        "finetune": {
            "model-base": "",
            "train-data": "",
            "checkpoint-in": "",
            "checkpoint-out": "ckpt.bin",
            "lora-out": "lora-out.bin",
            "learning-rate": 0.0001,
            "epochs": 1,
            "batch-size": 8,
            "grad-acc": 1,
            "lora-r": 8,
            "lora-alpha": 16,
            "n-threads": 4,
            "seed": -1,
            "optimizer": "adam",
            "use-gpu": false,
            "save-every": 10
        },
        "agentRuntime": default_agent_runtime_config()
    })
}

fn agent_request_policy(
    context_window_tokens: i64,
    reserved_output_tokens: i64,
    max_single_file_tokens: i64,
    max_log_tokens: i64,
    overload_behavior: &str,
) -> Value {
    let reserved_system_tokens = 4096;
    let safety_margin_tokens = 8192;
    let max_prompt_tokens = (context_window_tokens - reserved_output_tokens - reserved_system_tokens - safety_margin_tokens).max(1024);
    json!({
        "contextWindowTokens": context_window_tokens,
        "reservedOutputTokens": reserved_output_tokens,
        "reservedSystemTokens": reserved_system_tokens,
        "safetyMarginTokens": safety_margin_tokens,
        "maxPromptTokens": max_prompt_tokens,
        "maxOutputTokens": reserved_output_tokens,
        "maxSingleFileTokens": max_single_file_tokens,
        "maxLogTokens": max_log_tokens,
        "requestTimeoutMs": 20 * 60 * 1000,
        "streamStallTimeoutMs": 90 * 1000,
        "overloadBehavior": overload_behavior
    })
}

fn profile_flags(overrides: Value) -> Value {
    let mut flags = json!({
        "alias": "Ornith1",
        "ctx-size": 98304,
        "n-gpu-layers": 999,
        "threads": 16,
        "threads-batch": 16,
        "batch-size": 1024,
        "ubatch-size": 256,
        "parallel": 1,
        "flash-attn": "on",
        "cache-type-k": "q8_0",
        "cache-type-v": "q8_0",
        "cont-batching": true,
        "slots": true,
        "metrics": true,
        "context-shift": true,
        "predict": 8192,
        "reasoning": "off",
        "reasoning-budget": 0
    });
    merge_value(&mut flags, overrides);
    flags
}

fn default_agent_runtime_profiles() -> Value {
    json!([
        {
            "id": "3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu",
            "name": "3090 Ti Qwen3-Coder 30B 188K Full-GPU",
            "role": "main-coding",
            "description": "Default DarkFactory coder: measured highest all-GPU context on the 3090 Ti with Qwen3-Coder Q4 XL, q4 KV cache, and fast 1024/256 batching.",
            "modelDirectory": "/home/reid/Downloads",
            "modelPath": "/home/reid/Downloads/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf",
            "gpuOffloadMode": "full",
            "serverFlagOverrides": profile_flags(json!({
                "alias": "Qwen3-Coder-30B-A3B",
                "ctx-size": 188000,
                "parallel": 1,
                "batch-size": 1024,
                "ubatch-size": 256,
                "flash-attn": "on",
                "cache-type-k": "q4_0",
                "cache-type-v": "q4_0",
                "cont-batching": true,
                "slots": true,
                "metrics": true,
                "context-shift": true,
                "predict": 8192,
                "reasoning": "off",
                "reasoning-budget": 0,
                "temp": 0.2,
                "top-k": 20,
                "top-p": 0.8,
                "repeat-penalty": 1.05,
                "threads": 16,
                "threads-batch": 16
            })),
            "requestPolicy": agent_request_policy(188000, 8192, 40000, 28000, "reject")
        },
        {
            "id": "3090-ti-qwen3-coder-30b-a3b-q4-xl-262k-max-context",
            "name": "3090 Ti Qwen3-Coder 30B 262K Max Context",
            "role": "main-coding",
            "description": "Maximum-context Qwen3-Coder profile for giant repo reads. It reaches the native 262K window by letting llama.cpp auto-fit and spill some tensors to CPU.",
            "modelDirectory": "/home/reid/Downloads",
            "modelPath": "/home/reid/Downloads/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf",
            "gpuOffloadMode": "auto",
            "serverFlagOverrides": profile_flags(json!({
                "alias": "Qwen3-Coder-30B-A3B",
                "ctx-size": 262144,
                "parallel": 1,
                "batch-size": 1024,
                "ubatch-size": 256,
                "flash-attn": "on",
                "cache-type-k": "q4_0",
                "cache-type-v": "q4_0",
                "cont-batching": true,
                "slots": true,
                "metrics": true,
                "context-shift": true,
                "predict": 8192,
                "reasoning": "off",
                "reasoning-budget": 0,
                "temp": 0.2,
                "top-k": 20,
                "top-p": 0.8,
                "repeat-penalty": 1.05,
                "threads": 16,
                "threads-batch": 16
            })),
            "requestPolicy": agent_request_policy(262144, 8192, 48000, 32000, "reject")
        },
        {
            "id": "3090-ti-qwen3-coder-30b-a3b-q4-xl-131k-headroom",
            "name": "3090 Ti Qwen3-Coder 30B 131K GPU Headroom",
            "role": "main-coding",
            "description": "All-GPU Qwen3-Coder profile with extra VRAM margin. Use it when you want the same coder but less pressure on the desktop or sidecar tools.",
            "modelDirectory": "/home/reid/Downloads",
            "modelPath": "/home/reid/Downloads/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf",
            "gpuOffloadMode": "full",
            "serverFlagOverrides": profile_flags(json!({
                "alias": "Qwen3-Coder-30B-A3B",
                "ctx-size": 131072,
                "parallel": 1,
                "batch-size": 1024,
                "ubatch-size": 256,
                "flash-attn": "on",
                "cache-type-k": "q4_0",
                "cache-type-v": "q4_0",
                "cont-batching": true,
                "slots": true,
                "metrics": true,
                "context-shift": true,
                "predict": 8192,
                "reasoning": "off",
                "reasoning-budget": 0,
                "temp": 0.2,
                "top-k": 20,
                "top-p": 0.8,
                "repeat-penalty": 1.05,
                "threads": 16,
                "threads-batch": 16
            })),
            "requestPolicy": agent_request_policy(131072, 8192, 32000, 24000, "reject")
        },
        {
            "id": "3090-ti-ornith-35b-96k-always-on",
            "name": "3090 Ti Ornith 35B 96K Always-On",
            "role": "main-coding",
            "description": "Default local agent endpoint: keeps Ornith 35B loaded with enough headroom for long runs, compression, and recovery.",
            "modelDirectory": "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF",
            "modelPath": "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF/ornith-1.0-35b-Q4_K_M.gguf",
            "gpuOffloadMode": "auto",
            "serverFlagOverrides": profile_flags(json!({
                "alias": "Ornith1",
                "ctx-size": 98304,
                "parallel": 1,
                "batch-size": 1024,
                "ubatch-size": 256,
                "flash-attn": "on",
                "cache-type-k": "q8_0",
                "cache-type-v": "q8_0",
                "cont-batching": true,
                "slots": true,
                "metrics": true,
                "context-shift": true,
                "predict": 8192,
                "reasoning": "off",
                "reasoning-budget": 0,
                "threads": 16,
                "threads-batch": 16
            })),
            "requestPolicy": agent_request_policy(98304, 8192, 18000, 12000, "reject")
        },
        {
            "id": "3090-ti-ornith-35b-125k-max-context",
            "name": "3090 Ti Ornith 35B 125K Max Context",
            "role": "main-coding",
            "description": "Maximum-context mode for deliberate large reads. Use when you need the biggest window more than all-day headroom.",
            "modelDirectory": "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF",
            "modelPath": "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith-1.0-35B-GGUF/ornith-1.0-35b-Q4_K_M.gguf",
            "gpuOffloadMode": "auto",
            "serverFlagOverrides": profile_flags(json!({
                "alias": "Ornith1",
                "ctx-size": 125000,
                "parallel": 1,
                "batch-size": 1024,
                "ubatch-size": 256,
                "flash-attn": "on",
                "cache-type-k": "q8_0",
                "cache-type-v": "q8_0",
                "cont-batching": true,
                "slots": true,
                "metrics": true,
                "context-shift": true,
                "predict": 8192,
                "reasoning": "off",
                "reasoning-budget": 0,
                "threads": 16,
                "threads-batch": 16
            })),
            "requestPolicy": agent_request_policy(125000, 8192, 24000, 12000, "reject")
        },
        {
            "id": "3090-ti-qwen-3-6-27b-96k-coder",
            "name": "3090 Ti Qwen 3.6 27B 96K Coder",
            "role": "main-coding",
            "description": "Second-choice serious coding model with more VRAM headroom than Ornith 35B while keeping large-codebase context.",
            "modelDirectory": "/home/reid/Downloads",
            "modelPath": "/home/reid/Downloads/Qwen3.6-27B-Q4_K_M.gguf",
            "gpuOffloadMode": "auto",
            "serverFlagOverrides": profile_flags(json!({
                "alias": "Qwen3.6-27B",
                "ctx-size": 98304,
                "parallel": 1,
                "batch-size": 1024,
                "ubatch-size": 256,
                "flash-attn": "on",
                "cache-type-k": "q8_0",
                "cache-type-v": "q8_0",
                "cont-batching": true,
                "slots": true,
                "metrics": true,
                "context-shift": true,
                "predict": 8192,
                "reasoning": "off",
                "reasoning-budget": 0
            })),
            "requestPolicy": agent_request_policy(98304, 8192, 18000, 12000, "reject")
        },
        {
            "id": "3090-ti-ornith-9b-64k-fast",
            "name": "3090 Ti Ornith 9B 64K Fast",
            "role": "main-coding",
            "description": "Fast fallback for simple edits, routing, and cheap iteration when the 35B model is unnecessary.",
            "modelDirectory": "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith 1.0 9b",
            "modelPath": "/home/reid/.lmstudio/models/deepreinforce-ai/Ornith 1.0 9b/ornith-1.0-9b-Q8_0.gguf",
            "gpuOffloadMode": "auto",
            "serverFlagOverrides": profile_flags(json!({
                "alias": "Ornith1-9B",
                "ctx-size": 65536,
                "parallel": 1,
                "batch-size": 1024,
                "ubatch-size": 256,
                "flash-attn": "on",
                "cache-type-k": "q8_0",
                "cache-type-v": "q8_0",
                "cont-batching": true,
                "slots": true,
                "metrics": true,
                "context-shift": true,
                "predict": 8192,
                "reasoning": "off",
                "reasoning-budget": 0
            })),
            "requestPolicy": agent_request_policy(65536, 8192, 16000, 12000, "reject")
        },
        {
            "id": "compression-sidecar",
            "name": "Compression Sidecar",
            "role": "compression",
            "description": "Small-model profile for summarizing old context, logs, and oversized files before the main coder sees them.",
            "modelDirectory": "/home/reid/Downloads",
            "modelPath": "/home/reid/Downloads/Qwen2.5-3B-Instruct-Q4_K_M.gguf",
            "gpuOffloadMode": "cpu",
            "serverFlagOverrides": profile_flags(json!({
                "alias": "Qwen2.5-3B-compress",
                "ctx-size": 32768,
                "parallel": 1,
                "batch-size": 256,
                "ubatch-size": 64,
                "flash-attn": "on",
                "cache-type-k": "q4_0",
                "cache-type-v": "q4_0",
                "n-gpu-layers": 0,
                "metrics": true,
                "threads": 8,
                "threads-batch": 8,
                "predict": 4096
            })),
            "requestPolicy": agent_request_policy(32768, 4096, 20000, 24000, "compress")
        },
        {
            "id": "rescue-low-vram",
            "name": "Rescue Low VRAM",
            "role": "rescue",
            "description": "Fallback profile for recovering after VRAM pressure, repeated stalls, or driver instability.",
            "gpuOffloadMode": "auto",
            "serverFlagOverrides": profile_flags(json!({
                "alias": "Qwythos-9B-rescue",
                "ctx-size": 32768,
                "parallel": 1,
                "batch-size": 256,
                "ubatch-size": 64,
                "flash-attn": "on",
                "cache-type-k": "q4_0",
                "cache-type-v": "q4_0",
                "metrics": true,
                "slots": true,
                "predict": 4096
            })),
            "requestPolicy": agent_request_policy(32768, 4096, 12000, 8000, "reject")
        }
    ])
}

fn default_agent_runtime_config() -> Value {
    json!({
        "activeProfileId": "3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu",
        "gateway": {
            "enabled": false,
            "host": "0.0.0.0",
            "port": 18080,
            "apiKey": "atlas-local",
            "modelAlias": "Qwen3-Coder-30B-A3B",
            "autoCompressionEnabled": true
        },
        "visualLocator": {
            "enabled": true,
            "host": "127.0.0.1",
            "port": 8000,
            "apiKey": "local",
            "modelAlias": "nvidia/LocateAnything-3B",
            "serverPath": "/home/reid/.local/share/darkfactory/locateanything/bin/llama-server",
            "modelPath": "/home/reid/DarkFactoryModels/LocateAnything-3B-GGUF/LocateAnything-3B-Q4_K_M.gguf",
            "mmprojPath": "/home/reid/DarkFactoryModels/LocateAnything-3B-GGUF/mmproj-LocateAnything-3B-BF16.gguf",
            "gpuLayers": "all",
            "contextSize": 4096,
            "autoStartWithGateway": false
        },
        "profiles": default_agent_runtime_profiles()
    })
}

fn merge_value(base: &mut Value, saved: Value) {
    match (base, saved) {
        (Value::Object(base_map), Value::Object(saved_map)) => {
            for (key, value) in saved_map {
                if let Some(base_value) = base_map.get_mut(&key) {
                    merge_value(base_value, value);
                } else {
                    base_map.insert(key, value);
                }
            }
        }
        (base_slot, value) => *base_slot = value,
    }
}

fn load_config_value() -> Result<Value, AppError> {
    let mut config = default_config();
    let path = config_path()?;
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| app_error("config", "Could not read config", e.to_string(), "Check file permissions and try again."))?;
        let saved = serde_json::from_str::<Value>(&raw).map_err(|e| app_error("config", "Config file is invalid", format!("{} could not be parsed: {}", path.display(), e), "Fix or remove the config file, then restart Atlas Workbench."))?;
        merge_value(&mut config, saved);
    }
    ensure_gpu_offload_mode(&mut config);
    let initialized = value_at(&config, &["gpu", "autoOffloadInitialized"]).and_then(Value::as_bool).unwrap_or(false);
    if !initialized && collect_gpu().get("detected").and_then(Value::as_bool).unwrap_or(false) {
        if let Some(gpu) = config.get_mut("gpu").and_then(Value::as_object_mut) {
            gpu.insert("autoOffloadInitialized".to_string(), json!(true));
        }
        save_config_value(&config)?;
    }
    let profile_version = value_at(&config, &["gpu", "optimizedProfileVersion"]).and_then(Value::as_i64).unwrap_or(0);
    if profile_version < 1 && collect_gpu().get("detected").and_then(Value::as_bool).unwrap_or(false) {
        if let Some(flags) = config.get_mut("serverFlags").and_then(Value::as_object_mut) {
            flags.insert("alias".to_string(), json!("Qwythos-9B"));
            flags.insert("ctx-size".to_string(), json!(98304));
            flags.insert("n-gpu-layers".to_string(), json!(999));
            flags.insert("flash-attn".to_string(), json!("on"));
            flags.insert("cache-type-k".to_string(), json!("q8_0"));
            flags.insert("cache-type-v".to_string(), json!("q8_0"));
            flags.insert("threads".to_string(), json!(16));
            flags.insert("threads-batch".to_string(), json!(16));
            flags.insert("parallel".to_string(), json!(1));
            flags.insert("batch-size".to_string(), json!(1024));
            flags.insert("ubatch-size".to_string(), json!(256));
            flags.insert("cont-batching".to_string(), json!(true));
            flags.insert("slots".to_string(), json!(true));
            flags.insert("metrics".to_string(), json!(true));
            flags.insert("context-shift".to_string(), json!(true));
            flags.insert("predict".to_string(), json!(8192));
            flags.insert("reasoning".to_string(), json!("off"));
            flags.insert("reasoning-budget".to_string(), json!(0));
        }
        if let Some(gpu) = config.get_mut("gpu").and_then(Value::as_object_mut) {
            gpu.insert("optimizedProfileVersion".to_string(), json!(1));
            gpu.entry("offloadMode".to_string()).or_insert_with(|| json!("auto"));
        }
        save_config_value(&config)?;
    }
    let profile_version = value_at(&config, &["gpu", "optimizedProfileVersion"]).and_then(Value::as_i64).unwrap_or(0);
    if profile_version < OPTIMIZED_PROFILE_VERSION && collect_gpu().get("detected").and_then(Value::as_bool).unwrap_or(false) {
        if let Some(flags) = config.get_mut("serverFlags").and_then(Value::as_object_mut) {
            flags.insert("alias".to_string(), json!("Qwen3-Coder-30B-A3B"));
            flags.insert("ctx-size".to_string(), json!(188000));
            flags.insert("n-gpu-layers".to_string(), json!(999));
            flags.insert("flash-attn".to_string(), json!("on"));
            flags.insert("cache-type-k".to_string(), json!("q4_0"));
            flags.insert("cache-type-v".to_string(), json!("q4_0"));
            flags.insert("threads".to_string(), json!(16));
            flags.insert("threads-batch".to_string(), json!(16));
            flags.insert("parallel".to_string(), json!(1));
            flags.insert("batch-size".to_string(), json!(1024));
            flags.insert("ubatch-size".to_string(), json!(256));
            flags.insert("cont-batching".to_string(), json!(true));
            flags.insert("slots".to_string(), json!(true));
            flags.insert("metrics".to_string(), json!(true));
            flags.insert("context-shift".to_string(), json!(true));
            flags.insert("predict".to_string(), json!(8192));
            flags.insert("reasoning".to_string(), json!("off"));
            flags.insert("reasoning-budget".to_string(), json!(0));
            flags.insert("temp".to_string(), json!(0.2));
            flags.insert("top-k".to_string(), json!(20));
            flags.insert("top-p".to_string(), json!(0.8));
            flags.insert("repeat-penalty".to_string(), json!(1.05));
        }
        if let Some(runtime) = config.get_mut("agentRuntime").and_then(Value::as_object_mut) {
            runtime.insert("activeProfileId".to_string(), json!("3090-ti-qwen3-coder-30b-a3b-q4-xl-188k-full-gpu"));
            runtime.insert("profiles".to_string(), default_agent_runtime_profiles());
            if let Some(gateway) = runtime.get_mut("gateway").and_then(Value::as_object_mut) {
                gateway.insert("host".to_string(), json!("0.0.0.0"));
                gateway.insert("modelAlias".to_string(), json!("Qwen3-Coder-30B-A3B"));
                gateway.insert("autoCompressionEnabled".to_string(), json!(true));
            }
            runtime.entry("visualLocator".to_string()).or_insert_with(|| default_agent_runtime_config().get("visualLocator").cloned().unwrap_or_else(|| json!({})));
        }
        if let Some(model) = config.get_mut("model").and_then(Value::as_object_mut) {
            model.insert("directory".to_string(), json!("/home/reid/Downloads"));
            model.insert("selectedModel".to_string(), json!("/home/reid/Downloads/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf"));
        }
        if let Some(server) = config.get_mut("server").and_then(Value::as_object_mut) {
            server.insert("host".to_string(), json!("127.0.0.1"));
            server.insert("port".to_string(), json!(8099));
        }
        if let Some(gpu) = config.get_mut("gpu").and_then(Value::as_object_mut) {
            gpu.insert("optimizedProfileVersion".to_string(), json!(OPTIMIZED_PROFILE_VERSION));
            gpu.insert("offloadMode".to_string(), json!("full"));
        }
        save_config_value(&config)?;
    }
    ensure_gpu_offload_mode(&mut config);
    let server_binary = string_at(&config, &["binaryPaths", "server"]);
    let finetune_binary = string_at(&config, &["binaryPaths", "finetune"]);
    if !server_binary.is_empty() && server_binary == finetune_binary {
        let sibling = Path::new(&server_binary).parent().map(|p| p.join("llama-finetune"));
        if let Some(sibling) = sibling {
            if sibling.is_file() && sibling.metadata().map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false) {
                if let Some(paths) = config.get_mut("binaryPaths").and_then(Value::as_object_mut) {
                    paths.insert("finetune".to_string(), json!(sibling.to_string_lossy().to_string()));
                    save_config_value(&config)?;
                }
            }
        }
    }
    Ok(config)
}

fn save_config_value(config: &Value) -> Result<(), AppError> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| app_error("config", "Could not create config directory", e.to_string(), "Check permissions and try again."))?;
    }
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(config).map_err(|e| app_error("config", "Could not encode config", e.to_string(), "Try saving again."))?;
    fs::write(&tmp, raw).map_err(|e| app_error("config", "Could not write config", e.to_string(), "Check permissions and try again."))?;
    fs::rename(tmp, path).map_err(|e| app_error("config", "Could not finalize config", e.to_string(), "Check permissions and try again."))?;
    Ok(())
}

fn value_at<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let mut cur = value;
    for key in keys {
        cur = cur.get(*key)?;
    }
    Some(cur)
}

fn string_at(value: &Value, keys: &[&str]) -> String {
    value_at(value, keys).and_then(Value::as_str).unwrap_or("").to_string()
}

fn number_at(value: &Value, keys: &[&str], default: i64) -> i64 {
    value_at(value, keys).and_then(Value::as_i64).unwrap_or(default)
}

fn valid_gpu_offload_mode(mode: &str) -> bool {
    matches!(mode, "auto" | "full" | "manual" | "cpu")
}

fn inferred_gpu_offload_mode(config: &Value) -> &'static str {
    let layers = number_at(config, &["serverFlags", "n-gpu-layers"], 999);
    if layers <= 0 {
        "cpu"
    } else if layers >= 999 {
        "auto"
    } else {
        "manual"
    }
}

fn ensure_gpu_offload_mode(config: &mut Value) {
    let existing = string_at(config, &["gpu", "offloadMode"]);
    if valid_gpu_offload_mode(&existing) {
        return;
    }
    let mode = inferred_gpu_offload_mode(config);
    if let Some(gpu) = config.get_mut("gpu").and_then(Value::as_object_mut) {
        gpu.insert("offloadMode".to_string(), json!(mode));
    }
}

fn gpu_offload_mode(config: &Value) -> String {
    let mode = string_at(config, &["gpu", "offloadMode"]);
    if valid_gpu_offload_mode(&mode) {
        mode
    } else {
        inferred_gpu_offload_mode(config).to_string()
    }
}

fn server_flag_name(id: &str) -> Option<&'static str> {
    Some(match id {
        "api-key" => "--api-key",
        "alias" => "--alias",
        "batch-size" => "--batch-size",
        "cache-prompt" => "--cache-prompt",
        "cache-reuse" => "--cache-reuse",
        "cache-type-k" => "--cache-type-k",
        "cache-type-v" => "--cache-type-v",
        "chat-template" => "--chat-template",
        "chat-template-file" => "--chat-template-file",
        "context-shift" => "--context-shift",
        "cont-batching" => "--cont-batching",
        "control-vector" => "--control-vector",
        "control-vector-scaled" => "--control-vector-scaled",
        "ctx-size" => "--ctx-size",
        "defrag-thold" => "--defrag-thold",
        "device" => "--device",
        "draft-max" => "--draft-max",
        "draft-min" => "--draft-min",
        "draft-model" => "--model-draft",
        "draft-p-min" => "--draft-p-min",
        "dynatemp-exp" => "--dynatemp-exp",
        "dynatemp-range" => "--dynatemp-range",
        "embd-normalize" => "--embd-normalize",
        "embedding" => "--embedding",
        "escape" => "--escape",
        "flash-attn" => "--flash-attn",
        "frequency-penalty" => "--frequency-penalty",
        "grammar" => "--grammar",
        "grammar-file" => "--grammar-file",
        "ignore-eos" => "--ignore-eos",
        "jinja" => "--jinja",
        "json-schema" => "--json-schema",
        "json-schema-file" => "--json-schema-file",
        "keep" => "--keep",
        "log-prefix" => "--log-prefix",
        "log-timestamps" => "--log-timestamps",
        "logit-bias" => "--logit-bias",
        "lora" => "--lora",
        "lora-scaled" => "--lora-scaled",
        "main-gpu" => "--main-gpu",
        "metrics" => "--metrics",
        "min-p" => "--min-p",
        "mirostat" => "--mirostat",
        "mirostat-ent" => "--mirostat-ent",
        "mirostat-lr" => "--mirostat-lr",
        "mlock" => "--mlock",
        "n-gpu-layers" => "--n-gpu-layers",
        "no-mmap" => "--no-mmap",
        "no-perf" => "--no-perf",
        "numa" => "--numa",
        "override-kv" => "--override-kv",
        "override-tensor" => "--override-tensor",
        "parallel" => "--parallel",
        "path" => "--path",
        "pooling" => "--pooling",
        "predict" => "--n-predict",
        "presence-penalty" => "--presence-penalty",
        "props" => "--props",
        "reasoning" => "--reasoning",
        "reasoning-budget" => "--reasoning-budget",
        "reasoning-format" => "--reasoning-format",
        "repeat-last-n" => "--repeat-last-n",
        "repeat-penalty" => "--repeat-penalty",
        "reranking" => "--reranking",
        "reuse-port" => "--reuse-port",
        "rope-freq-base" => "--rope-freq-base",
        "rope-freq-scale" => "--rope-freq-scale",
        "rope-scaling" => "--rope-scaling",
        "samplers" => "--samplers",
        "seed" => "--seed",
        "slots" => "--slots",
        "split-mode" => "--split-mode",
        "sse-ping-interval" => "--sse-ping-interval",
        "ssl-cert-file" => "--ssl-cert-file",
        "ssl-key-file" => "--ssl-key-file",
        "temp" => "--temp",
        "tensor-split" => "--tensor-split",
        "threads" => "--threads",
        "threads-batch" => "--threads-batch",
        "threads-http" => "--threads-http",
        "timeout" => "--timeout",
        "top-k" => "--top-k",
        "top-nsigma" => "--top-nsigma",
        "top-p" => "--top-p",
        "typical-p" => "--typical-p",
        "ubatch-size" => "--ubatch-size",
        "warmup" => "--warmup",
        "webui" => "--webui",
        "xtc-probability" => "--xtc-probability",
        "xtc-threshold" => "--xtc-threshold",
        "yarn-attn-factor" => "--yarn-attn-factor",
        "yarn-beta-fast" => "--yarn-beta-fast",
        "yarn-beta-slow" => "--yarn-beta-slow",
        "yarn-ext-factor" => "--yarn-ext-factor",
        "yarn-orig-ctx" => "--yarn-orig-ctx",
        _ => return None,
    })
}

fn negated_server_flag_name(id: &str) -> Option<&'static str> {
    Some(match id {
        "cache-prompt" => "--no-cache-prompt",
        "context-shift" => "--no-context-shift",
        "cont-batching" => "--no-cont-batching",
        "escape" => "--no-escape",
        "jinja" => "--no-jinja",
        "log-prefix" => "--no-log-prefix",
        "log-timestamps" => "--no-log-timestamps",
        "slots" => "--no-slots",
        "warmup" => "--no-warmup",
        "webui" => "--no-webui",
        _ => return None,
    })
}

fn push_value_arg(args: &mut Vec<String>, flag: &str, value: &Value) {
    match value {
        Value::Bool(true) => args.push(flag.to_string()),
        Value::Bool(false) | Value::Null => {}
        Value::Number(n) => {
            args.push(flag.to_string());
            args.push(n.to_string());
        }
        Value::String(s) if !s.is_empty() => {
            args.push(flag.to_string());
            args.push(s.clone());
        }
        _ => {}
    }
}

fn push_server_arg(args: &mut Vec<String>, id: &str, value: &Value) {
    match value {
        Value::Bool(true) => {
            if let Some(flag) = server_flag_name(id) {
                args.push(flag.to_string());
            }
        }
        Value::Bool(false) => {
            if let Some(flag) = negated_server_flag_name(id) {
                args.push(flag.to_string());
            }
        }
        _ => {
            if let Some(flag) = server_flag_name(id) {
                push_value_arg(args, flag, value);
            }
        }
    }
}

fn push_gpu_layer_arg(args: &mut Vec<String>, config: &Value, value: &Value) {
    match gpu_offload_mode(config).as_str() {
        "auto" => {}
        "cpu" => {
            args.push("--n-gpu-layers".to_string());
            args.push("0".to_string());
        }
        _ => push_server_arg(args, "n-gpu-layers", value),
    }
}

fn always_emit_server_flag(id: &str) -> bool {
    matches!(id, "alias" | "parallel" | "n-gpu-layers" | "flash-attn" | "ctx-size" | "batch-size" | "ubatch-size" | "threads" | "threads-batch" | "predict" | "cache-type-k" | "cache-type-v" | "metrics")
}

fn server_default_value(id: &str) -> Option<Value> {
    Some(match id {
        "api-key" | "device" | "tensor-split" | "path" | "draft-model" | "logit-bias" | "chat-template" | "chat-template-file" | "grammar" | "grammar-file" | "lora" | "lora-scaled" | "control-vector" | "ssl-key-file" | "ssl-cert-file" | "override-tensor" => json!(""),
        "alias" => json!("Qwen3-Coder-30B-A3B"),
        "parallel" => json!(1),
        "cont-batching" | "slots" | "webui" | "log-prefix" | "warmup" => json!(true),
        "metrics" | "context-shift" => json!(true),
        "mlock" | "no-mmap" | "no-perf" | "ignore-eos" | "embedding" | "reranking" => json!(false),
        "n-gpu-layers" => json!(999),
        "split-mode" => json!("layer"),
        "main-gpu" => json!(0),
        "numa" => json!("disabled"),
        "flash-attn" => json!("on"),
        "draft-max" => json!(16),
        "draft-min" => json!(5),
        "draft-p-min" => json!(0.9),
        "ctx-size" => json!(188000),
        "batch-size" => json!(1024),
        "ubatch-size" => json!(256),
        "keep" => json!(0),
        "threads" | "threads-batch" => json!(16),
        "predict" => json!(8192),
        "top-nsigma" | "embd-normalize" => json!(-1),
        "reasoning-budget" => json!(0),
        "cache-type-k" | "cache-type-v" => json!("q4_0"),
        "defrag-thold" => json!(0.1),
        "cache-reuse" => json!(0),
        "temp" => json!(0.2),
        "top-k" => json!(20),
        "top-p" => json!(0.8),
        "min-p" => json!(0.05),
        "typical-p" => json!(1.0),
        "repeat-penalty" => json!(1.05),
        "repeat-last-n" => json!(64),
        "presence-penalty" | "frequency-penalty" | "dynatemp-range" | "xtc-probability" => json!(0),
        "mirostat" => json!("0"),
        "mirostat-lr" => json!(0.1),
        "mirostat-ent" => json!(5.0),
        "dynatemp-exp" => json!(1.0),
        "xtc-threshold" => json!(0.1),
        "samplers" => json!("top_k;typ_p;top_p;min_p;temperature"),
        "seed" => json!(-1),
        "jinja" => json!(false),
        "reasoning" => json!("off"),
        "reasoning-format" => json!("deepseek"),
        "escape" => json!(false),
        "rope-scaling" => json!("none"),
        "rope-freq-base" => json!(0.0),
        "rope-freq-scale" => json!(1.0),
        "yarn-orig-ctx" => json!(0),
        "yarn-ext-factor" => json!(-1.0),
        "yarn-attn-factor" => json!(1.0),
        "yarn-beta-fast" => json!(32.0),
        "yarn-beta-slow" => json!(1.0),
        "pooling" => json!("mean"),
        _ => return None,
    })
}

fn value_matches_default(id: &str, value: &Value) -> bool {
    let Some(default) = server_default_value(id) else {
        return false;
    };
    match (value, default) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Bool(a), Value::Bool(b)) => *a == b,
        (Value::String(a), Value::String(b)) => a == &b,
        _ => false,
    }
}

fn shell_quote(arg: &str) -> String {
    if arg.chars().all(|c| c.is_ascii_alphanumeric() || "-._/:=".contains(c)) {
        arg.to_string()
    } else {
        format!("'{}'", arg.replace('\'', "'\\''"))
    }
}

fn redacted_args(args: &[String]) -> String {
    let mut result = Vec::new();
    let mut redact_next = false;
    for arg in args {
        if redact_next {
            result.push("[redacted]".to_string());
            redact_next = false;
        } else if arg == "--api-key" {
            result.push(arg.clone());
            redact_next = true;
        } else {
            result.push(shell_quote(arg));
        }
    }
    result.join(" ")
}

fn executable_candidates(role: &str) -> &'static [&'static str] {
    match role {
        "server" => &["llama-server", "server"],
        "finetune" => &["llama-finetune", "finetune"],
        _ => &[],
    }
}

fn validate_executable(path: &Path) -> Result<PathBuf, String> {
    let meta = fs::metadata(path).map_err(|_| format!("“{}” was not found. Check the path and try again.", path.display()))?;
    if meta.is_dir() {
        return Err(format!("“{}” is a folder, not an executable file.", path.display()));
    }
    if meta.permissions().mode() & 0o111 == 0 {
        return Err(format!("“{}” is not executable. Run chmod +x on it or pick a different file.", path.display()));
    }
    fs::canonicalize(path).map_err(|e| e.to_string())
}

fn validate_binary_role(path: &Path, role: &str) -> Result<(), String> {
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if role == "server" && name.contains("finetune") {
        return Err(format!("“{}” looks like a fine-tune binary, not llama-server.", path.display()));
    }
    if role == "finetune" && name.contains("server") {
        return Err(format!("“{}” looks like llama-server, not llama-finetune.", path.display()));
    }
    Ok(())
}

fn resolve_binary_path(path: &str, role: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(format!("The {} binary path is empty.", role));
    }
    let path = Path::new(trimmed);
    if path.is_dir() {
        for candidate in executable_candidates(role) {
            let candidate_path = path.join(candidate);
            if candidate_path.exists() {
                return validate_executable(&candidate_path);
            }
        }
        let names = executable_candidates(role).join(" or ");
        return Err(format!("“{}” is a folder, but it does not contain {}. Select the executable file itself or the folder that contains it.", path.display(), names));
    }
    let resolved = validate_executable(path)?;
    validate_binary_role(&resolved, role)?;
    Ok(resolved)
}

fn build_server_args(config: &Value) -> Vec<String> {
    let mut args = vec![
        "--host".to_string(),
        string_at(config, &["server", "host"]),
        "--port".to_string(),
        number_at(config, &["server", "port"], 8080).to_string(),
    ];
    let model = string_at(config, &["model", "selectedModel"]);
    if !model.is_empty() {
        args.push("--model".to_string());
        args.push(model);
    }
    if let Some(Value::Object(flags)) = value_at(config, &["serverFlags"]) {
        for (id, value) in flags {
            if id == "host" || id == "port" {
                continue;
            }
            if id == "n-gpu-layers" {
                push_gpu_layer_arg(&mut args, config, value);
                continue;
            }
            if !always_emit_server_flag(id) && value_matches_default(id, value) {
                continue;
            }
            push_server_arg(&mut args, id, value);
        }
    }
    args
}

fn build_finetune_args(config: &Value) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(Value::Object(params)) = value_at(config, &["finetune"]) {
        for (id, value) in params {
            let flag = match id.as_str() {
                "model-base" => "--model".to_string(),
                "train-data" => "--train-data".to_string(),
                "lora-out" => "--lora-out".to_string(),
                "checkpoint-in" => "--checkpoint-in".to_string(),
                "checkpoint-out" => "--checkpoint-out".to_string(),
                "n-threads" => "--threads".to_string(),
                other => format!("--{}", other),
            };
            push_value_arg(&mut args, &flag, value);
        }
    }
    args
}

fn append_process_log(ts: u128, kind: &str, stream: &str, text: &str) {
    let Some(base) = dirs::config_dir() else {
        return;
    };
    let dir = base.join("atlas-workbench").join("logs");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(format!("{}.log", kind));
    if path.metadata().map(|m| m.len() > PROCESS_LOG_MAX_BYTES).unwrap_or(false) {
        let rotated = dir.join(format!("{}.log.1", kind));
        let _ = fs::remove_file(&rotated);
        let _ = fs::rename(&path, rotated);
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let line = format!("ts={} stream={} {}\n", ts, stream, text.replace('\n', "\\n"));
        let _ = file.write_all(line.as_bytes());
    }
}

fn emit_log(app: &AppHandle, kind: &str, stream: &str, text: String) {
    emit_log_with_replace_key(app, kind, stream, text, None);
}

fn emit_log_with_replace_key(app: &AppHandle, kind: &str, stream: &str, text: String, replace_key: Option<&str>) {
    let ts = now();
    append_process_log(ts, kind, stream, &text);
    let mut payload = json!({ "kind": kind, "stream": stream, "text": text, "ts": ts });
    if let Some(key) = replace_key {
        payload["replaceKey"] = json!(key);
    }
    let _ = app.emit("log", payload);
}

fn remember_tail(tails: &Arc<Mutex<HashMap<String, Vec<String>>>>, kind: &str, text: String) {
    if let Ok(mut map) = tails.lock() {
        let tail = map.entry(kind.to_string()).or_default();
        tail.push(text);
        if tail.len() > 80 {
            tail.remove(0);
        }
    }
}

fn tail_text(tails: &Arc<Mutex<HashMap<String, Vec<String>>>>, kind: &str) -> Option<String> {
    tails.lock().ok().and_then(|map| map.get(kind).map(|lines| lines.join("\n"))).filter(|s| !s.is_empty())
}

fn is_gpu_memory_error(stderr_tail: &str) -> bool {
    let text = stderr_tail.to_ascii_lowercase();
    text.contains("cudamalloc failed: out of memory")
        || text.contains("failed to allocate buffer for kv cache")
        || text.contains("failed to initialize the context")
        || text.contains("failed to fit params to free device memory")
}

fn process_exit_error(scope: &str, kind: &str, code: Option<i32>, stderr_tail: Option<String>) -> AppError {
    let tail = stderr_tail.unwrap_or_default();
    let mut error = if kind == "server" && is_gpu_memory_error(&tail) {
        app_error(
            scope,
            "GPU memory allocation failed",
            "llama-server could not fit the model, KV cache, and compute buffers into available GPU memory.",
            "Use GPU Loading > Auto fit, lower Context Size, switch KV cache to q4_0/q5_0, or choose a smaller/lower-quant model, then click Start again.",
        )
    } else {
        app_error(
            scope,
            "Process exited with an error",
            format!("The {} process exited with code {}.", kind, code.map(|c| c.to_string()).unwrap_or_else(|| "signal".to_string())),
            "Read the log output, fix the binary path, model, or flags, then try again.",
        )
    };
    error.exit_code = code;
    if !tail.is_empty() {
        error.stderr_tail = Some(tail);
    }
    error
}

fn health_probe_host(listen_host: &str) -> String {
    let host = listen_host.trim().trim_start_matches('[').trim_end_matches(']');
    match host {
        "" | "0.0.0.0" | "::" | "*" => "127.0.0.1".to_string(),
        other => other.to_string(),
    }
}

fn http_addr(host: &str, port: i64) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{}]:{}", host, port)
    } else {
        format!("{}:{}", host, port)
    }
}

fn child_registered(children: &Arc<Mutex<HashMap<String, Child>>>, kind: &str) -> bool {
    children.lock().map(|map| map.contains_key(kind)).unwrap_or(false)
}

fn percent_fragment(text: &str) -> Option<String> {
    let percent_idx = text.find('%')?;
    let prefix = &text[..percent_idx];
    let start = prefix
        .char_indices()
        .rev()
        .find(|(_, ch)| !ch.is_ascii_digit() && *ch != '.')
        .map(|(idx, ch)| idx + ch.len_utf8())
        .unwrap_or(0);
    let value = prefix[start..].trim();
    if value.is_empty() {
        return None;
    }
    let parsed = value.parse::<f64>().ok()?;
    if !(0.0..=100.0).contains(&parsed) {
        return None;
    }
    Some(value.to_string())
}

fn model_loading_progress_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || !trimmed.contains('%') {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    let loading_related = lower.contains("load")
        || lower.contains("tensor")
        || lower.contains("model")
        || lower.contains("gguf")
        || lower.contains("llama_model");
    if !loading_related {
        return None;
    }
    percent_fragment(trimmed).map(|percent| format!("Model loading: {}%...", percent))
}

fn model_loading_stage_text(text: &str) -> Option<&'static str> {
    let lower = text.to_ascii_lowercase();
    if lower.contains("load_model: loading model") || lower.contains("loading model '") {
        return Some("Model loading: opening model file...");
    }
    if lower.contains("loaded meta data") || (lower.contains("llama_model_loader") && lower.contains("metadata")) {
        return Some("Model loading: reading GGUF metadata...");
    }
    if lower.contains("loading model tensors") || lower.contains("load_tensors") {
        return Some("Model loading: loading tensors...");
    }
    if lower.contains("offloading") || lower.contains("assigned to device") {
        return Some("Model loading: assigning layers to GPU...");
    }
    if lower.contains("initializing, n_slots") || lower.contains("llama_context") {
        return Some("Model loading: initializing context...");
    }
    if lower.contains("model loaded") {
        return Some("Model loading: ready.");
    }
    None
}

fn emit_process_fragment(app: &AppHandle, tails: &Arc<Mutex<HashMap<String, Vec<String>>>>, kind: &'static str, stream: &'static str, text: String) {
    let trimmed = text.trim_matches(['\r', '\n']).trim().to_string();
    if trimmed.is_empty() {
        return;
    }
    if stream == "stderr" {
        remember_tail(tails, kind, trimmed.clone());
    }
    if kind == "server" {
        if let Some(progress) = model_loading_progress_text(&trimmed) {
            emit_log_with_replace_key(app, kind, stream, progress, Some("server:model-loading"));
            return;
        }
        if let Some(stage) = model_loading_stage_text(&trimmed) {
            emit_log(app, kind, stream, trimmed);
            emit_log_with_replace_key(app, kind, "stdout", stage.to_string(), Some("server:model-loading"));
            return;
        }
    }
    emit_log(app, kind, stream, trimmed);
}

fn spawn_reader(app: AppHandle, tails: Arc<Mutex<HashMap<String, Vec<String>>>>, kind: &'static str, stream: &'static str, mut reader: impl std::io::Read + Send + 'static) {
    std::thread::spawn(move || {
        let mut read_buf = [0_u8; 4096];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut read_buf) {
                Ok(0) => break,
                Ok(n) => {
                    for byte in &read_buf[..n] {
                        if *byte == b'\n' || *byte == b'\r' {
                            if !pending.is_empty() {
                                let text = String::from_utf8_lossy(&pending).to_string();
                                emit_process_fragment(&app, &tails, kind, stream, text);
                                pending.clear();
                            }
                        } else {
                            pending.push(*byte);
                        }
                    }
                }
                Err(err) => {
                    emit_log(&app, kind, "stderr", format!("Could not read {} stream: {}", stream, err));
                    break;
                }
            }
        }
        if !pending.is_empty() {
            let text = String::from_utf8_lossy(&pending).to_string();
            emit_process_fragment(&app, &tails, kind, stream, text);
        }
    });
}

fn kill_child_from_children(app: &AppHandle, children: &Arc<Mutex<HashMap<String, Child>>>, kind: &'static str) {
    if let Ok(mut map) = children.lock() {
        if let Some(mut child) = map.remove(kind) {
            let pid = child.id();
            terminate_managed_child(&mut child);
            let status = json!({ "kind": kind, "state": "exited", "pid": pid, "exitCode": null, "endedAt": now() });
            let _ = app.emit("status", status);
        }
    }
}

fn kill_all_managed_children(children: &Arc<Mutex<HashMap<String, Child>>>) {
    let Ok(mut map) = children.lock() else {
        return;
    };
    for (_, mut child) in map.drain() {
        terminate_managed_child(&mut child);
    }
}

fn signal_process_group(pid: u32, signal: &str) {
    let _ = Command::new("kill").args([format!("-{}", signal), "--".to_string(), format!("-{}", pid)]).status();
}

fn terminate_managed_child(child: &mut Child) {
    let pid = child.id();
    signal_process_group(pid, "TERM");
    let _ = child.kill();
    for _ in 0..50 {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    signal_process_group(pid, "KILL");
    let _ = child.kill();
    let _ = child.wait();
}

fn spawn_exit_watcher(app: AppHandle, children: Arc<Mutex<HashMap<String, Child>>>, tails: Arc<Mutex<HashMap<String, Vec<String>>>>, kind: &'static str, pid: u32) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let status = {
            let mut map = match children.lock() {
                Ok(map) => map,
                Err(_) => return,
            };
            let Some(child) = map.get_mut(kind) else {
                return;
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    map.remove(kind);
                    Some(status)
                }
                Ok(None) => None,
                Err(err) => {
                    emit_log(&app, kind, "stderr", format!("Could not read process status for pid {}: {}", pid, err));
                    map.remove(kind);
                    None
                }
            }
        };
        if let Some(status) = status {
            let code = status.code();
            emit_log(&app, kind, "stderr", format!("Process pid {} exited with code {}.", pid, code.map(|c| c.to_string()).unwrap_or_else(|| "signal".to_string())));
            let payload = json!({ "kind": kind, "state": "exited", "pid": pid, "exitCode": code, "endedAt": now() });
            let _ = app.emit("status", payload);
            if kind == "finetune" && code == Some(0) {
                if let Ok(config) = load_config_value() {
                    let output_path = string_at(&config, &["finetune", "lora-out"]);
                    let exists = !output_path.is_empty() && Path::new(&output_path).is_file();
                    let _ = app.emit("training-complete", json!({ "outputPath": output_path, "exists": exists, "exitCode": code }));
                }
            }
            if code != Some(0) || kind == "server" {
                let error = process_exit_error(kind, kind, code, tail_text(&tails, kind));
                let _ = app.emit("error", error);
            }
            return;
        }
    });
}

fn start_child(app: AppHandle, state: &State<AppState>, kind: &'static str, binary: String, args: Vec<String>) -> Result<Value, AppError> {
    start_child_with_env(app, state, kind, binary, args, Vec::new())
}

fn start_child_with_env(app: AppHandle, state: &State<AppState>, kind: &'static str, binary: String, args: Vec<String>, envs: Vec<(String, String)>) -> Result<Value, AppError> {
    if state.children.lock().map_err(|_| app_error(kind, "Process state unavailable", "Could not lock the process table.", "Restart Atlas Workbench and try again."))?.contains_key(kind) {
        return Err(app_error(kind, "Process is already running", format!("A {} process is already running.", kind), "Stop the running process before starting another one."));
    }
    let resolved = resolve_binary_path(&binary, kind).map_err(|message| app_error(kind, "Binary path is not runnable", message, "Open Settings and select your llama.cpp executable or its containing folder."))?;
    if let Ok(mut tails) = state.log_tails.lock() {
        tails.remove(kind);
    }
    emit_log(&app, kind, "stdout", format!("Launching: {} {}", shell_quote(&resolved.to_string_lossy()), redacted_args(&args)));
    let mut command = Command::new(&resolved);
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    for (key, value) in envs {
        command.env(key, value);
    }
    let mut child = command
        .spawn()
        .map_err(|e| app_error(kind, "Could not launch process", e.to_string(), "Check the binary path and permissions, then try again."))?;
    let pid = child.id();
    let tails = state.log_tails.clone();
    if let Some(stdout) = child.stdout.take() {
        spawn_reader(app.clone(), tails.clone(), kind, "stdout", stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_reader(app.clone(), tails.clone(), kind, "stderr", stderr);
    }
    let children = state.children.clone();
    children.lock().map_err(|_| app_error(kind, "Process state unavailable", "Could not lock the process table.", "Restart Atlas Workbench and try again."))?.insert(kind.to_string(), child);
    let status = json!({ "kind": kind, "state": "running", "pid": pid, "startedAt": now() });
    spawn_exit_watcher(app, children, tails, kind, pid);
    Ok(status)
}

fn wait_for_server_ready(
    app: &AppHandle,
    children: &Arc<Mutex<HashMap<String, Child>>>,
    tails: &Arc<Mutex<HashMap<String, Vec<String>>>>,
    host: &str,
    port: i64,
    timeout: Duration,
) -> Result<(), AppError> {
    if port < 1 || port > u16::MAX as i64 {
        return Err(app_error("server-control", "Invalid server port", format!("{} is not a valid TCP port.", port), "Choose a port from 1 to 65535."));
    }
    let probe_host = health_probe_host(host);
    let url_addr = http_addr(&probe_host, port);
    let deadline = Instant::now() + timeout;
    let started = Instant::now();
    let mut last_progress = Instant::now();
    let mut attempts = 0_u64;
    let mut last_detail = "health probe has not connected yet".to_string();
    emit_log_with_replace_key(
        app,
        "server",
        "stdout",
        format!(
            "Waiting for llama-server health at http://{}/health (listen host {}, timeout {}s)",
            url_addr,
            host,
            timeout.as_secs()
        ),
        Some("server:health-wait"),
    );

    while Instant::now() < deadline {
        if !child_registered(children, "server") {
            return Err(process_exit_error("server-control", "server", None, tail_text(tails, "server")));
        }

        let socket = match (probe_host.as_str(), port as u16).to_socket_addrs().ok().and_then(|mut addrs| addrs.next()) {
            Some(socket) => socket,
            None => {
                last_detail = format!("could not resolve health probe host {}", probe_host);
                std::thread::sleep(Duration::from_millis(500));
                continue;
            }
        };

        attempts += 1;
        match TcpStream::connect_timeout(&socket, Duration::from_millis(750)) {
            Ok(mut stream) => {
                let _ = stream.set_read_timeout(Some(Duration::from_millis(1000)));
                let _ = stream.set_write_timeout(Some(Duration::from_millis(1000)));
                let request = format!("GET /health HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n", url_addr);
                if stream.write_all(request.as_bytes()).is_ok() {
                    let mut response = String::new();
                    let _ = stream.read_to_string(&mut response);
                    let first = response.lines().next().unwrap_or("");
                    if first.contains(" 200 ") {
                        emit_log(app, "server", "stdout", "llama-server health check passed. Model is ready.".to_string());
                        return Ok(());
                    }
                    if first.is_empty() {
                        last_detail = "health endpoint returned an empty response".to_string();
                    } else {
                        last_detail = first.to_string();
                    }
                } else {
                    last_detail = "could not write the health request".to_string();
                }
            }
            Err(err) => {
                last_detail = format!("connection failed: {}", err);
            }
        }

        if last_progress.elapsed() >= Duration::from_secs(HEALTH_PROGRESS_LOG_SECS) {
            emit_log_with_replace_key(
                app,
                "server",
                "stdout",
                format!(
                    "Health check still waiting after {}s (attempt {}): {}",
                    started.elapsed().as_secs(),
                    attempts,
                    last_detail
                ),
                Some("server:health-wait"),
            );
            last_progress = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    let mut error = app_error(
        "server-control",
        "Server did not become ready",
        format!("The llama-server process started, but http://{}/health did not return ready before the {}s timeout. Last health check: {}", url_addr, timeout.as_secs(), last_detail),
        "Check the server log for model loading errors, invalid flags, or a model that needs more time/VRAM to load.",
    );
    error.stderr_tail = tail_text(tails, "server");
    Err(error)
}

fn spawn_server_ready_watcher(
    app: AppHandle,
    children: Arc<Mutex<HashMap<String, Child>>>,
    tails: Arc<Mutex<HashMap<String, Vec<String>>>>,
    host: String,
    port: i64,
    pid: u32,
    started_at: Value,
) {
    std::thread::spawn(move || {
        match wait_for_server_ready(&app, &children, &tails, &host, port, Duration::from_secs(SERVER_READY_TIMEOUT_SECS)) {
            Ok(()) => {
                if child_registered(&children, "server") {
                    let status = json!({ "kind": "server", "state": "running", "pid": pid, "startedAt": started_at });
                    let _ = app.emit("status", status);
                }
            }
            Err(error) => {
                if child_registered(&children, "server") {
                    let _ = app.emit("error", error.clone());
                    emit_log(&app, "server", "stderr", error.message);
                    kill_child_from_children(&app, &children, "server");
                }
            }
        }
    });
}

fn process_cmdline(pid: usize) -> Option<String> {
    let raw = fs::read(format!("/proc/{}/cmdline", pid)).ok()?;
    let parts: Vec<String> = raw
        .split(|b| *b == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part).to_string())
        .collect();
    if parts.is_empty() { None } else { Some(parts.join(" ")) }
}

fn discover_llama_processes() -> Vec<(usize, String)> {
    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir("/proc") {
        for entry in entries.flatten() {
            let Some(pid) = entry.file_name().to_str().and_then(|name| name.parse::<usize>().ok()) else {
                continue;
            };
            let Some(cmdline) = process_cmdline(pid) else {
                continue;
            };
            if cmdline.contains("llama-server") || cmdline.contains("llama.cpp") || cmdline.contains("llama-finetune") {
                result.push((pid, cmdline));
            }
        }
    }
    result
}

fn processes_matching_port(port: i64) -> Vec<(usize, String)> {
    let port_s = port.to_string();
    discover_llama_processes()
        .into_iter()
        .filter(|(_, cmdline)| {
            let args: Vec<&str> = cmdline.split_whitespace().collect();
            args.windows(2).any(|w| (w[0] == "--port" || w[0] == "-p") && w[1] == port_s)
                || args.iter().any(|arg| arg == &format!("--port={}", port_s))
        })
        .collect()
}

fn processes_with_port_arg(port: i64) -> Vec<String> {
    processes_matching_port(port)
        .into_iter()
        .map(|(pid, cmdline)| format!("pid {}: {}", pid, cmdline))
        .collect()
}

fn kill_external_pid(pid: usize) {
    let _ = Command::new("kill").arg(pid.to_string()).status();
    for _ in 0..20 {
        if !Path::new(&format!("/proc/{}", pid)).exists() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
}

fn ensure_port_free(host: &str, port: i64) -> Result<(), AppError> {
    let addr = format!("{}:{}", host, port);
    let socket = addr
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
        .ok_or_else(|| app_error("server-control", "Invalid listen address", format!("Could not resolve {}.", addr), "Check the Host and Port fields."))?;
    match TcpListener::bind(socket) {
        Ok(listener) => {
            drop(listener);
            Ok(())
        }
        Err(err) => {
            let matches = processes_with_port_arg(port);
            let detail = if matches.is_empty() {
                format!("{} is already in use: {}", addr, err)
            } else {
                format!("{} is already in use by {}", addr, matches.join("; "))
            };
            Err(app_error(
                "server-control",
                "Server port is already in use",
                detail,
                "Stop the existing llama-server process, or choose a different port before starting.",
            ))
        }
    }
}

#[tauri::command]
fn config_load() -> Result<Value, AppError> {
    load_config_value()
}

#[tauri::command]
fn config_save(config: Value) -> Result<Value, AppError> {
    save_config_value(&config)?;
    load_config_value()
}

#[tauri::command]
fn config_reset() -> Value {
    default_config()
}

#[tauri::command]
fn binary_validate(path: String) -> BinaryValidationResult {
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return BinaryValidationResult { path, ok: false, resolved: None, reason: Some("No path was provided. Choose the llama.cpp server or finetune binary.".to_string()) };
    }
    let path_ref = Path::new(&trimmed);
    if path_ref.is_dir() {
        for role in ["server", "finetune"] {
            if let Ok(resolved) = resolve_binary_path(&trimmed, role) {
                return BinaryValidationResult { path: trimmed, ok: true, resolved: Some(resolved.to_string_lossy().to_string()), reason: None };
            }
        }
        return BinaryValidationResult { path: trimmed.clone(), ok: false, resolved: None, reason: Some(format!("“{}” is a folder, but it does not contain llama-server/server or llama-finetune/finetune.", trimmed)) };
    }
    match validate_executable(path_ref) {
        Ok(resolved) => BinaryValidationResult { path: trimmed, ok: true, resolved: Some(resolved.to_string_lossy().to_string()), reason: None },
        Err(reason) => BinaryValidationResult { path: trimmed, ok: false, resolved: None, reason: Some(reason) },
    }
}

#[tauri::command]
fn binary_set(server: Option<String>, finetune: Option<String>) -> Result<Value, AppError> {
    let mut config = load_config_value()?;
    let server_path = server.unwrap_or_else(|| string_at(&config, &["binaryPaths", "server"]));
    let finetune_path = finetune.unwrap_or_else(|| string_at(&config, &["binaryPaths", "finetune"]));
    let server_path = if server_path.trim().is_empty() {
        server_path
    } else {
        resolve_binary_path(&server_path, "server").map_err(|message| app_error("binary-config", "Invalid server binary path", message, "Choose your llama-server executable or its containing folder."))?.to_string_lossy().to_string()
    };
    let finetune_path = if finetune_path.trim().is_empty() {
        finetune_path
    } else {
        resolve_binary_path(&finetune_path, "finetune").map_err(|message| app_error("binary-config", "Invalid finetune binary path", message, "Choose your llama-finetune executable or its containing folder."))?.to_string_lossy().to_string()
    };
    if let Some(obj) = config.as_object_mut() {
        obj.insert("binaryPaths".into(), json!({ "server": server_path, "finetune": finetune_path }));
    }
    save_config_value(&config)?;
    Ok(config)
}

#[tauri::command]
fn model_list(directory: String) -> Result<Value, AppError> {
    let path = Path::new(directory.trim());
    if !path.exists() || !path.is_dir() {
        return Err(app_error("model-management", "Could not open directory", format!("The directory “{}” could not be read. It may not exist or you may not have permission to access it.", path.display()), "Choose a different folder that exists and contains your model files."));
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| app_error("model-management", "Could not read directory", e.to_string(), "Choose a different folder and try again."))? {
        let entry = entry.map_err(|e| app_error("model-management", "Could not read directory entry", e.to_string(), "Choose a different folder and try again."))?;
        if entry.path().extension().and_then(|s| s.to_str()).map(|s| s.eq_ignore_ascii_case("gguf")).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                files.push(name.to_string());
            }
        }
    }
    files.sort();
    let message = if files.is_empty() { Some(format!("No .gguf files were found in “{}”.", path.display())) } else { None };
    Ok(json!({ "directory": directory, "files": files, "message": message }))
}

fn find_runtime_profile(config: &Value, profile_id: &str) -> Option<Value> {
    value_at(config, &["agentRuntime", "profiles"])
        .and_then(Value::as_array)
        .and_then(|profiles| profiles.iter().find(|profile| profile.get("id").and_then(Value::as_str) == Some(profile_id)))
        .cloned()
}

#[tauri::command]
fn runtime_profiles() -> Result<Value, AppError> {
    let config = load_config_value()?;
    Ok(value_at(&config, &["agentRuntime", "profiles"]).cloned().unwrap_or_else(default_agent_runtime_profiles))
}

#[tauri::command]
fn runtime_apply_profile(profile_id: String) -> Result<Value, AppError> {
    let mut config = load_config_value()?;
    let active = string_at(&config, &["agentRuntime", "activeProfileId"]);
    let requested = if profile_id.trim().is_empty() { active.as_str() } else { profile_id.trim() };
    let profile = find_runtime_profile(&config, requested)
        .or_else(|| find_runtime_profile(&config, "3090-ti-ornith-35b-96k-always-on"))
        .ok_or_else(|| app_error("agent-runtime", "Runtime profile unavailable", "Atlas could not find a usable agent runtime profile.", "Reset config or reinstall Atlas Workbench."))?;
    let resolved_id = profile.get("id").and_then(Value::as_str).unwrap_or("3090-ti-ornith-35b-96k-always-on").to_string();

    if let Some(flags) = profile.get("serverFlagOverrides").and_then(Value::as_object) {
        let target = config.get_mut("serverFlags").and_then(Value::as_object_mut)
            .ok_or_else(|| app_error("agent-runtime", "Server flags unavailable", "Atlas config is missing serverFlags.", "Reset config and try again."))?;
        for (key, value) in flags {
            target.insert(key.clone(), value.clone());
        }
    }
    if let Some(model_path) = profile.get("modelPath").and_then(Value::as_str) {
        let model_directory = profile
            .get("modelDirectory")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| Path::new(model_path).parent().map(|p| p.to_string_lossy().to_string()))
            .unwrap_or_default();
        if let Some(model) = config.get_mut("model").and_then(Value::as_object_mut) {
            model.insert("selectedModel".to_string(), json!(model_path));
            model.insert("directory".to_string(), json!(model_directory));
        }
    }
    if let Some(mode) = profile.get("gpuOffloadMode").and_then(Value::as_str) {
        if let Some(gpu) = config.get_mut("gpu").and_then(Value::as_object_mut) {
            gpu.insert("offloadMode".to_string(), json!(mode));
        }
    }
    if let Some(runtime) = config.get_mut("agentRuntime").and_then(Value::as_object_mut) {
        runtime.insert("activeProfileId".to_string(), json!(resolved_id.clone()));
        if let Some(gateway) = runtime.get_mut("gateway").and_then(Value::as_object_mut) {
            let model_alias = profile
                .get("serverFlagOverrides")
                .and_then(|flags| flags.get("alias"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("atlas/{}", resolved_id));
            gateway.insert("modelAlias".to_string(), json!(model_alias));
        }
    }
    save_config_value(&config)?;
    load_config_value()
}

fn http_get_text(host: &str, port: i64, path: &str, timeout: Duration) -> Result<(u16, String), String> {
    let client_host = client_host_for(host);
    let addr = format!("{}:{}", client_host, port);
    let mut addrs = addr.to_socket_addrs().map_err(|e| e.to_string())?;
    let socket = addrs.next().ok_or_else(|| format!("Could not resolve {}", addr))?;
    let mut stream = TcpStream::connect_timeout(&socket, timeout).map_err(|e| e.to_string())?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!("GET {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n", path, client_host);
    stream.write_all(request.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = String::new();
    stream.read_to_string(&mut raw).map_err(|e| e.to_string())?;
    let mut parts = raw.splitn(2, "\r\n\r\n");
    let headers = parts.next().unwrap_or_default();
    let body = parts.next().unwrap_or_default().to_string();
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);
    Ok((status, body))
}

fn client_host_for(host: &str) -> String {
    match host.trim() {
        "" | "0.0.0.0" | "::" | "*" => "127.0.0.1".to_string(),
        other => other.trim_matches(&['[', ']'][..]).to_string(),
    }
}

fn estimate_tokens(text: &str) -> i64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let wordish = trimmed.split_whitespace().count() as i64;
    let char_estimate = ((trimmed.len() as f64) / 4.0).ceil() as i64;
    wordish.max(char_estimate)
}

fn text_from_json(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().map(text_from_json).collect::<Vec<_>>().join("\n"),
        Value::Object(map) => {
            if let Some(Value::String(text)) = map.get("text") {
                text.clone()
            } else if let Some(Value::String(content)) = map.get("content") {
                content.clone()
            } else {
                map.values().map(text_from_json).collect::<Vec<_>>().join("\n")
            }
        }
        _ => String::new(),
    }
}

fn estimate_openai_prompt_tokens(body: &Value) -> i64 {
    let mut text = String::new();
    if let Some(messages) = body.get("messages").and_then(Value::as_array) {
        for message in messages {
            if let Some(content) = message.get("content") {
                text.push_str(&text_from_json(content));
                text.push('\n');
            }
        }
    }
    if let Some(prompt) = body.get("prompt").and_then(Value::as_str) {
        text.push_str(prompt);
    }
    estimate_tokens(&text)
}

fn structured_json_output_requested(body: &Value) -> bool {
    if let Some(response_format) = body.get("response_format") {
        let text = response_format.to_string().to_ascii_lowercase();
        if text.contains("json_object") || text.contains("json_schema") || text.contains("\"json\"") {
            return true;
        }
    }

    let mut text = String::new();
    if let Some(messages) = body.get("messages").and_then(Value::as_array) {
        for message in messages {
            if let Some(content) = message.get("content") {
                text.push_str(&text_from_json(content));
                text.push('\n');
            }
        }
    }
    if let Some(prompt) = body.get("prompt").and_then(Value::as_str) {
        text.push_str(prompt);
    }
    let lower = text.to_ascii_lowercase();
    lower.contains("json")
        && (
            lower.contains("return only")
            || lower.contains("strict json")
            || lower.contains("valid json")
            || lower.contains("json object")
            || lower.contains("json blueprint")
            || lower.contains("no markdown")
            || lower.contains("no explanation")
        )
}

fn with_configured_system_prompt(mut body: Value, config: &Value) -> Value {
    let prompt = string_at(config, &["systemPrompt"]);
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return body;
    }
    let Some(messages) = body.get_mut("messages").and_then(Value::as_array_mut) else {
        return body;
    };
    messages.insert(0, json!({ "role": "system", "content": prompt }));
    body
}

fn normalize_openai_request_for_gateway(mut body: Value) -> (Value, bool) {
    let structured = structured_json_output_requested(&body);
    if !structured {
        return (body, false);
    }
    if let Some(obj) = body.as_object_mut() {
        let kwargs = obj.entry("chat_template_kwargs".to_string()).or_insert_with(|| json!({}));
        if !kwargs.is_object() {
            *kwargs = json!({});
        }
        if let Some(map) = kwargs.as_object_mut() {
            map.insert("enable_thinking".to_string(), json!(false));
        }
    }
    (body, true)
}

fn truncate_for_token_budget(text: &str, target_tokens: i64) -> String {
    if estimate_tokens(text) <= target_tokens {
        return text.to_string();
    }
    let char_budget = (target_tokens.max(100) * 4) as usize;
    if text.len() <= char_budget {
        return text.to_string();
    }
    let head_chars = ((char_budget as f64) * 0.58).floor() as usize;
    let tail_chars = ((char_budget as f64) * 0.32).floor() as usize;
    let omitted = text.len().saturating_sub(head_chars + tail_chars);
    let head = text.chars().take(head_chars).collect::<String>();
    let tail_len = tail_chars.min(text.chars().count());
    let tail = text.chars().rev().take(tail_len).collect::<String>().chars().rev().collect::<String>();
    format!(
        "{}\n\n[Atlas automatic compression: omitted {} middle characters to keep this local request inside the active context budget.]\n\n{}",
        head.trim_end(),
        omitted,
        tail.trim_start()
    )
}

fn compress_openai_request(mut body: Value, max_prompt_tokens: i64) -> (Value, bool, i64, i64) {
    let before = estimate_openai_prompt_tokens(&body);
    let target = ((max_prompt_tokens as f64) * 0.82).floor().max(1024.0) as i64;
    let mut compressed = false;

    if let Some(prompt) = body.get("prompt").and_then(Value::as_str) {
        let clipped = truncate_for_token_budget(prompt, target);
        if clipped != prompt {
            compressed = true;
            if let Some(obj) = body.as_object_mut() {
                obj.insert("prompt".to_string(), json!(clipped));
            }
        }
    }

    if let Some(messages) = body.get_mut("messages").and_then(Value::as_array_mut) {
        let per_message_budget = (target / ((messages.len() as i64) + 1)).max(768);
        for message in messages.iter_mut() {
            if let Some(content) = message.get("content").cloned() {
                let original = text_from_json(&content);
                if !original.is_empty() {
                    let clipped = truncate_for_token_budget(&original, per_message_budget);
                    if clipped != original {
                        compressed = true;
                        if let Some(obj) = message.as_object_mut() {
                            obj.insert("content".to_string(), json!(clipped));
                        }
                    }
                }
            }
        }
    }

    let after = estimate_openai_prompt_tokens(&body);
    (body, compressed, before, after)
}

fn structured_empty_content_error(response_body: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(response_body).ok()?;
    let choices = parsed.get("choices").and_then(Value::as_array)?;
    let has_reasoning_only_choice = choices.iter().any(|choice| {
        let Some(message) = choice.get("message").and_then(Value::as_object) else {
            return false;
        };
        let content = message.get("content").and_then(Value::as_str).unwrap_or("").trim();
        let reasoning = message.get("reasoning_content").and_then(Value::as_str).unwrap_or("").trim();
        content.is_empty() && !reasoning.is_empty()
    });
    if !has_reasoning_only_choice {
        return None;
    }
    Some(json!({
        "error": {
            "message": "Atlas blocked an upstream reasoning-only response: the model returned hidden reasoning_content but empty final message.content for a structured JSON request. Atlas should disable thinking for structured output; retry the request.",
            "type": "atlas_structured_empty_content"
        }
    }).to_string())
}

fn active_profile(config: &Value) -> Option<Value> {
    let id = string_at(config, &["agentRuntime", "activeProfileId"]);
    find_runtime_profile(config, &id).or_else(|| find_runtime_profile(config, "3090-ti-ornith-35b-96k-always-on"))
}

fn active_max_prompt_tokens(config: &Value) -> i64 {
    active_profile(config)
        .and_then(|profile| profile.get("requestPolicy").and_then(|policy| policy.get("maxPromptTokens")).and_then(Value::as_i64).or(Some(77824)))
        .unwrap_or(77824)
}

fn gateway_auto_compression_enabled(config: &Value) -> bool {
    value_at(config, &["agentRuntime", "gateway", "autoCompressionEnabled"])
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

fn http_response(status: u16, content_type: &str, body: &str) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        413 => "Payload Too Large",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "OK",
    };
    format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        reason,
        content_type,
        body.len(),
        body
    )
    .into_bytes()
}

fn header_end(raw: &[u8]) -> Option<usize> {
    raw.windows(4).position(|window| window == b"\r\n\r\n")
}

fn read_http_request(stream: &mut TcpStream) -> Result<(String, String, HashMap<String, String>, Vec<u8>), String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut raw = Vec::new();
    let mut buf = [0_u8; 8192];
    let mut expected_len = None;
    loop {
        let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        raw.extend_from_slice(&buf[..n]);
        if let Some(end) = header_end(&raw) {
            let headers = String::from_utf8_lossy(&raw[..end]).to_string();
            let content_length = headers
                .lines()
                .find_map(|line| line.split_once(':').filter(|(key, _)| key.eq_ignore_ascii_case("content-length")).and_then(|(_, value)| value.trim().parse::<usize>().ok()))
                .unwrap_or(0);
            expected_len = Some(end + 4 + content_length);
        }
        if let Some(len) = expected_len {
            if raw.len() >= len {
                break;
            }
        }
        if raw.len() > 64 * 1024 * 1024 {
            return Err("Request body exceeds 64 MiB.".to_string());
        }
    }
    let end = header_end(&raw).ok_or_else(|| "Invalid HTTP request.".to_string())?;
    let header_text = String::from_utf8_lossy(&raw[..end]).to_string();
    let mut lines = header_text.lines();
    let request_line = lines.next().ok_or_else(|| "Missing HTTP request line.".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let body = raw[end + 4..].to_vec();
    Ok((method, path, headers, body))
}

fn gateway_api_key(config: &Value) -> String {
    string_at(config, &["agentRuntime", "gateway", "apiKey"]).trim().to_string()
}

fn gateway_request_token(headers: &HashMap<String, String>) -> String {
    let Some(raw) = headers.get("authorization") else {
        return String::new();
    };
    let trimmed = raw.trim();
    if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("bearer ") {
        return trimmed[7..].trim().to_string();
    }
    if trimmed.len() >= 6 && trimmed[..6].eq_ignore_ascii_case("basic ") {
        use base64::Engine;
        if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(trimmed[6..].trim()) {
            if let Ok(text) = String::from_utf8(decoded) {
                return text.split_once(':').map(|(_, token)| token.to_string()).unwrap_or(text);
            }
        }
        return String::new();
    }
    trimmed.to_string()
}

fn gateway_request_authorized(headers: &HashMap<String, String>, config: &Value) -> bool {
    let api_key = gateway_api_key(config);
    api_key.is_empty() || gateway_request_token(headers) == api_key
}

fn proxy_http_request(config: &Value, method: &str, path: &str, body: &[u8], content_type: &str) -> Result<(u16, String, String), String> {
    let host = string_at(config, &["server", "host"]);
    let port = number_at(config, &["server", "port"], 8080);
    let client_host = client_host_for(&host);
    let addr = format!("{}:{}", client_host, port);
    let mut addrs = addr.to_socket_addrs().map_err(|e| e.to_string())?;
    let socket = addrs.next().ok_or_else(|| format!("Could not resolve {}", addr))?;
    let mut stream = TcpStream::connect_timeout(&socket, Duration::from_secs(10)).map_err(|e| e.to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(600)));
    let request = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        method,
        path,
        client_host,
        content_type,
        body.len()
    );
    stream.write_all(request.as_bytes()).map_err(|e| e.to_string())?;
    if !body.is_empty() {
        stream.write_all(body).map_err(|e| e.to_string())?;
    }
    let mut raw = String::new();
    stream.read_to_string(&mut raw).map_err(|e| e.to_string())?;
    let mut parts = raw.splitn(2, "\r\n\r\n");
    let headers = parts.next().unwrap_or_default();
    let response_body = parts.next().unwrap_or_default().to_string();
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(502);
    let response_content_type = headers
        .lines()
        .find_map(|line| line.split_once(':').filter(|(key, _)| key.eq_ignore_ascii_case("content-type")).map(|(_, value)| value.trim().to_string()))
        .unwrap_or_else(|| "application/json".to_string());
    Ok((status, response_content_type, response_body))
}

fn requested_output_tokens(body: &Value) -> i64 {
    body.get("max_tokens")
        .or_else(|| body.get("max_completion_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0)
}

fn gateway_budget_value(ok: bool, estimated_prompt_tokens: i64, requested_output_tokens: i64, usable_prompt_tokens: i64, action: &str, reasons: Vec<String>) -> Value {
    json!({
        "ok": ok,
        "estimatedPromptTokens": estimated_prompt_tokens,
        "requestedOutputTokens": requested_output_tokens,
        "usablePromptTokens": usable_prompt_tokens,
        "overflowTokens": (estimated_prompt_tokens - usable_prompt_tokens).max(0),
        "action": action,
        "reasons": reasons,
    })
}

fn update_gateway_stats<F>(stats: &Arc<Mutex<GatewayStats>>, updater: F)
where
    F: FnOnce(&mut GatewayStats),
{
    if let Ok(mut guard) = stats.lock() {
        updater(&mut guard);
    }
}

fn handle_gateway_stream(mut stream: TcpStream, config: &Value, started_at: u128, stats: Arc<Mutex<GatewayStats>>) {
    let response = match read_http_request(&mut stream) {
        Ok((method, path, headers, body)) => {
            update_gateway_stats(&stats, |current| {
                current.request_count += 1;
            });
            if method == "GET" && path == "/health" {
                let snapshot = stats.lock().map(|current| current.clone()).unwrap_or_default();
                let body = json!({
                    "status": "ok",
                    "gateway": gateway_status_value(config, true, Some(started_at), snapshot)
                })
                .to_string();
                http_response(200, "application/json", &body)
            } else if !gateway_request_authorized(&headers, config) {
                update_gateway_stats(&stats, |current| {
                    current.rejected_count += 1;
                });
                http_response(401, "application/json", &json!({ "error": { "message": "Atlas Gateway requires Authorization: Bearer <api key>.", "type": "unauthorized" } }).to_string())
            } else if method == "GET" && path == "/v1/models" {
                match proxy_http_request(config, "GET", "/v1/models", &[], "application/json") {
                    Ok((status, content_type, body)) => http_response(status, &content_type, &body),
                    Err(err) => {
                        update_gateway_stats(&stats, |current| {
                            current.last_error = Some(err.clone());
                        });
                        http_response(502, "application/json", &json!({ "error": { "message": err, "type": "atlas_gateway_upstream_error" } }).to_string())
                    }
                }
            } else if method == "POST" && (path == "/v1/chat/completions" || path == "/v1/completions") {
                match serde_json::from_slice::<Value>(&body) {
                    Ok(parsed) => {
                        let with_system_prompt = if path == "/v1/chat/completions" {
                            with_configured_system_prompt(parsed, config)
                        } else {
                            parsed
                        };
                        let (forward_body, structured_output) = normalize_openai_request_for_gateway(with_system_prompt);
                        let estimated = estimate_openai_prompt_tokens(&forward_body);
                        let max_prompt = active_max_prompt_tokens(config);
                        let requested_output = requested_output_tokens(&forward_body);
                        let content_type = headers.get("content-type").map(String::as_str).unwrap_or("application/json");
                        update_gateway_stats(&stats, |current| {
                            current.last_budget = Some(gateway_budget_value(
                                estimated <= max_prompt,
                                estimated,
                                requested_output,
                                max_prompt,
                                if estimated <= max_prompt { "forward" } else if gateway_auto_compression_enabled(config) { "compress" } else { "reject" },
                                if estimated <= max_prompt { Vec::new() } else { vec![format!("Prompt estimate {} exceeds usable prompt budget {}.", estimated, max_prompt)] },
                            ));
                        });
                        if estimated > max_prompt {
                            if gateway_auto_compression_enabled(config) {
                                update_gateway_stats(&stats, |current| {
                                    current.compaction_active = true;
                                });
                                let (compressed_body, compressed, before, after) = compress_openai_request(forward_body, max_prompt);
                                update_gateway_stats(&stats, |current| {
                                    current.last_budget = Some(gateway_budget_value(
                                        compressed && after <= max_prompt,
                                        after,
                                        requested_output,
                                        max_prompt,
                                        if compressed && after <= max_prompt { "compress" } else { "reject" },
                                        if compressed && after <= max_prompt { Vec::new() } else { vec![format!("Compressed prompt estimate {} still exceeds usable prompt budget {}.", after, max_prompt)] },
                                    ));
                                });
                                if compressed && after <= max_prompt {
                                    update_gateway_stats(&stats, |current| {
                                        current.compressed_count += 1;
                                        current.last_compression = Some(json!({
                                            "beforeTokens": before,
                                            "afterTokens": after,
                                            "savedTokens": (before - after).max(0),
                                            "ts": now(),
                                        }));
                                    });
                                    match serde_json::to_vec(&compressed_body) {
                                        Ok(body) => match proxy_http_request(config, "POST", &path, &body, content_type) {
                                            Ok((status, content_type, body)) => {
                                                if structured_output && (200..300).contains(&status) {
                                                    if let Some(error_body) = structured_empty_content_error(&body) {
                                                        update_gateway_stats(&stats, |current| {
                                                            current.last_error = Some("Upstream returned reasoning-only structured output.".to_string());
                                                        });
                                                        http_response(502, "application/json", &error_body)
                                                    } else {
                                                        http_response(status, &content_type, &body)
                                                    }
                                                } else {
                                                    http_response(status, &content_type, &body)
                                                }
                                            }
                                            Err(err) => {
                                                update_gateway_stats(&stats, |current| {
                                                    current.last_error = Some(err.clone());
                                                });
                                                http_response(502, "application/json", &json!({ "error": { "message": err, "type": "atlas_gateway_upstream_error" } }).to_string())
                                            }
                                        },
                                        Err(err) => {
                                            update_gateway_stats(&stats, |current| {
                                                current.last_error = Some(err.to_string());
                                            });
                                            http_response(502, "application/json", &json!({ "error": { "message": err.to_string(), "type": "atlas_gateway_compression_error" } }).to_string())
                                        }
                                    }
                                } else {
                                    update_gateway_stats(&stats, |current| {
                                        current.rejected_count += 1;
                                    });
                                    http_response(
                                        413,
                                        "application/json",
                                        &json!({
                                            "error": {
                                                "message": format!("Atlas could not compress this request enough to fit the active profile budget. Estimate went from {} to {}, budget {}.", before, after, max_prompt),
                                                "type": "atlas_context_budget_exceeded",
                                                "budget": { "estimatedPromptTokens": after, "estimatedBeforeCompressionTokens": before, "usablePromptTokens": max_prompt, "overflowTokens": after - max_prompt }
                                            }
                                        })
                                        .to_string(),
                                    )
                                }
                            } else {
                                update_gateway_stats(&stats, |current| {
                                    current.rejected_count += 1;
                                });
                                http_response(
                                    413,
                                    "application/json",
                                    &json!({
                                        "error": {
                                            "message": format!("Atlas blocked this request before llama.cpp because the prompt estimate {} exceeds the active profile budget {}.", estimated, max_prompt),
                                            "type": "atlas_context_budget_exceeded",
                                            "budget": { "estimatedPromptTokens": estimated, "usablePromptTokens": max_prompt, "overflowTokens": estimated - max_prompt }
                                        }
                                    })
                                    .to_string(),
                                )
                            }
                        } else {
                            match serde_json::to_vec(&forward_body) {
                                Ok(body) => match proxy_http_request(config, "POST", &path, &body, content_type) {
                                    Ok((status, content_type, body)) => {
                                        if structured_output && (200..300).contains(&status) {
                                            if let Some(error_body) = structured_empty_content_error(&body) {
                                                update_gateway_stats(&stats, |current| {
                                                    current.last_error = Some("Upstream returned reasoning-only structured output.".to_string());
                                                });
                                                http_response(502, "application/json", &error_body)
                                            } else {
                                                http_response(status, &content_type, &body)
                                            }
                                        } else {
                                            http_response(status, &content_type, &body)
                                        }
                                    }
                                    Err(err) => {
                                        update_gateway_stats(&stats, |current| {
                                            current.last_error = Some(err.clone());
                                        });
                                        http_response(502, "application/json", &json!({ "error": { "message": err, "type": "atlas_gateway_upstream_error" } }).to_string())
                                    }
                                },
                                Err(err) => {
                                    update_gateway_stats(&stats, |current| {
                                        current.last_error = Some(err.to_string());
                                    });
                                    http_response(502, "application/json", &json!({ "error": { "message": err.to_string(), "type": "atlas_gateway_request_normalization_error" } }).to_string())
                                }
                            }
                        }
                    }
                    Err(_) => http_response(400, "application/json", &json!({ "error": { "message": "Request body must be JSON.", "type": "invalid_request_error" } }).to_string()),
                }
            } else {
                http_response(404, "application/json", &json!({ "error": { "message": format!("Atlas Gateway route not found: {}", path), "type": "not_found" } }).to_string())
            }
        }
        Err(err) => http_response(400, "application/json", &json!({ "error": { "message": err, "type": "invalid_request_error" } }).to_string()),
    };
    update_gateway_stats(&stats, |current| {
        current.compaction_active = false;
    });
    let _ = stream.write_all(&response);
}

fn gateway_status_value(config: &Value, running: bool, started_at: Option<u128>, stats: GatewayStats) -> Value {
    let host = string_at(config, &["agentRuntime", "gateway", "host"]);
    let port = number_at(config, &["agentRuntime", "gateway", "port"], 18080);
    json!({
        "running": running,
        "external": false,
        "host": if host.is_empty() { "127.0.0.1".to_string() } else { host },
        "port": port,
        "upstream": format!("http://{}:{}", client_host_for(&string_at(config, &["server", "host"])), number_at(config, &["server", "port"], 8080)),
        "modelAlias": string_at(config, &["agentRuntime", "gateway", "modelAlias"]),
        "activeProfileId": string_at(config, &["agentRuntime", "activeProfileId"]),
        "startedAt": started_at,
        "requestCount": stats.request_count,
        "rejectedCount": stats.rejected_count,
        "compressedCount": stats.compressed_count,
        "compactionActive": stats.compaction_active,
        "lastCompression": stats.last_compression,
        "lastError": stats.last_error,
        "lastBudget": stats.last_budget
    })
}

fn external_gateway_status(config: &Value) -> Value {
    let base = gateway_status_value(config, false, None, GatewayStats::default());
    let host = string_at(config, &["agentRuntime", "gateway", "host"]);
    let port = number_at(config, &["agentRuntime", "gateway", "port"], 18080);
    let Ok((status, body)) = http_get_text(&host, port, "/health", Duration::from_millis(1000)) else {
        return base;
    };
    if status != 200 {
        return base;
    }
    let Ok(parsed) = serde_json::from_str::<Value>(&body) else {
        return base;
    };
    let Some(mut gateway) = parsed.get("gateway").cloned() else {
        return base;
    };
    if let Some(obj) = gateway.as_object_mut() {
        obj.insert("running".to_string(), json!(true));
        obj.insert("external".to_string(), json!(true));
    }
    gateway
}

#[tauri::command]
fn gateway_start(state: State<AppState>) -> Result<Value, AppError> {
    let config = load_config_value()?;
    let host = string_at(&config, &["agentRuntime", "gateway", "host"]);
    let host = if host.trim().is_empty() { "127.0.0.1".to_string() } else { host };
    let port = number_at(&config, &["agentRuntime", "gateway", "port"], 18080);
    {
        let gateway = state.gateway.lock().map_err(|_| app_error("agent-gateway", "Gateway state unavailable", "Could not lock gateway state.", "Restart Atlas Workbench and try again."))?;
        if gateway.is_some() {
            let stats = state.gateway_stats.lock().map(|current| current.clone()).unwrap_or_default();
            return Ok(gateway_status_value(&config, true, gateway.as_ref().map(|g| g.started_at), stats));
        }
    }
    let external = external_gateway_status(&config);
    if external.get("running").and_then(Value::as_bool).unwrap_or(false) {
        return Ok(external);
    }
    if let Ok(mut stats) = state.gateway_stats.lock() {
        *stats = GatewayStats::default();
    }
    let listener = TcpListener::bind(format!("{}:{}", host, port)).map_err(|e| app_error("agent-gateway", "Could not start Atlas Gateway", e.to_string(), "Choose a different gateway port or stop the process already using it."))?;
    listener.set_nonblocking(true).map_err(|e| app_error("agent-gateway", "Could not configure Atlas Gateway", e.to_string(), "Restart Atlas Workbench and try again."))?;
    let (tx, rx) = mpsc::channel::<()>();
    let started_at = now();
    let thread_config = config.clone();
    let thread_stats = state.gateway_stats.clone();
    thread::spawn(move || {
        loop {
            if rx.try_recv().is_ok() {
                break;
            }
            match listener.accept() {
                Ok((stream, _addr)) => handle_gateway_stream(stream, &thread_config, started_at, thread_stats.clone()),
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(50)),
                Err(_) => thread::sleep(Duration::from_millis(100)),
            }
        }
    });
    let mut gateway = state.gateway.lock().map_err(|_| app_error("agent-gateway", "Gateway state unavailable", "Could not lock gateway state.", "Restart Atlas Workbench and try again."))?;
    *gateway = Some(GatewayRuntime { shutdown: tx, started_at, host, port });
    let stats = state.gateway_stats.lock().map(|current| current.clone()).unwrap_or_default();
    Ok(gateway_status_value(&config, true, Some(started_at), stats))
}

#[tauri::command]
fn gateway_stop(state: State<AppState>) -> Result<Value, AppError> {
    let config = load_config_value()?;
    let mut gateway = state.gateway.lock().map_err(|_| app_error("agent-gateway", "Gateway state unavailable", "Could not lock gateway state.", "Restart Atlas Workbench and try again."))?;
    if let Some(runtime) = gateway.take() {
        let _ = runtime.shutdown.send(());
        let mut stats = state.gateway_stats.lock().map(|current| current.clone()).unwrap_or_default();
        stats.compaction_active = false;
        return Ok(gateway_status_value(&config, false, None, stats));
    }
    Ok(external_gateway_status(&config))
}

#[tauri::command]
fn gateway_status(state: State<AppState>) -> Result<Value, AppError> {
    let config = load_config_value()?;
    let gateway = state.gateway.lock().map_err(|_| app_error("agent-gateway", "Gateway state unavailable", "Could not lock gateway state.", "Restart Atlas Workbench and try again."))?;
    let started_at = gateway.as_ref().map(|g| g.started_at);
    let stats = state.gateway_stats.lock().map(|current| current.clone()).unwrap_or_default();
    let mut status = gateway_status_value(&config, gateway.is_some(), started_at, stats);
    if let (Some(runtime), Some(obj)) = (gateway.as_ref(), status.as_object_mut()) {
        obj.insert("host".to_string(), json!(runtime.host.clone()));
        obj.insert("port".to_string(), json!(runtime.port));
    }
    if !gateway.is_some() {
        status = external_gateway_status(&config);
    }
    Ok(status)
}

fn visual_locator_host(config: &Value) -> String {
    let host = string_at(config, &["agentRuntime", "visualLocator", "host"]);
    if host.trim().is_empty() { "127.0.0.1".to_string() } else { host }
}

fn visual_locator_port(config: &Value) -> i64 {
    number_at(config, &["agentRuntime", "visualLocator", "port"], 8000)
}

fn visual_locator_status_value(config: &Value, running: bool, external: bool, pid: Option<usize>, cmdline: Option<String>) -> Value {
    let host = visual_locator_host(config);
    let port = visual_locator_port(config);
    json!({
        "running": running,
        "external": external,
        "state": if running { "running" } else { "stopped" },
        "pid": pid,
        "host": host,
        "port": port,
        "endpoint": format!("http://{}:{}/v1", client_host_for(&host), port),
        "modelAlias": string_at(config, &["agentRuntime", "visualLocator", "modelAlias"]),
        "serverPath": string_at(config, &["agentRuntime", "visualLocator", "serverPath"]),
        "modelPath": string_at(config, &["agentRuntime", "visualLocator", "modelPath"]),
        "mmprojPath": string_at(config, &["agentRuntime", "visualLocator", "mmprojPath"]),
        "gpuLayers": string_at(config, &["agentRuntime", "visualLocator", "gpuLayers"]),
        "contextSize": number_at(config, &["agentRuntime", "visualLocator", "contextSize"], 4096),
        "apiKey": string_at(config, &["agentRuntime", "visualLocator", "apiKey"]),
        "cmdline": cmdline
    })
}

fn managed_child_pid(state: &State<AppState>, kind: &str) -> Result<Option<usize>, AppError> {
    let children = state.children.lock().map_err(|_| app_error(kind, "Process state unavailable", "Could not lock process state.", "Restart Atlas Workbench and try again."))?;
    Ok(children.get(kind).map(|child| child.id() as usize))
}

fn external_visual_locator(config: &Value) -> Option<(usize, String)> {
    let port = visual_locator_port(config);
    let model_alias = string_at(config, &["agentRuntime", "visualLocator", "modelAlias"]);
    let model_path = string_at(config, &["agentRuntime", "visualLocator", "modelPath"]);
    processes_matching_port(port)
        .into_iter()
        .find(|(_, cmdline)| {
            (!model_alias.is_empty() && cmdline.contains(&model_alias))
                || (!model_path.is_empty() && cmdline.contains(&model_path))
                || cmdline.contains("LocateAnything")
                || cmdline.contains("mmproj")
        })
}

#[tauri::command]
fn visual_locator_status(state: State<AppState>) -> Result<Value, AppError> {
    let config = load_config_value()?;
    if let Some(pid) = managed_child_pid(&state, VISUAL_LOCATOR_KIND)? {
        return Ok(visual_locator_status_value(&config, true, false, Some(pid), None));
    }
    if let Some((pid, cmdline)) = external_visual_locator(&config) {
        return Ok(visual_locator_status_value(&config, true, true, Some(pid), Some(cmdline)));
    }
    Ok(visual_locator_status_value(&config, false, false, None, None))
}

fn visual_locator_launch(config: &Value) -> Result<(String, Vec<String>, Vec<(String, String)>), AppError> {
    let enabled = value_at(config, &["agentRuntime", "visualLocator", "enabled"]).and_then(Value::as_bool).unwrap_or(true);
    if !enabled {
        return Err(app_error("visual-locator", "Visual locator is disabled", "Atlas visual locator sidecar is disabled in Agent Runtime settings.", "Enable the visual locator sidecar, then start it again."));
    }
    let server = string_at(config, &["agentRuntime", "visualLocator", "serverPath"]);
    let model = string_at(config, &["agentRuntime", "visualLocator", "modelPath"]);
    let mmproj = string_at(config, &["agentRuntime", "visualLocator", "mmprojPath"]);
    if !Path::new(&model).is_file() {
        return Err(app_error("visual-locator", "Visual locator model not found", format!("The LocateAnything GGUF was not found at {}.", model), "Choose a valid LocateAnything GGUF path or reinstall the local visual locator files."));
    }
    if !Path::new(&mmproj).is_file() {
        return Err(app_error("visual-locator", "Visual locator mmproj not found", format!("The LocateAnything mmproj was not found at {}.", mmproj), "Choose a valid mmproj path or reinstall the local visual locator files."));
    }
    let resolved = resolve_binary_path(&server, "server").map_err(|message| app_error("visual-locator", "Visual locator server is not runnable", message, "Point the visual locator server path at the LocateAnything-compatible llama-server binary."))?;
    let host = visual_locator_host(config);
    let port = visual_locator_port(config);
    let gpu_layers = {
        let value = string_at(config, &["agentRuntime", "visualLocator", "gpuLayers"]);
        if value.trim().is_empty() { "all".to_string() } else { value }
    };
    let model_alias = {
        let value = string_at(config, &["agentRuntime", "visualLocator", "modelAlias"]);
        if value.trim().is_empty() { "nvidia/LocateAnything-3B".to_string() } else { value }
    };
    let context_size = number_at(config, &["agentRuntime", "visualLocator", "contextSize"], 4096).max(1024);
    let args = vec![
        "-m".to_string(), model,
        "--mmproj".to_string(), mmproj,
        "-ngl".to_string(), gpu_layers,
        "--special".to_string(),
        "--alias".to_string(), model_alias,
        "--host".to_string(), host,
        "--port".to_string(), port.to_string(),
        "--ctx-size".to_string(), context_size.to_string(),
        "--parallel".to_string(), "1".to_string(),
        "--cache-ram".to_string(), "0".to_string(),
        "--mmap".to_string(),
        "--no-warmup".to_string(),
    ];
    let mut envs = Vec::new();
    if let Some(parent) = resolved.parent() {
        let prior = env::var("LD_LIBRARY_PATH").unwrap_or_default();
        let value = if prior.is_empty() { parent.to_string_lossy().to_string() } else { format!("{}:{}", parent.to_string_lossy(), prior) };
        envs.push(("LD_LIBRARY_PATH".to_string(), value));
    }
    Ok((resolved.to_string_lossy().to_string(), args, envs))
}

#[tauri::command]
fn visual_locator_start(app: AppHandle, state: State<AppState>) -> Result<Value, AppError> {
    let config = load_config_value()?;
    if let Some(pid) = managed_child_pid(&state, VISUAL_LOCATOR_KIND)? {
        return Ok(visual_locator_status_value(&config, true, false, Some(pid), None));
    }
    if let Some((pid, cmdline)) = external_visual_locator(&config) {
        return Ok(visual_locator_status_value(&config, true, true, Some(pid), Some(cmdline)));
    }
    let (binary, args, envs) = visual_locator_launch(&config)?;
    let status = start_child_with_env(app, &state, VISUAL_LOCATOR_KIND, binary, args, envs)?;
    let pid = status.get("pid").and_then(Value::as_u64).map(|v| v as usize);
    Ok(visual_locator_status_value(&config, true, false, pid, None))
}

#[tauri::command]
fn visual_locator_stop(app: AppHandle, state: State<AppState>) -> Result<Value, AppError> {
    let config = load_config_value()?;
    let port = visual_locator_port(&config);
    for (pid, cmdline) in processes_matching_port(port) {
        emit_log(&app, VISUAL_LOCATOR_KIND, "stderr", format!("Stopping visual locator on configured port: pid {} ({})", pid, cmdline));
        kill_external_pid(pid);
    }
    let _ = stop_child(app, state, VISUAL_LOCATOR_KIND)?;
    Ok(visual_locator_status_value(&config, false, false, None, None))
}

#[tauri::command]
fn gateway_health() -> Result<Value, AppError> {
    runtime_health(Some(3000))
}

#[tauri::command]
fn runtime_health(timeout_ms: Option<u64>) -> Result<Value, AppError> {
    let config = load_config_value()?;
    let host = string_at(&config, &["server", "host"]);
    let port = number_at(&config, &["server", "port"], 8080);
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(3000));
    let started = Instant::now();
    let checked_at = now();
    let endpoint = format!(
        "http://{}:{}",
        match host.trim() { "" | "0.0.0.0" | "::" | "*" => "127.0.0.1", other => other.trim_matches(&['[', ']'][..]) },
        port
    );
    match (http_get_text(&host, port, "/health", timeout), http_get_text(&host, port, "/v1/models", timeout)) {
        (Ok((health_status, _)), Ok((models_status, models_body))) => {
            let models_json = serde_json::from_str::<Value>(&models_body).unwrap_or_else(|_| json!({}));
            let model_ids: Vec<String> = models_json
                .get("data")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string)).collect())
                .unwrap_or_default();
            let health_ok = (200..300).contains(&health_status);
            let models_ok = (200..300).contains(&models_status) && !model_ids.is_empty();
            Ok(json!({
                "state": if health_ok && models_ok { "healthy" } else { "degraded" },
                "endpoint": endpoint,
                "checkedAt": checked_at,
                "latencyMs": started.elapsed().as_millis(),
                "healthOk": health_ok,
                "modelsOk": models_ok,
                "modelIds": model_ids,
                "reason": if health_ok && models_ok { "llama.cpp health and model endpoints are responding." } else { "llama.cpp answered but health/model discovery is incomplete." }
            }))
        }
        (Err(err), _) | (_, Err(err)) => Ok(json!({
            "state": "unreachable",
            "endpoint": endpoint,
            "checkedAt": checked_at,
            "latencyMs": started.elapsed().as_millis(),
            "healthOk": false,
            "modelsOk": false,
            "modelIds": [],
            "reason": err
        })),
    }
}

#[tauri::command]
fn server_start(app: AppHandle, state: State<AppState>, config: Value) -> Result<Value, AppError> {
    let model = string_at(&config, &["model", "selectedModel"]);
    if model.trim().is_empty() {
        return Err(app_error("server-control", "No model selected", "llama-server needs a model path before it can start.", "Open the Models tab, choose a folder containing .gguf files, and load a model before starting the server."));
    }
    if !model.is_empty() && !Path::new(&model).is_file() {
        return Err(app_error("server-control", "Model file not found", format!("The model file “{}” was not found.", model), "Pick a valid model file and try again."));
    }
    save_config_value(&config)?;
    let binary = string_at(&config, &["binaryPaths", "server"]);
    let host = string_at(&config, &["server", "host"]);
    let port = number_at(&config, &["server", "port"], 8080);
    ensure_port_free(&host, port)?;
    let running_status = start_child(app.clone(), &state, "server", binary, build_server_args(&config))?;
    let pid = running_status.get("pid").and_then(Value::as_u64).unwrap_or(0) as u32;
    let started_at = running_status.get("startedAt").cloned().unwrap_or_else(|| json!(now()));
    let starting_status = json!({ "kind": "server", "state": "starting", "pid": pid, "startedAt": started_at.clone() });
    let _ = app.emit("status", starting_status.clone());
    spawn_server_ready_watcher(app, state.children.clone(), state.log_tails.clone(), host, port, pid, started_at);
    Ok(starting_status)
}

#[tauri::command]
fn server_stop(app: AppHandle, state: State<AppState>) -> Result<Value, AppError> {
    let config = load_config_value()?;
    let port = number_at(&config, &["server", "port"], 8080);
    let external = processes_matching_port(port);
    for (pid, cmdline) in &external {
        emit_log(&app, "server", "stderr", format!("Stopping external llama-server on configured port: pid {} ({})", pid, cmdline));
        kill_external_pid(*pid);
    }
    stop_child(app, state, "server")
}

#[tauri::command]
fn server_status(state: State<AppState>) -> Result<Value, AppError> {
    if state.children.lock().map_err(|_| app_error("server", "Process state unavailable", "Could not lock process state.", "Restart Atlas Workbench and try again."))?.contains_key("server") {
        return Ok(json!({ "kind": "server", "state": "running" }));
    }
    let config = load_config_value()?;
    let port = number_at(&config, &["server", "port"], 8080);
    if let Some((pid, cmdline)) = processes_matching_port(port).into_iter().next() {
        return Ok(json!({ "kind": "server", "state": "running", "pid": pid, "external": true, "cmdline": cmdline }));
    }
    Ok(json!({ "kind": "server", "state": "stopped" }))
}

fn stop_child(app: AppHandle, state: State<AppState>, kind: &'static str) -> Result<Value, AppError> {
    let mut children = state.children.lock().map_err(|_| app_error(kind, "Process state unavailable", "Could not lock the process table.", "Restart Atlas Workbench and try again."))?;
    if let Some(mut child) = children.remove(kind) {
        let _ = child.kill();
        let _ = child.wait();
    }
    let status = json!({ "kind": kind, "state": "exited", "exitCode": 0, "endedAt": now() });
    let _ = app.emit("status", status.clone());
    Ok(status)
}

fn first_line(text: &str) -> Option<String> {
    text.lines().map(str::trim).find(|line| !line.is_empty()).map(str::to_string)
}

fn read_trimmed(path: impl AsRef<Path>) -> Option<String> {
    fs::read_to_string(path).ok().and_then(|text| first_line(&text))
}

fn query_nvidia_smi() -> Option<Value> {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let line = first_line(&raw)?;
    let parts: Vec<&str> = line.split(',').map(str::trim).collect();
    if parts.is_empty() || parts[0].is_empty() {
        return None;
    }
    let usage = parts.get(1).and_then(|v| v.parse::<f64>().ok());
    let temperature = parts.get(2).and_then(|v| v.parse::<f64>().ok());
    let used = parts.get(3).and_then(|v| v.parse::<u64>().ok()).map(|mib| mib * 1024 * 1024);
    let total = parts.get(4).and_then(|v| v.parse::<u64>().ok()).map(|mib| mib * 1024 * 1024);
    Some(json!({
        "detected": true,
        "name": parts[0],
        "usagePercent": usage,
        "temperatureCelsius": temperature,
        "memoryUsed": used,
        "memoryTotal": total,
        "note": "Detected with nvidia-smi"
    }))
}

fn read_hwmon_temperature_celsius(device: &Path) -> Option<f64> {
    let hwmon = device.join("hwmon");
    for entry in fs::read_dir(hwmon).ok()?.flatten() {
        let raw = read_trimmed(entry.path().join("temp1_input"))?;
        let milli_celsius = raw.parse::<f64>().ok()?;
        return Some(milli_celsius / 1000.0);
    }
    None
}

fn query_gpu_sysfs() -> Value {
    if let Ok(entries) = fs::read_dir("/proc/driver/nvidia/gpus") {
        for entry in entries.flatten() {
            let info = entry.path().join("information");
            if let Ok(raw) = fs::read_to_string(info) {
                let name = raw
                    .lines()
                    .find_map(|line| line.strip_prefix("Model:").map(str::trim))
                    .filter(|line| !line.is_empty())
                    .unwrap_or("NVIDIA GPU");
                return json!({
                    "detected": true,
                    "name": name,
                    "note": "NVIDIA GPU detected from /proc. Install nvidia-smi for utilization and VRAM counters."
                });
            }
        }
    }

    if let Ok(entries) = fs::read_dir("/sys/class/drm") {
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if !file_name.starts_with("card") || file_name.contains('-') {
                continue;
            }
            let device = entry.path().join("device");
            let uevent = fs::read_to_string(device.join("uevent")).unwrap_or_default();
            if !(uevent.contains("DRIVER=amdgpu") || uevent.contains("DRIVER=i915") || uevent.contains("DRIVER=xe") || uevent.contains("DRIVER=nvidia")) {
                continue;
            }
            let driver = uevent
                .lines()
                .find_map(|line| line.strip_prefix("DRIVER="))
                .unwrap_or("gpu");
            let name = read_trimmed(device.join("product_name"))
                .or_else(|| read_trimmed(device.join("product")))
                .unwrap_or_else(|| format!("{} GPU", driver));
            let usage = read_trimmed(device.join("gpu_busy_percent")).and_then(|v| v.parse::<f64>().ok());
            let used = read_trimmed(device.join("mem_info_vram_used")).and_then(|v| v.parse::<u64>().ok());
            let total = read_trimmed(device.join("mem_info_vram_total")).and_then(|v| v.parse::<u64>().ok());
            let temperature = read_hwmon_temperature_celsius(&device);
            return json!({
                "detected": true,
                "name": name,
                "usagePercent": usage,
                "temperatureCelsius": temperature,
                "memoryUsed": used,
                "memoryTotal": total,
                "note": format!("Detected from /sys/class/drm/{}", file_name)
            });
        }
    }

    json!({ "detected": false, "note": "No NVIDIA/AMD/Intel GPU was exposed through nvidia-smi, /proc/driver/nvidia, or /sys/class/drm." })
}

fn collect_gpu() -> Value {
    query_nvidia_smi().unwrap_or_else(query_gpu_sysfs)
}

fn prometheus_metric(text: &str, metric: &str) -> Option<f64> {
    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let name = parts.next()?;
        let value = parts.next()?;
        let plain_name = name.split('{').next().unwrap_or(name);
        if plain_name == metric {
            return value.parse::<f64>().ok();
        }
    }
    None
}

fn delta_rate(total: Option<f64>, observed_at_ms: u128, previous_total: Option<f64>, previous_observed_at_ms: Option<u128>) -> Option<f64> {
    let total = total?;
    let previous_total = previous_total?;
    let previous_observed_at_ms = previous_observed_at_ms?;
    let token_delta = total - previous_total;
    if observed_at_ms < previous_observed_at_ms {
        return None;
    }
    let seconds_delta = (observed_at_ms - previous_observed_at_ms) as f64 / 1000.0;
    if token_delta < 0.0 {
        return None;
    }
    if token_delta == 0.0 {
        return Some(0.0);
    }
    if seconds_delta <= 0.0 {
        return None;
    }
    Some(token_delta / seconds_delta)
}

fn should_keep_runtime_baseline(current: RuntimeCounterSample, previous: Option<RuntimeCounterSample>, requests_processing: Option<f64>) -> bool {
    if previous.is_none() || requests_processing.is_some_and(|value| value <= 0.0) {
        return false;
    }
    let previous = previous.unwrap();
    current.generation_tokens_total == previous.generation_tokens_total && current.prompt_tokens_total == previous.prompt_tokens_total
}

fn collect_runtime_slot_context(config: &Value) -> (Option<i64>, Option<i64>) {
    let host = string_at(config, &["server", "host"]);
    let port = number_at(config, &["server", "port"], 8099);
    let Ok((status, body)) = http_get_text(&host, port, "/slots", Duration::from_millis(500)) else {
        return (None, None);
    };
    if status != 200 {
        return (None, None);
    }
    let Ok(slots) = serde_json::from_str::<Value>(&body) else {
        return (None, None);
    };
    let mut context_tokens: Option<i64> = None;
    let mut context_window_tokens: Option<i64> = None;
    if let Some(items) = slots.as_array() {
        for slot in items {
            if let Some(tokens) = slot.get("n_prompt_tokens").and_then(Value::as_i64) {
                context_tokens = Some(context_tokens.unwrap_or(0).max(tokens));
            }
            if let Some(ctx) = slot.get("n_ctx").and_then(Value::as_i64) {
                context_window_tokens = Some(context_window_tokens.unwrap_or(0).max(ctx));
            }
        }
    }
    (context_tokens, context_window_tokens)
}

fn collect_runtime_metrics(config: &Value, previous: Option<RuntimeCounterSample>) -> Option<(Value, RuntimeCounterSample)> {
    let host = string_at(config, &["server", "host"]);
    let port = number_at(config, &["server", "port"], 8099);
    let (status, body) = http_get_text(&host, port, "/metrics", Duration::from_millis(750)).ok()?;
    if status != 200 {
        return None;
    }
    let processing = prometheus_metric(&body, "llamacpp:requests_processing");
    let deferred = prometheus_metric(&body, "llamacpp:requests_deferred");
    let sample = RuntimeCounterSample {
        generation_tokens_total: prometheus_metric(&body, "llamacpp:tokens_predicted_total"),
        prompt_tokens_total: prometheus_metric(&body, "llamacpp:prompt_tokens_total"),
        observed_at_ms: now(),
    };
    let baseline = if should_keep_runtime_baseline(sample, previous, processing) { previous.unwrap() } else { sample };
    let average_generation = prometheus_metric(&body, "llamacpp:predicted_tokens_seconds");
    let average_prompt = prometheus_metric(&body, "llamacpp:prompt_tokens_seconds");
    let generation = delta_rate(
        sample.generation_tokens_total,
        sample.observed_at_ms,
        previous.and_then(|sample| sample.generation_tokens_total),
        previous.map(|sample| sample.observed_at_ms),
    );
    let prompt = delta_rate(
        sample.prompt_tokens_total,
        sample.observed_at_ms,
        previous.and_then(|sample| sample.prompt_tokens_total),
        previous.map(|sample| sample.observed_at_ms),
    );
    let (context_tokens, context_window_tokens) = collect_runtime_slot_context(config);
    if generation.is_none()
        && prompt.is_none()
        && average_generation.is_none()
        && average_prompt.is_none()
        && processing.is_none()
        && deferred.is_none()
        && context_tokens.is_none()
        && context_window_tokens.is_none()
    {
        return None;
    }
    Some((json!({
        "source": "llama.cpp",
        "generationTokensPerSecond": generation,
        "promptTokensPerSecond": prompt,
        "averageGenerationTokensPerSecond": average_generation,
        "averagePromptTokensPerSecond": average_prompt,
        "requestsProcessing": processing,
        "requestsDeferred": deferred,
        "contextTokens": context_tokens,
        "contextWindowTokens": context_window_tokens
    }), baseline))
}

fn read_cpu_ticks() -> Option<CpuTickSample> {
    let raw = fs::read_to_string("/proc/stat").ok()?;
    let per_core = raw
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let name = parts.next()?;
            if !name.starts_with("cpu") || name == "cpu" || !name[3..].chars().all(|ch| ch.is_ascii_digit()) {
                return None;
            }
            let user = parts.next()?.parse::<u64>().ok()?;
            let nice = parts.next()?.parse::<u64>().ok()?;
            let system = parts.next()?.parse::<u64>().ok()?;
            let idle = parts.next()?.parse::<u64>().ok()?;
            let iowait = parts.next().and_then(|value| value.parse::<u64>().ok()).unwrap_or(0);
            let irq = parts.next().and_then(|value| value.parse::<u64>().ok()).unwrap_or(0);
            let softirq = parts.next().and_then(|value| value.parse::<u64>().ok()).unwrap_or(0);
            let steal = parts.next().and_then(|value| value.parse::<u64>().ok()).unwrap_or(0);
            let idle_all = idle + iowait;
            let total = user + nice + system + idle_all + irq + softirq + steal;
            Some(CpuTicks { idle: idle_all, total })
        })
        .collect::<Vec<_>>();
    if per_core.is_empty() {
        None
    } else {
        Some(CpuTickSample { per_core })
    }
}

fn cpu_metrics_from_delta(previous: &CpuTickSample, current: &CpuTickSample) -> (f64, Vec<f64>) {
    let per_core = previous
        .per_core
        .iter()
        .zip(current.per_core.iter())
        .map(|(prev, curr)| {
            let total_delta = curr.total.saturating_sub(prev.total);
            let idle_delta = curr.idle.saturating_sub(prev.idle);
            if total_delta == 0 {
                0.0
            } else {
                (((total_delta.saturating_sub(idle_delta)) as f64 / total_delta as f64) * 100.0).clamp(0.0, 100.0)
            }
        })
        .collect::<Vec<_>>();
    let overall = if per_core.is_empty() { 0.0 } else { per_core.iter().sum::<f64>() / per_core.len() as f64 };
    (overall, per_core)
}

fn collect_cpu_metrics(state: &State<AppState>) -> (f64, Vec<f64>) {
    let Some(current) = read_cpu_ticks() else {
        return (0.0, Vec::new());
    };
    let Ok(mut guard) = state.cpu_sample.lock() else {
        return (0.0, Vec::new());
    };
    let metrics = guard
        .as_ref()
        .map(|previous| cpu_metrics_from_delta(previous, &current))
        .unwrap_or_else(|| (0.0, vec![0.0; current.per_core.len()]));
    *guard = Some(current);
    metrics
}

fn read_process_metrics(state: &State<AppState>, pid: usize, name: &str) -> Value {
    const CLK_TCK: f64 = 100.0;
    const PAGE_SIZE: u64 = 4096;
    let stat = fs::read_to_string(format!("/proc/{}/stat", pid)).unwrap_or_default();
    let statm = fs::read_to_string(format!("/proc/{}/statm", pid)).unwrap_or_default();

    let mut ticks = 0_u64;
    if let Some(end) = stat.rfind(')') {
        let fields: Vec<&str> = stat[end + 1..].split_whitespace().collect();
        let utime = fields.get(11).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
        let stime = fields.get(12).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
        ticks = utime + stime;
    }

    let resident_pages = statm.split_whitespace().nth(1).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let memory_bytes = resident_pages * PAGE_SIZE;
    let ts = now();
    let mut cpu_percent = 0.0_f64;
    if let Ok(mut samples) = state.proc_samples.lock() {
        if let Some(prev) = samples.get(&pid).copied() {
            let dt = (ts.saturating_sub(prev.ts) as f64) / 1000.0;
            if dt > 0.0 && ticks >= prev.ticks {
                cpu_percent = ((ticks - prev.ticks) as f64 / CLK_TCK / dt) * 100.0;
            }
        }
        samples.insert(pid, ProcSample { ticks, ts });
    }

    json!({ "pid": pid, "name": name, "cpuPercent": cpu_percent.max(0.0), "memoryBytes": memory_bytes })
}

#[tauri::command]
fn training_start(app: AppHandle, state: State<AppState>, config: Value) -> Result<Value, AppError> {
    let base_model = string_at(&config, &["finetune", "model-base"]);
    if base_model.is_empty() || !Path::new(&base_model).is_file() {
        return Err(app_error("fine-tuning", "Base model missing", format!("The base model “{}” was not found.", base_model), "Choose a valid base model before starting fine-tuning."));
    }
    let dataset = string_at(&config, &["finetune", "train-data"]);
    if dataset.is_empty() || !Path::new(&dataset).is_file() {
        return Err(app_error("fine-tuning", "Training dataset missing", format!("The training dataset “{}” was not found.", dataset), "Choose a valid training data file and try again."));
    }
    save_config_value(&config)?;
    let binary = string_at(&config, &["binaryPaths", "finetune"]);
    start_child(app, &state, "finetune", binary, build_finetune_args(&config))
}

#[tauri::command]
fn training_stop(app: AppHandle, state: State<AppState>) -> Result<Value, AppError> {
    stop_child(app, state, "finetune")
}

#[tauri::command]
fn training_status(state: State<AppState>) -> Result<Value, AppError> {
    let running = state.children.lock().map_err(|_| app_error("finetune", "Process state unavailable", "Could not lock process state.", "Restart Atlas Workbench and try again."))?.contains_key("finetune");
    Ok(json!({ "kind": "finetune", "state": if running { "running" } else { "stopped" } }))
}

#[tauri::command]
fn training_check_output(path: String) -> Value {
    json!({ "path": path, "exists": Path::new(&path).is_file() })
}

#[tauri::command]
fn monitor_collect(state: State<AppState>, pids: Option<Vec<Value>>) -> Value {
    let config = load_config_value().ok();
    let previous_runtime_sample = state.runtime_sample.lock().ok().and_then(|guard| *guard);
    let runtime = config
        .as_ref()
        .and_then(|config| collect_runtime_metrics(config, previous_runtime_sample));
    let runtime_metrics = runtime.as_ref().map(|(metrics, _)| metrics.clone());
    if let Some((_, sample)) = runtime {
        if let Ok(mut guard) = state.runtime_sample.lock() {
            *guard = Some(sample);
        }
    }
    let mut system = System::new_all();
    system.refresh_all();
    let (overall, per_core) = collect_cpu_metrics(&state);
    let total = system.total_memory();
    let used = system.used_memory();
    let mut processes = Vec::new();
    let mut seen = HashSet::new();
    for item in pids.unwrap_or_default() {
        let pid = item.get("pid").and_then(Value::as_u64).unwrap_or(0) as usize;
        let name = item.get("name").and_then(Value::as_str).unwrap_or("llama.cpp");
        if pid > 0 && Path::new(&format!("/proc/{}", pid)).exists() {
            processes.push(read_process_metrics(&state, pid, name));
            seen.insert(pid);
        }
    }
    for (pid, cmdline) in discover_llama_processes() {
        if !seen.contains(&pid) {
            let name = if cmdline.contains("llama-finetune") { "llama-finetune" } else { "llama-server" };
            processes.push(read_process_metrics(&state, pid, name));
            seen.insert(pid);
        }
    }
    json!({
        "cpu": { "overall": overall, "perCore": per_core },
        "ram": { "used": used, "total": total, "percent": if total > 0 { (used as f64 / total as f64) * 100.0 } else { 0.0 } },
        "gpu": collect_gpu(),
        "runtime": runtime_metrics,
        "processes": processes,
        "ts": now()
    })
}

#[tauri::command]
fn error_log(error: Value) -> Result<Value, AppError> {
    let dir = config_dir()?.join("logs");
    fs::create_dir_all(&dir).map_err(|e| app_error("error-handling", "Could not create log directory", e.to_string(), "Check permissions and try again."))?;
    let path = dir.join("error.log");
    let mut line = serde_json::to_string(&error).unwrap_or_else(|_| "{}".to_string());
    line.push('\n');
    use std::io::Write;
    let mut file = fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| app_error("error-handling", "Could not open error log", e.to_string(), "Check permissions and try again."))?;
    file.write_all(line.as_bytes()).map_err(|e| app_error("error-handling", "Could not write error log", e.to_string(), "Check permissions and try again."))?;
    Ok(json!({ "ok": true }))
}

fn write_crash_log(text: String) {
    let Some(base) = dirs::config_dir() else {
        return;
    };
    let dir = base.join("atlas-workbench").join("logs");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("crash.log");
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", text);
    }
}

fn install_panic_logger() {
    std::panic::set_hook(Box::new(|info| {
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_else(|| "unknown".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic payload".to_string());
        write_crash_log(format!("ts={} panic at {}: {}\n{:?}\n", now(), location, payload, Backtrace::force_capture()));
    }));
}

#[tauri::command]
fn dialog_open(kind: Option<String>) -> Option<String> {
    let dialog = rfd::FileDialog::new();
    let path = if kind.as_deref() == Some("directory") {
        dialog.pick_folder()
    } else {
        dialog.pick_file()
    };
    path.map(|p| p.to_string_lossy().to_string())
}

fn main() {
    install_panic_logger();
    tauri::Builder::default()
        .manage(AppState::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<AppState>();
                kill_all_managed_children(&state.children);
            }
        })
        .invoke_handler(tauri::generate_handler![
            config_load,
            config_save,
            config_reset,
            binary_validate,
            binary_set,
            model_list,
            runtime_profiles,
            runtime_apply_profile,
            runtime_health,
            gateway_start,
            gateway_stop,
            gateway_status,
            gateway_health,
            visual_locator_start,
            visual_locator_stop,
            visual_locator_status,
            server_start,
            server_stop,
            server_status,
            training_start,
            training_stop,
            training_status,
            training_check_output,
            monitor_collect,
            error_log,
            dialog_open
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Atlas Workbench");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_system_prompt_is_first_chat_message() {
        let config = json!({ "systemPrompt": "  You are Atlas. Be direct.  " });
        let body = json!({
            "messages": [
                { "role": "user", "content": "What model is loaded?" }
            ]
        });

        let injected = with_configured_system_prompt(body, &config);
        let messages = injected.get("messages").and_then(Value::as_array).unwrap();

        assert_eq!(messages[0], json!({ "role": "system", "content": "You are Atlas. Be direct." }));
        assert_eq!(messages[1], json!({ "role": "user", "content": "What model is loaded?" }));
    }

    #[test]
    fn empty_system_prompt_leaves_chat_messages_unchanged() {
        let config = json!({ "systemPrompt": "   " });
        let body = json!({ "messages": [{ "role": "user", "content": "Hello" }] });

        assert_eq!(with_configured_system_prompt(body.clone(), &config), body);
    }
}
