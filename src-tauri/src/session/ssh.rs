//! SSH Session 实现 - SSH 远程会话
//!
//! 使用 russh 实现 SSH 会话，支持直接连接和通过 Jump Host 连接。

use super::types::{ExecResult, JumpHostConfig, SessionError, SessionOutput, SessionType};
use anyhow::Result;
use russh::client;
use russh::keys::PrivateKeyWithHashAlg;
use russh::{ChannelId, ChannelMsg};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, Mutex};

use crate::state::ClientHandler;

/// SSH sessions storage for SFTP and port forwarding
type SshSessions = Arc<Mutex<HashMap<String, Arc<client::Handle<ClientHandler>>>>>;

/// Global SSH sessions storage
static SSH_SESSIONS: std::sync::OnceLock<SshSessions> = std::sync::OnceLock::new();

/// Get the global SSH sessions registry
pub fn get_ssh_sessions() -> SshSessions {
    SSH_SESSIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new()))).clone()
}

// ============================================================================
/// SSH Connection Pool - ControlMaster multiplexing
///
/// Shares a single SSH connection (one TCP socket) across multiple shell
/// sessions to the same host. Each session gets its own channel.
/// When all sessions for a connection are closed, the underlying TCP connection
/// is terminated and the handle removed from the pool.

use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::RwLock;

/// A pooled SSH connection with a reference count.
/// The connection is closed automatically when ref_count reaches 0.
struct PooledConnection {
    /// Shared SSH handle (Arc so SshSession can clone it for new channels)
    handle: Arc<client::Handle<ClientHandler>>,
    /// Reference count: number of active SshSession instances using this connection
    ref_count: AtomicUsize,
}

impl PooledConnection {
    fn new(handle: Arc<client::Handle<ClientHandler>>) -> Self {
        Self {
            handle,
            ref_count: AtomicUsize::new(1),
        }
    }

    fn add_ref(&self) -> usize {
        self.ref_count.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn release(&self) -> usize {
        self.ref_count.fetch_sub(1, Ordering::SeqCst).saturating_sub(1)
    }
}

/// The connection pool
pub struct SshConnectionPool {
    /// Pool: key -> (PooledConnection, broadcast receiver for cleanup)
    inner: RwLock<HashMap<String, PooledConnection>>,
}

impl SshConnectionPool {
    fn new() -> Self {
        Self { inner: RwLock::new(HashMap::new()) }
    }

    /// Try to get an existing pooled connection.
    /// Returns the pooled Arc<Handle> if found (caller clones the Arc).
    async fn get(&self, key: &str) -> Option<Arc<client::Handle<ClientHandler>>> {
        let pool = self.inner.read().await;
        if let Some(conn) = pool.get(key) {
            conn.add_ref();
            return Some(Arc::clone(&conn.handle));
        }
        None
    }

    /// Insert a new connection into the pool.
    /// Panics if the key already exists (caller must check get() first).
    async fn insert(&self, key: String, handle: Arc<client::Handle<ClientHandler>>) {
        let conn = PooledConnection::new(handle);
        self.inner.write().await.insert(key, conn);
    }

