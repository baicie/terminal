//! 统一命令层 - Tauri 命令
//!
//! 提供统一的 create/write/resize/close 命令，同时保持向后兼容。

use crate::session::local::LocalSession;
use crate::session::ssh::SshSession;
use crate::session::terminal_output::{ack_session_output, finish_session_output};
use crate::session::{
    get_session_manager, ExecResult, KeyGenResult, SessionError, SessionInfo, SessionState,
};
use tauri::AppHandle;

// ============================================================================
// Local Session Commands
// ============================================================================

/// 创建本地终端会话
#[tauri::command]
pub async fn session_create_local(
    app: AppHandle,
    cols: u16,
    rows: u16,
    profile: Option<crate::session::TerminalProfile>,
) -> Result<String, SessionError> {
    let session = LocalSession::new(app, cols, rows, profile).await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    manager.register_session(SessionState::Local(session)).await;

    Ok(session_id)
}

/// 写入本地会话
#[tauri::command]
pub async fn session_write(session_id: String, data: String) -> Result<(), SessionError> {
    let manager = get_session_manager();
    if let Some(session) = manager.get_session(&session_id).await {
        session.write(&data).await?;
        Ok(())
    } else {
        Err(SessionError::SessionNotFound)
    }
}

/// 写入不经过 UTF-8 转换的原始会话字节。
#[tauri::command]
pub async fn session_write_raw(session_id: String, data: Vec<u8>) -> Result<(), SessionError> {
    let manager = get_session_manager();
    if let Some(session) = manager.get_session(&session_id).await {
        session.write_raw(data).await?;
        Ok(())
    } else {
        Err(SessionError::SessionNotFound)
    }
}

/// 调整会话大小
#[tauri::command]
pub async fn session_resize(session_id: String, cols: u16, rows: u16) -> Result<(), SessionError> {
    let manager = get_session_manager();
    if let Some(session) = manager.get_session(&session_id).await {
        session.resize(cols, rows).await?;
        Ok(())
    } else {
        Err(SessionError::SessionNotFound)
    }
}

/// 确认前端 xterm 已完成指定字节数的输出解析。
#[tauri::command]
pub async fn session_ack_output(session_id: String, bytes: usize) -> Result<(), SessionError> {
    ack_session_output(&session_id, bytes)
}

