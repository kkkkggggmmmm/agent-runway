use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Manager};
use tokio::{
    net::TcpListener,
    process::Command,
    sync::{oneshot, Mutex, RwLock},
    time::sleep,
};
use uuid::Uuid;

use crate::app_server::CodexAppServer;

const LOCAL_PORT: u16 = 4317;
const TAILSCALE_HTTPS_PORT: u16 = 8443;
static DIST: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../dist");

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredConfig {
    enabled: bool,
    token: String,
}

impl Default for StoredConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            token: generate_token(),
        }
    }
}

#[derive(Clone, Debug, Default)]
struct RuntimeState {
    ready: bool,
    pairing_url: Option<String>,
    hostname: Option<String>,
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
    operation: Mutex<()>,
    config_path: RwLock<Option<PathBuf>>,
    config: RwLock<StoredConfig>,
    runtime: RwLock<RuntimeState>,
    server_shutdown: Mutex<Option<oneshot::Sender<()>>>,
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
                operation: Mutex::new(()),
                config_path: RwLock::new(None),
                config: RwLock::new(StoredConfig::default()),
                runtime: RwLock::new(RuntimeState::default()),
                server_shutdown: Mutex::new(None),
            }),
        }
    }

    pub async fn initialize(&self, app_handle: AppHandle) -> Result<(), String> {
        let _operation = self.inner.operation.lock().await;
        if self.inner.config_path.read().await.is_some() {
            return Ok(());
        }

        let config_dir = app_handle
            .path()
            .app_config_dir()
            .map_err(|error| format!("スマホ共有設定の保存先を開けません: {error}"))?;
        let config_path = config_dir.join("mobile-access.json");
        let config = read_config(&config_path).unwrap_or_default();
        *self.inner.config_path.write().await = Some(config_path);
        *self.inner.config.write().await = config.clone();

        if config.enabled {
            if let Err(error) = self.activate_inner(app_handle).await {
                self.set_error(error).await;
            }
        }
        Ok(())
    }

    pub async fn info(&self) -> MobileAccessInfo {
        let config = self.inner.config.read().await.clone();
        let runtime = self.inner.runtime.read().await.clone();
        MobileAccessInfo {
            enabled: config.enabled,
            ready: runtime.ready,
            pairing_url: runtime.pairing_url,
            hostname: runtime.hostname,
            error: runtime.error,
        }
    }

    pub async fn set_enabled(
        &self,
        app_handle: AppHandle,
        enabled: bool,
    ) -> Result<MobileAccessInfo, String> {
        self.initialize(app_handle.clone()).await?;
        let _operation = self.inner.operation.lock().await;

        {
            let mut config = self.inner.config.write().await;
            config.enabled = enabled;
            let saved = config.clone();
            drop(config);
            self.persist_config(&saved).await?;
        }

        if enabled {
            if let Err(error) = self.activate_inner(app_handle).await {
                self.set_error(error).await;
            }
        } else {
            self.stop_http_server().await;
            let _ = disable_tailscale_serve().await;
            *self.inner.runtime.write().await = RuntimeState::default();
        }
        Ok(self.info().await)
    }

    pub async fn rotate_token(&self, app_handle: AppHandle) -> Result<MobileAccessInfo, String> {
        self.initialize(app_handle.clone()).await?;
        let _operation = self.inner.operation.lock().await;
        let enabled = {
            let mut config = self.inner.config.write().await;
            config.token = generate_token();
            let saved = config.clone();
            let enabled = config.enabled;
            drop(config);
            self.persist_config(&saved).await?;
            enabled
        };

        if enabled {
            self.stop_http_server().await;
            if let Err(error) = self.activate_inner(app_handle).await {
                self.set_error(error).await;
            }
        }
        Ok(self.info().await)
    }

    pub async fn stop(&self) {
        self.stop_http_server().await;
    }

    async fn activate_inner(&self, app_handle: AppHandle) -> Result<(), String> {
        self.stop_http_server().await;
        *self.inner.runtime.write().await = RuntimeState::default();

        let tailscale = resolve_tailscale_command();
        let hostname = tailscale_dns_name(&tailscale).await?;
        let token = self.inner.config.read().await.token.clone();
        self.start_http_server(app_handle, token.clone()).await?;

        if let Err(error) = enable_tailscale_serve(&tailscale).await {
            self.stop_http_server().await;
            return Err(error);
        }

        let pairing_url = pairing_url(&hostname, &token);
        *self.inner.runtime.write().await = RuntimeState {
            ready: true,
            pairing_url: Some(pairing_url),
            hostname: Some(hostname),
            error: None,
        };
        Ok(())
    }

    async fn start_http_server(&self, app_handle: AppHandle, token: String) -> Result<(), String> {
        let listener = TcpListener::bind(("127.0.0.1", LOCAL_PORT))
            .await
            .map_err(|_| format!("スマホ共有ポート {LOCAL_PORT} を開けません。別のAgent Runwayが起動していないか確認してください"))?;
        let state = HttpState {
            client: self.inner.client.clone(),
            app_handle,
            token,
        };
        let router = Router::new()
            .route("/api/health", get(api_health))
            .route("/api/rate-limits", get(api_rate_limits))
            .route("/api/refresh", post(api_refresh))
            .fallback(static_asset)
            .with_state(state);
        let (shutdown_sender, shutdown_receiver) = oneshot::channel();
        *self.inner.server_shutdown.lock().await = Some(shutdown_sender);
        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = shutdown_receiver.await;
                })
                .await;
        });
        Ok(())
    }

    async fn stop_http_server(&self) {
        if let Some(shutdown) = self.inner.server_shutdown.lock().await.take() {
            let _ = shutdown.send(());
            sleep(Duration::from_millis(50)).await;
        }
    }

    async fn set_error(&self, error: String) {
        *self.inner.runtime.write().await = RuntimeState {
            error: Some(error),
            ..RuntimeState::default()
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
}

#[derive(Clone)]
struct HttpState {
    client: CodexAppServer,
    app_handle: AppHandle,
    token: String,
}

async fn api_health(State(state): State<HttpState>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state.token) {
        return unauthorized();
    }
    let snapshot = state.client.snapshot().await;
    json_response(
        StatusCode::OK,
        json!({ "status": snapshot.status, "source": "live", "error": snapshot.error }),
    )
}