    /// Release a reference. If ref_count reaches 0, close the connection and remove from pool.
    async fn release(&self, key: &str) {
        let handle = {
            let mut pool = self.inner.write().await;
            if let Some(conn) = pool.get_mut(key) {
                if conn.release() == 0 {
                    // Clone handle BEFORE removing entry (borrow checker)
                    let h = conn.handle.clone();
                    pool.remove(key);
                    Some(h)
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(handle) = handle {
            let _ = handle
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await;
        }
    }

}

impl Default for SshConnectionPool {
    fn default() -> Self {
        Self::new()
    }
}

/// Global connection pool
static SSH_CONNECTION_POOL: std::sync::OnceLock<Arc<SshConnectionPool>> = std::sync::OnceLock::new();

fn get_connection_pool() -> Arc<SshConnectionPool> {
    SSH_CONNECTION_POOL
        .get_or_init(|| Arc::new(SshConnectionPool::new()))
        .clone()
}

/// Connection key for the pool: based on host, port, username (excludes auth method)
/// Jump host connections are keyed separately since they involve two hosts.
fn connection_key(host: &str, port: u16, username: &str, is_jump: bool) -> String {
    if is_jump {
        format!("jump:{username}@{host}:{port}")
    } else {
        format!("{username}@{host}:{port}")
    }
}

/// Authenticate with SSH agent, trying all available identities.
///
/// Returns Ok(true) on success, Ok(false) if all identities were rejected,
/// or an error if the agent could not be contacted.
async fn authenticate_with_agent(
    handle: &mut client::Handle<ClientHandler>,
    username: &str,
) -> Result<bool, SessionError> {
    let rsa_hash = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|e| SessionError::ConnectionFailed(format!("Failed to get RSA hash: {}", e)))?
        .flatten();

    #[cfg(unix)]
    {
        use russh::keys::agent::client::AgentClient;

        let mut agent = AgentClient::connect_env().await.map_err(|e| {
            SessionError::AuthenticationFailed(format!("Failed to connect SSH agent: {}", e))
        })?;
        let identities = agent.request_identities().await.map_err(|e| {
            SessionError::AuthenticationFailed(format!(
                "Failed to read identities from SSH agent: {}",
                e
            ))
        })?;
        if identities.is_empty() {
            return Err(SessionError::AuthenticationFailed(
                "SSH agent has no available identities".to_string(),
            ));
        }

        for identity in identities {
            let public_key = identity.public_key().into_owned();
            let alg = match public_key.algorithm() {
                russh::keys::Algorithm::Dsa | russh::keys::Algorithm::Rsa { .. } => rsa_hash,
                _ => None,
            };
            let auth = handle
                .authenticate_publickey_with(username, public_key, alg, &mut agent)
                .await
                .map_err(|e| {
                    SessionError::AuthenticationFailed(format!("Agent auth failed: {}", e))
                })?;
            if auth.success() {
                return Ok(true);
            }
        }
        return Ok(false);
    }

    #[cfg(windows)]
    {
        use russh::keys::agent::client::AgentClient;
        use tokio::net::windows::named_pipe::ClientOptions;

        let explicit_pipe = std::env::var("SSH_AUTH_SOCK").ok();
        let candidates: Vec<String> = if let Some(pipe) = explicit_pipe.clone() {
            vec![pipe]
        } else {
            vec![
                r"\\.\pipe\openssh-ssh-agent".to_string(),
                r"\\.\pipe\pageant".to_string(),
            ]
        };

        let mut selected_pipe: Option<String> = None;
        let mut stream_opt = None;
        let mut open_errors: Vec<(String, std::io::Error)> = Vec::new();
        for pipe in candidates {
            match ClientOptions::new().open(&pipe) {
                Ok(stream) => {
                    selected_pipe = Some(pipe);
                    stream_opt = Some(stream);
                    break;
                }
                Err(e) => open_errors.push((pipe, e)),
            }
        }
        let selected_pipe = selected_pipe.ok_or_else(|| {
            if let Some((pipe, e)) = open_errors.first() {
                use std::io::ErrorKind;
                let msg = match e.kind() {
                    ErrorKind::NotFound => {
                        if explicit_pipe.is_some() {
                            format!(
                                "SSH_AUTH_SOCK points to '{}', but the pipe was not found.",
                                pipe
                            )
                        } else {
                            "No SSH agent pipe found. Start Windows OpenSSH Authentication Agent service or set SSH_AUTH_SOCK to a valid pipe.".to_string()
                        }
                    }
                    ErrorKind::PermissionDenied => format!(
                        "Permission denied when opening SSH agent pipe '{}'. Try running with matching user privileges.",
                        pipe
                    ),
                    _ => format!("Failed to open SSH agent pipe '{}': {}", pipe, e),
                };
                SessionError::AuthenticationFailed(msg)
            } else {
                SessionError::AuthenticationFailed(
                    "No SSH agent pipe candidate available".to_string(),
                )
            }
        })?;
        let stream = stream_opt.expect("stream must exist when selected_pipe exists");

        if selected_pipe.to_ascii_lowercase().contains("pageant") {
            tracing::info!(
                pipe = %selected_pipe,
                "using Pageant named pipe for SSH agent auth (best-effort)"
            );
        }
        let mut agent = AgentClient::connect(stream);
        let identities = agent.request_identities().await.map_err(|e| {
            SessionError::AuthenticationFailed(format!(
                "Failed to read identities from SSH agent: {}",
                e
            ))
        })?;
        if identities.is_empty() {
            return Err(SessionError::AuthenticationFailed(
                "SSH agent has no available identities".to_string(),
            ));
        }

        for identity in identities {
            let public_key = identity.public_key().into_owned();
            let alg = match public_key.algorithm() {
                russh::keys::Algorithm::Dsa | russh::keys::Algorithm::Rsa { .. } => rsa_hash,
                _ => None,
            };
            let auth = handle
                .authenticate_publickey_with(username, public_key, alg, &mut agent)
                .await
                .map_err(|e| {
                    SessionError::AuthenticationFailed(format!("Agent auth failed: {}", e))
                })?;
            if auth.success() {
                return Ok(true);
            }
        }
        return Ok(false);
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = (handle, username);
        return Err(SessionError::AuthenticationFailed(
            "SSH agent authentication is not available on this platform yet".to_string(),
        ));
    }
}

/// SSH Session 内部状态
pub struct SshSessionState {
    /// SSH 连接句柄 (Arc so exec() can clone it for a separate channel)
    handle: Arc<client::Handle<ClientHandler>>,
    /// Channel ID
    channel_id: ChannelId,
    /// 是否存活
    is_alive: bool,
    /// 关闭信号发送端
    shutdown_tx: broadcast::Sender<()>,
    /// 读取任务的 JoinHandle
    read_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    /// 连接池 key（用于复用时释放引用）
    pool_key: Option<String>,
}

/// SSH Session - SSH 远程会话
#[derive(Clone)]
pub struct SshSession {
    /// Session ID
    session_id: String,
    /// 内部状态
    state: Arc<Mutex<SshSessionState>>,
}

impl SshSession {
    /// 创建新的 SSH Session（密码认证）
    pub async fn new_with_password(
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
        Self::create(
            app,
            host,
            port,
            username,
            Some(password),
            None,
            false,
            None,
            cols,
            rows,
        )
        .await
    }

    /// 创建新的 SSH Session（密钥认证）
    #[allow(clippy::too_many_arguments)]
    pub async fn new_with_key(
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        private_key: &str,
        password: Option<&str>,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
        Self::create(
            app,
            host,
            port,
            username,
            password,
            Some(private_key),
            false,
            None,
            cols,
            rows,
        )
        .await
    }

    /// 创建新的 SSH Session（Agent 认证）
    pub async fn new_with_agent(
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
        Self::create(
            app,
            host,
            port,
            username,
            None,
            None,
            true,
            None,
            cols,
            rows,
        )
        .await
    }

    /// 创建新的 SSH Session（通过 Jump Host）
    #[allow(clippy::too_many_arguments)]
    pub async fn new_with_jump(
        app: AppHandle,
        target_host: &str,
        target_port: u16,
        target_username: &str,
        target_password: Option<&str>,
        target_key: Option<&str>,
        jump_host: JumpHostConfig,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
        Self::create(
            app,
            target_host,
            target_port,
            target_username,
            target_password,
            target_key,
            false,
            Some(jump_host),
            cols,
            rows,
        )
        .await
    }

    /// 内部创建方法
    #[allow(dead_code)]
    #[allow(clippy::too_many_arguments)]
    async fn create(
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        private_key: Option<&str>,
        use_agent: bool,
        jump_host: Option<JumpHostConfig>,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
        // 验证输入
        if host.is_empty() {
            return Err(SessionError::InvalidInput("Host cannot be empty".to_string()));
        }
        if !(1..=65535).contains(&port) {
            return Err(SessionError::InvalidInput(
                "Port must be between 1 and 65535".to_string(),
            ));
        }
        if username.is_empty() {
            return Err(SessionError::InvalidInput("Username cannot be empty".to_string()));
        }

        let _session_id = format!("{}-{}:{}", username, host, port);

        // 构建 SSH 配置
        let config = Arc::new(client::Config {
            inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
            keepalive_interval: Some(std::time::Duration::from_secs(30)),
            keepalive_max: 3,
            ..Default::default()
        });

        // 决定连接方式：直接连接 或 通过 Jump Host
        // Try to get a pooled connection first (ControlMaster multiplexing)
        let pool = get_connection_pool();
        let is_jump = jump_host.is_some();
        let pool_key = connection_key(host, port, username, is_jump);

        // pooled_handle is an Arc we can use directly for channel ops
        let pooled_arc: Option<Arc<client::Handle<ClientHandler>>> =
            pool.get(&pool_key).await;

        if let Some(arc_handle) = pooled_arc {
            // Reuse pooled connection: release lock immediately, open new channel
            tracing::info!(key = %pool_key, "reusing pooled SSH connection");
            // Pool Arc is already in the state; just open a channel
            let mut channel = arc_handle
                .channel_open_session()
                .await
                .map_err(|e| SessionError::ChannelError(format!("failed to open channel: {}", e)))?;

            channel
                .request_pty(false, "xterm-256color", cols.into(), rows.into(), 0, 0, &[])
                .await
                .map_err(|e| SessionError::ChannelError(format!("failed to request PTY: {}", e)))?;

            channel
                .request_shell(false)
                .await
                .map_err(|e| SessionError::ChannelError(format!("failed to request shell: {}", e)))?;

            let channel_id = channel.id();

            // 创建关闭信号 channel
            let (shutdown_tx, _) = broadcast::channel(1);
            let shutdown_rx = shutdown_tx.subscribe();

            let read_handle = Arc::new(Mutex::new(None::<tokio::task::JoinHandle<()>>));

            let state = Arc::new(Mutex::new(SshSessionState {
                handle: Arc::clone(&arc_handle),
                channel_id,
                is_alive: true,
                shutdown_tx,
                read_handle: read_handle.clone(),
                pool_key: Some(pool_key),
            }));

            let session_id = format!("{}-{}:{}", username, host, port);

            // 启动读取任务 (same pattern as below)
            let session_id_clone = session_id.clone();
            let app_clone = app.clone();
            let read_handle_clone = read_handle.clone();

            let _jh = tokio::spawn(async move {
                let mut shutdown_rx = shutdown_rx;

                loop {
                    tokio::select! {
                        biased;
                        _ = shutdown_rx.recv() => {
                            let _ = app_clone.emit("ssh-close", &session_id_clone);
                            break;
                        }
                        msg = channel.wait() => {
                            match msg {
                                Some(ChannelMsg::Data { data }) => {
                                    let output = SessionOutput {
                                        session_id: session_id_clone.clone(),
                                        data: String::from_utf8_lossy(&data).to_string(),
                                        is_stderr: false,
                                    };
                                    let _ = app_clone.emit("ssh-data", output);
                                }
                                Some(ChannelMsg::ExtendedData { data, ext }) => {
                                    let output = SessionOutput {
                                        session_id: session_id_clone.clone(),
                                        data: String::from_utf8_lossy(&data).to_string(),
                                        is_stderr: ext == 1,
                                    };
                                    let _ = app_clone.emit("ssh-data", output);
                                }
                                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                                    let _ = app_clone.emit("ssh-close", &session_id_clone);
                                    break;
                                }
                                Some(ChannelMsg::ExitStatus { exit_status }) => {
                                    let _ = app_clone.emit("ssh-exit", (&session_id_clone, exit_status));
                                }
                                None => break,
                                _ => continue,
                            }
                        }
                    }
                }

                let mut handle_guard = read_handle_clone.lock().await;
                *handle_guard = None;
            });

            {
                let mut handle_guard = read_handle.lock().await;
                *handle_guard = Some(_jh);
            }

            return Ok(Self { session_id, state });
        }

        // ── New connection (not pooled) ──────────────────────────────────────
        let raw_handle: client::Handle<ClientHandler>;
        let jh_ch: Option<russh::Channel<client::Msg>>;

        if let Some(ref jh) = jump_host {
            let (jh_h, ch) = Self::connect_via_jump(
                config.clone(), host, port, username, password, private_key, use_agent, jh,
            )
            .await?;
            raw_handle = jh_h;
            jh_ch = Some(ch);
        } else {
            let addr = format!("{}:{}", host, port);
            let mut direct = client::connect(config, addr, ClientHandler::new())
                .await
                .map_err(|e| SessionError::ConnectionFailed(format!("Connection failed: {}", e)))?;
            Self::authenticate(&mut direct, username, password, private_key, use_agent).await?;
            raw_handle = direct;
            jh_ch = None;
        }

        // Add to pool for future reuse
        let arc_handle = Arc::new(raw_handle);
        pool.insert(pool_key.clone(), Arc::clone(&arc_handle)).await;
        tracing::info!(key = %pool_key, "new SSH connection added to pool");

        // Open shell channel (raw_handle moved into arc_handle, use the cloned Arc for the channel)
        let mut channel = if let Some(ch) = jh_ch {
            ch
        } else {
            Arc::clone(&arc_handle)
                .channel_open_session()
                .await
                .map_err(|e| SessionError::ChannelError(format!("failed to open channel: {}", e)))?
        };

        channel
            .request_pty(false, "xterm-256color", cols.into(), rows.into(), 0, 0, &[])
            .await
            .map_err(|e| SessionError::ChannelError(format!("failed to request PTY: {}", e)))?;

        channel
            .request_shell(false)
            .await
            .map_err(|e| SessionError::ChannelError(format!("failed to request shell: {}", e)))?;

        let channel_id = channel.id();

        let (shutdown_tx, _) = broadcast::channel(1);
        let shutdown_rx = shutdown_tx.subscribe();
        let read_handle = Arc::new(Mutex::new(None::<tokio::task::JoinHandle<()>>));

        let session_id = format!("{}-{}:{}", username, host, port);

        let state = Arc::new(Mutex::new(SshSessionState {
            handle: Arc::clone(&arc_handle),
            channel_id,
            is_alive: true,
            shutdown_tx,
            read_handle: read_handle.clone(),
            pool_key: Some(pool_key),
        }));

        let session_id_clone = session_id.clone();
        let app_clone = app.clone();
        let read_handle_clone = read_handle.clone();

        let _jh = tokio::spawn(async move {
            let mut shutdown_rx = shutdown_rx;

            loop {
                tokio::select! {
                    biased;
                    _ = shutdown_rx.recv() => {
                        let _ = app_clone.emit("ssh-close", &session_id_clone);
                        break;
                    }
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { data }) => {
                                let output = SessionOutput {
                                    session_id: session_id_clone.clone(),
                                    data: String::from_utf8_lossy(&data).to_string(),
                                    is_stderr: false,
                                };
                                let _ = app_clone.emit("ssh-data", output);
                            }
                            Some(ChannelMsg::ExtendedData { data, ext }) => {
                                let output = SessionOutput {
                                    session_id: session_id_clone.clone(),
                                    data: String::from_utf8_lossy(&data).to_string(),
                                    is_stderr: ext == 1,
                                };
                                let _ = app_clone.emit("ssh-data", output);
                            }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                                let _ = app_clone.emit("ssh-close", &session_id_clone);
                                break;
                            }
                            Some(ChannelMsg::ExitStatus { exit_status }) => {
                                let _ = app_clone.emit("ssh-exit", (&session_id_clone, exit_status));
                            }
                            None => break,
                            _ => continue,
                        }
                    }
                }
            }

