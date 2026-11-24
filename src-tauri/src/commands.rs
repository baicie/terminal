//! 统一命令层 - Tauri 命令
//!
//! 提供统一的 create/write/resize/close 命令，同时保持向后兼容。

use crate::session::local::LocalSession;
use crate::session::ssh::{
    register_connection_attempt, run_cancellable_connection, ssh_connection_deadline_with_timeout,
    ExecCancellation, SshSession,
};
use crate::session::terminal_output::{ack_session_output, finish_session_output};
use crate::session::{
    get_session_manager, ExecResult, KeyGenResult, SessionError, SessionFailure, SessionInfo,
    SessionState,
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
    if !manager.register_session(SessionState::Local(session)).await {
        return Err(SessionError::ConnectionCancelled);
    }

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
///
/// The SFTP channel that was opened on this SSH connection is dropped here too.
/// `SessionManager` only knows about terminal sessions; the SFTP registry is a
/// separate map keyed by the same id, and before this it was never cleaned
/// outside process exit (`forge0 / GAP-SFTP-REGISTRY`). Closing the terminal is
/// the natural point: the SFTP channel rides on that connection, so once the
/// connection is gone the entry is a dangling reference.
#[tauri::command]
pub async fn session_close(
    state: tauri::State<'_, crate::state::SharedStateType>,
    session_id: String,
) -> Result<(), SessionError> {
    finish_session_output(&session_id);
    // Before removing the session: if removal fails we still want the SFTP entry
    // gone, because the channel is already unusable either way.
    crate::sftp::forget_session(&state, &session_id).await;
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

/// Cancel an SSH connection that is still in its creation handshake.
#[tauri::command]
pub fn session_cancel_connection(attempt_id: String) -> bool {
    crate::session::ssh::cancel_connection_attempt(&attempt_id)
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
    attempt_id: Option<String>,
    connection_timeout_ms: Option<u64>,
) -> Result<String, SessionError> {
    let attempt = register_connection_attempt(attempt_id.as_deref());
    let connection_deadline = ssh_connection_deadline_with_timeout(connection_timeout_ms);
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

    let session = run_cancellable_connection(
        attempt.cancellation(),
        SshSession::new_with_password(
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
            connection_deadline,
        ),
        || SessionError::ConnectionCancelled,
    )
    .await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    if !manager.register_session(SessionState::Ssh(session)).await {
        return Err(SessionError::ConnectionCancelled);
    }

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
    attempt_id: Option<String>,
    connection_timeout_ms: Option<u64>,
) -> Result<String, SessionError> {
    let attempt = register_connection_attempt(attempt_id.as_deref());
    let connection_deadline = ssh_connection_deadline_with_timeout(connection_timeout_ms);
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

    let session = run_cancellable_connection(
        attempt.cancellation(),
        SshSession::new_with_key(
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
            connection_deadline,
        ),
        || SessionError::ConnectionCancelled,
    )
    .await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    if !manager.register_session(SessionState::Ssh(session)).await {
        return Err(SessionError::ConnectionCancelled);
    }

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
    attempt_id: Option<String>,
    connection_timeout_ms: Option<u64>,
) -> Result<String, SessionError> {
    let attempt = register_connection_attempt(attempt_id.as_deref());
    let connection_deadline = ssh_connection_deadline_with_timeout(connection_timeout_ms);
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

    let session = run_cancellable_connection(
        attempt.cancellation(),
        SshSession::new_with_agent(
            app,
            host,
            port,
            username,
            expected_host_key,
            agent_forwarding_enabled(agent_forwarding),
            cols,
            rows,
            profile,
            connection_deadline,
        ),
        || SessionError::ConnectionCancelled,
    )
    .await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    if !manager.register_session(SessionState::Ssh(session)).await {
        return Err(SessionError::ConnectionCancelled);
    }

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
    attempt_id: Option<String>,
    connection_timeout_ms: Option<u64>,
) -> Result<String, SessionError> {
    let attempt = register_connection_attempt(attempt_id.as_deref());
    let connection_deadline = ssh_connection_deadline_with_timeout(connection_timeout_ms);
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

    let session = run_cancellable_connection(
        attempt.cancellation(),
        SshSession::new_with_cert(
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
            connection_deadline,
        ),
        || SessionError::ConnectionCancelled,
    )
    .await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    if !manager.register_session(SessionState::Ssh(session)).await {
        return Err(SessionError::ConnectionCancelled);
    }

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
    attempt_id: Option<String>,
    connection_timeout_ms: Option<u64>,
) -> Result<String, SessionFailure> {
    /*
     * SSH05/SSH06 — the first command whose return type carries connection context.
     *
     * This is the one path that can fail at two different machines, so it is the one that
     * gains `hop`/`stage`. The other five `session_create_ssh_*` commands are direct
     * connections and keep `Result<_, SessionError>` until SSH07–SSH09 wire their stages;
     * widening them now would claim a hop they cannot have.
     */
    let attempt = register_connection_attempt(attempt_id.as_deref());
    let connection_deadline = ssh_connection_deadline_with_timeout(connection_timeout_ms);
    let session = run_cancellable_connection(
        attempt.cancellation(),
        SshSession::new_with_jump(
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
            connection_deadline,
        ),
        || SessionFailure::bare(SessionError::ConnectionCancelled),
    )
    .await?;
    let session_id = session.session_id().to_string();

    let manager = get_session_manager();
    if !manager.register_session(SessionState::Ssh(session)).await {
        return Err(SessionFailure::bare(SessionError::ConnectionCancelled));
    }

    Ok(session_id)
}

// ============================================================================
// Session Exec Command (shell completion / RC file parsing)
// ============================================================================

use std::time::Duration;

/// Live exec calls, keyed by the id the caller supplied.
///
/// ## Why the caller supplies the id
///
/// The id has to be known **before** the call blocks, because cancelling means calling
/// `session_exec_cancel` from another IPC call while the first one is still awaiting.
/// Generating it inside `session_exec` would return it only on completion — after the
/// point where anyone could use it.
static ACTIVE_EXECS: std::sync::OnceLock<
    tokio::sync::Mutex<std::collections::HashMap<String, ExecCancellation>>,
> = std::sync::OnceLock::new();

fn active_execs() -> &'static tokio::sync::Mutex<std::collections::HashMap<String, ExecCancellation>>
{
    ACTIVE_EXECS.get_or_init(|| tokio::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Remove an exec from the registry, whichever way it finished.
///
/// Called on every exit path including errors: a token left behind would keep the map
/// growing for the life of the process, and a re-used id would find a stale entry.
async fn forget_exec(exec_id: &str) {
    active_execs().lock().await.remove(exec_id);
}

/// Execute a shell command and return its output.
/// Used for shell completion (aliases, functions) and RC file parsing.
/// - Local sessions: runs via tokio::process with matching shell.
/// - SSH sessions: uses exec channel.
#[tauri::command]
pub async fn session_exec(
    session_id: String,
    command: String,
    timeout_ms: Option<u64>,
    exec_id: Option<String>,
) -> Result<ExecResult, SessionError> {
    let manager = get_session_manager();
    let Some(session) = manager.get_session(&session_id).await else {
        return Err(SessionError::SessionNotFound);
    };

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(5000));
    let cancel = ExecCancellation::new();
    if let Some(id) = exec_id.as_deref() {
        active_execs()
            .lock()
            .await
            .insert(id.to_string(), cancel.clone());
    }

    let outcome = match session {
        crate::session::SessionState::Local(_) => {
            exec_local(&command, timeout, cancel.clone()).await
        }
        crate::session::SessionState::Ssh(ssh) => ssh.exec(&command, timeout, cancel.clone()).await,
    };

    if let Some(id) = exec_id.as_deref() {
        forget_exec(id).await;
    }
    outcome
}

/// Stop one in-flight exec. The session and its interactive shell are untouched.
#[tauri::command]
pub async fn session_exec_cancel(exec_id: String) -> Result<bool, SessionError> {
    let token = active_execs().lock().await.get(&exec_id).cloned();
    match token {
        Some(token) => {
            token.cancel();
            Ok(true)
        }
        // Already finished, or never existed. Not an error: the caller races the probe's
        // natural completion, and reporting a failure for that would be a false alarm.
        None => Ok(false),
    }
}

async fn exec_local(
    command: &str,
    timeout: Duration,
    cancel: ExecCancellation,
) -> Result<ExecResult, SessionError> {
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

    // `kill_on_drop(true)` is set on the command above, so returning early from this
    // `select!` drops the future and takes the child process with it. A cancelled local
    // exec therefore leaves no stray probe process behind.
    let output = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(SessionError::ExecCancelled),
        result = tokio::time::timeout(timeout, cmd.output()) => result
            .map_err(|_| SessionError::ExecTimeout)?,
    }
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
    use super::{exec_local, local_exec_args, local_exec_command, ExecCancellation, SessionError};

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

    #[tokio::test]
    async fn a_cancelled_local_exec_returns_promptly_and_leaves_no_child() {
        // The flag test above only proves `kill_on_drop` was set. This drives the real
        // path: a command that would run far past the cancel, cancelled after 50 ms.
        //
        // Without cancellation this would return after the 10 s timeout; the assertion
        // on elapsed time is what distinguishes "stopped" from "waited it out".
        let cancel = ExecCancellation::new();
        let tripper = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            tripper.cancel();
        });

        let marker = std::env::temp_dir().join(format!(
            "tn-cancel-marker-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let marker_path = marker.to_string_lossy().to_string();

        let started = std::time::Instant::now();
        let outcome = exec_local(
            &format!("sleep 3; touch '{}'", marker_path),
            std::time::Duration::from_secs(10),
            cancel,
        )
        .await;
        let elapsed = started.elapsed();

        assert!(
            matches!(outcome, Err(SessionError::ExecCancelled)),
            "expected ExecCancelled, got {:?}",
            outcome.err()
        );
        assert!(
            elapsed < std::time::Duration::from_secs(2),
            "cancel must interrupt the wait rather than the deadline: took {:?}",
            elapsed
        );

        // Give a killed child any chance to run its remaining command, then confirm it
        // did not. A child that outlived the cancel would still create this file.
        tokio::time::sleep(std::time::Duration::from_millis(3_500)).await;
        assert!(
            !marker.exists(),
            "the cancelled exec's child kept running and created {marker_path}"
        );
    }
}

#[cfg(test)]
mod ssh_command_future_tests {
    use super::{
        agent_forwarding_enabled, session_create_ssh_agent, session_create_ssh_cert,
        session_create_ssh_jump, session_create_ssh_key, session_create_ssh_password, AppHandle,
        SessionError, SessionFailure,
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
    /*
     * The jump command returns `SessionFailure` (SSH06). It gets its own assertion rather
     * than a loosened shared one: the point of these macros is that each command's future
     * is `Send` with the error type it actually has, and a `SessionFailure` that stopped
     * being `Send` would be caught here and nowhere else.
     */
    macro_rules! assert_send_failure_command {
        ($assertion:ident, ($($argument:ty),+)) => {
            fn $assertion<F, Fut>(_: F)
            where
                F: FnOnce($($argument),+) -> Fut,
                Fut: Future<Output = Result<String, SessionFailure>> + Send + 'static,
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
            Option<TerminalProfile>,
            Option<String>,
            Option<u64>
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
            Option<TerminalProfile>,
            Option<String>,
            Option<u64>
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
            Option<TerminalProfile>,
            Option<String>,
            Option<u64>
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
            Option<TerminalProfile>,
            Option<String>,
            Option<u64>
        )
    );
    assert_send_failure_command!(
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
            Option<TerminalProfile>,
            Option<String>,
            Option<u64>
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

    #[tokio::test]
    async fn cancelling_an_unknown_connection_attempt_is_idempotent() {
        assert!(!crate::session::ssh::cancel_connection_attempt(
            "missing-attempt"
        ));
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

    // ssh-key 0.7 removed `OsRng`: rand_core 0.10 exposes the OS generator as
    // `getrandom::SysRng`, which is fallible, and `UnwrapErr` is the adapter the
    // crate documents for turning it back into the infallible `CryptoRng` these
    // calls take. A failing OS RNG is not a condition a key generator can
    // continue through anyway.
    use ssh_key::getrandom::SysRng;
    use ssh_key::rand_core::UnwrapErr;

    let private_key = match key_type {
        SshKeyType::Ed25519 => {
            ssh_key::PrivateKey::random(&mut UnwrapErr(SysRng), ssh_key::Algorithm::Ed25519)
                .map_err(|e| {
                    SessionError::KeyGenerationFailed(format!("ed25519 generation failed: {}", e))
                })?
        }
        SshKeyType::Rsa2048 => ssh_key::PrivateKey::random(
            &mut UnwrapErr(SysRng),
            ssh_key::Algorithm::Rsa { hash: None },
        )
        .map_err(|e| {
            SessionError::KeyGenerationFailed(format!("rsa2048 generation failed: {}", e))
        })?,
        SshKeyType::Rsa4096 => ssh_key::PrivateKey::random(
            &mut UnwrapErr(SysRng),
            ssh_key::Algorithm::Rsa { hash: None },
        )
        .map_err(|e| {
            SessionError::KeyGenerationFailed(format!("rsa4096 generation failed: {}", e))
        })?,
        SshKeyType::EcdsaNistp256 => ssh_key::PrivateKey::random(
            &mut UnwrapErr(SysRng),
            ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP256,
            },
        )
        .map_err(|e| {
            SessionError::KeyGenerationFailed(format!("ecdsa-nistp256 generation failed: {}", e))
        })?,
        SshKeyType::EcdsaNistp384 => ssh_key::PrivateKey::random(
            &mut UnwrapErr(SysRng),
            ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP384,
            },
        )
        .map_err(|e| {
            SessionError::KeyGenerationFailed(format!("ecdsa-nistp384 generation failed: {}", e))
        })?,
        SshKeyType::EcdsaNistp521 => ssh_key::PrivateKey::random(
            &mut UnwrapErr(SysRng),
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
        pk.set_comment(comment.as_str());
        pk
    };

    // Encrypt with passphrase if provided
    let private_key = if let Some(ref pw) = passphrase {
        if !pw.is_empty() {
            private_key
                .encrypt(&mut UnwrapErr(SysRng), pw.as_bytes())
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
