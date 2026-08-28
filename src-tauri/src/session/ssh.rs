//! SSH Session 实现 - SSH 远程会话
//!
//! 使用 russh 实现 SSH 会话，支持直接连接和通过 Jump Host 连接。
//! 交互终端默认使用独立 SSH transport，避免一个慢 channel 阻塞其他 tab。

use super::lifecycle::{SessionCompletion, SessionLifecycle};
use super::ssh_channel::configure_shell_channel;
use super::ssh_writer::{
    spawn_ssh_writer, SshWriterCompletion, SshWriterHandle, SshWriterTimeouts,
    SSH_WRITER_QUEUE_CAPACITY,
};
use super::terminal_output::{emit_terminal_error, spawn_session_output_pump, TerminalOutputChunk};
use super::types::{
    validate_terminal_size, ExecResult, JumpHostConfig, SessionError, SessionType, TerminalProfile,
};
use futures::task::AtomicWaker;
use russh::client;
use russh::keys::{PrivateKeyWithHashAlg, PublicKey};
use russh::{Channel, ChannelMsg, ChannelWriteHalf};
use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::{broadcast, Mutex};

use crate::state::ClientHandler;

/// SSH sessions storage for SFTP and port forwarding
type SshSessions = Arc<Mutex<HashMap<String, Arc<client::Handle<ClientHandler>>>>>;
/// Erases nested russh futures so Tauri commands stay `Send` on every target.
type BoxedSshFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, SessionError>> + Send + 'a>>;

const SSH_CHANNEL_OPEN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const SSH_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);
const SSH_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const SSH_AUTH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const SSH_WRITE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
const SSH_RESIZE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);

/// Decode a user-supplied private-key document in the format accepted by the
/// key-management UI (OpenSSH PEM, legacy PEM/PKCS8, or PuTTY PPK).
///
/// `decode_openssh` is intentionally not used here: that lower-level API
/// expects an already Base64-decoded binary blob, while callers provide the
/// complete text document.
fn decode_private_key(
    private_key: &str,
    password: Option<&str>,
) -> Result<russh::keys::PrivateKey, russh::keys::Error> {
    russh::keys::decode_secret_key(private_key, password)
}

trait PendingSshConnection: Sized {
    fn disconnect_and_wait(self, reason: &'static str) -> impl Future<Output = ()> + Send;
}

impl PendingSshConnection for client::Handle<ClientHandler> {
    async fn disconnect_and_wait(mut self, reason: &'static str) {
        match tokio::time::timeout(
            SSH_WRITE_TIMEOUT,
            self.disconnect(russh::Disconnect::ByApplication, reason, "en"),
        )
        .await
        {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                tracing::warn!(%error, %reason, "failed to request pending SSH disconnect");
            }
            Err(_) => tracing::warn!(%reason, "pending SSH disconnect request timed out"),
        }

        match tokio::time::timeout(SSH_WRITE_TIMEOUT, &mut self).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                tracing::debug!(%error, %reason, "pending SSH session stopped with an error");
            }
            Err(_) => {
                tracing::warn!(%reason, "pending SSH session did not stop before deadline");
            }
        }
    }
}

async fn cleanup_pending_jump_connections<H: PendingSshConnection>(
    target: Option<H>,
    jump: H,
    reason: &'static str,
) {
    if let Some(target) = target {
        target.disconnect_and_wait(reason).await;
    }
    jump.disconnect_and_wait(reason).await;
}

pub(crate) struct TcpShutdownGuard {
    socket: Option<std::net::TcpStream>,
}

impl TcpShutdownGuard {
    fn new(socket: std::net::TcpStream) -> Self {
        Self {
            socket: Some(socket),
        }
    }

    pub(crate) fn shutdown(&self) -> std::io::Result<()> {
        match &self.socket {
            Some(socket) => socket.shutdown(std::net::Shutdown::Both),
            None => Ok(()),
        }
    }

    pub(crate) fn disarm(&mut self) {
        self.socket.take();
    }
}

struct StreamCancellation {
    cancelled: AtomicBool,
    read_waker: AtomicWaker,
    write_waker: AtomicWaker,
}

#[derive(Clone)]
struct StreamAbortHandle {
    state: Arc<StreamCancellation>,
}

impl StreamAbortHandle {
    fn abort(&self) {
        self.state.cancelled.store(true, Ordering::Release);
        self.state.read_waker.wake();
        self.state.write_waker.wake();
    }
}

struct AbortableStream<S> {
    stream: S,
    state: Arc<StreamCancellation>,
}

fn abortable_stream<S>(stream: S) -> (AbortableStream<S>, StreamAbortHandle) {
    let state = Arc::new(StreamCancellation {
        cancelled: AtomicBool::new(false),
        read_waker: AtomicWaker::new(),
        write_waker: AtomicWaker::new(),
    });
    (
        AbortableStream {
            stream,
            state: Arc::clone(&state),
        },
        StreamAbortHandle { state },
    )
}

fn stream_cancelled_error() -> io::Error {
    io::Error::new(
        io::ErrorKind::ConnectionAborted,
        "SSH stream handshake cancelled",
    )
}

impl<S: AsyncRead + Unpin> AsyncRead for AbortableStream<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.state.cancelled.load(Ordering::Acquire) {
            return Poll::Ready(Err(stream_cancelled_error()));
        }
        self.state.read_waker.register(cx.waker());
        if self.state.cancelled.load(Ordering::Acquire) {
            return Poll::Ready(Err(stream_cancelled_error()));
        }
        Pin::new(&mut self.stream).poll_read(cx, buffer)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for AbortableStream<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.state.cancelled.load(Ordering::Acquire) {
            return Poll::Ready(Err(stream_cancelled_error()));
        }
        self.state.write_waker.register(cx.waker());
        if self.state.cancelled.load(Ordering::Acquire) {
            return Poll::Ready(Err(stream_cancelled_error()));
        }
        Pin::new(&mut self.stream).poll_write(cx, buffer)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.state.cancelled.load(Ordering::Acquire) {
            return Poll::Ready(Err(stream_cancelled_error()));
        }
        self.state.write_waker.register(cx.waker());
        if self.state.cancelled.load(Ordering::Acquire) {
            return Poll::Ready(Err(stream_cancelled_error()));
        }
        Pin::new(&mut self.stream).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.state.cancelled.load(Ordering::Acquire) {
            return Poll::Ready(Err(stream_cancelled_error()));
        }
        self.state.write_waker.register(cx.waker());
        if self.state.cancelled.load(Ordering::Acquire) {
            return Poll::Ready(Err(stream_cancelled_error()));
        }
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

impl Drop for TcpShutdownGuard {
    fn drop(&mut self) {
        if let Some(socket) = &self.socket {
            let _ = socket.shutdown(std::net::Shutdown::Both);
        }
    }
}

fn connection_timeout_error(timeout: std::time::Duration, operation: &'static str) -> SessionError {
    SessionError::ConnectionFailed(format!(
        "{operation} timed out after {} ms",
        timeout.as_millis()
    ))
}

fn connection_failure_error(
    operation: &'static str,
    error: impl std::fmt::Display,
) -> SessionError {
    SessionError::ConnectionFailed(format!("{operation} failed: {error}"))
}

pub(crate) async fn connect_tcp_with_timeout<H, A>(
    config: Arc<client::Config>,
    address: A,
    handler: H,
    timeout: std::time::Duration,
    operation: &'static str,
) -> Result<client::Handle<H>, SessionError>
where
    H: client::Handler + Send + 'static,
    H::Error: std::fmt::Display,
    A: tokio::net::ToSocketAddrs + Send,
{
    let (handle, mut shutdown_guard) =
        connect_tcp_with_shutdown(config, address, handler, timeout, operation).await?;
    shutdown_guard.disarm();
    Ok(handle)
}

