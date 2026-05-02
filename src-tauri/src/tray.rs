//! 系统托盘
//!
//! 主菜单 + 左键点击切换主窗口可见。
//! 托盘菜单项的点击会通过 `Emitter` 发送到前端事件总线，
//! 由前端的 `useTrayEvents` hook 转换为 `shortcut:*` / 自定义动作。

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

const TRAY_ID: &str = "main-tray";

/// 跨平台快捷键提示
#[cfg(target_os = "macos")]
const QUIT_SHORTCUT: Option<&str> = Some("Cmd+Q");
#[cfg(not(target_os = "macos"))]
const QUIT_SHORTCUT: Option<&str> = Some("Ctrl+Q");

/// 在 setup 阶段初始化系统托盘
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show_window = MenuItem::with_id(
        app,
        "tray-show",
        "Show Window",
        true,
        None::<&str>,
    )?;
    let new_local = MenuItem::with_id(app, "tray-new-local", "New Local Terminal", true, None::<&str>)?;
    let new_ssh = MenuItem::with_id(app, "tray-new-ssh", "New SSH Connection…", true, None::<&str>)?;
    let command_palette = MenuItem::with_id(app, "tray-command-palette", "Command Palette…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, QUIT_SHORTCUT)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_window,
            &separator,
            &new_local,
            &new_ssh,
            &command_palette,
            &separator,
            &quit,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("tray icon".into()))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true) // macOS 模板色
        .tooltip("termius")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-show" => focus_main_window(app),
            "tray-new-local" => {
                focus_main_window(app);
                let _ = app.emit("tray://new-local", ());
            }
            "tray-new-ssh" => {
                focus_main_window(app);
                let _ = app.emit("tray://new-ssh", ());
            }
            "tray-command-palette" => {
                focus_main_window(app);
                let _ = app.emit("tray://command-palette", ());
            }
            "tray-quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// 显示并聚焦主窗口
pub fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 切换主窗口显示/隐藏（左键托盘时调用）
fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible().unwrap_or(false) {
            true => {
                if window.is_focused().unwrap_or(false) {
                    let _ = window.hide();
                } else {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            false => {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}