async fn api_rate_limits(State(state): State<HttpState>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state.token) {
        return unauthorized();
    }
    match state
        .client
        .latest_or_refresh(state.app_handle.clone())
        .await
    {
        Ok(payload) => json_response(StatusCode::OK, payload),
        Err(error) => json_response(StatusCode::SERVICE_UNAVAILABLE, json!({ "error": error })),
    }
}

async fn api_refresh(State(state): State<HttpState>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state.token) {
        return unauthorized();
    }
    match state
        .client
        .refresh_with_start(state.app_handle.clone())
        .await
    {
        Ok(payload) => json_response(StatusCode::OK, payload),
        Err(error) => json_response(StatusCode::SERVICE_UNAVAILABLE, json!({ "error": error })),
    }
}

async fn static_asset(uri: Uri) -> Response {
    let requested = uri.path().trim_start_matches('/');
    if requested.starts_with("api/") || requested.split('/').any(|part| part == "..") {
        return json_response(StatusCode::NOT_FOUND, json!({ "error": "Not found" }));
    }

    let path = if requested.is_empty() { "index.html" } else { requested };
    let file = DIST.get_file(path).or_else(|| {
        if Path::new(path).extension().is_none() {
            DIST.get_file("index.html")
        } else {
            None
        }
    });
    let Some(file) = file else {
        return json_response(StatusCode::NOT_FOUND, json!({ "error": "Not found" }));
    };

    let mut response = Response::new(Body::from(file.contents()));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime_guess::from_path(file.path()).first_or_octet_stream().essence_str())
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    let cache_control = if path == "index.html" || path == "sw.js" || path == "manifest.webmanifest" {
        "no-cache"
    } else {
        "public, max-age=31536000, immutable"
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache_control));
    add_security_headers(&mut response);
    response
}

