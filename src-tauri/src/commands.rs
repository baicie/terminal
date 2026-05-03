//! 统一命令层 - Tauri 命令
//!
//! 提供统一的 create/write/resize/close 命令，同时保持向后兼容。

use crate::session::local::LocalSession;
use crate::session::manager::SessionManager;
use crate::session::ssh::SshSession;
use crate::session::{ExecResult, SessionError, SessionInfo, SessionState};
use std::sync::Arc;
use tauri::AppHandle;

/// 全局 SessionManager 实例
static SESSION_MANAGER: std::sync::OnceLock<Arc<SessionManager>> = std::sync::OnceLock::new();

/// 获取全局 SessionManager
pub fn get_session_manager() -> Arc<SessionManager> {
    SESSION_MANAGER
        .get_or_init(|| Arc::new(SessionManager::new()))
        .clone()
}

// ============================================================================
// Local Session Commands
// ============================================================================

/// 创建本地终端会话
#[tauri::command]
pub async fn session_create_local(
    app: AppHandle,
    cols: u16,
    rows: u16,
) -> Result<String, SessionError> {
    let session = LocalSession::new(app, cols, rows).await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    manager.register_session(SessionState::Local(session)).await;

    Ok(session_id)
}

/// 写入本地会话
#[tauri::command]
pub async fn session_write(
    session_id: String,
    data: String,
) -> Result<(), SessionError> {
    let manager = get_session_manager();
    if let Some(session) = manager.get_session(&session_id).await {
        session.write(&data).await?;
        Ok(())
    } else {
        Err(SessionError::SessionNotFound)
    }
}

/// 调整会话大小
#[tauri::command]
pub async fn session_resize(
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), SessionError> {
    let manager = get_session_manager();
    if let Some(session) = manager.get_session(&session_id).await {
        session.resize(cols, rows).await?;
        Ok(())
    } else {
        Err(SessionError::SessionNotFound)
    }
}

/// 关闭会话
#[tauri::command]
pub async fn session_close(
    session_id: String,
) -> Result<(), SessionError> {
    let manager = get_session_manager();
    manager.remove_session(&session_id).await
}

/// 获取会话信息列表
#[tauri::command]
pub async fn session_list() -> Result<Vec<SessionInfo>, SessionError> {
    let manager = get_session_manager();
    Ok(manager.list_sessions().await)
}

// ============================================================================
// SSH Session Commands
// ============================================================================

/// 创建 SSH 会话（密码认证）
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn session_create_ssh_password(
    app: AppHandle,
    host: String,
    port: u16,
    username: String,
    password: String,
    cols: u16,
    rows: u16,
) -> Result<String, SessionError> {
    // 验证输入
    if host.is_empty() {
        return Err(SessionError::InvalidInput("Host cannot be empty".to_string()));
    }
    if !(1..=65535).contains(&port) {
        return Err(SessionError::InvalidInput("Port must be between 1 and 65535".to_string()));
    }
    if username.is_empty() {
        return Err(SessionError::InvalidInput("Username cannot be empty".to_string()));
    }
    if password.is_empty() {
        return Err(SessionError::InvalidInput("Password cannot be empty".to_string()));
    }

    let session = SshSession::new_with_password(
        app, &host, port, &username, &password, cols, rows,
    )
    .await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    manager.register_session(SessionState::Ssh(session)).await;

    Ok(session_id)
}

/// 创建 SSH 会话（密钥认证）
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn session_create_ssh_key(
    app: AppHandle,
    host: String,
    port: u16,
    username: String,
    private_key: String,
    password: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<String, SessionError> {
    // 验证输入
    if host.is_empty() {
        return Err(SessionError::InvalidInput("Host cannot be empty".to_string()));
    }
    if !(1..=65535).contains(&port) {
        return Err(SessionError::InvalidInput("Port must be between 1 and 65535".to_string()));
    }
    if username.is_empty() {
        return Err(SessionError::InvalidInput("Username cannot be empty".to_string()));
    }
    if private_key.is_empty() {
        return Err(SessionError::InvalidInput("Private key cannot be empty".to_string()));
    }

    let session = SshSession::new_with_key(
        app, &host, port, &username, &private_key, password.as_deref(), cols, rows,
    )
    .await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    manager.register_session(SessionState::Ssh(session)).await;

    Ok(session_id)
}

/// 创建 SSH 会话（Agent 认证）
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn session_create_ssh_agent(
    app: AppHandle,
    host: String,
    port: u16,
    username: String,
    cols: u16,
    rows: u16,
) -> Result<String, SessionError> {
    if host.is_empty() {
        return Err(SessionError::InvalidInput("Host cannot be empty".to_string()));
    }
    if !(1..=65535).contains(&port) {
        return Err(SessionError::InvalidInput("Port must be between 1 and 65535".to_string()));
    }
    if username.is_empty() {
        return Err(SessionError::InvalidInput("Username cannot be empty".to_string()));
    }

    let session = SshSession::new_with_agent(app, &host, port, &username, cols, rows).await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    manager.register_session(SessionState::Ssh(session)).await;

    Ok(session_id)
}

/// 创建 SSH 会话（通过 Jump Host）
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn session_create_ssh_jump(
    app: AppHandle,
    target_host: String,
    target_port: u16,
    target_username: String,
    target_password: Option<String>,
    target_private_key: Option<String>,
    jump_host: crate::session::JumpHostConfig,
    cols: u16,
    rows: u16,
) -> Result<String, SessionError> {
    let session = SshSession::new_with_jump(
        app,
        &target_host,
        target_port,
        &target_username,
        target_password.as_deref(),
        target_private_key.as_deref(),
        jump_host,
        cols,
        rows,
    )
    .await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    manager.register_session(SessionState::Ssh(session)).await;

    Ok(session_id)
}

// ============================================================================
// Session Exec Command (shell completion / RC file parsing)
// ============================================================================

use std::time::Duration;

/// Execute a shell command and return its output.
/// Used for shell completion (aliases, functions) and RC file parsing.
/// - Local sessions: runs via tokio::process with matching shell.
/// - SSH sessions: uses exec channel.
#[tauri::command]
pub async fn session_exec(
    session_id: String,
    command: String,
    timeout_ms: Option<u64>,
) -> Result<ExecResult, String> {
    let manager = get_session_manager();
    let Some(session) = manager.get_session(&session_id).await else {
        return Err("Session not found".to_string());
    };

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(5000));

    match session {
        crate::session::SessionState::Local(_) => {
            exec_local(&command, timeout).await.map_err(|e| e.to_string())
        }
        crate::session::SessionState::Ssh(ssh) => {
            ssh.exec(&command, timeout).await.map_err(|e| e.to_string())
        }
    }
}

async fn exec_local(command: &str, timeout: Duration) -> Result<ExecResult, crate::session::SessionError> {
    let shell = if let Ok(s) = std::env::var("TERMINAL_DEFAULT_SHELL") {
        s
    } else if cfg!(windows) {
        std::env::var("PSModulePath")
            .map(|_| "powershell.exe".to_string())
            .unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };

    let mut cmd = tokio::process::Command::new(&shell);
    cmd.args(["-c", command]);
    #[cfg(windows)]
    {
        use std::path::PathBuf;
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        cmd.current_dir(PathBuf::from(&home));
    }

    let output = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| crate::session::SessionError::ChannelError("exec timed out".to_string()))?
        .map_err(|e| crate::session::SessionError::ChannelError(format!("exec failed: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(ExecResult { stdout, stderr, exit_code })
}