pub(crate) async fn connect_tcp_with_shutdown<H, A>(
    config: Arc<client::Config>,
    address: A,
    handler: H,
    timeout: std::time::Duration,
    operation: &'static str,
) -> Result<(client::Handle<H>, TcpShutdownGuard), SessionError>
where
    H: client::Handler + Send + 'static,
    H::Error: std::fmt::Display,
    A: tokio::net::ToSocketAddrs + Send,
{
    let deadline = tokio::time::Instant::now() + timeout;
    let socket = tokio::time::timeout_at(deadline, tokio::net::TcpStream::connect(address))
        .await
        .map_err(|_| connection_timeout_error(timeout, operation))?
        .map_err(|error| connection_failure_error(operation, error))?;
    if config.nodelay {
        socket
            .set_nodelay(true)
            .map_err(|error| connection_failure_error(operation, error))?;
    }

    let socket = socket
        .into_std()
        .map_err(|error| connection_failure_error(operation, error))?;
    let shutdown_socket = socket
        .try_clone()
        .map_err(|error| connection_failure_error(operation, error))?;
    let socket = tokio::net::TcpStream::from_std(socket)
        .map_err(|error| connection_failure_error(operation, error))?;
    let shutdown_guard = TcpShutdownGuard::new(shutdown_socket);
    let connection = client::connect_stream(config, socket, handler);
    tokio::pin!(connection);

    match tokio::time::timeout_at(deadline, &mut connection).await {
        Ok(Ok(handle)) => Ok((handle, shutdown_guard)),
        Ok(Err(error)) => Err(connection_failure_error(operation, error)),
        Err(_) => {
            if let Err(error) = shutdown_guard.shutdown() {
                tracing::warn!(%error, %operation, "failed to interrupt timed-out SSH handshake");
            }

            if let Ok(mut handle) = (&mut connection).await {
                if let Err(error) = (&mut handle).await {
                    tracing::debug!(%error, %operation, "timed-out SSH session stopped");
                }
            }
            Err(connection_timeout_error(timeout, operation))
        }
    }
}

pub(crate) async fn connect_stream_with_timeout<H, S>(
    config: Arc<client::Config>,
    stream: S,
    handler: H,
    timeout: std::time::Duration,
    operation: &'static str,
    transport: Option<&TcpShutdownGuard>,
) -> Result<client::Handle<H>, SessionError>
where
    H: client::Handler + Send + 'static,
    H::Error: std::fmt::Display,
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (stream, abort_handle) = abortable_stream(stream);
    let connection = client::connect_stream(config, stream, handler);
    tokio::pin!(connection);

    match tokio::time::timeout(timeout, &mut connection).await {
        Ok(Ok(handle)) => Ok(handle),
        Ok(Err(error)) => Err(connection_failure_error(operation, error)),
        Err(_) => {
            if let Some(transport) = transport {
                if let Err(error) = transport.shutdown() {
                    tracing::debug!(%error, %operation, "failed to interrupt SSH jump transport");
                }
            }
            abort_handle.abort();
            if let Ok(mut handle) = (&mut connection).await {
                if let Err(error) = (&mut handle).await {
                    tracing::debug!(%error, %operation, "timed-out SSH stream session stopped");
                }
            }
            Err(connection_timeout_error(timeout, operation))
        }
    }
}

pub(crate) async fn disconnect_and_wait_with_shutdown<H>(
    mut handle: client::Handle<H>,
    mut transport: TcpShutdownGuard,
    reason: &'static str,
) where
    H: client::Handler,
    H::Error: std::fmt::Display,
{
    let _ = tokio::time::timeout(
        SSH_WRITE_TIMEOUT,
        handle.disconnect(russh::Disconnect::ByApplication, reason, "en"),
    )
    .await;
    let join = async {
        if let Err(error) = (&mut handle).await {
            tracing::debug!(%error, %reason, "SSH session stopped during cleanup");
        }
    };
    tokio::pin!(join);
    if tokio::time::timeout(SSH_WRITE_TIMEOUT, &mut join)
        .await
        .is_ok()
    {
        transport.disarm();
        return;
    }
    if let Err(error) = transport.shutdown() {
        tracing::warn!(%error, %reason, "failed to interrupt SSH transport during cleanup");
    }
    join.await;
}

pub(crate) async fn disconnect_jump_connections_with_shutdown<H>(
    mut target: client::Handle<H>,
    mut jump: client::Handle<ClientHandler>,
    mut transport: TcpShutdownGuard,
    reason: &'static str,
) where
    H: client::Handler,
    H::Error: std::fmt::Display,
{
    let _ = tokio::time::timeout(
        SSH_WRITE_TIMEOUT,
        target.disconnect(russh::Disconnect::ByApplication, reason, "en"),
    )
    .await;
    let _ = tokio::time::timeout(
        SSH_WRITE_TIMEOUT,
        jump.disconnect(russh::Disconnect::ByApplication, reason, "en"),
    )
    .await;

    let join = async {
        let (target_result, jump_result) = tokio::join!(&mut target, &mut jump);
        if let Err(error) = target_result {
            tracing::debug!(%error, %reason, "target SSH session stopped during cleanup");
        }
        if let Err(error) = jump_result {
            tracing::debug!(%error, %reason, "jump SSH session stopped during cleanup");
        }
    };
    tokio::pin!(join);
    if tokio::time::timeout(SSH_WRITE_TIMEOUT, &mut join)
        .await
        .is_ok()
    {
        transport.disarm();
        return;
    }
    if let Err(error) = transport.shutdown() {
        tracing::warn!(%error, %reason, "failed to interrupt SSH jump transport during cleanup");
    }
    join.await;
}

fn interactive_ssh_config() -> client::Config {
    client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
        keepalive_interval: Some(std::time::Duration::from_secs(30)),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    }
}

fn parse_expected_host_key(value: Option<String>) -> Result<Option<PublicKey>, SessionError> {
    value
        .map(|value| {
            let value = value.trim();
            if value.is_empty() {
                return Err(SessionError::InvalidInput(
                    "Expected host key cannot be empty".to_string(),
                ));
            }
            let mut public_key = PublicKey::from_openssh(value).map_err(|error| {
                SessionError::KeyParseFailed(format!("failed to parse expected host key: {error}"))
            })?;
            public_key.set_comment("");
            Ok(public_key)
        })
        .transpose()
}

fn client_handler(
    host: String,
    port: u16,
    expected_host_key: Option<PublicKey>,
    allow_agent_forwarding: bool,
) -> ClientHandler {
    match expected_host_key {
        Some(public_key) => ClientHandler::for_host_with_expected_key(
            host,
            port,
            public_key,
            allow_agent_forwarding,
        ),
        None => ClientHandler::for_host_with_agent_forwarding(host, port, allow_agent_forwarding),
    }
}

/// Global SSH sessions storage
static SSH_SESSIONS: std::sync::OnceLock<SshSessions> = std::sync::OnceLock::new();