fn json_response(status: StatusCode, payload: Value) -> Response {
    let mut response = (status, Json(payload)).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    add_security_headers(&mut response);
    response
}

fn unauthorized() -> Response {
    let mut response = json_response(
        StatusCode::UNAUTHORIZED,
        json!({ "error": "スマホ接続コードが無効です。PCで新しいQRコードを読み取ってください" }),
    );
    response.headers_mut().insert(
        header::WWW_AUTHENTICATE,
        HeaderValue::from_static("Bearer"),
    );
    response
}

fn add_security_headers(response: &mut Response) {
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; worker-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'"),
    );
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
}

fn authorized(headers: &HeaderMap, expected: &str) -> bool {
    let Some(supplied) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    supplied.as_bytes().ct_eq(expected.as_bytes()).into()
}

fn generate_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn pairing_url(hostname: &str, token: &str) -> String {
    format!(
        "https://{hostname}:{TAILSCALE_HTTPS_PORT}/#access_token={token}"
    )
}

fn resolve_tailscale_command() -> PathBuf {
    if let Some(path) = env::var_os("TAILSCALE_BIN").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }

    let mut candidates = vec![
        PathBuf::from("/Applications/Tailscale.app/Contents/MacOS/Tailscale"),
        PathBuf::from("/usr/local/bin/tailscale"),
        PathBuf::from("/opt/homebrew/bin/tailscale"),
    ];
    #[cfg(windows)]
    if let Some(program_files) = env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("Tailscale/tailscale.exe"));
    }
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| PathBuf::from("tailscale"))
}

async fn tailscale_dns_name(command: &Path) -> Result<String, String> {
    let output = Command::new(command)
        .args(["status", "--json"])
        .output()
        .await
        .map_err(|_| "Tailscaleが見つかりません。PCとスマホへTailscaleをインストールしてください".to_string())?;
    if !output.status.success() {
        return Err("Tailscaleへ接続できません。PC側でサインイン済みか確認してください".into());
    }
    let payload: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "Tailscaleの接続情報を読み取れません".to_string())?;
    let hostname = payload
        .pointer("/Self/DNSName")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim_end_matches('.')
        .to_string();
    if hostname.is_empty()
        || !hostname.ends_with(".ts.net")
        || !hostname
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
    {
        return Err("TailscaleのMagicDNS名を取得できません。MagicDNSとHTTPSを有効にしてください".into());
    }
    Ok(hostname)
}

async fn enable_tailscale_serve(command: &Path) -> Result<(), String> {
    let https = format!("--https={TAILSCALE_HTTPS_PORT}");
    let target = format!("http://127.0.0.1:{LOCAL_PORT}");
    let output = Command::new(command)
        .args(["serve", "--bg", "--yes", &https, &target])
        .output()
        .await
        .map_err(|_| "Tailscale Serveを開始できません".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Tailscale Serveを開始できません。TailscaleのHTTPS機能を有効にしてください".into())
    }
}

async fn disable_tailscale_serve() -> Result<(), String> {
    let command = resolve_tailscale_command();
    let https = format!("--https={TAILSCALE_HTTPS_PORT}");
    let output = Command::new(command)
        .args(["serve", &https, "off"])
        .output()
        .await
        .map_err(|_| "Tailscale Serveを停止できません".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Tailscale Serveを停止できません".into())
    }
}

fn read_config(path: &Path) -> Option<StoredConfig> {
    let contents = fs::read_to_string(path).ok()?;
    let config = serde_json::from_str::<StoredConfig>(&contents).ok()?;
    (config.token.len() >= 40).then_some(config)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_secret_stays_in_the_url_fragment() {
        let url = pairing_url("runway.example.ts.net", &"A".repeat(64));
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
    fn bearer_authorization_requires_an_exact_token() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer exact-secret"),
        );
        assert!(authorized(&headers, "exact-secret"));
        assert!(!authorized(&headers, "different-secret"));
    }
}
