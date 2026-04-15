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
mod vault;

// Session 模块 - 统一会话抽象层
pub mod session;

// Re-export session types for public API
pub use session::{
    ChannelConfig, ChannelManager, SessionChannel, SessionConfig, SessionError, SessionInfo,
    SessionManager, SessionOutput, SessionState, SessionType, SshConfig, JumpHostConfig,
};

use commands::{
    session_close, session_create_local, session_create_ssh_jump, session_create_ssh_key,
    session_create_ssh_password, session_list, session_resize, session_write,
};
use port_forward::{port_forward_list, port_forward_start, port_forward_stop};
use serial::{serial_baud_rates, serial_connect, serial_disconnect, serial_is_connected, serial_list, serial_write, serial_write_raw};
use sftp::{sftp_connect, sftp_delete, sftp_download, sftp_list, sftp_mkdir, sftp_rename, sftp_upload};
use state::create_shared_state;
use storage::{storage_delete, storage_download, storage_health_check, storage_init, storage_list, storage_upload};
use vault::{
    vault_change_password, vault_create, vault_delete, vault_exists, vault_get, vault_is_unlocked,
    vault_list, vault_lock, vault_set, vault_unlock,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared_state = create_shared_state();

    tauri::Builder::default()
        .manage(shared_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            // Session commands (unified API)
            session_create_local,
            session_create_ssh_password,
            session_create_ssh_key,
            session_create_ssh_jump,
            session_write,
            session_resize,
            session_close,
            session_list,
            // SFTP commands
            sftp_connect,
            sftp_list,
            sftp_upload,
            sftp_download,
            sftp_mkdir,
            sftp_delete,
            sftp_rename,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