            let mut guard = read_handle_clone.lock().await;
            *guard = None;
        });

        {
            let mut guard = read_handle.lock().await;
            *guard = Some(_jh);
        }

        Ok(Self { session_id, state })
    }

    /// 通过 Jump Host 连接到目标主机
    ///
    /// 返回跳板机的 handle 和到目标主机的 channel
    async fn connect_via_jump(
        config: Arc<client::Config>,
        target_host: &str,
        target_port: u16,
        target_username: &str,
        target_password: Option<&str>,
        target_key: Option<&str>,
        use_target_agent: bool,
        jump_host: &JumpHostConfig,
    ) -> Result<(client::Handle<ClientHandler>, russh::Channel<client::Msg>), SessionError> {
        // 第一步：连接到跳板机
        let jump_addr = format!("{}:{}", jump_host.host, jump_host.port);
        let mut jump_handle = client::connect(config.clone(), jump_addr, ClientHandler::new())
            .await
            .map_err(|e| SessionError::ConnectionFailed(format!("Jump host connection failed: {}", e)))?;

        // 跳板机认证
        let jump_auth: Result<bool, SessionError> = match jump_host.auth_type.as_str() {
            "agent" => {
                let success = authenticate_with_agent(&mut jump_handle, &jump_host.username).await?;
                if success { Ok(true) } else {
                    Err(SessionError::AuthenticationFailed(
                        "Jump host: all SSH agent identities rejected".to_string(),
                    ))
                }
            }
            "key" => {
                let rsa_hash = jump_handle
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|e| SessionError::ConnectionFailed(format!("RSA hash failed: {}", e)))?
                    .flatten();
                if let Some(ref key) = jump_host.private_key {
                    match russh::keys::decode_openssh(key.as_bytes(), jump_host.password.as_deref()) {
                        Ok(key) => {
                            let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
                            jump_handle.authenticate_publickey(&jump_host.username, key_with_hash).await
                                .map(|r| r.success())
                                .map_err(|e| SessionError::AuthenticationFailed(format!("Jump host auth failed: {}", e)))
                        }
                        Err(_) => {
                            if let Some(ref pwd) = jump_host.password {
                                jump_handle.authenticate_password(&jump_host.username, pwd).await
                                    .map(|r| r.success())
                                    .map_err(|e| SessionError::AuthenticationFailed(format!("Jump host auth failed: {}", e)))
                            } else {
                                Err(SessionError::AuthenticationFailed(
                                    "Failed to parse jump host key and no password provided".to_string(),
                                ))
                            }
                        }
                    }
                } else if let Some(ref pwd) = jump_host.password {
                    jump_handle.authenticate_password(&jump_host.username, pwd).await
                        .map(|r| r.success())
                        .map_err(|e| SessionError::AuthenticationFailed(format!("Jump host auth failed: {}", e)))
                } else {
                    Err(SessionError::AuthenticationFailed(
                        "No authentication method provided for jump host".to_string(),
                    ))
                }
            }
            _ => {
                // 默认使用密码认证
                if let Some(ref pwd) = jump_host.password {
                    jump_handle.authenticate_password(&jump_host.username, pwd).await
                        .map(|r| r.success())
                        .map_err(|e| SessionError::AuthenticationFailed(format!("Jump host auth failed: {}", e)))
                } else {
                    Err(SessionError::AuthenticationFailed(
                        "Jump host password required".to_string(),
                    ))
                }
            }
        };

        if !jump_auth? {
            return Err(SessionError::AuthenticationFailed(
                "Jump host authentication failed".to_string(),
            ));
        }

        // 第二步：通过跳板机打开到目标主机的 direct-tcpip channel
        let peer_addr = format!("{}:{}", jump_host.host, jump_host.port);
        let mut target_channel = jump_handle
            .channel_open_direct_tcpip(target_host, target_port as u32, &peer_addr, jump_host.port as u32)
            .await
            .map_err(|e| SessionError::ChannelError(format!("Failed to open channel via jump host: {}", e)))?;

        // 第三步：目标主机认证（在已建立的 channel 上进行）
        let target_auth = if use_target_agent {
            let success = authenticate_with_agent(&mut jump_handle, target_username).await?;
            if success {
                Ok(true)
            } else {
                Err(SessionError::AuthenticationFailed(
                    "Target host: all SSH agent identities rejected".to_string(),
                ))
            }
        } else {
            Self::authenticate_channel_on_channel(
                &mut target_channel,
                target_username,
                target_password,
                target_key,
            )
            .await
        };

        if !target_auth? {
            return Err(SessionError::AuthenticationFailed(
                "Target host authentication failed".to_string(),
            ));
        }

        Ok((jump_handle, target_channel))
    }

    /// 在 channel 上进行认证（实验性）
    ///
    /// SSH 认证通常在 channel_open 之前完成。对于通过跳板机的连接，
    /// 认证信息已经在跳板机层处理。这里返回 Ok(false) 表示未认证。
    async fn authenticate_channel_on_channel(
        channel: &mut russh::Channel<client::Msg>,
        username: &str,
        password: Option<&str>,
        private_key: Option<&str>,
    ) -> Result<bool, SessionError> {
        // SSH 认证在 channel_open 之后通常无法完成，这里尝试发送认证请求
        // 但实际上 SSH 认证需要在 session 层面进行，不是在 channel 层面
        let _ = (channel, username, password, private_key);
        Ok(false)
    }

    /// 认证处理
    async fn authenticate(
        handle: &mut client::Handle<ClientHandler>,
        username: &str,
        password: Option<&str>,
        private_key: Option<&str>,
        use_agent: bool,
    ) -> Result<(), SessionError> {
        if use_agent {
            let success = authenticate_with_agent(handle, username).await?;
            if success {
                return Ok(());
            }
            return Err(SessionError::AuthenticationFailed(
                "Authentication failed: all SSH agent identities rejected".to_string(),
            ));
        }

        let auth_result = if let Some(key_content) = private_key {
            let rsa_hash = handle
                .best_supported_rsa_hash()
                .await
                .map_err(|e| SessionError::ConnectionFailed(format!("Failed to get RSA hash: {}", e)))?
                .flatten();
            match russh::keys::decode_openssh(key_content.as_bytes(), password) {
                Ok(key) => {
                    let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
                    handle.authenticate_publickey(username, key_with_hash).await
                }
                Err(_) => {
                    if let Some(pwd) = password {
                        handle.authenticate_password(username, pwd).await
                    } else {
                        return Err(SessionError::AuthenticationFailed(
                            "Failed to parse private key and no password provided".to_string(),
                        ));
                    }
                }
            }
        } else if let Some(pwd) = password {
            handle.authenticate_password(username, pwd).await
        } else {
            return Err(SessionError::AuthenticationFailed(
                "No authentication method provided".to_string(),
            ));
        };

        if !auth_result
            .map_err(|e| SessionError::AuthenticationFailed(format!("Auth failed: {}", e)))?
            .success()
        {
            return Err(SessionError::AuthenticationFailed(
                "Authentication failed: all methods rejected".to_string(),
            ));
        }

        Ok(())
    }

    /// 获取会话 ID
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// 获取 Session 类型
    pub fn session_type(&self) -> SessionType {
        SessionType::Ssh
    }

    /// Execute a command on the SSH session and return its output.
    pub fn exec(
        &self,
        command: &str,
        timeout: std::time::Duration,
    ) -> Pin<Box<dyn Future<Output = Result<ExecResult, SessionError>> + Send>> {
        let command = command.to_string();
        let state = self.state.clone();
        Box::pin(async move {
            let handle = {
                let guard = state.lock().await;
                if !guard.is_alive {
                    return Err(SessionError::ChannelError("session is closed".to_string()));
                }
                guard.handle.clone()
            };

            // Open exec channel
            let mut channel = handle
                .channel_open_session()
                .await
                .map_err(|e| SessionError::ChannelError(format!("failed to open exec channel: {}", e)))?;

            // Request exec
            channel
                .exec(true, command.as_bytes())
                .await
                .map_err(|e| SessionError::ChannelError(format!("exec request failed: {}", e)))?;

            // Read output
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            let mut exit_code: Option<u32> = None;

            loop {
                tokio::select! {
                    biased;
                    result = channel.wait() => {
                        match result {
                            Some(ChannelMsg::Data { data }) => {
                                stdout.extend_from_slice(&data);
                            }
                            Some(ChannelMsg::ExtendedData { data, ext }) => {
                                if ext == 1 {
                                    stderr.extend_from_slice(&data);
                                } else {
                                    stdout.extend_from_slice(&data);
                                }
                            }
                            Some(ChannelMsg::ExitStatus { exit_status }) => {
                                exit_code = Some(exit_status);
                                break;
                            }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                                break;
                            }
                            None => break,
                            _ => continue,
                        }
                    }
                    _ = tokio::time::sleep(timeout) => {
                        return Err(SessionError::ChannelError("exec timed out".to_string()));
                    }
                }
            }

            let stdout_str = String::from_utf8_lossy(&stdout).to_string();
            let stderr_str = String::from_utf8_lossy(&stderr).to_string();
            let code = exit_code.unwrap_or(1) as i32;

            Ok(ExecResult { stdout: stdout_str, stderr: stderr_str, exit_code: code })
        })
    }

    /// 写入数据
    pub fn write(&self, data: &str) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        let data_bytes = bytes::Bytes::copy_from_slice(data.as_bytes());
        let state = self.state.clone();
        Box::pin(async move {
            let state = state.lock().await;
            if !state.is_alive {
                return Err(SessionError::WriteFailed("Session is closed".to_string()));
            }

            let handle = state.handle.as_ref();
            handle
                .data(state.channel_id, data_bytes)
                .await
                .map_err(|e| SessionError::ChannelError(format!("Failed to send data: {:?}", e)))?;

            Ok(())
        })
    }

    /// 调整大小
    pub fn resize(&self, cols: u16, rows: u16) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        let resize_cmd = format!("\x1b[8;{};{}t", rows, cols);
        let resize_bytes = bytes::Bytes::from(resize_cmd);
        let state = self.state.clone();
        Box::pin(async move {
            let state = state.lock().await;
            if !state.is_alive {
                return Err(SessionError::ResizeFailed("Session is closed".to_string()));
            }

            let handle = state.handle.as_ref();
            handle
                .data(state.channel_id, resize_bytes)
                .await
                .map_err(|e| SessionError::ChannelError(format!("Failed to send resize: {:?}", e)))?;

            Ok(())
        })
    }

    /// 关闭会话 - 发送关闭信号并等待任务完成，并释放连接池引用
    pub fn close(self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let state = self.state.clone();
        Box::pin(async move {
            let pool_key = {
                let s = state.lock().await;
                s.pool_key.clone()
            };
            let read_handle = {
                let mut s = state.lock().await;
                if s.is_alive {
                    let _ = s.shutdown_tx.send(());
                    s.is_alive = false;
                }
                let h = s.read_handle.lock().await.take();
                h
            };
            // 等待读取任务完成（最多等待 2 秒）
            if let Some(h) = read_handle {
                let _ = tokio::time::timeout(tokio::time::Duration::from_secs(2), h).await;
            }
            // 释放连接池引用（如果是最后一个引用，底层连接会被关闭）
            if let Some(ref key) = pool_key {
                get_connection_pool().release(key).await;
            }
        })
    }

    /// 检查会话是否活跃
    pub fn is_alive(&self) -> bool {
        let state = self.state.try_lock();
        match state {
            Ok(s) => s.is_alive,
            Err(_) => false,
        }
    }
}
