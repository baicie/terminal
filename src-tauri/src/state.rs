// Allow dead code for exported Tauri commands - they are called from frontend
#![allow(dead_code)]

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

/// Jump host configuration for connecting through a bastion/jump server
#[derive(Clone, Serialize, Deserialize)]
pub struct JumpHostConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
}

/// Port forwarding task handle
pub struct PortForwardTask {
    pub task: tokio::task::JoinHandle<()>,
}

/// Agent channel state for managing forwarded agent connections
pub(crate) struct AgentChannel {
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
#[derive(Clone, Serialize, Deserialize)]
pub struct SerialConfig {
    pub name: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: String,
    pub flow_control: String,
}

/// Local PTY session state
pub struct LocalPtySession {
    pub pty_pair: portable_pty::PtyPair,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
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
pub struct AgentForwardState {
    pub session_id: String,
    pub socket_path: String,
}

/// Get the SSH_AUTH_SOCK path from environment
#[allow(dead_code)]
pub fn get_ssh_agent_socket() -> Option<String> {
    std::env::var("SSH_AUTH_SOCK").ok()
}

/// ClientHandler with SSH Agent forwarding support
pub struct ClientHandler {
    /// Path to local SSH agent socket (if available)
    agent_socket: Option<PathBuf>,
    /// Session ID for logging/debugging
    session_id: Option<String>,
}

impl ClientHandler {
    pub fn new() -> Self {
        Self {
            agent_socket: get_ssh_agent_socket().map(PathBuf::from),
            session_id: None,
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
        eprintln!("Agent forwarding channel opened by server");
        Ok(())
    }

    async fn data(
        &mut self,
        _channel: ChannelId,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if let Some(ref socket_path) = self.agent_socket {
            if let Ok(mut stream) = std::os::unix::net::UnixStream::connect(socket_path) {
                let _ = stream.write_all(data);
            }
        }
        Ok(())
    }
}

/// Shared application state containing all session management
/// Note: SSH sessions are managed directly by the ssh module to avoid circular dependencies
#[allow(dead_code)]
pub struct SharedState {
    pub local_sessions: Mutex<HashMap<String, LocalPtySession>>,
    pub sftp_sessions: Mutex<HashMap<String, SftpSession>>,
    pub shell_channels: Mutex<HashMap<String, ChannelId>>,
    pub port_forwards: Mutex<HashMap<String, PortForwardTask>>,
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
