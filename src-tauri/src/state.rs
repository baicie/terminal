use crate::errors::PortForwardError;
use anyhow::{anyhow, Result};
use russh::client::{self, Handler};
use russh::Channel;
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use serialport::SerialPort;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex;

type AgentTransport = Box<dyn russh::keys::agent::client::AgentStream + Send + Unpin + 'static>;

#[cfg(unix)]
async fn connect_agent_transport(socket_path: Option<PathBuf>) -> Result<AgentTransport> {
    let path = socket_path.ok_or_else(|| anyhow!("SSH_AUTH_SOCK is not configured"))?;
    let stream = tokio::net::UnixStream::connect(&path)
        .await
        .map_err(|error| {
            anyhow!(
                "failed to connect SSH agent at {}: {}",
                path.display(),
                error
            )
        })?;
    Ok(Box::new(stream))
}

#[cfg(windows)]
async fn connect_agent_transport(socket_path: Option<PathBuf>) -> Result<AgentTransport> {
    use russh::keys::agent::client::AgentClient;

    const OPENSSH_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";
    // Capture the configured pipe when the handler is created. Reading the
    // environment again here made forwarding ignore a handler's socket
    // identity and could connect a later session to a different agent.
    if let Some(pipe) = socket_path
        .and_then(|path| path.into_os_string().into_string().ok())
        .filter(|pipe| !pipe.trim().is_empty())
    {
        return AgentClient::connect_named_pipe(&pipe)
            .await
            .map(AgentClient::into_inner)
            .map_err(|error| anyhow!("failed to open SSH agent pipe '{}': {}", pipe, error));
    }

    match AgentClient::connect_named_pipe(OPENSSH_AGENT_PIPE).await {
        Ok(agent) => Ok(agent.into_inner()),
        Err(open_ssh_error) => AgentClient::connect_pageant()
            .await
            .map(AgentClient::into_inner)
            .map_err(|pageant_error| {
                anyhow!(
                    "OpenSSH Agent is unavailable ({}), and Pageant is unavailable ({})",
                    open_ssh_error,
                    pageant_error
                )
            }),
    }
}

#[cfg(not(any(unix, windows)))]
async fn connect_agent_transport(_socket_path: Option<PathBuf>) -> Result<AgentTransport> {
    Err(anyhow!(
        "SSH agent forwarding is not supported on this platform"
    ))
}

/// Shell output event for frontend
#[derive(Clone, Serialize, Deserialize)]
pub struct ShellOutput {
    pub session_id: String,
    pub data: String,
    pub is_stderr: bool,
}

/// Port forwarding configuration
#[derive(Clone, Serialize, Deserialize)]
pub struct PortForwardConfig {
    pub id: String,
    pub name: String,
    pub forward_type: String,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

/// Jump host configuration for connecting through a bastion/jump server.
#[allow(dead_code)]
#[derive(Clone, Serialize, Deserialize)]
pub struct JumpHostConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
}

// Remote port-forward types (for SSH remote port forwarding -R)

/// Wrapper for a forwarded Russh channel sent through an mpsc channel.
#[derive(Debug)]
#[allow(dead_code)]
pub struct ForwardedChannel {
    pub handle: Box<dyn std::any::Any + Send>,
}

/// Message sent from `server_channel_open_forwarded_tcpip` to the forwarder task.
#[derive(Debug)]
pub struct ForwardedChannelMsg {
    pub channel: russh::Channel<russh::client::Msg>,
    pub connected_address: String,
    pub connected_port: u32,
    pub originator_address: String,
    pub originator_port: u32,
}

/// Remote port forward listener.
/// Keeps the `tcpip_forward` registration alive and bridges connections.
#[derive(Clone)]
pub struct TcpForwardListener {
    /// Port the SSH server bound (returned to frontend for display).
    #[allow(dead_code)]
    pub bound_port: u32,
    pub sender: tokio::sync::mpsc::Sender<ForwardedChannelMsg>,
    /// Registry key (pointer address of the SshHandle). Used for cleanup.
    pub registry_key: usize,
}

