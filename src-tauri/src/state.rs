use crate::errors::PortForwardError;
use anyhow::Result;
use russh::client::{self, Handler};
use russh::{Channel, ChannelId};
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use serialport::SerialPort;
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

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

/// Agent channel state for managing forwarded agent connections.
pub struct AgentChannel {
    #[allow(dead_code)]
    pub socket_path: PathBuf,
}

/// Serial port session state
pub struct SerialSession {
    pub port: Box<dyn SerialPort>,
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

/// Local PTY session state.
pub struct LocalPtySession {
    #[allow(dead_code)]
    pub pty_pair: portable_pty::PtyPair,
    #[allow(dead_code)]
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    #[allow(dead_code)]
    pub writer: Arc<Mutex<Box<dyn Write + Send + 'static>>>,
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
    #[cfg(unix)]
    {
        std::env::var("SSH_AUTH_SOCK").ok()
    }
    #[cfg(not(unix))]
    {
        None
    }
}

/// ClientHandler with SSH Agent forwarding and remote port forwarding support.
pub struct ClientHandler {
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
    pub fn new() -> Self {
        Self {
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
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn server_channel_open_agent_forward(
        &mut self,
        _channel: Channel<client::Msg>,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        tracing::info!("agent forwarding channel opened by server");
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
            let guard = self.forward_listener.read().unwrap_or_else(|e| e.into_inner());
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

    async fn data(
        &mut self,
        _channel: ChannelId,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        #[cfg(unix)]
        {
            if let Some(ref socket_path) = self.agent_socket {
                use std::os::unix::net::UnixStream;
                if let Ok(mut stream) = UnixStream::connect(socket_path) {
                    let _ = stream.write_all(data);
                }
            }
        }
        #[cfg(not(unix))]
        {
            let _ = data;
        }
        Ok(())
    }
}

// SharedState

/// Shared application state containing all session management.
pub struct SharedState {
    #[allow(dead_code)]
    pub local_sessions: Mutex<HashMap<String, LocalPtySession>>,
    pub sftp_sessions: Mutex<HashMap<String, Arc<SftpSession>>>,
    #[allow(dead_code)]
    pub shell_channels: Mutex<HashMap<String, ChannelId>>,
    pub port_forwards: Mutex<HashMap<String, PortForwardTask>>,
    #[allow(dead_code)]
    pub agent_channels: Mutex<HashMap<String, AgentChannel>>,
    pub serial_sessions: Mutex<HashMap<String, SerialSession>>,
}

pub type SharedStateType = Arc<SharedState>;

/// Create and initialize the shared state
pub fn create_shared_state() -> SharedStateType {
    Arc::new(SharedState {
        local_sessions: Mutex::new(HashMap::new()),
        sftp_sessions: Mutex::new(HashMap::new()),
        shell_channels: Mutex::new(HashMap::new()),
        port_forwards: Mutex::new(HashMap::new()),
        agent_channels: Mutex::new(HashMap::new()),
        serial_sessions: Mutex::new(HashMap::new()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn test_get_ssh_agent_socket_returns_env_var() {
        // When SSH_AUTH_SOCK is set, should return Some(value)
        std::env::set_var("SSH_AUTH_SOCK", "/tmp/ssh-agent.sock");
        let result = get_ssh_agent_socket();
        assert_eq!(result, Some("/tmp/ssh-agent.sock".to_string()));
        std::env::remove_var("SSH_AUTH_SOCK");
    }

    #[test]
    #[cfg(unix)]
    fn test_get_ssh_agent_socket_returns_none_when_not_set() {
        std::env::remove_var("SSH_AUTH_SOCK");
        let result = get_ssh_agent_socket();
        assert_eq!(result, None);
    }

    #[test]
    #[cfg(not(unix))]
    fn test_get_ssh_agent_socket_always_none_on_windows() {
        // On non-Unix platforms, always returns None
        let result = get_ssh_agent_socket();
        assert_eq!(result, None);
    }

    use tokio::sync::Mutex as TokioMutex;

    #[tokio::test]
    async fn test_create_shared_state_returns_arc() {
        let state = create_shared_state();
        // Verify Arc<SharedState> by cloning and accessing async mutex
        let _clone = Arc::clone(&state);
        let guard = state.local_sessions.lock().await;
        assert!(guard.is_empty());
    }
}
