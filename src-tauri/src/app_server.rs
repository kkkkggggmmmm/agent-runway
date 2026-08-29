use std::{
    collections::HashMap,
    env,
    io::ErrorKind,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex, RwLock},
    time::{sleep, timeout},
};

use crate::tray;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const POLL_INTERVAL: Duration = Duration::from_secs(5 * 60);
const RATE_LIMIT_EVENT: &str = "agent-runway-rate-limits";
const BRIDGE_STATUS_EVENT: &str = "agent-runway-bridge-status";

#[derive(Clone, Debug)]
struct LaunchCommand {
    program: PathBuf,
    args: Vec<String>,
}

impl LaunchCommand {
    fn codex(path: impl Into<PathBuf>) -> Self {
        let path = path.into();

        #[cfg(windows)]
        if path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat"))
        {
            let command = format!("\"\"{}\" app-server\"", path.display());
            return Self {
                program: PathBuf::from("cmd.exe"),
                args: vec!["/D".into(), "/S".into(), "/C".into(), command],
            };
        }

        Self {
            program: path,
            args: vec!["app-server".into()],
        }
    }

    #[cfg(test)]
    fn custom(program: impl Into<PathBuf>, args: Vec<String>) -> Self {
        Self {
            program: program.into(),
            args,
        }
    }
}