/// Port forwarding task handle with additional info and listener for remote forwards.
pub struct PortForwardTask {
    pub task: tokio::task::JoinHandle<Result<(), PortForwardError>>,
    /// `Some` for remote forward (keeps `tcpip_forward` alive); `None` for local/dynamic.
    #[allow(dead_code)]
    pub listener: Option<TcpForwardListener>,
    pub info: PortForwardInfo,
}

/// Port forwarding info for listing
#[derive(Clone, Serialize, Deserialize)]
pub struct PortForwardInfo {
    pub name: String,
    pub forward_type: String,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: String,
}

/// Serial port session state
pub struct SerialSession {
    pub port: Arc<StdMutex<Box<dyn SerialPort>>>,
    pub stop: Arc<AtomicBool>,
    /// Released once the blocking read loop has returned and dropped the
    /// cloned port handle, so a disconnect can wait for the device to be
    /// genuinely released before the caller reconnects it. A semaphore rather
    /// than a Notify, because a disconnect racing reader startup must not miss
    /// the wakeup and hang.
    pub closed: Arc<tokio::sync::Semaphore>,
    /// Held for reading by every in-flight write and for writing by a
    /// disconnect. A write clones the port out of the session map and then
    /// writes without holding that map, so without this gate a disconnect
    /// could report success while a write still had the device open.
    pub write_gate: Arc<tokio::sync::RwLock<()>>,
}

/// Serial port info for frontend
#[derive(Clone, Serialize, Deserialize)]
pub struct SerialPortInfo {
    pub name: String,
    pub port_type: String,
}

/// Serial port connection configuration
#[allow(dead_code)]
#[derive(Clone, Serialize, Deserialize)]
pub struct SerialConfig {
    pub name: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: String,
    pub flow_control: String,
}

/// SFTP file item for directory listing
#[derive(Serialize, Deserialize, Clone)]
pub struct SftpFileItem {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified_time: i64,
    pub permissions: String,
}

/// Agent forwarding channel state
#[allow(dead_code)]
pub struct AgentForwardState {
    pub session_id: String,
    pub socket_path: String,
}

// ClientHandler