/// 关闭会话
#[tauri::command]
pub async fn session_close(session_id: String) -> Result<(), SessionError> {
    finish_session_output(&session_id);
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

fn agent_forwarding_enabled(value: Option<bool>) -> bool {
    value.unwrap_or(false)
}

/// 创建 SSH 会话（密码认证）
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn session_create_ssh_password(
    app: AppHandle,
    host: String,
    port: u16,
    username: String,
    password: String,
    expected_host_key: Option<String>,
    agent_forwarding: Option<bool>,
    cols: u16,
    rows: u16,
    profile: Option<crate::session::TerminalProfile>,
) -> Result<String, SessionError> {
    // 验证输入
    if host.is_empty() {
        return Err(SessionError::InvalidInput(
            "Host cannot be empty".to_string(),
        ));
    }
    if !(1..=65535).contains(&port) {
        return Err(SessionError::InvalidInput(
            "Port must be between 1 and 65535".to_string(),
        ));
    }
    if username.is_empty() {
        return Err(SessionError::InvalidInput(
            "Username cannot be empty".to_string(),
        ));
    }
    if password.is_empty() {
        return Err(SessionError::InvalidInput(
            "Password cannot be empty".to_string(),
        ));
    }

    let session = SshSession::new_with_password(
        app,
        host,
        port,
        username,
        password,
        expected_host_key,
        agent_forwarding_enabled(agent_forwarding),
        cols,
        rows,
        profile,
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
    expected_host_key: Option<String>,
    agent_forwarding: Option<bool>,
    cols: u16,
    rows: u16,
    profile: Option<crate::session::TerminalProfile>,
) -> Result<String, SessionError> {
    // 验证输入
    if host.is_empty() {
        return Err(SessionError::InvalidInput(
            "Host cannot be empty".to_string(),
        ));
    }
    if !(1..=65535).contains(&port) {
        return Err(SessionError::InvalidInput(
            "Port must be between 1 and 65535".to_string(),
        ));
    }
    if username.is_empty() {
        return Err(SessionError::InvalidInput(
            "Username cannot be empty".to_string(),
        ));
    }
    if private_key.is_empty() {
        return Err(SessionError::InvalidInput(
            "Private key cannot be empty".to_string(),
        ));
    }

    let session = SshSession::new_with_key(
        app,
        host,
        port,
        username,
        private_key,
        password,
        expected_host_key,
        agent_forwarding_enabled(agent_forwarding),
        cols,
        rows,
        profile,
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
    expected_host_key: Option<String>,
    agent_forwarding: Option<bool>,
    cols: u16,
    rows: u16,
    profile: Option<crate::session::TerminalProfile>,
) -> Result<String, SessionError> {
    if host.is_empty() {
        return Err(SessionError::InvalidInput(
            "Host cannot be empty".to_string(),
        ));
    }
    if !(1..=65535).contains(&port) {
        return Err(SessionError::InvalidInput(
            "Port must be between 1 and 65535".to_string(),
        ));
    }
    if username.is_empty() {
        return Err(SessionError::InvalidInput(
            "Username cannot be empty".to_string(),
        ));
    }

    let session = SshSession::new_with_agent(
        app,
        host,
        port,
        username,
        expected_host_key,
        agent_forwarding_enabled(agent_forwarding),
        cols,
        rows,
        profile,
    )
    .await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    manager.register_session(SessionState::Ssh(session)).await;

    Ok(session_id)
}

/// 创建 SSH 会话（证书认证）
#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri exposes each field as a stable top-level IPC argument"
)]
pub async fn session_create_ssh_cert(
    app: AppHandle,
    host: String,
    port: u16,
    username: String,
    certificate: String,
    private_key: String,
    password: Option<String>,
    expected_host_key: Option<String>,
    agent_forwarding: Option<bool>,
    cols: u16,
    rows: u16,
    profile: Option<crate::session::TerminalProfile>,
) -> Result<String, SessionError> {
    if host.is_empty() {
        return Err(SessionError::InvalidInput(
            "Host cannot be empty".to_string(),
        ));
    }
    if !(1..=65535).contains(&port) {
        return Err(SessionError::InvalidInput(
            "Port must be between 1 and 65535".to_string(),
        ));
    }
    if username.is_empty() {
        return Err(SessionError::InvalidInput(
            "Username cannot be empty".to_string(),
        ));
    }
    if certificate.is_empty() {
        return Err(SessionError::InvalidInput(
            "Certificate cannot be empty".to_string(),
        ));
    }
    if private_key.is_empty() {
        return Err(SessionError::InvalidInput(
            "Private key cannot be empty".to_string(),
        ));
    }

    let session = SshSession::new_with_cert(
        app,
        host,
        port,
        username,
        certificate,
        private_key,
        password,
        expected_host_key,
        agent_forwarding_enabled(agent_forwarding),
        cols,
        rows,
        profile,
    )
    .await?;
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
    target_certificate: Option<String>,
    jump_host: crate::session::JumpHostConfig,
    expected_host_key: Option<String>,
    agent_forwarding: Option<bool>,
    cols: u16,
    rows: u16,
    profile: Option<crate::session::TerminalProfile>,
) -> Result<String, SessionError> {
    let session = SshSession::new_with_jump(
        app,
        target_host,
        target_port,
        target_username,
        target_password,
        target_private_key,
        target_certificate,
        jump_host,
        expected_host_key,
        agent_forwarding_enabled(agent_forwarding),
        cols,
        rows,
        profile,
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
) -> Result<ExecResult, SessionError> {
    let manager = get_session_manager();
    let Some(session) = manager.get_session(&session_id).await else {
        return Err(SessionError::SessionNotFound);
    };

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(5000));

    match session {
        crate::session::SessionState::Local(_) => exec_local(&command, timeout).await,
        crate::session::SessionState::Ssh(ssh) => ssh.exec(&command, timeout).await,
    }
}

async fn exec_local(command: &str, timeout: Duration) -> Result<ExecResult, SessionError> {
    let shell = if let Ok(s) = std::env::var("TERMINAL_DEFAULT_SHELL") {
        s
    } else if cfg!(windows) {
        std::env::var("PSModulePath")
            .map(|_| "powershell.exe".to_string())
            .unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };

    let mut cmd = local_exec_command(&shell, command, cfg!(windows));
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
        .map_err(|_| SessionError::ExecTimeout)?
        .map_err(|e| SessionError::ExecFailed(format!("exec failed: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(ExecResult {
        stdout,
        stderr,
        exit_code,
    })
}

fn local_exec_command(shell: &str, command: &str, windows: bool) -> tokio::process::Command {
    let mut process = tokio::process::Command::new(shell);
    process.args(local_exec_args(shell, command, windows));
    process.kill_on_drop(true);
    process
}

fn local_exec_args(shell: &str, command: &str, windows: bool) -> [String; 2] {
    let executable = shell
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(shell)
        .to_ascii_lowercase();
    let command_switch = if windows && matches!(executable.as_str(), "cmd" | "cmd.exe") {
        "/C"
    } else if windows
        && matches!(
            executable.as_str(),
            "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"
        )
    {
        "-Command"
    } else {
        "-c"
    };

    [command_switch.to_string(), command.to_string()]
}

#[cfg(test)]
mod local_exec_tests {
    use super::{local_exec_args, local_exec_command};

    #[test]
    fn windows_cmd_uses_slash_c() {
        assert_eq!(
            local_exec_args(r"C:\\Windows\\System32\\cmd.exe", "echo ok", true),
            ["/C", "echo ok"]
        );
    }

    #[test]
    fn windows_powershell_uses_command_switch() {
        assert_eq!(
            local_exec_args("powershell.exe", "Write-Output ok", true),
            ["-Command", "Write-Output ok"]
        );
    }

    #[test]
    fn unix_shell_uses_dash_c() {
        assert_eq!(
            local_exec_args("/bin/bash", "printf ok", false),
            ["-c", "printf ok"]
        );
    }

    #[test]
    fn local_exec_kills_child_when_timeout_drops_output_future() {
        let command = local_exec_command("/bin/bash", "sleep 60", false);

        assert!(command.get_kill_on_drop());
    }
}

#[cfg(test)]
mod ssh_command_future_tests {
    use super::{
        agent_forwarding_enabled, session_create_ssh_agent, session_create_ssh_cert,
        session_create_ssh_jump, session_create_ssh_key, session_create_ssh_password, AppHandle,
        SessionError,
    };
    use crate::session::{JumpHostConfig, TerminalProfile};
    use std::future::Future;

    macro_rules! assert_send_command {
        ($assertion:ident, ($($argument:ty),+)) => {
            fn $assertion<F, Fut>(_: F)
            where
                F: FnOnce($($argument),+) -> Fut,
                Fut: Future<Output = Result<String, SessionError>> + Send + 'static,
            {
            }
        };
    }

    assert_send_command!(
        password_command_future_is_send,
        (
            AppHandle,
            String,
            u16,
            String,
            String,
            Option<String>,
            Option<bool>,
            u16,
            u16,
            Option<TerminalProfile>
        )
    );
    assert_send_command!(
        key_command_future_is_send,
        (
            AppHandle,
            String,
            u16,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<bool>,
            u16,
            u16,
            Option<TerminalProfile>
        )
    );
    assert_send_command!(
        agent_command_future_is_send,
        (
            AppHandle,
            String,
            u16,
            String,
            Option<String>,
            Option<bool>,
            u16,
            u16,
            Option<TerminalProfile>
        )
    );
    assert_send_command!(
        cert_command_future_is_send,
        (
            AppHandle,
            String,
            u16,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<bool>,
            u16,
            u16,
            Option<TerminalProfile>
        )
    );
    assert_send_command!(
        jump_command_future_is_send,
        (
            AppHandle,
            String,
            u16,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            JumpHostConfig,
            Option<String>,
            Option<bool>,
            u16,
            u16,
            Option<TerminalProfile>
        )
    );

    #[test]
    fn ssh_command_futures_own_ipc_arguments() {
        password_command_future_is_send(session_create_ssh_password);
        key_command_future_is_send(session_create_ssh_key);
        agent_command_future_is_send(session_create_ssh_agent);
        cert_command_future_is_send(session_create_ssh_cert);
        jump_command_future_is_send(session_create_ssh_jump);
    }

    #[test]
    fn agent_forwarding_is_opt_in_for_legacy_ipc_callers() {
        assert!(!agent_forwarding_enabled(None));
        assert!(!agent_forwarding_enabled(Some(false)));
        assert!(agent_forwarding_enabled(Some(true)));
    }
}

// ============================================================================
// Key Generation Commands
// ============================================================================

/// SSH key type enumeration (matches frontend)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshKeyType {
    Ed25519,
    Rsa2048,
    Rsa4096,
    EcdsaNistp256,
    EcdsaNistp384,
    EcdsaNistp521,
}

impl SshKeyType {
    fn from_str(s: &str) -> Option<Self> {
        match s {
            "ed25519" => Some(Self::Ed25519),
            "rsa" => Some(Self::Rsa2048),
            "rsa4096" => Some(Self::Rsa4096),
            "ecdsa-nistp256" => Some(Self::EcdsaNistp256),
            "ecdsa-nistp384" => Some(Self::EcdsaNistp384),
            "ecdsa-nistp521" => Some(Self::EcdsaNistp521),
            _ => None,
        }
    }
}

/// Generate an SSH key pair.
#[tauri::command]
pub async fn key_generate(
    key_type: String,
    comment: String,
    passphrase: Option<String>,
) -> Result<KeyGenResult, SessionError> {
    let key_type = SshKeyType::from_str(&key_type).ok_or_else(|| {
        SessionError::KeyGenerationFailed(format!("unsupported key type: {}", key_type))
    })?;

    use ssh_key::rand_core::OsRng;

    let private_key = match key_type {
        SshKeyType::Ed25519 => ssh_key::PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519)
            .map_err(|e| {
                SessionError::KeyGenerationFailed(format!("ed25519 generation failed: {}", e))
            })?,
        SshKeyType::Rsa2048 => {
            ssh_key::PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Rsa { hash: None })
                .map_err(|e| {
                    SessionError::KeyGenerationFailed(format!("rsa2048 generation failed: {}", e))
                })?
        }
        SshKeyType::Rsa4096 => {
            ssh_key::PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Rsa { hash: None })
                .map_err(|e| {
                    SessionError::KeyGenerationFailed(format!("rsa4096 generation failed: {}", e))
                })?
        }
        SshKeyType::EcdsaNistp256 => ssh_key::PrivateKey::random(
            &mut OsRng,
            ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP256,
            },
        )
        .map_err(|e| {
            SessionError::KeyGenerationFailed(format!("ecdsa-nistp256 generation failed: {}", e))
        })?,
        SshKeyType::EcdsaNistp384 => ssh_key::PrivateKey::random(
            &mut OsRng,
            ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP384,
            },
        )
        .map_err(|e| {
            SessionError::KeyGenerationFailed(format!("ecdsa-nistp384 generation failed: {}", e))
        })?,
        SshKeyType::EcdsaNistp521 => ssh_key::PrivateKey::random(
            &mut OsRng,
            ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP521,
            },
        )
        .map_err(|e| {
            SessionError::KeyGenerationFailed(format!("ecdsa-nistp521 generation failed: {}", e))
        })?,
    };

    // Set comment if provided
    let private_key = if comment.is_empty() {
        private_key
    } else {
        let mut pk = private_key;
        pk.set_comment(&comment);
        pk
    };

    // Encrypt with passphrase if provided
    let private_key = if let Some(ref pw) = passphrase {
        if !pw.is_empty() {
            private_key
                .encrypt(&mut OsRng, pw.as_bytes())
                .map_err(|e| {
                    SessionError::KeyGenerationFailed(format!("encryption failed: {}", e))
                })?
        } else {
            private_key
        }
    } else {
        private_key
    };

    let public_key = private_key.public_key();
    let fingerprint = public_key.fingerprint(ssh_key::HashAlg::Sha256).to_string();

    let key_type_name = match key_type {
        SshKeyType::Ed25519 => "ed25519",
        SshKeyType::Rsa2048 | SshKeyType::Rsa4096 => "rsa",
        SshKeyType::EcdsaNistp256 => "ecdsa-nistp256",
        SshKeyType::EcdsaNistp384 => "ecdsa-nistp384",
        SshKeyType::EcdsaNistp521 => "ecdsa-nistp521",
    };

    let private_pem = private_key
        .to_openssh(ssh_key::LineEnding::LF)
        .map_err(|e| {
            SessionError::KeyGenerationFailed(format!("serialize private key failed: {}", e))
        })?;
    let public_openssh = public_key.to_openssh().map_err(|e| {
        SessionError::KeyGenerationFailed(format!("serialize public key failed: {}", e))
    })?;

    Ok(KeyGenResult {
        private_key: (*private_pem).to_string(),
        public_key: public_openssh,
        key_type: key_type_name.to_string(),
        fingerprint,
    })
}
