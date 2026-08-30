use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};
use tokio::{
    sync::{Mutex, RwLock},
    time::sleep,
};
use uuid::Uuid;

use crate::app_server::CodexAppServer;

const CLOUD_SYNC_ENDPOINT: &str = "https://cjjxjoaugpmttwxmtgyp.supabase.co/functions/v1/agent-runway-mobile";
const SUPABASE_PUBLISHABLE_KEY: &str = "sb_publishable_DvgeGVQ1Q3WHEnfpGuoRoA_nvYi9zu_";
const PUBLIC_COMPANION_URL: &str = "https://agent-runway.vercel.app";
const SYNC_INTERVAL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredConfig {
    enabled: bool,
    device_id: String,
    write_secret: String,
    share_token: String,
}

impl Default for StoredConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            device_id: Uuid::new_v4().to_string(),
            write_secret: generate_token(),
            share_token: generate_token(),
        }
    }
}

#[derive(Clone, Debug, Default)]
struct RuntimeState {
    ready: bool,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAccessInfo {
    enabled: bool,
    ready: bool,
    pairing_url: Option<String>,
    hostname: Option<String>,
    error: Option<String>,
}

struct Inner {
    client: CodexAppServer,
    http: Client,
    operation: Mutex<()>,
    config_path: RwLock<Option<PathBuf>>,
    config: RwLock<StoredConfig>,
    runtime: RwLock<RuntimeState>,
    sync_loop_started: AtomicBool,
}

#[derive(Clone)]
pub struct MobileBridge {
    inner: Arc<Inner>,
}

impl MobileBridge {
    pub fn new(client: CodexAppServer) -> Self {
        Self {
            inner: Arc::new(Inner {
                client,
                http: Client::new(),
                operation: Mutex::new(()),
                config_path: RwLock::new(None),
                config: RwLock::new(StoredConfig::default()),
                runtime: RwLock::new(RuntimeState::default()),
                sync_loop_started: AtomicBool::new(false),
            }),
        }
    }

    pub async fn initialize(&self, app_handle: AppHandle) -> Result<(), String> {
        {
            let _operation = self.inner.operation.lock().await;
            if self.inner.config_path.read().await.is_none() {
                let config_dir = app_handle
                    .path()
                    .app_config_dir()
                    .map_err(|error| format!("スマホ共有設定の保存先を開けません: {error}"))?;
                let config_path = config_dir.join("mobile-cloud-access.json");
                let config = read_config(&config_path).unwrap_or_default();
                *self.inner.config_path.write().await = Some(config_path);
                *self.inner.config.write().await = config;
            }
        }

        self.start_sync_loop(app_handle.clone());
        if self.inner.config.read().await.enabled {
            let _ = self.sync_latest(app_handle).await;
        }
        Ok(())
    }

    pub async fn info(&self) -> MobileAccessInfo {
        let config = self.inner.config.read().await.clone();
        let runtime = self.inner.runtime.read().await.clone();
        MobileAccessInfo {
            enabled: config.enabled,
            ready: runtime.ready,
            pairing_url: config.enabled.then(|| pairing_url(&config.share_token)),
            hostname: config.enabled.then(|| "agent-runway.vercel.app".to_string()),
            error: runtime.error,
        }
    }

    pub async fn set_enabled(
        &self,
        app_handle: AppHandle,
        enabled: bool,
    ) -> Result<MobileAccessInfo, String> {
        self.initialize(app_handle.clone()).await?;
        let operation = self.inner.operation.lock().await;
        let current = self.inner.config.read().await.clone();

        if enabled {
            let mut next = current;
            next.enabled = true;
            self.persist_config(&next).await?;
            *self.inner.config.write().await = next;
            drop(operation);
            match self.sync_latest(app_handle).await {
                Ok(()) => Ok(self.info().await),
                Err(error) => {
                    self.set_error(error).await;
                    Ok(self.info().await)
                }
            }
        } else {
            self.revoke_config(&current).await?;
            let mut next = current;
            next.enabled = false;
            self.persist_config(&next).await?;
            *self.inner.config.write().await = next;
            *self.inner.runtime.write().await = RuntimeState::default();
            Ok(self.info().await)
        }
    }

    pub async fn rotate_token(&self, app_handle: AppHandle) -> Result<MobileAccessInfo, String> {
        self.initialize(app_handle.clone()).await?;
        let _operation = self.inner.operation.lock().await;
        let current = self.inner.config.read().await.clone();
        if !current.enabled {
            return Ok(self.info().await);
        }

        let mut next = current;
        next.share_token = generate_token();
        let payload = self.inner.client.latest_or_refresh(app_handle).await?;
        self.sync_config(&next, payload).await?;
        self.persist_config(&next).await?;
        *self.inner.config.write().await = next;
        *self.inner.runtime.write().await = RuntimeState { ready: true, error: None };
        Ok(self.info().await)
    }

