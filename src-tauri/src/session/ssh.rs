//! SSH Session 实现 - SSH 远程会话
//!
//! 使用 russh 实现 SSH 会话，支持直接连接和通过 Jump Host 连接。
//! 支持连接池复用（ControlMaster multiplexing）以减少同一主机多 tab 的重复连接。

use super::types::{ExecResult, JumpHostConfig, SessionError, SessionOutput, SessionType};
use russh::client;
use russh::keys::PrivateKeyWithHashAlg;
use russh::{ChannelMsg, ChannelWriteHalf};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, Mutex};

use crate::state::ClientHandler;

/// SSH sessions storage for SFTP and port forwarding
type SshSessions = Arc<Mutex<HashMap<String, Arc<client::Handle<ClientHandler>>>>>;
/// Erases nested russh futures so Tauri commands stay `Send` on every target.
type BoxedSshFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, SessionError>> + Send + 'a>>;

/// Global SSH sessions storage
static SSH_SESSIONS: std::sync::OnceLock<SshSessions> = std::sync::OnceLock::new();

/// Get the global SSH sessions registry
pub fn get_ssh_sessions() -> SshSessions {
    SSH_SESSIONS
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

// ============================================================================
/// SSH Connection Pool - ControlMaster multiplexing
///
/// Shares a single SSH connection (one TCP socket) across multiple shell
/// sessions to the same host. Each session gets its own channel.
/// When all sessions for a connection are closed, the underlying TCP connection
/// is terminated and the handle removed from the pool.
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tokio::sync::RwLock;

/// A pooled SSH connection with a reference count.
/// The connection is closed automatically when ref_count reaches 0.
struct PooledConnection {
    /// Shared SSH handle (Arc so SshSession can clone it for new channels)
    handle: Arc<client::Handle<ClientHandler>>,
    /// Jump-host transport that owns the direct-tcpip stream, when applicable.
    transport_handle: Option<Arc<client::Handle<ClientHandler>>>,
    /// Reference count: number of active SshSession instances using this connection
    ref_count: AtomicUsize,
}

impl PooledConnection {
    fn new(
        handle: Arc<client::Handle<ClientHandler>>,
        transport_handle: Option<Arc<client::Handle<ClientHandler>>>,
    ) -> Self {
        Self {
            handle,
            transport_handle,
            ref_count: AtomicUsize::new(1),
        }
    }

    fn add_ref(&self) -> usize {
        self.ref_count.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn release(&self) -> usize {
        self.ref_count
            .fetch_sub(1, Ordering::SeqCst)
            .saturating_sub(1)
    }
}

/// The connection pool
pub struct SshConnectionPool {
    /// Pool: key -> (PooledConnection, broadcast receiver for cleanup)
    inner: RwLock<HashMap<String, PooledConnection>>,
    /// Serializes connection creation and shell setup for each pool identity.
    creation_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl SshConnectionPool {
    fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
            creation_locks: Mutex::new(HashMap::new()),
        }
    }

    async fn creation_lock(self: Arc<Self>, key: String) -> Arc<Mutex<()>> {
        let mut locks = self.creation_locks.lock().await;
        Arc::clone(locks.entry(key).or_insert_with(|| Arc::new(Mutex::new(()))))
    }

    /// Try to get an existing pooled connection.
    /// Returns the pooled Arc<Handle> if found (caller clones the Arc).
    async fn get(self: Arc<Self>, key: String) -> Option<Arc<client::Handle<ClientHandler>>> {
        let pool = self.inner.read().await;
        if let Some(conn) = pool.get(&key) {
            conn.add_ref();
            return Some(Arc::clone(&conn.handle));
        }
        None
    }

    /// Insert a new connection into the pool and register it globally for SFTP/port-forward access.
    async fn insert(
        self: Arc<Self>,
        key: String,
        handle: Arc<client::Handle<ClientHandler>>,
        transport_handle: Option<Arc<client::Handle<ClientHandler>>>,
    ) {
        let key_for_global = key.clone();
        let conn = PooledConnection::new(Arc::clone(&handle), transport_handle);
        self.inner.write().await.insert(key, conn);
        // Also register globally so SFTP / port-forward can find this handle by session_id
        let sessions = get_ssh_sessions();
        let mut sessions = sessions.lock().await;
        sessions.insert(key_for_global, handle);
    }

    /// Release a reference. If ref_count reaches 0, close the connection, remove from pool,
    /// and unregister from the global sessions map (used by SFTP / port-forward).
    async fn release(self: Arc<Self>, key: String) {
        let handles = {
            let mut pool = self.inner.write().await;
            if let Some(conn) = pool.get_mut(&key) {
                if conn.release() == 0 {
                    let h = conn.handle.clone();
                    let transport = conn.transport_handle.clone();
                    pool.remove(&key);
                    Some((h, transport))
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some((handle, transport_handle)) = handles {
            let sessions = get_ssh_sessions();
            sessions.lock().await.remove(&key);
            let _ = handle
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await;
            if let Some(transport_handle) = transport_handle {
                let _ = transport_handle
                    .disconnect(russh::Disconnect::ByApplication, "", "en")
                    .await;
            }
        }
    }
}

impl Default for SshConnectionPool {
    fn default() -> Self {
        Self::new()
    }
}

/// Global connection pool
static SSH_CONNECTION_POOL: std::sync::OnceLock<Arc<SshConnectionPool>> =
    std::sync::OnceLock::new();

fn get_connection_pool() -> Arc<SshConnectionPool> {
    SSH_CONNECTION_POOL
        .get_or_init(|| Arc::new(SshConnectionPool::new()))
        .clone()
}

/// Connection key for the pool. Jump connections include the bastion identity so
/// sessions using different tunnels can never share the wrong transport.
fn connection_key(
    host: &str,
    port: u16,
    username: &str,
    jump_host: Option<&JumpHostConfig>,
) -> String {
    match jump_host {
        Some(jump) => format!(
            "jump:{}@{}:{}=>{}@{}:{}",
            jump.username, jump.host, jump.port, username, host, port
        ),
        None => format!("{username}@{host}:{port}"),
    }
}

/// Authenticate with SSH agent, trying all available identities.
///
/// Returns Ok(true) on success, Ok(false) if all identities were rejected,
/// or an error if the agent could not be contacted.
fn authenticate_with_agent<'a>(
    handle: &'a mut client::Handle<ClientHandler>,
    username: String,
) -> BoxedSshFuture<'a, bool> {
    Box::pin(authenticate_with_agent_inner(handle, username))
}

async fn authenticate_with_agent_inner(
    handle: &mut client::Handle<ClientHandler>,
    username: String,
) -> Result<bool, SessionError> {
    let rsa_hash = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|e| SessionError::ConnectionFailed(format!("failed to get RSA hash: {}", e)))?
        .flatten();

    #[cfg(unix)]
    {
        use russh::keys::agent::client::AgentClient;

        let mut agent = AgentClient::connect_env().await.map_err(|e| {
            SessionError::AuthenticationFailed(format!("failed to connect SSH agent: {}", e))
        })?;
        let identities = agent.request_identities().await.map_err(|e| {
            SessionError::AuthenticationFailed(format!(
                "failed to read identities from SSH agent: {}",
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
                .authenticate_publickey_with(username.clone(), public_key, alg, &mut agent)
                .await
                .map_err(|e| {
                    SessionError::AuthenticationFailed(format!("agent auth failed: {}", e))
                })?;
            if auth.success() {
                return Ok(true);
            }
        }
        Ok(false)
    }

    #[cfg(windows)]
    {
        use russh::keys::agent::client::AgentClient;

        const OPENSSH_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";
        let explicit_pipe = std::env::var("SSH_AUTH_SOCK").ok();

        let mut agent = if let Some(pipe) = explicit_pipe {
            let pipe_for_error = pipe.clone();
            AgentClient::connect_named_pipe(pipe)
                .await
                .map_err(|error| {
                    let message = match &error {
                        russh::keys::Error::IO(io_error) => match io_error.kind() {
                            std::io::ErrorKind::NotFound => format!(
                                "SSH_AUTH_SOCK points to '{}', but the named pipe was not found. Verify the path or unset SSH_AUTH_SOCK to use the default agent.",
                                pipe_for_error
                            ),
                            std::io::ErrorKind::PermissionDenied => format!(
                                "Permission denied when opening SSH agent pipe '{}'. Check that your user account has access to the pipe.",
                                pipe_for_error
                            ),
                            std::io::ErrorKind::AddrNotAvailable => format!(
                                "SSH agent pipe '{}' is not available. The agent service may have stopped.",
                                pipe_for_error
                            ),
                            _ => format!(
                                "Failed to open SSH agent pipe '{}': {}",
                                pipe_for_error, error
                            ),
                        },
                        _ => format!(
                            "Failed to open SSH agent pipe '{}': {}",
                            pipe_for_error, error
                        ),
                    };
                    SessionError::AuthenticationFailed(message)
                })?
                .dynamic()
        } else {
            match AgentClient::connect_named_pipe(OPENSSH_AGENT_PIPE.to_string()).await {
                Ok(agent) => agent.dynamic(),
                Err(open_ssh_error) => {
                    let pageant = AgentClient::connect_pageant().await.map_err(|pageant_error| {
                        SessionError::AuthenticationFailed(format!(
                            "Windows OpenSSH Authentication Agent is unavailable ({}), and Pageant does not appear to be running ({})",
                            open_ssh_error, pageant_error
                        ))
                    })?;
                    tracing::info!("using Pageant transport for SSH agent authentication");
                    pageant.dynamic()
                }
            }
        };

        let identities = agent.request_identities().await.map_err(|e| {
            SessionError::AuthenticationFailed(format!(
                "failed to read identities from SSH agent: {}",
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
                .authenticate_publickey_with(username.clone(), public_key, alg, &mut agent)
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
    /// Shell channel write half used for terminal input and RFC 4254 requests.
    channel_writer: Arc<ChannelWriteHalf<client::Msg>>,
    /// 是否存活
    is_alive: Arc<AtomicBool>,
    /// 关闭信号发送端
    shutdown_tx: broadcast::Sender<()>,
    /// 读取任务的 JoinHandle
    read_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    /// 连接池 key（用于复用时释放引用）
    pool_key: Option<String>,
    /// Ensures EOF and explicit close release the pool reference exactly once.
    pool_ref_held: Arc<AtomicBool>,
}

/// SSH Session - SSH 远程会话
#[derive(Clone)]
pub struct SshSession {
    /// Session ID
    session_id: String,
    /// 内部状态
    state: Arc<Mutex<SshSessionState>>,
}

struct JumpTarget {
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    use_agent: bool,
}

fn open_shell_channel(
    handle: Arc<client::Handle<ClientHandler>>,
    cols: u16,
    rows: u16,
) -> BoxedSshFuture<'static, russh::Channel<client::Msg>> {
    Box::pin(open_shell_channel_inner(handle, cols, rows))
}

async fn open_shell_channel_inner(
    handle: Arc<client::Handle<ClientHandler>>,
    cols: u16,
    rows: u16,
) -> Result<russh::Channel<client::Msg>, SessionError> {
    let channel = handle
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

    Ok(channel)
}

impl SshSession {
    /// 创建新的 SSH Session（密码认证）
    pub fn new_with_password(
        app: AppHandle,
        host: String,
        port: u16,
        username: String,
        password: String,
        cols: u16,
        rows: u16,
    ) -> BoxedSshFuture<'static, Self> {
        Box::pin(Self::create(
            app,
            host,
            port,
            username,
            Some(password),
            None,
            None,  // certificate
            false, // use_agent
            None,  // no jump host
            false, // use_target_agent
            cols,
            rows,
        ))
    }

    /// 创建新的 SSH Session（密钥认证）
    #[allow(clippy::too_many_arguments)]
    pub fn new_with_key(
        app: AppHandle,
        host: String,
        port: u16,
        username: String,
        private_key: String,
        password: Option<String>,
        cols: u16,
        rows: u16,
    ) -> BoxedSshFuture<'static, Self> {
        Box::pin(Self::create(
            app,
            host,
            port,
            username,
            password,
            Some(private_key),
            None,  // certificate
            false, // use_agent
            None,  // no jump host
            false, // use_target_agent
            cols,
            rows,
        ))
    }

    /// 创建新的 SSH Session（证书认证）
    ///
    /// 证书认证需要同时提供私钥（用于签名）和 SSH 证书（OpenSSH 格式）。
    /// 私钥格式：PEM 或 OpenSSH 格式（russh decode_openssh）
    /// 证书格式：OpenSSH 格式（ssh-ed25519-cert-v01@openssh.com AAAA...）
    #[allow(clippy::too_many_arguments)]
    pub fn new_with_cert(
        app: AppHandle,
        host: String,
        port: u16,
        username: String,
        certificate: String,
        private_key: String,
        key_password: Option<String>,
        cols: u16,
        rows: u16,
    ) -> BoxedSshFuture<'static, Self> {
        Box::pin(Self::create(
            app,
            host,
            port,
            username,
            key_password,      // password (for key encryption)
            Some(private_key), // private_key
            Some(certificate), // certificate
            false,             // use_agent
            None,              // no jump host
            false,             // use_target_agent
            cols,
            rows,
        ))
    }

    /// 创建新的 SSH Session（Agent 认证）
    pub fn new_with_agent(
        app: AppHandle,
        host: String,
        port: u16,
        username: String,
        cols: u16,
        rows: u16,
    ) -> BoxedSshFuture<'static, Self> {
        Box::pin(Self::create(
            app, host, port, username, None,  // password
            None,  // private_key
            None,  // certificate
            true,  // use_agent
            None,  // no jump host
            false, // use_target_agent
            cols, rows,
        ))
    }

    /// 创建新的 SSH Session（通过 Jump Host）
    #[allow(clippy::too_many_arguments)]
    pub fn new_with_jump(
        app: AppHandle,
        target_host: String,
        target_port: u16,
        target_username: String,
        target_password: Option<String>,
        target_key: Option<String>,
        jump_host: JumpHostConfig,
        cols: u16,
        rows: u16,
    ) -> BoxedSshFuture<'static, Self> {
        Box::pin(Self::new_with_jump_inner(
            app,
            target_host,
            target_port,
            target_username,
            target_password,
            target_key,
            jump_host,
            cols,
            rows,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    async fn new_with_jump_inner(
        app: AppHandle,
        target_host: String,
        target_port: u16,
        target_username: String,
        target_password: Option<String>,
        target_key: Option<String>,
        jump_host: JumpHostConfig,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
        validate_jump_auth_types(&jump_host)?;
        // 根据 jump_host.target_auth_type 决定是否对目标主机使用 SSH agent 认证
        let use_target_agent = jump_host.target_auth_type.as_deref() == Some("agent");
        Self::create(
            app,
            target_host,
            target_port,
            target_username,
            target_password,
            target_key,
            None,  // certificate
            false, // use_agent for jump host itself
            Some(jump_host),
            use_target_agent,
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
        host: String,
        port: u16,
        username: String,
        password: Option<String>,
        private_key: Option<String>,
        certificate: Option<String>,
        use_agent: bool,
        jump_host: Option<JumpHostConfig>,
        use_target_agent: bool,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
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
        let pool_key = connection_key(&host, port, &username, jump_host.as_ref());
        let creation_lock = Arc::clone(&pool).creation_lock(pool_key.clone()).await;
        let _creation_guard = creation_lock.lock().await;

        // pooled_handle is an Arc we can use directly for channel ops
        let pooled_arc: Option<Arc<client::Handle<ClientHandler>>> =
            Arc::clone(&pool).get(pool_key.clone()).await;

        if let Some(arc_handle) = pooled_arc {
            // Reuse pooled connection: open a new PTY channel on the shared handle
            tracing::info!(key = %pool_key, "reusing pooled SSH connection for new tab");

            let channel = match open_shell_channel(Arc::clone(&arc_handle), cols, rows).await {
                Ok(channel) => channel,
                Err(error) => {
                    Arc::clone(&pool).release(pool_key.clone()).await;
                    return Err(error);
                }
            };
            let (mut channel_reader, channel_writer) = channel.split();
            let channel_writer = Arc::new(channel_writer);
            let is_alive = Arc::new(AtomicBool::new(true));
            let pool_ref_held = Arc::new(AtomicBool::new(true));

            // 创建关闭信号 channel
            let (shutdown_tx, _) = broadcast::channel(1);
            let shutdown_rx = shutdown_tx.subscribe();

            let read_handle = Arc::new(Mutex::new(None::<tokio::task::JoinHandle<()>>));

            // 每个 tab 使用唯一 session_id（UUID），pool_key 用于复用底层 TCP 连接
            let session_id = format!("ssh-{}", uuid::Uuid::new_v4());

            let state = Arc::new(Mutex::new(SshSessionState {
                handle: Arc::clone(&arc_handle),
                channel_writer,
                is_alive: Arc::clone(&is_alive),
                shutdown_tx,
                read_handle: read_handle.clone(),
                pool_key: Some(pool_key.clone()),
                pool_ref_held: Arc::clone(&pool_ref_held),
            }));

            // 启动读取任务
            let session_id_clone = session_id.clone();
            let app_clone = app.clone();
            let read_handle_clone = read_handle.clone();
            let is_alive_clone = Arc::clone(&is_alive);
            let pool_ref_held_clone = Arc::clone(&pool_ref_held);
            let pool_key_clone = pool_key.clone();

            let _jh = tokio::spawn(async move {
                let mut shutdown_rx = shutdown_rx;

                loop {
                    tokio::select! {
                        biased;
                        _ = shutdown_rx.recv() => {
                            let _ = app_clone.emit("ssh-close", &session_id_clone);
                            break;
                        }
                        msg = channel_reader.wait() => {
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
                                None => {
                                    let _ = app_clone.emit("ssh-close", &session_id_clone);
                                    break;
                                }
                                _ => continue,
                            }
                        }
                    }
                }

                is_alive_clone.store(false, Ordering::Release);
                if pool_ref_held_clone.swap(false, Ordering::AcqRel) {
                    get_connection_pool().release(pool_key_clone).await;
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
        let transport_handle: Option<Arc<client::Handle<ClientHandler>>>;

        if let Some(jh) = jump_host {
            let target = JumpTarget {
                host,
                port,
                username,
                password,
                private_key,
                use_agent: use_target_agent,
            };
            let (target_handle, jump_handle) =
                Self::connect_via_jump(config.clone(), target, jh).await?;
            raw_handle = target_handle;
            transport_handle = Some(Arc::new(jump_handle));
        } else {
            let addr = format!("{}:{}", host, port);
            let mut direct = client::connect(config, addr, ClientHandler::for_host(host, port))
                .await
                .map_err(|e| SessionError::ConnectionFailed(format!("connection failed: {}", e)))?;

            if use_agent {
                let success = authenticate_with_agent(&mut direct, username).await?;
                if !success {
                    return Err(SessionError::AuthenticationFailed(
                        "all SSH agent identities rejected".to_string(),
                    ));
                }
            } else {
                Self::authenticate(&mut direct, username, password, private_key, certificate)
                    .await?;
            }
            raw_handle = direct;
            transport_handle = None;
        }

        let arc_handle = Arc::new(raw_handle);
        let channel = match open_shell_channel(Arc::clone(&arc_handle), cols, rows).await {
            Ok(channel) => channel,
            Err(error) => {
                let _ = arc_handle
                    .disconnect(russh::Disconnect::ByApplication, "", "en")
                    .await;
                if let Some(handle) = transport_handle.as_ref() {
                    let _ = handle
                        .disconnect(russh::Disconnect::ByApplication, "", "en")
                        .await;
                }
                return Err(error);
            }
        };

        // Only publish fully initialized connections to the pool.
        pool.insert(pool_key.clone(), Arc::clone(&arc_handle), transport_handle)
            .await;
        tracing::info!(key = %pool_key, "new SSH connection added to pool");

        let (mut channel_reader, channel_writer) = channel.split();
        let channel_writer = Arc::new(channel_writer);
        let is_alive = Arc::new(AtomicBool::new(true));
        let pool_ref_held = Arc::new(AtomicBool::new(true));

        let (shutdown_tx, _) = broadcast::channel(1);
        let shutdown_rx = shutdown_tx.subscribe();
        let read_handle = Arc::new(Mutex::new(None::<tokio::task::JoinHandle<()>>));

        // 每个 tab 使用唯一 session_id（UUID），pool_key 用于复用底层 TCP 连接
        let session_id = format!("ssh-{}", uuid::Uuid::new_v4());

        let state = Arc::new(Mutex::new(SshSessionState {
            handle: Arc::clone(&arc_handle),
            channel_writer,
            is_alive: Arc::clone(&is_alive),
            shutdown_tx,
            read_handle: read_handle.clone(),
            pool_key: Some(pool_key.clone()),
            pool_ref_held: Arc::clone(&pool_ref_held),
        }));

        let session_id_clone = session_id.clone();
        let app_clone = app.clone();
        let read_handle_clone = read_handle.clone();
        let is_alive_clone = Arc::clone(&is_alive);
        let pool_ref_held_clone = Arc::clone(&pool_ref_held);
        let pool_key_clone = pool_key.clone();

        let _jh = tokio::spawn(async move {
            let mut shutdown_rx = shutdown_rx;

            loop {
                tokio::select! {
                    biased;
                    _ = shutdown_rx.recv() => {
                        let _ = app_clone.emit("ssh-close", &session_id_clone);
                        break;
                    }
                    msg = channel_reader.wait() => {
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
                            None => {
                                let _ = app_clone.emit("ssh-close", &session_id_clone);
                                break;
                            }
                            _ => continue,
                        }
                    }
                }
            }

            is_alive_clone.store(false, Ordering::Release);
            if pool_ref_held_clone.swap(false, Ordering::AcqRel) {
                get_connection_pool().release(pool_key_clone).await;
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
    /// 返回目标主机 handle 和负责承载隧道的跳板机 handle。
    fn connect_via_jump(
        config: Arc<client::Config>,
        target: JumpTarget,
        jump_host: JumpHostConfig,
    ) -> BoxedSshFuture<'static, (client::Handle<ClientHandler>, client::Handle<ClientHandler>)>
    {
        Box::pin(Self::connect_via_jump_inner(config, target, jump_host))
    }

    async fn connect_via_jump_inner(
        config: Arc<client::Config>,
        target: JumpTarget,
        jump_host: JumpHostConfig,
    ) -> Result<(client::Handle<ClientHandler>, client::Handle<ClientHandler>), SessionError> {
        // 第一步：连接到跳板机
        let jump_addr = format!("{}:{}", jump_host.host, jump_host.port);
        let mut jump_handle = client::connect(
            config.clone(),
            jump_addr,
            ClientHandler::for_host(&jump_host.host, jump_host.port),
        )
        .await
        .map_err(|e| {
            SessionError::ConnectionFailed(format!("Jump host connection failed: {}", e))
        })?;

        // 跳板机认证
        let jump_auth: Result<bool, SessionError> = match jump_host.auth_type.as_str() {
            "agent" => {
                let success =
                    authenticate_with_agent(&mut jump_handle, jump_host.username.clone()).await?;
                if success {
                    Ok(true)
                } else {
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
                    match russh::keys::decode_openssh(key.as_bytes(), jump_host.password.as_deref())
                    {
                        Ok(key) => {
                            let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
                            jump_handle
                                .authenticate_publickey(jump_host.username.clone(), key_with_hash)
                                .await
                                .map(|r| r.success())
                                .map_err(|e| {
                                    SessionError::AuthenticationFailed(format!(
                                        "Jump host auth failed: {}",
                                        e
                                    ))
                                })
                        }
                        Err(_) => {
                            if let Some(ref pwd) = jump_host.password {
                                jump_handle
                                    .authenticate_password(jump_host.username.clone(), pwd.clone())
                                    .await
                                    .map(|r| r.success())
                                    .map_err(|e| {
                                        SessionError::AuthenticationFailed(format!(
                                            "Jump host auth failed: {}",
                                            e
                                        ))
                                    })
                            } else {
                                Err(SessionError::AuthenticationFailed(
                                    "Failed to parse jump host key and no password provided"
                                        .to_string(),
                                ))
                            }
                        }
                    }
                } else if let Some(ref pwd) = jump_host.password {
                    jump_handle
                        .authenticate_password(jump_host.username.clone(), pwd.clone())
                        .await
                        .map(|r| r.success())
                        .map_err(|e| {
                            SessionError::AuthenticationFailed(format!(
                                "Jump host auth failed: {}",
                                e
                            ))
                        })
                } else {
                    Err(SessionError::AuthenticationFailed(
                        "No authentication method provided for jump host".to_string(),
                    ))
                }
            }
            _ => {
                // 默认使用密码认证
                if let Some(ref pwd) = jump_host.password {
                    jump_handle
                        .authenticate_password(jump_host.username.clone(), pwd.clone())
                        .await
                        .map(|r| r.success())
                        .map_err(|e| {
                            SessionError::AuthenticationFailed(format!(
                                "Jump host auth failed: {}",
                                e
                            ))
                        })
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
        let target_channel = jump_handle
            .channel_open_direct_tcpip(
                target.host.clone(),
                target.port as u32,
                peer_addr,
                jump_host.port as u32,
            )
            .await
            .map_err(|e| {
                SessionError::ChannelError(format!("Failed to open channel via jump host: {}", e))
            })?;

        // 第三步：把 direct-tcpip channel 当成双向流，在隧道内完成目标主机
        // 自己的 SSH 握手和认证。认证跳板 Handle 只会再次认证跳板机。
        let target_stream = target_channel.into_stream();
        let mut target_handle = client::connect_stream(
            config,
            target_stream,
            ClientHandler::for_host(target.host, target.port),
        )
        .await
        .map_err(|e| {
            SessionError::ConnectionFailed(format!(
                "Target host connection through jump host failed: {}",
                e
            ))
        })?;

        if target.use_agent {
            let success = authenticate_with_agent(&mut target_handle, target.username).await?;
            if !success {
                return Err(SessionError::AuthenticationFailed(
                    "Target host: all SSH agent identities rejected".to_string(),
                ));
            }
        } else {
            Self::authenticate(
                &mut target_handle,
                target.username,
                target.password,
                target.private_key,
                None,
            )
            .await?;
        }

        Ok((target_handle, jump_handle))
    }

    /// 认证处理（不含 agent；agent 由调用方在需要时单独调用 `authenticate_with_agent`）
    fn authenticate<'a>(
        handle: &'a mut client::Handle<ClientHandler>,
        username: String,
        password: Option<String>,
        private_key: Option<String>,
        certificate: Option<String>,
    ) -> BoxedSshFuture<'a, ()> {
        Box::pin(Self::authenticate_inner(
            handle,
            username,
            password,
            private_key,
            certificate,
        ))
    }

    async fn authenticate_inner(
        handle: &mut client::Handle<ClientHandler>,
        username: String,
        password: Option<String>,
        private_key: Option<String>,
        certificate: Option<String>,
    ) -> Result<(), SessionError> {
        // 证书认证优先级最高（用户显式提供证书时使用）
        if let Some(cert_content) = certificate {
            Self::authenticate_with_cert(
                handle,
                username,
                cert_content,
                private_key.unwrap_or_default(),
                password,
            )
            .await?;
            return Ok(());
        }

        // 私钥认证
        if let Some(key_content) = private_key {
            let rsa_hash = handle
                .best_supported_rsa_hash()
                .await
                .map_err(|e| {
                    SessionError::ConnectionFailed(format!("failed to get RSA hash: {}", e))
                })?
                .flatten();
            match russh::keys::decode_openssh(key_content.as_bytes(), password.as_deref()) {
                Ok(key) => {
                    let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
                    let result = handle
                        .authenticate_publickey(username, key_with_hash)
                        .await
                        .map_err(|e| {
                            SessionError::AuthenticationFailed(format!("auth failed: {}", e))
                        })?;
                    if !result.success() {
                        return Err(SessionError::AuthenticationFailed(
                            "all methods rejected".to_string(),
                        ));
                    }
                }
                Err(e) => {
                    if let Some(pwd) = password {
                        let result =
                            handle
                                .authenticate_password(username, pwd)
                                .await
                                .map_err(|e| {
                                    SessionError::AuthenticationFailed(format!(
                                        "auth failed: {}",
                                        e
                                    ))
                                })?;
                        if !result.success() {
                            return Err(SessionError::AuthenticationFailed(
                                "all methods rejected".to_string(),
                            ));
                        }
                    } else {
                        return Err(SessionError::KeyParseFailed(format!(
                            "failed to parse private key: {}",
                            e
                        )));
                    }
                }
            }
            return Ok(());
        }

        // 密码认证
        if let Some(pwd) = password {
            let result = handle
                .authenticate_password(username, pwd)
                .await
                .map_err(|e| SessionError::AuthenticationFailed(format!("auth failed: {}", e)))?;
            if !result.success() {
                return Err(SessionError::AuthenticationFailed(
                    "all methods rejected".to_string(),
                ));
            }
            return Ok(());
        }

        Err(SessionError::AuthenticationFailed(
            "no authentication method provided".to_string(),
        ))
    }

    /// 使用 SSH 证书认证（authenticate_openssh_cert）
    ///
    /// SSH 证书认证需要同时提供私钥（用于签名）和证书（包含公钥和 CA 签名）。
    /// 格式：证书为 OpenSSH 格式（user-cert.pub 内容），私钥为 PEM/OpenSSH 格式。
    fn authenticate_with_cert<'a>(
        handle: &'a mut client::Handle<ClientHandler>,
        username: String,
        cert_content: String,
        private_key_content: String,
        key_password: Option<String>,
    ) -> BoxedSshFuture<'a, ()> {
        Box::pin(Self::authenticate_with_cert_inner(
            handle,
            username,
            cert_content,
            private_key_content,
            key_password,
        ))
    }

    async fn authenticate_with_cert_inner(
        handle: &mut client::Handle<ClientHandler>,
        username: String,
        cert_content: String,
        private_key_content: String,
        key_password: Option<String>,
    ) -> Result<(), SessionError> {
        // 解析 SSH 证书（OpenSSH 格式），使用 russh internal fork 的类型
        let cert = russh::keys::Certificate::from_openssh(&cert_content)
            .map_err(|e| SessionError::CertificateParseFailed(
                format!("failed to parse certificate (expected OpenSSH format, e.g. 'ssh-ed25519-cert-v01@openssh.com AAAA...'): {}", e)
            ))?;

        tracing::info!(
            cert_type = ?cert.cert_type(),
            serial = %cert.serial(),
            "using SSH certificate for authentication"
        );

        // 解析私钥（用于签名）
        let private_key =
            russh::keys::decode_openssh(private_key_content.as_bytes(), key_password.as_deref())
                .map_err(|e| {
                    SessionError::KeyParseFailed(format!(
                        "failed to parse private key for certificate signing: {}",
                        e
                    ))
                })?;

        let result = handle
            .authenticate_openssh_cert(username, std::sync::Arc::new(private_key), cert)
            .await
            .map_err(|e| {
                SessionError::AuthenticationFailed(format!(
                    "certificate authentication failed: {}",
                    e
                ))
            })?;

        if !result.success() {
            return Err(SessionError::AuthenticationFailed(
                "certificate authentication was rejected by server".to_string(),
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
                if !guard.is_alive.load(Ordering::Acquire) {
                    return Err(SessionError::ChannelError("session is closed".to_string()));
                }
                guard.handle.clone()
            };

            // Open exec channel
            let mut channel = handle.channel_open_session().await.map_err(|e| {
                SessionError::ChannelError(format!("failed to open exec channel: {}", e))
            })?;

            // Request exec
            channel
                .exec(true, command.as_bytes())
                .await
                .map_err(|e| SessionError::ExecFailed(format!("exec request failed: {}", e)))?;

            // Read output under one absolute deadline.
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            let mut exit_code: Option<u32> = None;

            let read_result = enforce_exec_timeout(timeout, async {
                loop {
                    match channel.wait().await {
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
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => break,
                        None => break,
                        _ => continue,
                    }
                }
            })
            .await;
            if read_result.is_err() {
                let _ = channel.close().await;
            }
            read_result?;

            let stdout_str = String::from_utf8_lossy(&stdout).to_string();
            let stderr_str = String::from_utf8_lossy(&stderr).to_string();
            let code = exit_code.unwrap_or(1) as i32;

            Ok(ExecResult {
                stdout: stdout_str,
                stderr: stderr_str,
                exit_code: code,
            })
        })
    }

    /// 写入数据
    pub fn write(
        &self,
        data: &str,
    ) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        let data_bytes = bytes::Bytes::copy_from_slice(data.as_bytes());
        let state = self.state.clone();
        Box::pin(async move {
            let channel_writer = {
                let state = state.lock().await;
                if !state.is_alive.load(Ordering::Acquire) {
                    return Err(SessionError::WriteFailed("Session is closed".to_string()));
                }
                Arc::clone(&state.channel_writer)
            };

            channel_writer
                .data(data_bytes.as_ref())
                .await
                .map_err(|e| SessionError::ChannelError(format!("Failed to send data: {:?}", e)))?;

            Ok(())
        })
    }

    /// 调整大小
    pub fn resize(
        &self,
        cols: u16,
        rows: u16,
    ) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        let state = self.state.clone();
        Box::pin(async move {
            let channel_writer = {
                let state = state.lock().await;
                if !state.is_alive.load(Ordering::Acquire) {
                    return Err(SessionError::ResizeFailed("Session is closed".to_string()));
                }
                Arc::clone(&state.channel_writer)
            };

            channel_writer
                .window_change(cols.into(), rows.into(), 0, 0)
                .await
                .map_err(|e| {
                    SessionError::ChannelError(format!("Failed to send resize: {:?}", e))
                })?;

            Ok(())
        })
    }

    /// 关闭会话 - 发送关闭信号并等待任务完成，并释放连接池引用
    pub fn close(self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let state = self.state.clone();
        Box::pin(async move {
            let (pool_key, pool_ref_held, shutdown_tx, is_alive, read_handle, channel_writer) = {
                let s = state.lock().await;
                (
                    s.pool_key.clone(),
                    Arc::clone(&s.pool_ref_held),
                    s.shutdown_tx.clone(),
                    Arc::clone(&s.is_alive),
                    Arc::clone(&s.read_handle),
                    Arc::clone(&s.channel_writer),
                )
            };
            if is_alive.swap(false, Ordering::AcqRel) {
                let _ = channel_writer.close().await;
                let _ = shutdown_tx.send(());
            }
            let read_task = read_handle.lock().await.take();
            // 等待读取任务完成（最多等待 2 秒）
            if let Some(h) = read_task {
                let _ = tokio::time::timeout(tokio::time::Duration::from_secs(2), h).await;
            }
            // 释放连接池引用（如果是最后一个引用，底层连接会被关闭）
            if pool_ref_held.swap(false, Ordering::AcqRel) {
                if let Some(key) = pool_key {
                    get_connection_pool().release(key).await;
                }
            }
        })
    }

    /// 检查会话是否活跃
    pub fn is_alive(&self) -> bool {
        let state = self.state.try_lock();
        match state {
            Ok(s) => s.is_alive.load(Ordering::Acquire),
            Err(_) => false,
        }
    }

    /// 获取 SSH handle 克隆（用于 SFTP / port-forward 等共享连接的场景）。
    /// 返回 None 如果会话已关闭。
    pub fn handle(&self) -> Option<Arc<client::Handle<ClientHandler>>> {
        let state = self.state.try_lock().ok()?;
        if state.is_alive.load(Ordering::Acquire) {
            Some(Arc::clone(&state.handle))
        } else {
            None
        }
    }
}

async fn enforce_exec_timeout<T>(
    timeout: std::time::Duration,
    future: impl Future<Output = T>,
) -> Result<T, SessionError> {
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| SessionError::ExecTimeout)
}

fn validate_jump_auth_types(jump_host: &JumpHostConfig) -> Result<(), SessionError> {
    if jump_host.auth_type == "cert" || jump_host.target_auth_type.as_deref() == Some("cert") {
        return Err(SessionError::InvalidInput(
            "Certificate authentication through a jump host is not supported yet".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_send_static<T: Send + 'static>(_: T) {}

    fn jump_host(host: &str) -> JumpHostConfig {
        JumpHostConfig {
            host: host.to_string(),
            port: 22,
            username: "jump-user".to_string(),
            auth_type: "password".to_string(),
            password: Some("unused".to_string()),
            private_key: None,
            certificate: None,
            target_auth_type: Some("password".to_string()),
        }
    }

    #[test]
    fn jump_pool_key_includes_bastion_identity() {
        let first = jump_host("bastion-a.example");
        let second = jump_host("bastion-b.example");

        let first_key = connection_key("target.example", 22, "target-user", Some(&first));
        let second_key = connection_key("target.example", 22, "target-user", Some(&second));

        assert_ne!(first_key, second_key);
    }

    #[test]
    fn direct_and_jump_pool_keys_cannot_collide() {
        let jump = jump_host("bastion.example");

        let direct = connection_key("target.example", 22, "target-user", None);
        let tunneled = connection_key("target.example", 22, "target-user", Some(&jump));

        assert_ne!(direct, tunneled);
    }

    #[test]
    fn jump_auth_rejects_certificate_until_it_is_supported() {
        for configure in [
            |jump: &mut JumpHostConfig| jump.auth_type = "cert".to_string(),
            |jump: &mut JumpHostConfig| jump.target_auth_type = Some("cert".to_string()),
        ] {
            let mut jump = jump_host("bastion.example");
            configure(&mut jump);

            assert!(matches!(
                validate_jump_auth_types(&jump),
                Err(SessionError::InvalidInput(message))
                    if message == "Certificate authentication through a jump host is not supported yet"
            ));
        }
    }

    #[tokio::test]
    async fn same_connection_key_shares_creation_lock() {
        let pool = Arc::new(SshConnectionPool::new());

        let first = Arc::clone(&pool)
            .creation_lock("same-key".to_string())
            .await;
        let second = pool.creation_lock("same-key".to_string()).await;

        assert!(Arc::ptr_eq(&first, &second));
    }

    #[tokio::test]
    async fn different_connection_keys_use_independent_creation_locks() {
        let pool = Arc::new(SshConnectionPool::new());

        let first = Arc::clone(&pool)
            .creation_lock("first-key".to_string())
            .await;
        let second = pool.creation_lock("second-key".to_string()).await;

        assert!(!Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn connection_pool_future_owns_shared_state() {
        let pool = Arc::new(SshConnectionPool::new());

        assert_send_static(Arc::clone(&pool).creation_lock("compile-creation-lock".to_string()));
        assert_send_static(Arc::clone(&pool).get("compile-get".to_string()));
        assert_send_static(pool.release("compile-release".to_string()));
    }

    #[tokio::test]
    async fn sustained_output_cannot_extend_exec_deadline() {
        let active = async {
            for _ in 0..10 {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        };

        assert!(matches!(
            enforce_exec_timeout(std::time::Duration::from_millis(25), active).await,
            Err(SessionError::ExecTimeout)
        ));
    }
}
