mod app_server;
mod mobile_bridge;
mod tray;

use app_server::{BridgeSnapshot, CodexAppServer};
use mobile_bridge::{MobileAccessInfo, MobileBridge};
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

#[tauri::command]
async fn get_rate_limits(
    app_handle: AppHandle,
    client: State<'_, CodexAppServer>,
    bridge: State<'_, MobileBridge>,
) -> Result<Value, String> {
    let payload = client.latest_or_refresh(app_handle).await?;
    bridge.sync_payload(payload.clone()).await;
    Ok(payload)
}

#[tauri::command]
async fn refresh_rate_limits(
    app_handle: AppHandle,
    client: State<'_, CodexAppServer>,
    bridge: State<'_, MobileBridge>,
) -> Result<Value, String> {
    let payload = client.refresh_with_start(app_handle).await?;
    bridge.sync_payload(payload.clone()).await;
    Ok(payload)
}

#[tauri::command]
async fn get_bridge_status(client: State<'_, CodexAppServer>) -> Result<BridgeSnapshot, String> {
    Ok(client.snapshot().await)
}

#[tauri::command]
fn get_autostart_enabled(app_handle: AppHandle) -> Result<bool, String> {
    app_handle
        .autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_autostart_enabled(app_handle: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app_handle.autolaunch();
    if enabled {
        manager.enable().map_err(|error| error.to_string())?;
    } else {
        manager.disable().map_err(|error| error.to_string())?;
    }
    tray::update_autostart(&app_handle);
    manager.is_enabled().map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_mobile_access_info(
    app_handle: AppHandle,
    bridge: State<'_, MobileBridge>,
) -> Result<MobileAccessInfo, String> {
    bridge.initialize(app_handle).await?;
    Ok(bridge.info().await)
}

#[tauri::command]
async fn set_mobile_access_enabled(
    app_handle: AppHandle,
    bridge: State<'_, MobileBridge>,
    enabled: bool,
) -> Result<MobileAccessInfo, String> {
    bridge.set_enabled(app_handle, enabled).await
}

#[tauri::command]
async fn rotate_mobile_access_token(
    app_handle: AppHandle,
    bridge: State<'_, MobileBridge>,
) -> Result<MobileAccessInfo, String> {
    bridge.rotate_token(app_handle).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_server = CodexAppServer::new();
    let mobile_bridge = MobileBridge::new(app_server.clone());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app_handle, _, _| {
            tray::show_main_window(app_handle);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(app_server)
        .manage(mobile_bridge)
        .invoke_handler(tauri::generate_handler![
            get_rate_limits,
            refresh_rate_limits,
            get_bridge_status,
            get_autostart_enabled,
            set_autostart_enabled,
            get_mobile_access_info,
            set_mobile_access_enabled,
            rotate_mobile_access_token
        ])
        .setup(|app| {
            tray::create_tray(app)?;

            let app_handle = app.handle().clone();
            let client = app.state::<CodexAppServer>().inner().clone();
            let mobile = app.state::<MobileBridge>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let _ = client.ensure_started(Some(app_handle.clone())).await;
                let _ = mobile.initialize(app_handle).await;
            });

            if std::env::args().any(|argument| argument == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Agent Runway");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let client = app_handle.state::<CodexAppServer>().inner().clone();
            let mobile = app_handle.state::<MobileBridge>().inner().clone();
            tauri::async_runtime::block_on(async move {
                mobile.stop().await;
                client.stop().await;
            });
        }
    });
}
