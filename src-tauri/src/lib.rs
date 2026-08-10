//! Terminal module
//!
//! This module provides re-exports for terminal-related types and functions.

mod agent;
mod commands;
mod errors;
mod port_forward;
mod serial;
mod sftp;
mod state;
mod storage;
mod tray;
mod vault;
mod window_cmd;

// Session 模块 - 统一会话抽象层
pub mod session;

// Re-export session types for public API
pub use session::{
    ChannelConfig, ChannelManager, ExecResult, JumpHostConfig, KeyGenResult, SessionChannel,
    SessionConfig, SessionError, SessionInfo, SessionManager, SessionOutput, SessionState,
    SessionType, SshConfig,
};

use commands::{
    key_generate, session_close, session_create_local, session_create_ssh_agent,
    session_create_ssh_cert, session_create_ssh_jump, session_create_ssh_key,
    session_create_ssh_password, session_exec, session_list, session_resize, session_write,
};
use port_forward::{port_forward_list, port_forward_start, port_forward_stop};
use serial::{
    serial_baud_rates, serial_connect, serial_disconnect, serial_is_connected, serial_list,
    serial_write, serial_write_raw,
};
use sftp::{
    sftp_connect, sftp_delete, sftp_download, sftp_list, sftp_local_checksum, sftp_mkdir,
    sftp_remote_checksum, sftp_rename, sftp_upload,
};
use state::create_shared_state;
use storage::{
    storage_delete, storage_download, storage_health_check, storage_init, storage_list,
    storage_upload,
};
use vault::{
    vault_can_encrypt_for_team, vault_change_password, vault_create, vault_decrypt_for_team,
    vault_delete, vault_encrypt_for_team, vault_exists, vault_get, vault_is_unlocked, vault_list,
    vault_lock, vault_set, vault_unlock,
};
use window_cmd::{
    close_to_tray_enabled, get_close_to_tray, hide_main_window, is_main_window_focused,
    set_close_to_tray, show_main_window,
};

/// 初始化结构化日志（tracing）。
///
/// - 默认级别：`info`，可通过 `RUST_LOG` env 覆盖（与原 env_logger 兼容）
/// - 桥接 `log` crate：第三方依赖（russh, tauri 等）的 `log::info!` 也会
///   被路由到 tracing subscriber，统一输出格式
/// - 输出包含：时间戳、target（模块路径）、级别、字段（结构化）
fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};

    // 兼容旧 RUST_LOG 配置；若未设置则默认 info 级别
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let layer = fmt::layer()
        .with_target(true)
        .with_thread_ids(false)
        .with_line_number(false)
        .compact();

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(layer)
        .try_init();

    // 把 log crate 的事件桥接到 tracing
    let _ = tracing_log::LogTracer::init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let shared_state = create_shared_state();
    let storage_manager = std::sync::Arc::new(crate::storage::StorageManager::new());

    tauri::Builder::default()
        .manage(shared_state)
        .manage(storage_manager)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            tracing::info!("tauri app starting up");
            if let Err(e) = tray::build_tray(app.handle()) {
                tracing::error!(error = %e, "failed to build tray icon");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 点 X 拦截：若用户在设置里开启了 minimize-to-tray，则隐藏窗口而非退出
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && close_to_tray_enabled() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Session commands (unified API)
            session_create_local,
            session_create_ssh_password,
            session_create_ssh_key,
            session_create_ssh_agent,
            session_create_ssh_cert,
            session_create_ssh_jump,
            session_write,
            session_resize,
            session_close,
            session_list,
            session_exec,
            key_generate,
            // SFTP commands
            sftp_connect,
            sftp_list,
            sftp_upload,
            sftp_download,
            sftp_mkdir,
            sftp_delete,
            sftp_rename,
            sftp_local_checksum,
            sftp_remote_checksum,
            // Port forwarding commands
            port_forward_start,
            port_forward_stop,
            port_forward_list,
            // Vault commands
            vault_exists,
            vault_create,
            vault_unlock,
            vault_lock,
            vault_is_unlocked,
            vault_set,
            vault_get,
            vault_list,
            vault_delete,
            vault_change_password,
            vault_encrypt_for_team,
            vault_decrypt_for_team,
            vault_can_encrypt_for_team,
            // Serial commands
            serial_list,
            serial_baud_rates,
            serial_connect,
            serial_write,
            serial_write_raw,
            serial_is_connected,
            serial_disconnect,
            // Storage commands
            storage_init,
            storage_health_check,
            storage_upload,
            storage_download,
            storage_list,
            storage_delete,
            // Window / tray commands
            set_close_to_tray,
            get_close_to_tray,
            show_main_window,
            hide_main_window,
            is_main_window_focused,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
