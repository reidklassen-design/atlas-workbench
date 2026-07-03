use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    backtrace::Backtrace,
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader},
    io::{Read, Write},
    net::{TcpListener, TcpStream, ToSocketAddrs},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use uuid::Uuid;

const SERVER_READY_TIMEOUT_SECS: u64 = 600;
const HEALTH_PROGRESS_LOG_SECS: u64 = 5;
const PROCESS_LOG_MAX_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Default)]
struct AppState {
    children: Arc<Mutex<HashMap<String, Child>>>,
    log_tails: Arc<Mutex<HashMap<String, Vec<String>>>>,
    proc_samples: Mutex<HashMap<usize, ProcSample>>,
}

#[derive(Clone, Copy)]
struct ProcSample {
    ticks: u64,
    ts: u128,
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
        "binaryPaths": { "server": "", "finetune": "" },
        "gpu": { "autoOffloadInitialized": false, "optimizedProfileVersion": 0, "offloadMode": "auto" },
        "model": { "directory": "", "selectedModel": "" },
        "server": { "host": "127.0.0.1", "port": 8080 },
        "serverFlags": {
            "ctx-size": 131072,
            "n-gpu-layers": 999,
            "threads": 16,
            "threads-batch": 16,
            "batch-size": 2048,
            "ubatch-size": 512,
            "temp": 0.8,
            "top-k": 40,
            "top-p": 0.95,
            "flash-attn": "on",
            "cache-type-k": "q8_0",
            "cache-type-v": "q8_0",
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
        }
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
            flags.insert("ctx-size".to_string(), json!(131072));
            flags.insert("n-gpu-layers".to_string(), json!(999));
            flags.insert("flash-attn".to_string(), json!("on"));
            flags.insert("cache-type-k".to_string(), json!("q8_0"));
            flags.insert("cache-type-v".to_string(), json!("q8_0"));
            flags.insert("threads".to_string(), json!(16));
            flags.insert("threads-batch".to_string(), json!(16));
            flags.insert("parallel".to_string(), json!(1));
        }
        if let Some(gpu) = config.get_mut("gpu").and_then(Value::as_object_mut) {
            gpu.insert("optimizedProfileVersion".to_string(), json!(1));
            gpu.entry("offloadMode".to_string()).or_insert_with(|| json!("auto"));
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
    matches!(id, "parallel" | "n-gpu-layers" | "flash-attn" | "ctx-size" | "threads" | "threads-batch" | "cache-type-k" | "cache-type-v")
}

fn server_default_value(id: &str) -> Option<Value> {
    Some(match id {
        "api-key" | "device" | "tensor-split" | "path" | "draft-model" | "logit-bias" | "chat-template" | "chat-template-file" | "grammar" | "grammar-file" | "lora" | "lora-scaled" | "control-vector" | "ssl-key-file" | "ssl-cert-file" | "override-tensor" => json!(""),
        "alias" => json!("unknown"),
        "parallel" => json!(1),
        "cont-batching" | "slots" | "webui" | "log-prefix" | "warmup" => json!(true),
        "metrics" | "mlock" | "no-mmap" | "no-perf" | "context-shift" | "ignore-eos" | "embedding" | "reranking" => json!(false),
        "n-gpu-layers" => json!(999),
        "split-mode" => json!("layer"),
        "main-gpu" => json!(0),
        "numa" => json!("disabled"),
        "flash-attn" => json!("on"),
        "draft-max" => json!(16),
        "draft-min" => json!(5),
        "draft-p-min" => json!(0.9),
        "ctx-size" => json!(131072),
        "batch-size" => json!(2048),
        "ubatch-size" => json!(512),
        "keep" => json!(0),
        "threads" | "threads-batch" => json!(16),
        "predict" | "top-nsigma" | "reasoning-budget" | "embd-normalize" => json!(-1),
        "cache-type-k" | "cache-type-v" => json!("q8_0"),
        "defrag-thold" => json!(0.1),
        "cache-reuse" => json!(0),
        "temp" => json!(0.8),
        "top-k" => json!(40),
        "top-p" => json!(0.95),
        "min-p" => json!(0.05),
        "typical-p" => json!(1.0),
        "repeat-penalty" => json!(1.1),
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
    let ts = now();
    append_process_log(ts, kind, stream, &text);
    let _ = app.emit("log", json!({ "kind": kind, "stream": stream, "text": text, "ts": ts }));
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

fn spawn_reader(app: AppHandle, tails: Arc<Mutex<HashMap<String, Vec<String>>>>, kind: &'static str, stream: &'static str, reader: impl std::io::Read + Send + 'static) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            if let Ok(text) = line {
                if stream == "stderr" {
                    remember_tail(&tails, kind, text.clone());
                }
                emit_log(&app, kind, stream, text);
            }
        }
    });
}

fn kill_child_from_children(app: &AppHandle, children: &Arc<Mutex<HashMap<String, Child>>>, kind: &'static str) {
    if let Ok(mut map) = children.lock() {
        if let Some(mut child) = map.remove(kind) {
            let pid = child.id();
            let _ = child.kill();
            let _ = child.wait();
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
        let _ = child.kill();
        let _ = child.wait();
    }
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
    if state.children.lock().map_err(|_| app_error(kind, "Process state unavailable", "Could not lock the process table.", "Restart Atlas Workbench and try again."))?.contains_key(kind) {
        return Err(app_error(kind, "Process is already running", format!("A {} process is already running.", kind), "Stop the running process before starting another one."));
    }
    let resolved = resolve_binary_path(&binary, kind).map_err(|message| app_error(kind, "Binary path is not runnable", message, "Open Settings and select your llama.cpp executable or its containing folder."))?;
    if let Ok(mut tails) = state.log_tails.lock() {
        tails.remove(kind);
    }
    emit_log(&app, kind, "stdout", format!("Launching: {} {}", shell_quote(&resolved.to_string_lossy()), redacted_args(&args)));
    let mut child = Command::new(&resolved)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
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
    emit_log(
        app,
        "server",
        "stdout",
        format!(
            "Waiting for llama-server health at http://{}/health (listen host {}, timeout {}s)",
            url_addr,
            host,
            timeout.as_secs()
        ),
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
            emit_log(
                app,
                "server",
                "stdout",
                format!(
                    "Health check still waiting after {}s (attempt {}): {}",
                    started.elapsed().as_secs(),
                    attempts,
                    last_detail
                ),
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
            "--query-gpu=name,utilization.gpu,memory.used,memory.total",
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
    let used = parts.get(2).and_then(|v| v.parse::<u64>().ok()).map(|mib| mib * 1024 * 1024);
    let total = parts.get(3).and_then(|v| v.parse::<u64>().ok()).map(|mib| mib * 1024 * 1024);
    Some(json!({
        "detected": true,
        "name": parts[0],
        "usagePercent": usage,
        "memoryUsed": used,
        "memoryTotal": total,
        "note": "Detected with nvidia-smi"
    }))
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
            return json!({
                "detected": true,
                "name": name,
                "usagePercent": usage,
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
    let mut system = System::new_all();
    system.refresh_all();
    let cpus = system.cpus();
    let per_core: Vec<f32> = cpus.iter().map(|c| c.cpu_usage()).collect();
    let overall = if per_core.is_empty() { 0.0 } else { per_core.iter().sum::<f32>() / per_core.len() as f32 };
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
