use serde_json::Value;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Wry,
};
use tauri_plugin_autostart::ManagerExt;

use crate::app_server::{weekly_remaining, CodexAppServer};

pub struct TrayHandles {
    status_item: MenuItem<Wry>,
    autostart_item: MenuItem<Wry>,
}

pub fn create_tray(app: &mut App) -> tauri::Result<()> {
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let status_item = MenuItem::with_id(
        app,
        "quota-status",
        "週次残量: 接続中",
        false,
        None::<&str>,
    )?;
    let autostart_item = MenuItem::with_id(
        app,
        "toggle-autostart",
        autostart_label(autostart_enabled),
        true,
        None::<&str>,
    )?;
    let menu = MenuBuilder::new(app)
        .item(&status_item)
        .separator()
        .text("open", "Agent Runwayを開く")
        .text("refresh", "今すぐ更新")
        .item(&autostart_item)
        .separator()
        .text("quit", "終了")
        .build()?;
    let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Agent Runway · 接続中")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| match event.id.as_ref() {
            "open" => show_main_window(app_handle),
            "refresh" => {
                let client = app_handle.state::<CodexAppServer>().inner().clone();
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = client.refresh_with_start(app_handle).await;
                });
            }
            "toggle-autostart" => {
                let manager = app_handle.autolaunch();
                let enabled = manager.is_enabled().unwrap_or(false);
                let _ = if enabled {
                    manager.disable()
                } else {
                    manager.enable()
                };
                update_autostart(app_handle);
            }
            "quit" => app_handle.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(TrayHandles {
        status_item,
        autostart_item,
    });
    Ok(())
}

pub fn show_main_window(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn update_quota(app_handle: &AppHandle, payload: &Value) {
    let Some(remaining) = weekly_remaining(payload) else {
        return;
    };
    let rounded = remaining.round() as i64;
    if let Some(handles) = app_handle.try_state::<TrayHandles>() {
        let _ = handles
            .status_item
            .set_text(format!("週次残量: {rounded}%"));
    }
    if let Some(tray) = app_handle.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(format!("Agent Runway · 週次残量 {rounded}%")));
        #[cfg(target_os = "macos")]
        let _ = tray.set_title(Some(format!(" {rounded}%")));
    }
}

pub fn update_bridge_status(app_handle: &AppHandle, status: &str, error: Option<&str>) {
    if status == "connected" {
        return;
    }

    let label = match status {
        "connecting" => "週次残量: 接続中".to_string(),
        "degraded" => "週次残量: 更新待ち".to_string(),
        "stopped" => "Agent Runway: 停止".to_string(),
        _ => "Agent Runway: 接続なし".to_string(),
    };
    if let Some(handles) = app_handle.try_state::<TrayHandles>() {
        let _ = handles.status_item.set_text(&label);
    }
    if let Some(tray) = app_handle.tray_by_id("main-tray") {
        let tooltip = error.unwrap_or(&label);
        let _ = tray.set_tooltip(Some(tooltip));
        #[cfg(target_os = "macos")]
        let _ = tray.set_title(Some(" --"));
    }
}

pub fn update_autostart(app_handle: &AppHandle) {
    let enabled = app_handle.autolaunch().is_enabled().unwrap_or(false);
    if let Some(handles) = app_handle.try_state::<TrayHandles>() {
        let _ = handles.autostart_item.set_text(autostart_label(enabled));
    }
}

fn autostart_label(enabled: bool) -> &'static str {
    if enabled {
        "ログイン時の自動起動を無効にする"
    } else {
        "ログイン時の自動起動を有効にする"
    }
}