/// Get the global SSH sessions registry
pub fn get_ssh_sessions() -> SshSessions {
    SSH_SESSIONS
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

// ============================================================================
/// Owns interactive SSH transports until their terminal session closes.
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::RwLock;

/// One physical SSH connection owned by one interactive terminal session.
struct PooledConnection {
    /// Shared SSH handle (Arc so SshSession can clone it for new channels)
    handle: Arc<client::Handle<ClientHandler>>,
    /// Jump-host transport that owns the direct-tcpip stream, when applicable.
    transport_handle: Option<Arc<client::Handle<ClientHandler>>>,
}

impl PooledConnection {
    fn new(
        handle: Arc<client::Handle<ClientHandler>>,
        transport_handle: Option<Arc<client::Handle<ClientHandler>>>,
    ) -> Self {
        Self {
            handle,
            transport_handle,
        }
    }
}

/// The connection pool
pub struct SshConnectionPool {
    /// Unique terminal session key -> owned transport.
    inner: RwLock<HashMap<String, PooledConnection>>,
}

impl SshConnectionPool {
    fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
        }
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

    /// Close and unregister the transport owned by this terminal session.
    async fn release(self: Arc<Self>, key: String) {
        let handles = {
            let mut pool = self.inner.write().await;
            pool.remove(&key)
                .map(|connection| (connection.handle, connection.transport_handle))
        };

        let sessions = get_ssh_sessions();
        sessions.lock().await.remove(&key);

        if let Some((handle, transport_handle)) = handles {
            let _ = tokio::time::timeout(
                SSH_WRITE_TIMEOUT,
                handle.disconnect(russh::Disconnect::ByApplication, "", "en"),
            )
            .await;
            if let Some(transport_handle) = transport_handle {
                let _ = tokio::time::timeout(
                    SSH_WRITE_TIMEOUT,
                    transport_handle.disconnect(russh::Disconnect::ByApplication, "", "en"),
                )
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

pub(crate) async fn ssh_resource_keys() -> (Vec<String>, Vec<String>) {
    let pool = match SSH_CONNECTION_POOL.get() {
        Some(pool) => pool.inner.read().await.keys().cloned().collect(),
        None => Vec::new(),
    };
    let registry = match SSH_SESSIONS.get() {
        Some(sessions) => sessions.lock().await.keys().cloned().collect(),
        None => Vec::new(),
    };
    (pool, registry)
}

fn spawn_connection_pool_release(
    pool: Arc<SshConnectionPool>,
    key: String,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(pool.release(key))
}

async fn release_connection_pool_entry(key: String) {
    let release_key = key.clone();
    if let Err(error) = spawn_connection_pool_release(get_connection_pool(), key).await {
        tracing::warn!(key = %release_key, %error, "SSH connection pool release task failed");
    }
}

/// Connection key for the pool. Jump connections include the bastion identity so
/// sessions using different tunnels can never share the wrong transport.
fn connection_key(
    session_id: &str,
    host: &str,
    port: u16,
    username: &str,
    jump_host: Option<&JumpHostConfig>,
    agent_forwarding: bool,
) -> String {
    let forwarding = if agent_forwarding { "forward" } else { "deny" };
    match jump_host {
        Some(jump) => format!(
            "terminal:{session_id}:jump:{}@{}:{}=>{}@{}:{}:{forwarding}",
            jump.username, jump.host, jump.port, username, host, port,
        ),
        None => format!("terminal:{session_id}:{username}@{host}:{port}:{forwarding}"),
    }
}

fn into_owned_agent_public_key(
    identity: russh::keys::agent::AgentIdentity,
) -> russh::keys::PublicKey {
    identity.public_key().into_owned()
}

type DynamicAgentClient = russh::keys::agent::client::AgentClient<
    Box<dyn russh::keys::agent::client::AgentStream + Send + Unpin + 'static>,
>;

/// Keeps russh's borrowed sign-request identity out of the returned future.
struct OwnedIdentityAgentSigner(DynamicAgentClient);

impl russh::Signer for OwnedIdentityAgentSigner {
    type Error = russh::AgentAuthError;

    #[allow(clippy::manual_async_fn)]
    fn auth_sign(
        &mut self,
        identity: &russh::keys::agent::AgentIdentity,
        hash_alg: Option<russh::keys::HashAlg>,
        to_sign: Vec<u8>,
    ) -> impl Future<Output = Result<Vec<u8>, Self::Error>> + Send {
        let identity = identity.clone();
        async move {
            self.0
                .sign_request(&identity, hash_alg, to_sign)
                .await
                .map_err(Into::into)
        }
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

        let agent = AgentClient::connect_env().await.map_err(|e| {
            SessionError::AuthenticationFailed(format!("failed to connect SSH agent: {}", e))
        })?;
        let mut agent = OwnedIdentityAgentSigner(agent.dynamic());
        let identities = agent.0.request_identities().await.map_err(|e| {
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
            let public_key = into_owned_agent_public_key(identity);
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

        let agent = if let Some(pipe) = explicit_pipe {
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

        let mut agent = OwnedIdentityAgentSigner(agent);
        let identities = agent.0.request_identities().await.map_err(|e| {
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
            let public_key = into_owned_agent_public_key(identity);
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
    /// Bounded single-writer command queue for all shell channel mutations.
    writer: SshWriterHandle,
    /// Writer task, joined during explicit close.
    writer_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    /// 是否存活
    is_alive: Arc<AtomicBool>,
    /// 关闭信号发送端
    shutdown_tx: broadcast::Sender<()>,
    /// 读取任务的 JoinHandle
    read_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    /// 连接池 key（用于复用时释放引用）
    pool_key: Option<String>,
}

fn start_ssh_writer(
    channel_writer: ChannelWriteHalf<client::Msg>,
) -> (
    SshWriterHandle,
    Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
) {
    let timeouts = SshWriterTimeouts {
        write: SSH_WRITE_TIMEOUT,
        resize: SSH_RESIZE_TIMEOUT,
        close: SSH_WRITE_TIMEOUT,
    };
    let (writer, task) = spawn_ssh_writer(channel_writer, SSH_WRITER_QUEUE_CAPACITY, timeouts);
    (writer, Arc::new(Mutex::new(Some(task))))
}

async fn close_ssh_writer(
    is_alive: &AtomicBool,
    writer: &SshWriterHandle,
    writer_handle: &Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
) {
    is_alive.store(false, Ordering::Release);
    let mut writer_task = writer_handle.lock().await;
    let Some(mut task) = writer_task.take() else {
        return;
    };

    if writer.is_running() {
        if let Err(error) = writer.close().await {
            tracing::warn!(%error, "failed to close SSH terminal channel cleanly");
        }
    }
    if tokio::time::timeout(SSH_WRITE_TIMEOUT, &mut task)
        .await
        .is_err()
    {
        tracing::warn!("SSH terminal writer task did not stop before the close deadline");
        task.abort();
        let _ = task.await;
    }
}

/// SSH Session - SSH 远程会话
#[derive(Clone)]
pub struct SshSession {
    /// Session ID
    session_id: String,
    /// 内部状态
    state: Arc<Mutex<SshSessionState>>,
    /// 保留最终完成状态，覆盖远端关闭早于 manager 注册的竞态。
    lifecycle: SessionLifecycle,
}

struct JumpTarget {
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    certificate: Option<String>,
    expected_host_key: Option<PublicKey>,
    use_agent: bool,
    allow_agent_forwarding: bool,
}

fn open_shell_channel<'a>(
    handle: &'a client::Handle<ClientHandler>,
    cols: u16,
    rows: u16,
    agent_forwarding: bool,
    profile: &'a TerminalProfile,
) -> BoxedSshFuture<'a, russh::Channel<client::Msg>> {
    Box::pin(open_shell_channel_inner(
        handle,
        cols,
        rows,
        agent_forwarding,
        profile,
    ))
}

async fn open_shell_channel_inner(
    handle: &client::Handle<ClientHandler>,
    cols: u16,
    rows: u16,
    agent_forwarding: bool,
    profile: &TerminalProfile,
) -> Result<russh::Channel<client::Msg>, SessionError> {
    let mut channel = enforce_ssh_operation_timeout(
        SSH_CHANNEL_OPEN_TIMEOUT,
        "open SSH terminal channel",
        handle.channel_open_session(),
    )
    .await?;

    configure_shell_channel(
        &mut channel,
        cols,
        rows,
        agent_forwarding,
        &profile.environment,
        SSH_REQUEST_TIMEOUT,
    )
    .await?;

    Ok(channel)
}

async fn run_terminal_output_reader(
    mut channel_reader: russh::ChannelReadHalf,
    mut shutdown_rx: broadcast::Receiver<()>,
    writer_completion: SshWriterCompletion,
    is_alive: Arc<AtomicBool>,
    app: AppHandle,
    session_id: String,
) {
    let (output_tx, mut output_handle) =
        spawn_session_output_pump(app.clone(), session_id.clone(), "ssh-data");
    let mut exit_status = None;
    let mut output_result = None;
    let mut writer_error = None;
    let writer_completion = writer_completion.wait();
    tokio::pin!(writer_completion);

    loop {
        tokio::select! {
            biased;
            _ = shutdown_rx.recv() => break,
            result = &mut writer_completion => {
                writer_error = apply_writer_completion(&is_alive, result);
                break;
            }
            result = &mut output_handle => {
                output_result = Some(result);
                break;
            }
            message = channel_reader.wait() => {
                let output = match message {
                    Some(ChannelMsg::Data { data }) => {
                        Some(TerminalOutputChunk::new(&data, false))
                    }
                    Some(ChannelMsg::ExtendedData { data, ext }) => {
                        Some(TerminalOutputChunk::new(&data, ext == 1))
                    }
                    Some(ChannelMsg::ExitStatus { exit_status: status }) => {
                        exit_status = Some(status);
                        None
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => None,
                };
                if let Some(output) = output {
                    if output_tx.send(output).await.is_err() {
                        tracing::error!(
                            session_id = %session_id,
                            "SSH terminal output pump stopped before the channel reader",
                        );
                        break;
                    }
                }
            }
        }
    }

    drop(output_tx);
    let output_result = match output_result {
        Some(result) => result,
        None => output_handle.await,
    };
    match output_result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            tracing::error!(session_id = %session_id, %error, "SSH terminal output pump failed");
            emit_terminal_error(&app, &session_id, error);
        }
        Err(error) => {
            tracing::error!(session_id = %session_id, %error, "SSH terminal output pump task failed");
            emit_terminal_error(
                &app,
                &session_id,
                format!("terminal output task failed: {error}"),
            );
        }
    }
    if let Some(error) = writer_error {
        tracing::error!(session_id = %session_id, %error, "SSH terminal writer failed");
        emit_terminal_error(&app, &session_id, error);
    }
    if let Some(status) = exit_status {
        let _ = app.emit("ssh-exit", (&session_id, status));
    }
    let _ = app.emit("ssh-close", &session_id);
}

fn apply_writer_completion(
    is_alive: &AtomicBool,
    result: Result<(), SessionError>,
) -> Option<String> {
    is_alive.store(false, Ordering::Release);
    result
        .err()
        .map(|error| format!("SSH terminal writer failed: {error}"))
}

impl SshSession {
    /// 创建新的 SSH Session（密码认证）
    #[allow(clippy::too_many_arguments)]
    pub fn new_with_password(
        app: AppHandle,
        host: String,
        port: u16,
        username: String,
        password: String,
        expected_host_key: Option<String>,
        agent_forwarding: bool,
        cols: u16,
        rows: u16,
        profile: Option<TerminalProfile>,
    ) -> BoxedSshFuture<'static, Self> {
        Box::pin(Self::create(
            app,
            host,
            port,
            username,
            Some(password),
            None,
            None, // certificate
            expected_host_key,
            false, // use_agent
            None,  // no jump host
            false, // use_target_agent
            agent_forwarding,
            cols,
            rows,
            profile,
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
        expected_host_key: Option<String>,
        agent_forwarding: bool,
        cols: u16,
        rows: u16,
        profile: Option<TerminalProfile>,
    ) -> BoxedSshFuture<'static, Self> {
        Box::pin(Self::create(
            app,
            host,
            port,
            username,
            password,
            Some(private_key),
            None, // certificate
            expected_host_key,
            false, // use_agent
            None,  // no jump host
            false, // use_target_agent
            agent_forwarding,
            cols,
            rows,
            profile,
        ))
    }

    /// 创建新的 SSH Session（证书认证）
    ///
    /// 证书认证需要同时提供私钥（用于签名）和 SSH 证书（OpenSSH 格式）。
    /// 私钥格式：PEM 或 OpenSSH 格式。
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
        expected_host_key: Option<String>,
        agent_forwarding: bool,
        cols: u16,
        rows: u16,
        profile: Option<TerminalProfile>,
    ) -> BoxedSshFuture<'static, Self> {
        Box::pin(Self::create(
            app,
            host,
            port,
            username,
            key_password,      // password (for key encryption)
            Some(private_key), // private_key
            Some(certificate), // certificate
            expected_host_key,
            false, // use_agent
            None,  // no jump host
            false, // use_target_agent
            agent_forwarding,
            cols,
            rows,
            profile,
        ))
    }

    /// 创建新的 SSH Session（Agent 认证）
    #[allow(clippy::too_many_arguments)]
    pub fn new_with_agent(
        app: AppHandle,
        host: String,
        port: u16,
        username: String,
        expected_host_key: Option<String>,
        agent_forwarding: bool,
        cols: u16,
        rows: u16,
        profile: Option<TerminalProfile>,
    ) -> BoxedSshFuture<'static, Self> {
        Box::pin(Self::create(
            app,
            host,
            port,
            username,
            None, // password
            None, // private_key
            None, // certificate
            expected_host_key,
            true,  // use_agent
            None,  // no jump host
            false, // use_target_agent
            agent_forwarding,
            cols,
            rows,
            profile,
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
        target_certificate: Option<String>,
        jump_host: JumpHostConfig,
        expected_host_key: Option<String>,
        agent_forwarding: bool,
        cols: u16,
        rows: u16,
        profile: Option<TerminalProfile>,
    ) -> BoxedSshFuture<'static, Self> {
        Box::pin(Self::new_with_jump_inner(
            app,
            target_host,
            target_port,
            target_username,
            target_password,
            target_key,
            target_certificate,
            jump_host,
            expected_host_key,
            agent_forwarding,
            cols,
            rows,
            profile,
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
        target_certificate: Option<String>,
        jump_host: JumpHostConfig,
        expected_host_key: Option<String>,
        agent_forwarding: bool,
        cols: u16,
        rows: u16,
        profile: Option<TerminalProfile>,
    ) -> Result<Self, SessionError> {
        validate_jump_auth_config(
            &jump_host,
            target_key.as_deref(),
            target_certificate.as_deref(),
        )?;
        // 根据 jump_host.target_auth_type 决定是否对目标主机使用 SSH agent 认证
        let use_target_agent = jump_host.target_auth_type.as_deref() == Some("agent");
        Self::create(
            app,
            target_host,
            target_port,
            target_username,
            target_password,
            target_key,
            target_certificate,
            expected_host_key,
            false, // use_agent for jump host itself
            Some(jump_host),
            use_target_agent,
            agent_forwarding,
            cols,
            rows,
            profile,
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
        expected_host_key: Option<String>,
        use_agent: bool,
        jump_host: Option<JumpHostConfig>,
        use_target_agent: bool,
        agent_forwarding: bool,
        cols: u16,
        rows: u16,
        profile: Option<TerminalProfile>,
    ) -> Result<Self, SessionError> {
        // 验证输入
        validate_terminal_size(cols, rows)?;
        let profile = profile.unwrap_or_default();
        profile.validate()?;
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
        let expected_host_key = parse_expected_host_key(expected_host_key)?;

        // 构建 SSH 配置
        let config = Arc::new(interactive_ssh_config());

        // Each interactive tab owns a physical SSH transport. A stalled output
        // consumer can therefore close only its own connection.
        let session_id = format!("ssh-{}", uuid::Uuid::new_v4());
        let pool = get_connection_pool();
        let pool_key = connection_key(
            &session_id,
            &host,
            port,
            &username,
            jump_host.as_ref(),
            agent_forwarding,
        );

        let raw_handle: client::Handle<ClientHandler>;
        let transport_handle: Option<client::Handle<ClientHandler>>;

        if let Some(jh) = jump_host {
            let target = JumpTarget {
                host,
                port,
                username,
                password,
                private_key,
                certificate,
                expected_host_key,
                use_agent: use_target_agent,
                allow_agent_forwarding: agent_forwarding,
            };
            let (target_handle, jump_handle) =
                Self::connect_via_jump(config.clone(), target, jh).await?;
            raw_handle = target_handle;
            transport_handle = Some(jump_handle);
        } else {
            let addr = format!("{}:{}", host, port);
            let handler = client_handler(host, port, expected_host_key, agent_forwarding);
            let mut direct = connect_tcp_with_timeout(
                config,
                addr,
                handler,
                SSH_CONNECT_TIMEOUT,
                "connect SSH server",
            )
            .await?;

            let authentication = if use_agent {
                enforce_authentication_timeout(
                    SSH_AUTH_TIMEOUT,
                    "authenticate SSH agent",
                    authenticate_with_agent(&mut direct, username),
                )
                .await
                .and_then(|success| {
                    success.then_some(()).ok_or_else(|| {
                        SessionError::AuthenticationFailed(
                            "all SSH agent identities rejected".to_string(),
                        )
                    })
                })
            } else {
                enforce_authentication_timeout(
                    SSH_AUTH_TIMEOUT,
                    "authenticate SSH user",
                    Self::authenticate(&mut direct, username, password, private_key, certificate),
                )
                .await
            };
            if let Err(error) = authentication {
                direct
                    .disconnect_and_wait("direct SSH authentication failed")
                    .await;
                return Err(error);
            }
            raw_handle = direct;
            transport_handle = None;
        }

        let channel =
            match open_shell_channel(&raw_handle, cols, rows, agent_forwarding, &profile).await {
                Ok(channel) => channel,
                Err(error) => {
                    if let Some(jump_handle) = transport_handle {
                        cleanup_pending_jump_connections(
                            Some(raw_handle),
                            jump_handle,
                            "open SSH terminal shell failed",
                        )
                        .await;
                    } else {
                        raw_handle
                            .disconnect_and_wait("open SSH terminal shell failed")
                            .await;
                    }
                    return Err(error);
                }
            };

        let arc_handle = Arc::new(raw_handle);
        let transport_handle = transport_handle.map(Arc::new);

        // Publish only after PTY/agent/shell were confirmed by the server.
        pool.insert(pool_key.clone(), Arc::clone(&arc_handle), transport_handle)
            .await;
        tracing::info!(key = %pool_key, "interactive SSH transport registered");

        let (channel_reader, channel_writer) = channel.split();
        let (writer, writer_handle) = start_ssh_writer(channel_writer);
        if let Some(command) = profile.startup_command.as_deref() {
            let mut data = command.as_bytes().to_vec();
            if !data.ends_with(b"\n") {
                data.push(b'\n');
            }
            if let Err(error) = writer.write(data).await {
                tracing::warn!(%error, "SSH startup command failed");
            }
        }
        let is_alive = Arc::new(AtomicBool::new(true));

        let (shutdown_tx, _) = broadcast::channel(1);
        let shutdown_rx = shutdown_tx.subscribe();
        let read_handle = Arc::new(Mutex::new(None::<tokio::task::JoinHandle<()>>));
        let lifecycle = SessionLifecycle::new();

        let state = Arc::new(Mutex::new(SshSessionState {
            handle: Arc::clone(&arc_handle),
            writer: writer.clone(),
            writer_handle: Arc::clone(&writer_handle),
            is_alive: Arc::clone(&is_alive),
            shutdown_tx,
            read_handle: read_handle.clone(),
            pool_key: Some(pool_key.clone()),
        }));

        let session_id_clone = session_id.clone();
        let app_clone = app.clone();
        let is_alive_clone = Arc::clone(&is_alive);
        let pool_key_clone = pool_key.clone();
        let lifecycle_clone = lifecycle.clone();
        let writer_clone = writer.clone();
        let writer_completion = writer.completion();
        let writer_handle_clone = Arc::clone(&writer_handle);

        let _jh = tokio::spawn(async move {
            run_terminal_output_reader(
                channel_reader,
                shutdown_rx,
                writer_completion,
                Arc::clone(&is_alive_clone),
                app_clone,
                session_id_clone,
            )
            .await;

            close_ssh_writer(&is_alive_clone, &writer_clone, &writer_handle_clone).await;
            release_connection_pool_entry(pool_key_clone).await;
            lifecycle_clone.complete();
        });

        {
            let mut guard = read_handle.lock().await;
            *guard = Some(_jh);
        }

        Ok(Self {
            session_id,
            state,
            lifecycle,
        })
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
        // 第一步：验证并认证跳板机。主会话与 TOFU 隧道探测共用此路径，
        // 避免 password/key/agent/cert 语义随时间漂移。
        let (jump_handle, mut jump_shutdown) =
            connect_authenticated_jump_host_with_shutdown(config.clone(), &jump_host).await?;

        // 第二步：通过跳板机打开到目标主机的 direct-tcpip channel
        let target_channel =
            match open_jump_host_tunnel(&jump_handle, &jump_host, target.host.clone(), target.port)
                .await
            {
                Ok(channel) => channel,
                Err(error) => {
                    disconnect_and_wait_with_shutdown(
                        jump_handle,
                        jump_shutdown,
                        "open jump host tunnel failed",
                    )
                    .await;
                    return Err(error);
                }
            };

        // 第三步：把 direct-tcpip channel 当成双向流，在隧道内完成目标主机
        // 自己的 SSH 握手和认证。认证跳板 Handle 只会再次认证跳板机。
        let target_stream = target_channel.into_stream();
        let target_handler = client_handler(
            target.host,
            target.port,
            target.expected_host_key,
            target.allow_agent_forwarding,
        );
        let target_connection = connect_stream_with_timeout(
            config,
            target_stream,
            target_handler,
            SSH_CONNECT_TIMEOUT,
            "connect target host through jump host",
            Some(&jump_shutdown),
        )
        .await;
        let mut target_handle = match target_connection {
            Ok(handle) => handle,
            Err(error) => {
                disconnect_and_wait_with_shutdown(
                    jump_handle,
                    jump_shutdown,
                    "target SSH handshake failed",
                )
                .await;
                return Err(error);
            }
        };

        let authentication = if target.use_agent {
            enforce_authentication_timeout(
                SSH_AUTH_TIMEOUT,
                "authenticate target SSH agent",
                authenticate_with_agent(&mut target_handle, target.username),
            )
            .await
            .and_then(|success| {
                success.then_some(()).ok_or_else(|| {
                    SessionError::AuthenticationFailed(
                        "Target host: all SSH agent identities rejected".to_string(),
                    )
                })
            })
        } else {
            enforce_authentication_timeout(
                SSH_AUTH_TIMEOUT,
                "authenticate target SSH user",
                Self::authenticate(
                    &mut target_handle,
                    target.username,
                    target.password,
                    target.private_key,
                    target.certificate,
                ),
            )
            .await
        };
        if let Err(error) = authentication {
            disconnect_jump_connections_with_shutdown(
                target_handle,
                jump_handle,
                jump_shutdown,
                "target SSH authentication failed",
            )
            .await;
            return Err(error);
        }

        jump_shutdown.disarm();
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
            match decode_private_key(&key_content, password.as_deref()) {
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
        let private_key = decode_private_key(&private_key_content, key_password.as_deref())
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

    pub(crate) fn completion(&self) -> SessionCompletion {
        self.lifecycle.completion()
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
            let deadline =
                tokio::time::Instant::now() + timeout.max(std::time::Duration::from_millis(1));
            let handle = {
                let guard = state.lock().await;
                if !guard.is_alive.load(Ordering::Acquire) || !guard.writer.is_running() {
                    return Err(SessionError::ChannelError("session is closed".to_string()));
                }
                guard.handle.clone()
            };

            // Open exec channel
            let mut channel = enforce_exec_deadline(deadline, handle.channel_open_session())
                .await?
                .map_err(|e| {
                    SessionError::ChannelError(format!("failed to open exec channel: {}", e))
                })?;

            // Request exec
            enforce_exec_deadline(deadline, channel.exec(true, command.as_bytes()))
                .await?
                .map_err(|e| SessionError::ExecFailed(format!("exec request failed: {}", e)))?;

            // Read output under one absolute deadline.
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            let mut exit_code: Option<u32> = None;

            enforce_exec_deadline(deadline, async {
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
            .await?;

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
        self.write_raw(data.as_bytes().to_vec())
    }

    /// 写入不经过 UTF-8 转换的原始终端字节。
    pub fn write_raw(
        &self,
        data: Vec<u8>,
    ) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        let state = self.state.clone();
        Box::pin(async move {
            let writer = {
                let state = state.lock().await;
                if !state.is_alive.load(Ordering::Acquire) || !state.writer.is_running() {
                    return Err(SessionError::WriteFailed("Session is closed".to_string()));
                }
                state.writer.clone()
            };
            writer.write(data).await
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
            validate_terminal_size(cols, rows)?;
            let writer = {
                let state = state.lock().await;
                if !state.is_alive.load(Ordering::Acquire) || !state.writer.is_running() {
                    return Err(SessionError::ResizeFailed("Session is closed".to_string()));
                }
                state.writer.clone()
            };
            writer.resize(cols, rows).await
        })
    }

    /// 关闭会话 - 发送关闭信号并等待任务完成，并释放连接池引用
    pub fn close(self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let state = self.state.clone();
        let lifecycle = self.lifecycle.clone();
        Box::pin(async move {
            let (pool_key, shutdown_tx, is_alive, read_handle, writer, writer_handle) = {
                let s = state.lock().await;
                (
                    s.pool_key.clone(),
                    s.shutdown_tx.clone(),
                    Arc::clone(&s.is_alive),
                    Arc::clone(&s.read_handle),
                    s.writer.clone(),
                    Arc::clone(&s.writer_handle),
                )
            };
            let _ = shutdown_tx.send(());
            close_ssh_writer(&is_alive, &writer, &writer_handle).await;
            let read_task = read_handle.lock().await.take();
            // 等待读取任务完成（最多等待 2 秒）
            if let Some(mut task) = read_task {
                if tokio::time::timeout(tokio::time::Duration::from_secs(2), &mut task)
                    .await
                    .is_err()
                {
                    tracing::warn!(
                        "SSH terminal reader task did not stop before the close deadline"
                    );
                    task.abort();
                    let _ = task.await;
                }
            }
            // release is idempotent; its detached task survives reader cancellation.
            if let Some(key) = pool_key {
                release_connection_pool_entry(key).await;
            }
            lifecycle.complete();
        })
    }

    /// 检查会话是否活跃
    pub fn is_alive(&self) -> bool {
        let state = self.state.try_lock();
        match state {
            Ok(s) => s.is_alive.load(Ordering::Acquire) && s.writer.is_running(),
            Err(_) => false,
        }
    }

    /// 获取 SSH handle 克隆（用于 SFTP / port-forward 等共享连接的场景）。
    /// 返回 None 如果会话已关闭。
    pub fn handle(&self) -> Option<Arc<client::Handle<ClientHandler>>> {
        let state = self.state.try_lock().ok()?;
        if state.is_alive.load(Ordering::Acquire) && state.writer.is_running() {
            Some(Arc::clone(&state.handle))
        } else {
            None
        }
    }
}

/// Connect to a jump host, verify its host key, and authenticate it using the
/// same password/key/agent/certificate semantics as a real terminal session.
pub(crate) async fn connect_authenticated_jump_host_with_shutdown(
    config: Arc<client::Config>,
    jump_host: &JumpHostConfig,
) -> Result<(client::Handle<ClientHandler>, TcpShutdownGuard), SessionError> {
    if jump_host.host.trim().is_empty() {
        return Err(SessionError::InvalidInput(
            "Jump host cannot be empty".to_string(),
        ));
    }
    if jump_host.port == 0 {
        return Err(SessionError::InvalidInput(
            "Jump host port must be between 1 and 65535".to_string(),
        ));
    }
    if jump_host.username.trim().is_empty() {
        return Err(SessionError::InvalidInput(
            "Jump host username cannot be empty".to_string(),
        ));
    }
    validate_auth_config(
        "jump host",
        &jump_host.auth_type,
        jump_host.private_key.as_deref(),
        jump_host.certificate.as_deref(),
    )?;

    let expected_host_key = parse_expected_host_key(jump_host.expected_host_key.clone())?;
    let (mut handle, shutdown_guard) = connect_tcp_with_shutdown(
        config,
        (jump_host.host.as_str(), jump_host.port),
        client_handler(
            jump_host.host.clone(),
            jump_host.port,
            expected_host_key,
            false,
        ),
        SSH_CONNECT_TIMEOUT,
        "connect jump host",
    )
    .await?;

    let authentication = enforce_authentication_timeout(
        SSH_AUTH_TIMEOUT,
        "authenticate jump host",
        authenticate_jump_host(&mut handle, jump_host),
    )
    .await;
    if let Err(error) = authentication {
        disconnect_and_wait_with_shutdown(
            handle,
            shutdown_guard,
            "jump host authentication failed",
        )
        .await;
        return Err(error);
    }

    Ok((handle, shutdown_guard))
}

/// Open the only network path used to reach a target behind a jump host.
pub(crate) async fn open_jump_host_tunnel(
    jump_handle: &client::Handle<ClientHandler>,
    jump_host: &JumpHostConfig,
    target_host: String,
    target_port: u16,
) -> Result<Channel<client::Msg>, SessionError> {
    let peer_addr = format!("{}:{}", jump_host.host, jump_host.port);
    enforce_ssh_operation_timeout(
        SSH_CHANNEL_OPEN_TIMEOUT,
        "open jump host tunnel",
        jump_handle.channel_open_direct_tcpip(
            target_host,
            target_port as u32,
            peer_addr,
            jump_host.port as u32,
        ),
    )
    .await
}

async fn authenticate_jump_host(
    handle: &mut client::Handle<ClientHandler>,
    jump_host: &JumpHostConfig,
) -> Result<(), SessionError> {
    let authenticated = match jump_host.auth_type.as_str() {
        "agent" => authenticate_with_agent(handle, jump_host.username.clone()).await?,
        "cert" => {
            SshSession::authenticate(
                handle,
                jump_host.username.clone(),
                jump_host.password.clone(),
                jump_host.private_key.clone(),
                jump_host.certificate.clone(),
            )
            .await?;
            true
        }
        "key" => {
            let rsa_hash = handle
                .best_supported_rsa_hash()
                .await
                .map_err(|error| {
                    SessionError::ConnectionFailed(format!("RSA hash failed: {error}"))
                })?
                .flatten();
            if let Some(key) = &jump_host.private_key {
                match decode_private_key(key, jump_host.password.as_deref()) {
                    Ok(key) => {
                        let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
                        handle
                            .authenticate_publickey(jump_host.username.clone(), key_with_hash)
                            .await
                            .map(|result| result.success())
                            .map_err(|error| {
                                SessionError::AuthenticationFailed(format!(
                                    "Jump host auth failed: {error}"
                                ))
                            })?
                    }
                    Err(_) => authenticate_jump_host_password(handle, jump_host).await?,
                }
            } else {
                authenticate_jump_host_password(handle, jump_host).await?
            }
        }
        _ => authenticate_jump_host_password(handle, jump_host).await?,
    };

    if authenticated {
        Ok(())
    } else {
        Err(SessionError::AuthenticationFailed(
            "Jump host authentication was rejected".to_string(),
        ))
    }
}

async fn authenticate_jump_host_password(
    handle: &mut client::Handle<ClientHandler>,
    jump_host: &JumpHostConfig,
) -> Result<bool, SessionError> {
    let password = jump_host.password.clone().ok_or_else(|| {
        SessionError::AuthenticationFailed(match jump_host.auth_type.as_str() {
            "key" if jump_host.private_key.is_some() => {
                "Failed to parse jump host key and no password provided".to_string()
            }
            "key" => "No authentication method provided for jump host".to_string(),
            _ => "Jump host password required".to_string(),
        })
    })?;
    handle
        .authenticate_password(jump_host.username.clone(), password)
        .await
        .map(|result| result.success())
        .map_err(|error| {
            SessionError::AuthenticationFailed(format!("Jump host auth failed: {error}"))
        })
}

async fn enforce_exec_deadline<T>(
    deadline: tokio::time::Instant,
    future: impl Future<Output = T>,
) -> Result<T, SessionError> {
    tokio::time::timeout_at(deadline, future)
        .await
        .map_err(|_| SessionError::ExecTimeout)
}

#[cfg(test)]
async fn enforce_connection_timeout<T, E>(
    timeout: std::time::Duration,
    operation: &'static str,
    future: impl Future<Output = Result<T, E>>,
) -> Result<T, SessionError>
where
    E: std::fmt::Display,
{
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| connection_timeout_error(timeout, operation))?
        .map_err(|error| connection_failure_error(operation, error))
}

async fn enforce_authentication_timeout<T, E>(
    timeout: std::time::Duration,
    operation: &'static str,
    future: impl Future<Output = Result<T, E>>,
) -> Result<T, SessionError>
where
    E: std::fmt::Display,
{
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| {
            SessionError::AuthenticationFailed(format!(
                "{operation} timed out after {} ms",
                timeout.as_millis()
            ))
        })?
        .map_err(|error| SessionError::AuthenticationFailed(format!("{operation} failed: {error}")))
}

async fn enforce_ssh_operation_timeout<T, E>(
    timeout: std::time::Duration,
    operation: &'static str,
    future: impl Future<Output = Result<T, E>>,
) -> Result<T, SessionError>
where
    E: std::fmt::Display,
{
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| {
            SessionError::ChannelError(format!(
                "{operation} timed out after {} ms",
                timeout.as_millis()
            ))
        })?
        .map_err(|error| SessionError::ChannelError(format!("{operation} failed: {error}")))
}

fn validate_auth_config(
    label: &str,
    auth_type: &str,
    private_key: Option<&str>,
    certificate: Option<&str>,
) -> Result<(), SessionError> {
    match auth_type {
        "" | "password" | "key" | "agent" => Ok(()),
        "cert" => {
            if certificate.is_none_or(|value| value.trim().is_empty()) {
                return Err(SessionError::InvalidInput(format!(
                    "{label} certificate is required for certificate authentication"
                )));
            }
            if private_key.is_none_or(|value| value.trim().is_empty()) {
                return Err(SessionError::InvalidInput(format!(
                    "{label} private key is required for certificate authentication"
                )));
            }
            Ok(())
        }
        other => Err(SessionError::InvalidInput(format!(
            "Unsupported {label} authentication type: {other}"
        ))),
    }
}

fn validate_jump_auth_config(
    jump_host: &JumpHostConfig,
    target_private_key: Option<&str>,
    target_certificate: Option<&str>,
) -> Result<(), SessionError> {
    validate_auth_config(
        "jump host",
        &jump_host.auth_type,
        jump_host.private_key.as_deref(),
        jump_host.certificate.as_deref(),
    )?;

    if let Some(target_auth_type) = jump_host.target_auth_type.as_deref() {
        validate_auth_config(
            "target host",
            target_auth_type,
            target_private_key,
            target_certificate,
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::ssh_writer::SshChannelWriter;
    use async_trait::async_trait;
    use std::sync::atomic::AtomicUsize;

    struct CloseProbeWriter {
        close_calls: Arc<AtomicUsize>,
    }

    struct DisconnectProbe {
        label: &'static str,
        events: Arc<Mutex<Vec<(&'static str, &'static str)>>>,
    }

    impl PendingSshConnection for DisconnectProbe {
        async fn disconnect_and_wait(self, reason: &'static str) {
            self.events.lock().await.push((self.label, reason));
        }
    }

    #[async_trait]
    impl SshChannelWriter for CloseProbeWriter {
        async fn write_data(&mut self, _data: Vec<u8>) -> Result<(), SessionError> {
            Ok(())
        }

        async fn resize(&mut self, _cols: u16, _rows: u16) -> Result<(), SessionError> {
            Ok(())
        }

        async fn close(&mut self) -> Result<(), SessionError> {
            self.close_calls.fetch_add(1, Ordering::AcqRel);
            Ok(())
        }
    }

    fn assert_send_static<T: Send + 'static>(_: T) {}

    #[test]
    fn standard_openssh_pem_private_key_is_decoded_by_auth_parser() {
        use ssh_key::rand_core::OsRng;

        let private_key = ssh_key::PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519)
            .expect("test private key should generate")
            .to_openssh(ssh_key::LineEnding::LF)
            .expect("test private key should serialize");

        let decoded = decode_private_key(&private_key, None)
            .expect("standard OpenSSH PEM should be accepted by the auth parser");

        assert_eq!(
            decoded.algorithm(),
            russh::keys::ssh_key::Algorithm::Ed25519
        );
    }

    fn jump_host(host: &str) -> JumpHostConfig {
        JumpHostConfig {
            host: host.to_string(),
            port: 22,
            username: "jump-user".to_string(),
            auth_type: "password".to_string(),
            password: Some("unused".to_string()),
            private_key: None,
            certificate: None,
            expected_host_key: None,
            target_auth_type: Some("password".to_string()),
        }
    }

    #[test]
    fn jump_pool_key_includes_bastion_identity() {
        let first = jump_host("bastion-a.example");
        let second = jump_host("bastion-b.example");

        let first_key = connection_key(
            "session-a",
            "target.example",
            22,
            "target-user",
            Some(&first),
            false,
        );
        let second_key = connection_key(
            "session-a",
            "target.example",
            22,
            "target-user",
            Some(&second),
            false,
        );

        assert_ne!(first_key, second_key);
    }

    #[test]
    fn direct_and_jump_pool_keys_cannot_collide() {
        let jump = jump_host("bastion.example");

        let direct = connection_key(
            "session-a",
            "target.example",
            22,
            "target-user",
            None,
            false,
        );
        let tunneled = connection_key(
            "session-a",
            "target.example",
            22,
            "target-user",
            Some(&jump),
            false,
        );

        assert_ne!(direct, tunneled);
    }

    #[test]
    fn forwarding_and_non_forwarding_connections_cannot_share_a_pool_entry() {
        let denied = connection_key(
            "session-a",
            "target.example",
            22,
            "target-user",
            None,
            false,
        );
        let allowed = connection_key("session-a", "target.example", 22, "target-user", None, true);

        assert_ne!(denied, allowed);
    }

    #[test]
    fn jump_auth_accepts_complete_certificate_credentials() {
        let mut jump_certificate = jump_host("bastion.example");
        jump_certificate.auth_type = "cert".to_string();
        jump_certificate.private_key = Some("jump-private-key".to_string());
        jump_certificate.certificate = Some("jump-certificate".to_string());
        assert!(validate_jump_auth_config(&jump_certificate, None, None).is_ok());

        let mut target_certificate = jump_host("bastion.example");
        target_certificate.target_auth_type = Some("cert".to_string());
        assert!(validate_jump_auth_config(
            &target_certificate,
            Some("target-private-key"),
            Some("target-certificate"),
        )
        .is_ok());
    }

    #[test]
    fn jump_auth_rejects_incomplete_certificate_credentials() {
        let mut jump = jump_host("bastion.example");
        jump.auth_type = "cert".to_string();

        assert!(matches!(
            validate_jump_auth_config(&jump, None, None),
            Err(SessionError::InvalidInput(message))
                if message == "jump host certificate is required for certificate authentication"
        ));

        jump.auth_type = "password".to_string();
        jump.target_auth_type = Some("cert".to_string());
        assert!(matches!(
            validate_jump_auth_config(&jump, Some("target-private-key"), None),
            Err(SessionError::InvalidInput(message))
                if message == "target host certificate is required for certificate authentication"
        ));
    }

    #[test]
    fn connection_pool_future_owns_shared_state() {
        let pool = Arc::new(SshConnectionPool::new());

        assert_send_static(pool.release("compile-release".to_string()));
    }

    #[tokio::test]
    async fn pool_release_continues_when_its_waiter_is_aborted() {
        let pool = Arc::new(SshConnectionPool::new());
        let pool_guard = pool.inner.write().await;
        let release_task =
            spawn_connection_pool_release(Arc::clone(&pool), "blocked-release".to_string());
        tokio::task::yield_now().await;
        let waiter = tokio::spawn(async move {
            release_task
                .await
                .expect("connection pool release task should finish");
        });
        tokio::task::yield_now().await;

        waiter.abort();
        let _ = waiter.await;
        assert_eq!(Arc::strong_count(&pool), 2);

        drop(pool_guard);
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while Arc::strong_count(&pool) != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("detached connection pool release should complete");
    }

    #[test]
    fn interactive_tabs_use_distinct_physical_connection_keys() {
        let first = connection_key(
            "session-a",
            "target.example",
            22,
            "target-user",
            None,
            false,
        );
        let second = connection_key(
            "session-b",
            "target.example",
            22,
            "target-user",
            None,
            false,
        );

        assert_ne!(first, second);
    }

    #[test]
    fn interactive_ssh_config_disables_nagle_for_terminal_input() {
        assert!(interactive_ssh_config().nodelay);
    }

    #[test]
    fn expected_host_key_parser_normalizes_untrusted_comments() {
        let value = format!(
            "{} untrusted-comment",
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti"
        );

        let key = parse_expected_host_key(Some(value))
            .expect("expected host key should parse")
            .expect("expected host key should be present");

        assert_eq!(key.comment(), "");
    }

    #[tokio::test]
    async fn sustained_output_cannot_extend_exec_deadline() {
        let active = async {
            for _ in 0..10 {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        };
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(25);

        assert!(matches!(
            enforce_exec_deadline(deadline, active).await,
            Err(SessionError::ExecTimeout)
        ));
    }

    #[tokio::test]
    async fn exec_stages_share_one_absolute_deadline() {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(25);

        enforce_exec_deadline(deadline, async {
            tokio::time::sleep(std::time::Duration::from_millis(15)).await;
        })
        .await
        .expect("the first exec stage should finish within the shared deadline");
        let second_stage = enforce_exec_deadline(deadline, async {
            tokio::time::sleep(std::time::Duration::from_millis(15)).await;
        })
        .await;

        assert!(matches!(second_stage, Err(SessionError::ExecTimeout)));
    }

    #[tokio::test]
    async fn ssh_writer_closes_when_reader_already_marked_session_dead() {
        let close_calls = Arc::new(AtomicUsize::new(0));
        let timeouts = SshWriterTimeouts {
            write: std::time::Duration::from_millis(100),
            resize: std::time::Duration::from_millis(100),
            close: std::time::Duration::from_millis(100),
        };
        let (writer, task) = spawn_ssh_writer(
            CloseProbeWriter {
                close_calls: Arc::clone(&close_calls),
            },
            1,
            timeouts,
        );
        let writer_handle = Arc::new(Mutex::new(Some(task)));
        let is_alive = AtomicBool::new(false);

        close_ssh_writer(&is_alive, &writer, &writer_handle).await;

        assert_eq!(
            (
                is_alive.load(Ordering::Acquire),
                close_calls.load(Ordering::Acquire),
                writer_handle.lock().await.is_none(),
            ),
            (false, 1, true),
            "reader EOF must not prevent the writer actor from closing and joining"
        );
    }

    #[test]
    fn fatal_writer_completion_marks_session_dead_and_reports_the_error() {
        let is_alive = AtomicBool::new(true);

        let error = apply_writer_completion(
            &is_alive,
            Err(SessionError::WriteFailed("injected failure".to_string())),
        )
        .expect("fatal writer completion must be observable");

        assert_eq!(
            (is_alive.load(Ordering::Acquire), error),
            (
                false,
                "SSH terminal writer failed: write failed: injected failure".to_string()
            )
        );
    }

    #[test]
    fn clean_writer_completion_marks_session_dead_without_reporting_an_error() {
        let is_alive = AtomicBool::new(true);

        let error = apply_writer_completion(&is_alive, Ok(()));

        assert_eq!((is_alive.load(Ordering::Acquire), error), (false, None));
    }

    #[tokio::test]
    async fn ssh_operation_timeout_reports_the_stalled_stage() {
        let stalled = std::future::pending::<Result<(), std::io::Error>>();

        assert!(matches!(
            enforce_ssh_operation_timeout(
                std::time::Duration::from_millis(5),
                "request PTY",
                stalled,
            )
            .await,
            Err(SessionError::ChannelError(message))
                if message.contains("request PTY") && message.contains("timed out")
        ));
    }

    #[tokio::test]
    async fn ssh_operation_error_keeps_stage_context() {
        let failed = std::future::ready::<Result<(), std::io::Error>>(Err(std::io::Error::other(
            "transport closed",
        )));

        assert!(matches!(
            enforce_ssh_operation_timeout(
                std::time::Duration::from_secs(1),
                "write terminal data",
                failed,
            )
            .await,
            Err(SessionError::ChannelError(message))
                if message.contains("write terminal data")
                    && message.contains("transport closed")
        ));
    }

    #[tokio::test]
    async fn ssh_connection_timeout_reports_connect_stage() {
        let stalled = std::future::pending::<Result<(), std::io::Error>>();

        assert!(matches!(
            enforce_connection_timeout(
                std::time::Duration::from_millis(5),
                "connect SSH server",
                stalled,
            )
            .await,
            Err(SessionError::ConnectionFailed(message))
                if message.contains("connect SSH server") && message.contains("timed out")
        ));
    }

    #[tokio::test]
    async fn stream_kex_timeout_closes_transport_before_returning() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (client_stream, mut server_stream) = tokio::io::duplex(64 * 1024);
        let (eof_tx, mut eof_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            server_stream
                .write_all(b"SSH-2.0-terminal-stalled-stream-kex\r\n")
                .await
                .expect("stalled SSH stream banner should be written");
            let mut buffer = [0_u8; 1024];
            loop {
                match server_stream.read(&mut buffer).await {
                    Ok(0) => {
                        let _ = eof_tx.send(());
                        return;
                    }
                    Ok(_) => {}
                    Err(_) => return,
                }
            }
        });

        let result = connect_stream_with_timeout(
            Arc::new(interactive_ssh_config()),
            client_stream,
            client_handler("target.example".to_string(), 22, None, false),
            std::time::Duration::from_millis(20),
            "connect stalled SSH stream",
            None,
        )
        .await;
        let result_description = match result {
            Ok(_) => "unexpected success".to_string(),
            Err(error) => error.to_string(),
        };

        tokio::time::timeout(std::time::Duration::from_secs(1), &mut eof_rx)
            .await
            .expect("stream KEX timeout must not leave its transport running")
            .expect("stalled stream server must report transport EOF");
        assert!(
            result_description.contains("timed out"),
            "stream KEX timeout returned an unexpected result: {result_description}"
        );
    }

    #[tokio::test]
    async fn tcp_kex_timeout_closes_transport_before_returning() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("stalled SSH listener should bind");
        let address = listener
            .local_addr()
            .expect("stalled SSH listener should have an address");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener
                .accept()
                .await
                .expect("stalled SSH listener should accept");
            socket
                .write_all(b"SSH-2.0-terminal-stalled-kex\r\n")
                .await
                .expect("stalled SSH banner should be written");
            let mut buffer = [0_u8; 1024];
            loop {
                match socket.read(&mut buffer).await {
                    Ok(0) | Err(_) => return,
                    Ok(_) => {}
                }
            }
        });

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            connect_tcp_with_timeout(
                Arc::new(interactive_ssh_config()),
                address.to_string(),
                client_handler("127.0.0.1".to_string(), address.port(), None, false),
                std::time::Duration::from_millis(20),
                "connect stalled SSH server",
            ),
        )
        .await
        .expect("KEX cancellation should finish after closing the socket");

        assert!(matches!(
            result,
            Err(SessionError::ConnectionFailed(message))
                if message.contains("connect stalled SSH server")
                    && message.contains("timed out")
        ));
        tokio::time::timeout(std::time::Duration::from_secs(1), server)
            .await
            .expect("server should observe EOF before the client returns")
            .expect("stalled SSH server task should join");
    }

    #[tokio::test]
    async fn ssh_authentication_timeout_reports_auth_stage() {
        let stalled = std::future::pending::<Result<(), std::io::Error>>();

        assert!(matches!(
            enforce_authentication_timeout(
                std::time::Duration::from_millis(5),
                "authenticate SSH user",
                stalled,
            )
            .await,
            Err(SessionError::AuthenticationFailed(message))
                if message.contains("authenticate SSH user") && message.contains("timed out")
        ));
    }

    #[tokio::test]
    async fn pending_jump_cleanup_disconnects_target_before_jump() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let target = DisconnectProbe {
            label: "target",
            events: Arc::clone(&events),
        };
        let jump = DisconnectProbe {
            label: "jump",
            events: Arc::clone(&events),
        };

        cleanup_pending_jump_connections(Some(target), jump, "target authentication failed").await;

        assert_eq!(
            *events.lock().await,
            vec![
                ("target", "target authentication failed"),
                ("jump", "target authentication failed"),
            ]
        );
    }

    #[tokio::test]
    async fn pending_jump_cleanup_disconnects_jump_without_target_handle() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let jump = DisconnectProbe {
            label: "jump",
            events: Arc::clone(&events),
        };

        cleanup_pending_jump_connections::<DisconnectProbe>(
            None,
            jump,
            "target handshake timed out",
        )
        .await;

        assert_eq!(
            *events.lock().await,
            vec![("jump", "target handshake timed out")]
        );
    }
}