    pub async fn sync_payload(&self, payload: Value) {
        let config = self.inner.config.read().await.clone();
        if !config.enabled {
            return;
        }
        match self.sync_config(&config, payload).await {
            Ok(()) => *self.inner.runtime.write().await = RuntimeState { ready: true, error: None },
            Err(error) => self.set_error(error).await,
        }
    }

    pub async fn stop(&self) {}

    async fn sync_latest(&self, app_handle: AppHandle) -> Result<(), String> {
        let config = self.inner.config.read().await.clone();
        if !config.enabled {
            return Ok(());
        }
        let payload = self.inner.client.latest_or_refresh(app_handle).await?;
        self.sync_config(&config, payload).await?;
        *self.inner.runtime.write().await = RuntimeState { ready: true, error: None };
        Ok(())
    }

    async fn sync_config(&self, config: &StoredConfig, payload: Value) -> Result<(), String> {
        let payload = quota_only_payload(payload);
        let response = self
            .inner
            .http
            .post(CLOUD_SYNC_ENDPOINT)
            .header("apikey", SUPABASE_PUBLISHABLE_KEY)
            .bearer_auth(&config.write_secret)
            .json(&json!({
                "action": "sync",
                "deviceId": config.device_id,
                "shareToken": config.share_token,
                "payload": payload,
            }))
            .send()
            .await
            .map_err(|_| "スマホ向け同期先へ接続できません。ネットワークを確認してください".to_string())?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err("スマホ向け同期を完了できません。もう一度試してください".into())
        }
    }

    async fn revoke_config(&self, config: &StoredConfig) -> Result<(), String> {
        let response = self
            .inner
            .http
            .post(CLOUD_SYNC_ENDPOINT)
            .header("apikey", SUPABASE_PUBLISHABLE_KEY)
            .bearer_auth(&config.write_secret)
            .json(&json!({ "action": "revoke", "deviceId": config.device_id }))
            .send()
            .await
            .map_err(|_| "スマホ共有を安全に停止できません。ネットワークを確認してください".to_string())?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err("スマホ共有を安全に停止できません。PCがオンラインのときにもう一度試してください".into())
        }
    }

    async fn set_error(&self, error: String) {
        *self.inner.runtime.write().await = RuntimeState {
            ready: false,
            error: Some(error),
        };
    }

    async fn persist_config(&self, config: &StoredConfig) -> Result<(), String> {
        let path = self
            .inner
            .config_path
            .read()
            .await
            .clone()
            .ok_or_else(|| "スマホ共有設定が初期化されていません".to_string())?;
        write_config(&path, config)
    }

    fn start_sync_loop(&self, app_handle: AppHandle) {
        if self.inner.sync_loop_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let bridge = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                sleep(SYNC_INTERVAL).await;
                let _ = bridge.sync_latest(app_handle.clone()).await;
            }
        });
    }
}

fn quota_only_payload(payload: Value) -> Value {
    let mut safe = Map::new();
    for key in [
        "rateLimits",
        "rateLimitsByLimitId",
        "planType",
        "observedAt",
        "resetCreditsAvailable",
        "nextResetCreditExpiry",
    ] {
        if let Some(value) = payload.get(key) {
            safe.insert(key.to_string(), value.clone());
        }
    }
    safe.insert("source".into(), Value::from("live"));
    Value::Object(safe)
}

fn pairing_url(token: &str) -> String {
    format!("{PUBLIC_COMPANION_URL}/#access_token={token}")
}

fn generate_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn read_config(path: &Path) -> Option<StoredConfig> {
    let contents = fs::read_to_string(path).ok()?;
    let config = serde_json::from_str::<StoredConfig>(&contents).ok()?;
    (config.device_id.parse::<Uuid>().is_ok()
        && valid_token(&config.write_secret)
        && valid_token(&config.share_token))
        .then_some(config)
}

fn write_config(path: &Path, config: &StoredConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())
}

fn valid_token(token: &str) -> bool {
    token.len() == 64 && token.chars().all(|character| character.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_secret_stays_in_the_url_fragment() {
        let url = pairing_url(&"A".repeat(64));
        let (origin, fragment) = url.split_once('#').unwrap();
        assert!(!origin.contains('?'));
        assert!(fragment.starts_with("access_token="));
    }

    #[test]
    fn generated_tokens_are_strong_and_url_safe() {
        let token = generate_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn cloud_payload_excludes_non_quota_fields() {
        let payload = quota_only_payload(json!({
            "rateLimits": { "primary": { "usedPercent": 42 } },
            "observedAt": 123,
            "prompt": "never synchronize this",
            "repositoryPath": "/private/path"
        }));
        assert_eq!(payload["rateLimits"]["primary"]["usedPercent"], 42);
        assert_eq!(payload["source"], "live");
        assert!(payload.get("prompt").is_none());
        assert!(payload.get("repositoryPath").is_none());
    }
}