/// Get the SSH_AUTH_SOCK path from environment
pub fn get_ssh_agent_socket() -> Option<String> {
    std::env::var("SSH_AUTH_SOCK")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

/// ClientHandler with SSH Agent forwarding and remote port forwarding support.
pub struct ClientHandler {
    host: String,
    port: u16,
    known_hosts_path: Option<PathBuf>,
    expected_host_key: Option<russh::keys::PublicKey>,
    allow_agent_forwarding: bool,
    #[cfg_attr(not(unix), allow(dead_code))]
    agent_socket: Option<PathBuf>,
    #[allow(dead_code)]
    session_id: Option<String>,
    /// Set by `setup_remote_forward` so `server_channel_open_forwarded_tcpip` can route
    /// incoming connections to the forwarder task.
    /// std::sync::RwLock is safe here: the guard is always dropped before any await.
    pub(crate) forward_listener: std::sync::RwLock<Option<TcpForwardListener>>,
}

impl ClientHandler {
    pub fn for_host(host: impl Into<String>, port: u16) -> Self {
        Self::for_host_with_agent_forwarding(host, port, false)
    }

    pub fn for_host_with_agent_forwarding(
        host: impl Into<String>,
        port: u16,
        allow_agent_forwarding: bool,
    ) -> Self {
        Self {
            host: host.into(),
            port,
            known_hosts_path: None,
            expected_host_key: None,
            allow_agent_forwarding,
            agent_socket: get_ssh_agent_socket().map(PathBuf::from),
            session_id: None,
            forward_listener: std::sync::RwLock::new(None),
        }
    }

    /// Build a handler pinned to the exact key returned by a host-key preflight.
    ///
    /// This is used for one-time TOFU approval: the key is accepted only when
    /// the subsequent SSH handshake presents the same key, even if it is not
    /// persisted in `known_hosts`.
    pub fn for_host_with_expected_key(
        host: impl Into<String>,
        port: u16,
        expected_host_key: russh::keys::PublicKey,
        allow_agent_forwarding: bool,
    ) -> Self {
        let mut expected_host_key = expected_host_key;
        expected_host_key.set_comment("");
        Self {
            host: host.into(),
            port,
            known_hosts_path: None,
            expected_host_key: Some(expected_host_key),
            allow_agent_forwarding,
            agent_socket: get_ssh_agent_socket().map(PathBuf::from),
            session_id: None,
            forward_listener: std::sync::RwLock::new(None),
        }
    }

    #[cfg(test)]
    fn for_host_with_known_hosts(host: &str, port: u16, known_hosts_path: PathBuf) -> Self {
        Self {
            host: host.to_string(),
            port,
            known_hosts_path: Some(known_hosts_path),
            expected_host_key: None,
            allow_agent_forwarding: false,
            agent_socket: get_ssh_agent_socket().map(PathBuf::from),
            session_id: None,
            forward_listener: std::sync::RwLock::new(None),
        }
    }
}

impl Handler for ClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let has_matching_preflight_key = match &self.expected_host_key {
            Some(expected_host_key)
                if expected_host_key.key_data() == server_public_key.key_data() =>
            {
                true
            }
            Some(_) => {
                return Err(anyhow!(
                    "host key verification failed for {}:{}: server key does not match the preflight key",
                    self.host,
                    self.port
                ));
            }
            None => false,
        };

        let verified = if let Some(path) = &self.known_hosts_path {
            russh::keys::check_known_hosts_path(&self.host, self.port, server_public_key, path)
        } else {
            russh::keys::check_known_hosts(&self.host, self.port, server_public_key)
        };

        match verified {
            Ok(true) => Ok(true),
            Ok(false) if has_matching_preflight_key => Ok(true),
            Ok(false) => Err(anyhow!(
                "host key verification failed for {}:{}: key not found in known_hosts",
                self.host,
                self.port
            )),
            Err(error) => Err(anyhow!(
                "host key verification failed for {}:{}: {}",
                self.host,
                self.port,
                error
            )),
        }
    }

    async fn server_channel_open_agent_forward(
        &mut self,
        channel: Channel<client::Msg>,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if !self.allow_agent_forwarding {
            tracing::warn!(
                host = %self.host,
                port = self.port,
                "rejecting unauthorized SSH agent forwarding channel"
            );
            let _ = channel.close().await;
            return Ok(());
        }

        match connect_agent_transport(self.agent_socket.clone()).await {
            Ok(mut agent) => {
                let mut channel_stream = channel.into_stream();
                tokio::spawn(async move {
                    if let Err(error) =
                        tokio::io::copy_bidirectional(&mut channel_stream, &mut agent).await
                    {
                        tracing::warn!(%error, "SSH agent forwarding channel closed with an error");
                    }
                });
            }
            Err(error) => {
                tracing::warn!(%error, "rejecting SSH agent forwarding channel");
                let _ = channel.close().await;
            }
        }
        Ok(())
    }

    /// Receive a forwarded TCP connection from the SSH server.
    ///
    /// Called when the SSH server receives a connection on the port bound by
    /// `tcpip_forward` and sends a `CHANNEL_OPEN` with type `forwarded-tcpip`.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        connected_address: &str,
        connected_port: u32,
        originator_address: &str,
        originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        // std::sync::RwLock guard is dropped before any await.
        let sender = {
            let guard = self
                .forward_listener
                .read()
                .unwrap_or_else(|e| e.into_inner());
            guard.clone()
        };
        if let Some(l) = sender {
            let msg = ForwardedChannelMsg {
                channel,
                connected_address: connected_address.to_string(),
                connected_port,
                originator_address: originator_address.to_string(),
                originator_port,
            };
            if l.sender.send(msg).await.is_err() {
                tracing::debug!("forward listener receiver dropped");
            }
        } else {
            tracing::debug!("received forwarded TCP channel but no listener registered");
        }
        Ok(())
    }
}

