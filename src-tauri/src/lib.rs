mod app_server;
mod tray;

use app_server::{BridgeSnapshot, CodexAppServer};
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

#[tauri::command]
async fn get_rate_limits(
    app_handle: AppHandle,
    client: State<'_, CodexAppServer>,
) -> Result<Value, String> {
    client.latest_or_refresh(app_handle).await
}

#[tauri::command]
async fn refresh_rate_limits(
    app_handle: AppHandle,
    client: State<'_, CodexAppServer>,
) -> Result<Value, String> {
    client.refresh_with_start(app_handle).await
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app_handle, _, _| {
            tray::show_main_window(app_handle);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(CodexAppServer::new())
        .invoke_handler(tauri::generate_handler![
            get_rate_limits,
            refresh_rate_limits,
            get_bridge_status,
            get_autostart_enabled,
            set_autostart_enabled
        ])
        .setup(|app| {
            tray::create_tray(app)?;

            let app_handle = app.handle().clone();
            let client = app.state::<CodexAppServer>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let _ = client.ensure_started(Some(app_handle)).await;
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
            tauri::async_runtime::block_on(client.stop());
        }
    });
}

