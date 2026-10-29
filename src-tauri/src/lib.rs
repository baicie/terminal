//! Terminal module
//!
//! This module provides re-exports for terminal-related types and functions.

mod agent;
mod commands;
mod errors;
mod input_probe;
mod port_forward;
mod raw_input_probe;
mod remote_prompt_probe;
mod serial;
mod sftp;
mod shell_interaction_probe;
mod shutdown;
mod ssh_host_key;
mod state;
mod storage;
mod terminal_smoke;
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
    key_generate, session_ack_output, session_cancel_connection, session_close,
    session_create_local, session_create_ssh_agent, session_create_ssh_cert,
    session_create_ssh_jump, session_create_ssh_key, session_create_ssh_password, session_exec,
    session_list, session_resize, session_write, session_write_raw,
};
use input_probe::{
    input_probe_config, input_probe_diag, input_probe_focus, input_probe_ready, input_probe_result,
    InputProbeState,
};
use port_forward::{port_forward_list, port_forward_start, port_forward_stop};
use raw_input_probe::{raw_input_probe_config, raw_input_probe_result, RawInputProbeState};
use remote_prompt_probe::{
    remote_prompt_probe_config, remote_prompt_probe_observed, RemotePromptProbeState,
};
use serial::{
    serial_baud_rates, serial_connect, serial_disconnect, serial_is_connected, serial_list,
    serial_write, serial_write_raw,
};
use sftp::{
    sftp_connect, sftp_delete, sftp_download, sftp_list, sftp_local_checksum, sftp_mkdir,
    sftp_remote_checksum, sftp_rename, sftp_upload,
};
use shell_interaction_probe::{shell_probe_config, shell_probe_result, ShellProbeState};
use ssh_host_key::{ssh_host_key_learn, ssh_host_key_probe, ssh_host_key_probe_via_jump};
use state::create_shared_state;
use storage::{
    storage_delete, storage_download, storage_health_check, storage_init, storage_list,
    storage_upload,
};
use terminal_smoke::{
    terminal_smoke_complete, terminal_smoke_config, terminal_smoke_connected,
    terminal_smoke_emit_stale_output, terminal_smoke_host_wake, terminal_smoke_reconnect_requested,
    terminal_smoke_renderer_heartbeat_config, terminal_smoke_resources, TerminalSmokeState,
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

#[derive(Default)]
struct GracefulExitState {
    cleanup_started: std::sync::atomic::AtomicBool,
    cleanup_complete: std::sync::atomic::AtomicBool,
}

impl GracefulExitState {
    fn try_start_cleanup(&self) -> bool {
        !self.is_complete()
            && !self
                .cleanup_started
                .swap(true, std::sync::atomic::Ordering::AcqRel)
    }

    fn mark_complete(&self) {
        self.cleanup_complete
            .store(true, std::sync::atomic::Ordering::Release);
    }

    fn is_complete(&self) -> bool {
        self.cleanup_complete
            .load(std::sync::atomic::Ordering::Acquire)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let shared_state = create_shared_state();
    let storage_manager = std::sync::Arc::new(crate::storage::StorageManager::new());
    let terminal_smoke_state = TerminalSmokeState::from_env();
    let input_probe_state = InputProbeState::from_env();
    let raw_input_probe_state = RawInputProbeState::from_env();
    let remote_prompt_probe_state = RemotePromptProbeState::from_env();
    let shell_probe_state = ShellProbeState::from_env();

    let app = tauri::Builder::default()
        .manage(std::sync::Arc::clone(&shared_state))
        .manage(storage_manager)
        .manage(terminal_smoke_state)
        .manage(input_probe_state)
        .manage(raw_input_probe_state)
        .manage(remote_prompt_probe_state)
        .manage(shell_probe_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        // Updater plugin: only checks and downloads when tauri.conf.json carries a
        // real plugins.updater.pubkey. The placeholder that ships in this
        // repository makes every check fail closed instead of trusting an
        // unsigned manifest.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            tracing::info!("tauri app starting up");
            if !terminal_smoke::setup(app) {
                if let Err(e) = tray::build_tray(app.handle()) {
                    tracing::error!(error = %e, "failed to build tray icon");
                }
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
            session_cancel_connection,
            session_create_ssh_password,
            session_create_ssh_key,
            session_create_ssh_agent,
            session_create_ssh_cert,
            session_create_ssh_jump,
            session_write,
            session_write_raw,
            session_resize,
            session_ack_output,
            session_close,
            session_list,
            session_exec,
            key_generate,
            ssh_host_key_probe,
            ssh_host_key_probe_via_jump,
            ssh_host_key_learn,
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
            // Explicitly gated local terminal reliability smoke
            terminal_smoke_config,
            terminal_smoke_renderer_heartbeat_config,
            terminal_smoke_connected,
            terminal_smoke_resources,
            terminal_smoke_reconnect_requested,
            terminal_smoke_host_wake,
            terminal_smoke_emit_stale_output,
            terminal_smoke_complete,
            // Explicitly gated physical keyboard input probe
            input_probe_config,
            input_probe_diag,
            input_probe_focus,
            input_probe_ready,
            input_probe_result,
            raw_input_probe_config,
            raw_input_probe_result,
            // Explicitly gated remote shell prompt round-trip probe
            remote_prompt_probe_config,
            remote_prompt_probe_observed,
            shell_probe_config,
            shell_probe_result,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    let exit_state = std::sync::Arc::new(GracefulExitState::default());
    app.run(move |app, event| {
        let tauri::RunEvent::ExitRequested { api, code, .. } = event else {
            return;
        };
        if exit_state.is_complete() || code == Some(tauri::RESTART_EXIT_CODE) {
            return;
        }

        api.prevent_exit();
        if !exit_state.try_start_cleanup() {
            return;
        }

        let app = app.clone();
        let exit_state = std::sync::Arc::clone(&exit_state);
        let shared_state = std::sync::Arc::clone(&shared_state);
        tauri::async_runtime::spawn(async move {
            session::ssh::cancel_all_connection_attempts();
            let manager = session::get_session_manager();
            let cleanup = async {
                tokio::join!(
                    manager.shutdown(),
                    shutdown::close_shared_resources(&shared_state),
                );
            };
            if tokio::time::timeout(std::time::Duration::from_secs(10), cleanup)
                .await
                .is_err()
            {
                tracing::warn!("resource cleanup exceeded the application exit deadline");
            }
            exit_state.mark_complete();
            app.exit(code.unwrap_or_default());
        });
    });
}

#[cfg(test)]
mod tests {
    use super::GracefulExitState;

    #[test]
    fn graceful_exit_state_starts_cleanup_once_and_then_allows_exit() {
        let state = GracefulExitState::default();

        let actual = (
            state.try_start_cleanup(),
            state.try_start_cleanup(),
            state.is_complete(),
        );
        state.mark_complete();

        assert_eq!(
            (actual, state.is_complete()),
            ((true, false, false), true),
            "only one cleanup task may start before the final exit request is allowed"
        );
    }
}