// SharedState

/// Shared application state containing all session management.
pub struct SharedState {
    pub sftp_sessions: Mutex<HashMap<String, Arc<SftpSession>>>,
    pub port_forwards: Mutex<HashMap<String, PortForwardTask>>,
    pub serial_sessions: Mutex<HashMap<String, SerialSession>>,
}

pub type SharedStateType = Arc<SharedState>;

/// Create and initialize the shared state
pub fn create_shared_state() -> SharedStateType {
    Arc::new(SharedState {
        sftp_sessions: Mutex::new(HashMap::new()),
        port_forwards: Mutex::new(HashMap::new()),
        serial_sessions: Mutex::new(HashMap::new()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ED25519_PUBLIC_KEY: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti";
    #[cfg(any(unix, windows))]
    static SSH_AUTH_SOCK_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    #[cfg(any(unix, windows))]
    fn test_get_ssh_agent_socket_returns_env_var() {
        let _guard = SSH_AUTH_SOCK_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let original = std::env::var_os("SSH_AUTH_SOCK");

        // When SSH_AUTH_SOCK is set, should return Some(value)
        let expected = if cfg!(windows) {
            r"\\.\pipe\terminal-test-agent"
        } else {
            "/tmp/ssh-agent.sock"
        };
        std::env::set_var("SSH_AUTH_SOCK", expected);
        let result = get_ssh_agent_socket();
        assert_eq!(result, Some(expected.to_string()));

        match original {
            Some(value) => std::env::set_var("SSH_AUTH_SOCK", value),
            None => std::env::remove_var("SSH_AUTH_SOCK"),
        }
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn test_get_ssh_agent_socket_returns_none_when_not_set() {
        let _guard = SSH_AUTH_SOCK_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let original = std::env::var_os("SSH_AUTH_SOCK");

        std::env::remove_var("SSH_AUTH_SOCK");
        let result = get_ssh_agent_socket();
        assert_eq!(result, None);

        if let Some(value) = original {
            std::env::set_var("SSH_AUTH_SOCK", value);
        }
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn test_get_ssh_agent_socket_ignores_empty_value() {
        let _guard = SSH_AUTH_SOCK_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let original = std::env::var_os("SSH_AUTH_SOCK");

        std::env::set_var("SSH_AUTH_SOCK", "   ");
        assert_eq!(get_ssh_agent_socket(), None);

        match original {
            Some(value) => std::env::set_var("SSH_AUTH_SOCK", value),
            None => std::env::remove_var("SSH_AUTH_SOCK"),
        }
    }

    #[tokio::test]
    async fn test_create_shared_state_returns_arc() {
        let state = create_shared_state();
        // Verify Arc<SharedState> by cloning and accessing async mutex
        let _clone = Arc::clone(&state);
        let guard = state.serial_sessions.lock().await;
        assert!(guard.is_empty());
    }

    #[tokio::test]
    async fn server_key_is_accepted_only_when_it_matches_known_hosts() {
        let path =
            std::env::temp_dir().join(format!("terminal-known-hosts-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, format!("example.com {ED25519_PUBLIC_KEY}\n")).unwrap();
        let key = russh::keys::PublicKey::from_openssh(ED25519_PUBLIC_KEY).unwrap();
        let mut handler = ClientHandler::for_host_with_known_hosts("example.com", 22, path.clone());

        let accepted = handler.check_server_key(&key).await.unwrap();

        std::fs::remove_file(path).unwrap();
        assert!(accepted);
    }

    #[tokio::test]
    async fn server_key_is_rejected_when_host_is_unknown() {
        let path = std::env::temp_dir().join(format!(
            "terminal-empty-known-hosts-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, "").unwrap();
        let key = russh::keys::PublicKey::from_openssh(ED25519_PUBLIC_KEY).unwrap();
        let mut handler =
            ClientHandler::for_host_with_known_hosts("unknown.example", 22, path.clone());

        let error = handler.check_server_key(&key).await.unwrap_err();

        std::fs::remove_file(path).unwrap();
        assert!(error.to_string().contains("host key verification failed"));
    }

    #[tokio::test]
    async fn server_key_is_rejected_when_known_key_has_changed() {
        let path = std::env::temp_dir().join(format!(
            "terminal-changed-known-hosts-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, format!("example.com {ED25519_PUBLIC_KEY}\n")).unwrap();
        let changed_key = russh::keys::PublicKey::from(
            russh::keys::ssh_key::public::Ed25519PublicKey([0x42; 32]),
        );
        let mut handler = ClientHandler::for_host_with_known_hosts("example.com", 22, path.clone());

        let error = handler.check_server_key(&changed_key).await.unwrap_err();

        std::fs::remove_file(path).unwrap();
        assert!(error.to_string().contains("host key verification failed"));
    }

    #[tokio::test]
    async fn preflight_key_pins_one_time_trust_without_known_hosts_entry() {
        let path = std::env::temp_dir().join(format!(
            "terminal-preflight-empty-known-hosts-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, "").unwrap();
        let key = russh::keys::PublicKey::from_openssh(ED25519_PUBLIC_KEY).unwrap();
        let mut handler =
            ClientHandler::for_host_with_expected_key("example.com", 22, key.clone(), false);
        handler.known_hosts_path = Some(path.clone());

        let accepted = handler.check_server_key(&key).await.unwrap();

        std::fs::remove_file(path).unwrap();
        assert!(accepted);
    }

    #[tokio::test]
    async fn preflight_key_rejects_a_changed_server_key() {
        let expected = russh::keys::PublicKey::from_openssh(ED25519_PUBLIC_KEY).unwrap();
        let changed = russh::keys::PublicKey::from(russh::keys::ssh_key::public::Ed25519PublicKey(
            [0x42; 32],
        ));
        let mut handler =
            ClientHandler::for_host_with_expected_key("example.com", 22, expected, false);

        let error = handler.check_server_key(&changed).await.unwrap_err();

        assert!(error.to_string().contains("preflight key"));
    }

    #[tokio::test]
    async fn preflight_key_does_not_override_a_changed_known_hosts_entry() {
        let path = std::env::temp_dir().join(format!(
            "terminal-preflight-changed-known-hosts-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, format!("example.com {ED25519_PUBLIC_KEY}\n")).unwrap();
        let changed = russh::keys::PublicKey::from(russh::keys::ssh_key::public::Ed25519PublicKey(
            [0x42; 32],
        ));
        let mut handler =
            ClientHandler::for_host_with_expected_key("example.com", 22, changed.clone(), false);
        handler.known_hosts_path = Some(path.clone());

        let result = handler.check_server_key(&changed).await;

        std::fs::remove_file(path).unwrap();
        assert!(
            result.is_err(),
            "a preflight pin must not override a changed key"
        );
    }

    #[tokio::test]
    async fn preflight_key_does_not_override_a_known_hosts_parse_error() {
        let path = std::env::temp_dir().join(format!(
            "terminal-preflight-invalid-known-hosts-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, "example.com ssh-ed25519 not-base64\n").unwrap();
        let key = russh::keys::PublicKey::from_openssh(ED25519_PUBLIC_KEY).unwrap();
        let mut handler =
            ClientHandler::for_host_with_expected_key("example.com", 22, key.clone(), false);
        handler.known_hosts_path = Some(path.clone());

        let result = handler.check_server_key(&key).await;

        std::fs::remove_file(path).unwrap();
        assert!(
            result.is_err(),
            "a preflight pin must not suppress host-key errors"
        );
    }

    #[test]
    fn agent_forwarding_requires_explicit_handler_authorization() {
        let denied = ClientHandler::for_host("example.com", 22);
        let allowed = ClientHandler::for_host_with_agent_forwarding("example.com", 22, true);

        assert!(!denied.allow_agent_forwarding);
        assert!(allowed.allow_agent_forwarding);
    }
}
