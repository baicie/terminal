//! 窗口/托盘相关 Tauri 命令
//!
//! - `set_close_to_tray(enabled)`：开启后点 X 仅隐藏窗口而不退出
//! - `show_main_window()` / `hide_main_window()`：从前端控制主窗口
//! - `is_main_window_focused()`：辅助初始焦点状态读取（前端事件订阅之前用一次）

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Runtime};

/// 全局：是否点 X 时最小化到托盘。默认 false（保持原有退出行为）。
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

/// 提供给 setup 的查询接口。
pub fn close_to_tray_enabled() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
    tracing::info!(enabled, "close-to-tray flag updated");
}

#[tauri::command]
pub fn get_close_to_tray() -> bool {
    close_to_tray_enabled()
}

#[tauri::command]
pub fn show_main_window<R: Runtime>(app: AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn hide_main_window<R: Runtime>(app: AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
pub fn is_main_window_focused<R: Runtime>(app: AppHandle<R>) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
}