fn resolve_codex_command() -> LaunchCommand {
    if let Some(path) = env::var_os("CODEX_BIN").filter(|value| !value.is_empty()) {
        return LaunchCommand::codex(path);
    }

    let mut candidates = Vec::new();
    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join(".local/bin/codex"));
        candidates.push(home.join(".npm-global/bin/codex"));
        candidates.push(home.join(".volta/bin/codex"));
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
        candidates.push(PathBuf::from("/usr/local/bin/codex"));
    }

    #[cfg(windows)]
    {
        if let Some(app_data) = env::var_os("APPDATA").map(PathBuf::from) {
            candidates.push(app_data.join("npm/codex.exe"));
            candidates.push(app_data.join("npm/codex.cmd"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            candidates.push(local_app_data.join("Programs/codex/codex.exe"));
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .map(LaunchCommand::codex)
        .unwrap_or_else(|| LaunchCommand::codex("codex"))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSnapshot {
    pub status: String,
    pub latest: Option<Value>,
    pub error: Option<String>,
}

type PendingResponse = Result<Value, String>;

struct Inner {
    launch: LaunchCommand,
    start_gate: Mutex<()>,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<PendingResponse>>>,
    next_id: AtomicU64,
    status: RwLock<String>,
    latest: RwLock<Option<Value>>,
    last_error: RwLock<Option<String>>,
    app_handle: RwLock<Option<AppHandle>>,
    polling_started: AtomicBool,
    stopping: AtomicBool,
    notification_generation: AtomicU64,
}

#[derive(Clone)]
pub struct CodexAppServer {
    inner: Arc<Inner>,
}

impl Default for CodexAppServer {
    fn default() -> Self {
        Self::new()
    }
}

impl CodexAppServer {
    pub fn new() -> Self {
        Self::from_launch(resolve_codex_command())
    }

    fn from_launch(launch: LaunchCommand) -> Self {
        Self {
            inner: Arc::new(Inner {
                launch,
                start_gate: Mutex::new(()),
                stdin: Mutex::new(None),
                child: Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
                status: RwLock::new("idle".into()),
                latest: RwLock::new(None),
                last_error: RwLock::new(None),
                app_handle: RwLock::new(None),
                polling_started: AtomicBool::new(false),
                stopping: AtomicBool::new(false),
                notification_generation: AtomicU64::new(0),
            }),
        }
    }

    #[cfg(test)]
    fn with_command(program: impl Into<PathBuf>, args: Vec<String>) -> Self {
        Self::from_launch(LaunchCommand::custom(program, args))
    }

    pub async fn ensure_started(&self, app_handle: Option<AppHandle>) -> Result<(), String> {
        if let Some(app_handle) = app_handle {
            *self.inner.app_handle.write().await = Some(app_handle);
        }

        let _start_guard = self.inner.start_gate.lock().await;
        if self.inner.stdin.lock().await.is_some() {
            self.start_polling();
            return Ok(());
        }

        self.inner.stopping.store(false, Ordering::SeqCst);
        self.set_status("connecting", None).await;

        let mut command = Command::new(&self.inner.launch.program);
        command
            .args(&self.inner.launch.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        #[cfg(windows)]
        command.creation_flags(0x0800_0000);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let message = if error.kind() == ErrorKind::NotFound {
                    "Codex CLIが見つかりません。CodexをインストールするかCODEX_BINを設定してください".to_string()
                } else {
                    format!("Codex App Serverを起動できません: {error}")
                };
                self.set_status("unavailable", Some(message.clone())).await;
                return Err(message);
            }
        };

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex App Serverの標準入力を開けません".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex App Serverの標準出力を開けません".to_string())?;
        let stderr = child.stderr.take();

        *self.inner.stdin.lock().await = Some(stdin);
        *self.inner.child.lock().await = Some(child);

        let reader_client = self.clone();
        tauri::async_runtime::spawn(async move {
            reader_client.read_stdout(stdout).await;
        });

        if let Some(stderr) = stderr {
            tauri::async_runtime::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while matches!(lines.next_line().await, Ok(Some(_))) {
                    // App Server diagnostics may contain local paths. Intentionally discard them.
                }
            });
        }

        let initialize_result = self
            .request(
                "initialize",
                Some(json!({
                    "clientInfo": {
                        "name": "agent_runway",
                        "title": "Agent Runway",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "capabilities": {
                        "optOutNotificationMethods": [
                            "item/agentMessage/delta",
                            "item/reasoning/summaryTextDelta",
                            "item/commandExecution/outputDelta"
                        ]
                    }
                })),
            )
            .await;

        if let Err(error) = initialize_result {
            self.stop_process().await;
            self.set_status("unavailable", Some(error.clone())).await;
            return Err(error);
        }

        if let Err(error) = self.send_notification("initialized", Some(json!({}))).await {
            self.stop_process().await;
            self.set_status("unavailable", Some(error.clone())).await;
            return Err(error);
        }
        self.set_status("connected", None).await;
        self.start_polling();
        self.refresh().await?;
        Ok(())
    }

    pub async fn latest_or_refresh(&self, app_handle: AppHandle) -> Result<Value, String> {
        self.ensure_started(Some(app_handle)).await?;
        if let Some(latest) = self.inner.latest.read().await.clone() {
            return Ok(latest);
        }
        self.refresh().await
    }

    pub async fn refresh_with_start(&self, app_handle: AppHandle) -> Result<Value, String> {
        self.ensure_started(Some(app_handle)).await?;
        self.refresh().await
    }

    pub async fn refresh(&self) -> Result<Value, String> {
        let result = match self.request("account/rateLimits/read", None).await {
            Ok(result) => result,
            Err(error) => {
                self.set_status("degraded", Some(error.clone())).await;
                return Err(error);
            }
        };

        let mut fields = match result {
            Value::Object(fields) => fields,
            other => {
                let mut fields = Map::new();
                fields.insert("rateLimits".into(), other);
                fields
            }
        };
        fields.insert("observedAt".into(), Value::from(now_millis()));
        fields.insert("source".into(), Value::from("live"));
        let payload = Value::Object(fields);

        *self.inner.latest.write().await = Some(payload.clone());
        self.set_status("connected", None).await;

        if let Some(app_handle) = self.inner.app_handle.read().await.clone() {
            let _ = app_handle.emit(RATE_LIMIT_EVENT, payload.clone());
            tray::update_quota(&app_handle, &payload);
        }
        Ok(payload)
    }

    pub async fn snapshot(&self) -> BridgeSnapshot {
        BridgeSnapshot {
            status: self.inner.status.read().await.clone(),
            latest: self.inner.latest.read().await.clone(),
            error: self.inner.last_error.read().await.clone(),
        }
    }

    pub async fn stop(&self) {
        self.inner.stopping.store(true, Ordering::SeqCst);
        self.stop_process().await;
        self.set_status("stopped", None).await;
    }

    async fn read_stdout(&self, stdout: tokio::process::ChildStdout) {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => self.handle_line(&line).await,
                Ok(None) => break,
                Err(_) => break,
            }
        }
        self.handle_disconnect().await;
    }

    async fn handle_line(&self, line: &str) {
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            return;
        };

        if let Some(id) = message.get("id").and_then(Value::as_u64) {
            if let Some(sender) = self.inner.pending.lock().await.remove(&id) {
                let response = if let Some(error) = message.get("error") {
                    Err(error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("App Server request failed")
                        .to_string())
                } else {
                    Ok(message.get("result").cloned().unwrap_or_else(|| json!({})))
                };
                let _ = sender.send(response);
            }
            return;
        }

        if message.get("method").and_then(Value::as_str) == Some("account/rateLimits/updated") {
            let generation = self
                .inner
                .notification_generation
                .fetch_add(1, Ordering::SeqCst)
                + 1;
            let client = self.clone();
            tauri::async_runtime::spawn(async move {
                sleep(Duration::from_millis(400)).await;
                if client.inner.notification_generation.load(Ordering::SeqCst) == generation {
                    let _ = client.refresh().await;
                }
            });
        }
    }

    async fn request(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        self.inner.pending.lock().await.insert(id, sender);

        let mut fields = Map::new();
        fields.insert("method".into(), Value::from(method));
        fields.insert("id".into(), Value::from(id));
        if let Some(params) = params {
            fields.insert("params".into(), params);
        }

        if let Err(error) = self.write_message(Value::Object(fields)).await {
            self.inner.pending.lock().await.remove(&id);
            return Err(error);
        }

        match timeout(REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => Err(format!("{method} response channel closed")),
            Err(_) => {
                self.inner.pending.lock().await.remove(&id);
                Err(format!("{method} timed out"))
            }
        }
    }

    async fn send_notification(&self, method: &str, params: Option<Value>) -> Result<(), String> {
        let mut fields = Map::new();
        fields.insert("method".into(), Value::from(method));
        if let Some(params) = params {
            fields.insert("params".into(), params);
        }
        self.write_message(Value::Object(fields)).await
    }

    async fn write_message(&self, message: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
        bytes.push(b'\n');

        let mut stdin_guard = self.inner.stdin.lock().await;
        let stdin = stdin_guard
            .as_mut()
            .ok_or_else(|| "Codex App Server is not connected".to_string())?;
        stdin
            .write_all(&bytes)
            .await
            .map_err(|error| format!("Codex App Server write failed: {error}"))?;
        stdin
            .flush()
            .await
            .map_err(|error| format!("Codex App Server flush failed: {error}"))
    }

    async fn set_status(&self, status: &str, error: Option<String>) {
        *self.inner.status.write().await = status.to_string();
        *self.inner.last_error.write().await = error.clone();

        let app_handle = self.inner.app_handle.read().await.clone();
        if let Some(app_handle) = app_handle {
            let snapshot = self.snapshot().await;
            let _ = app_handle.emit(BRIDGE_STATUS_EVENT, snapshot);
            tray::update_bridge_status(&app_handle, status, error.as_deref());
        }
    }

    fn start_polling(&self) {
        if self.inner.polling_started.swap(true, Ordering::SeqCst) {
            return;
        }

        let client = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                sleep(POLL_INTERVAL).await;
                if client.inner.stopping.load(Ordering::SeqCst) {
                    break;
                }
                let app_handle = client.inner.app_handle.read().await.clone();
                if client.ensure_started(app_handle).await.is_ok() {
                    let _ = client.refresh().await;
                }
            }
        });
    }

    async fn handle_disconnect(&self) {
        self.inner.stdin.lock().await.take();
        if let Some(mut child) = self.inner.child.lock().await.take() {
            let _ = child.wait().await;
        }
        self.fail_pending("Codex App Server stopped").await;

        if self.inner.stopping.load(Ordering::SeqCst) {
            self.set_status("stopped", None).await;
        } else {
            self.set_status(
                "unavailable",
                Some("Codex App Serverとの接続が終了しました".into()),
            )
            .await;
        }
    }

    async fn stop_process(&self) {
        self.inner.stdin.lock().await.take();
        if let Some(mut child) = self.inner.child.lock().await.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        self.fail_pending("Agent Runway stopped").await;
    }

    async fn fail_pending(&self, message: &str) {
        let pending = std::mem::take(&mut *self.inner.pending.lock().await);
        for (_, sender) in pending {
            let _ = sender.send(Err(message.to_string()));
        }
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn weekly_remaining(payload: &Value) -> Option<f64> {
    let bucket = payload
        .get("rateLimitsByLimitId")
        .and_then(|buckets| buckets.get("codex"))
        .or_else(|| payload.get("rateLimits"))?;

    ["primary", "secondary"].into_iter().find_map(|name| {
        let window = bucket.get(name)?;
        let duration = window.get("windowDurationMins")?.as_f64()?;
        if (duration - 10_080.0).abs() > f64::EPSILON {
            return None;
        }
        window
            .get("usedPercent")
            .and_then(Value::as_f64)
            .map(|used| (100.0 - used).clamp(0.0, 100.0))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn finds_weekly_window_by_duration_not_position() {
        let payload = json!({
            "rateLimitsByLimitId": {
                "codex": {
                    "primary": { "usedPercent": 20, "windowDurationMins": 300 },
                    "secondary": { "usedPercent": 42, "windowDurationMins": 10080 }
                }
            }
        });
        assert_eq!(weekly_remaining(&payload), Some(58.0));
    }

    #[tokio::test]
    async fn speaks_app_server_jsonl_and_handles_update_notification() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../server/test/fake-app-server.mjs");
        let client = CodexAppServer::with_command(
            "node",
            vec![fixture.to_string_lossy().into_owned()],
        );

        client.ensure_started(None).await.unwrap();
        let initial = client.snapshot().await.latest.unwrap();
        assert_eq!(
            initial["rateLimits"]["primary"]["usedPercent"],
            Value::from(41)
        );

        sleep(Duration::from_millis(700)).await;
        let updated = client.snapshot().await.latest.unwrap();
        assert_eq!(
            updated["rateLimits"]["primary"]["usedPercent"],
            Value::from(42)
        );
        client.stop().await;
    }

    #[tokio::test]
    async fn missing_executable_is_recoverable() {
        let client = CodexAppServer::with_command(
            "/agent-runway/definitely-missing-codex",
            vec!["app-server".into()],
        );
        let error = client.ensure_started(None).await.unwrap_err();
        assert!(error.contains("Codex CLIが見つかりません"));
        assert_eq!(client.snapshot().await.status, "unavailable");
    }
}
