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
///
/// 当前在 `session::ssh` 内部按字段使用；保留 derive 是为后续从前端 IPC 直接接收。
#[allow(dead_code)] // wired through session::ssh; kept Serializable for future direct IPC
#[derive(Clone, Serialize, Deserialize)]
pub struct JumpHostConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
}

/// Port forwarding task handle with additional info
pub struct PortForwardTask {
    pub task: tokio::task::JoinHandle<Result<(), PortForwardError>>,
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
///
/// 当前仅由 `agent_channels` map 持有以维持 socket 生命周期；后续
/// 在 transport 替换时可读出 `socket_path`。
pub struct AgentChannel {
    #[allow(dead_code)] // owned for lifecycle; consumed by future agent forwarding refactor
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

/// Serial port connection configuration（保留为 IPC payload 类型，
/// 当前 serial::serial_connect 接收的是逐字段参数，后续若改为单参 struct 即可启用）
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
///
/// 字段并非显式读取 —— 它们在结构体中的存在本身就承担「保持 PTY、
/// 子进程、写入端句柄存活」的所有权语义。Drop 触发时会一起释放。
pub struct LocalPtySession {
    #[allow(dead_code)] // ownership-only: keeps the PTY pair alive
    pub pty_pair: portable_pty::PtyPair,
    #[allow(dead_code)] // ownership-only: keeps the child process alive
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    #[allow(dead_code)] // ownership-only: writer handle owned for shutdown
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

/// Agent forwarding channel state（agent 子模块的 IPC payload 占位类型，
/// 当 agent::forward 完整接入后即可去掉 allow）。
#[allow(dead_code)]
pub struct AgentForwardState {
    pub session_id: String,
    pub socket_path: String,
}

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

/// ClientHandler with SSH Agent forwarding support
pub struct ClientHandler {
    /// Path to local SSH agent socket (if available)。
    /// Unix 路径上 `data()` 会读取它把字节透传给本地 agent；
    /// Windows 上目前没有等价实现，因此在 non-unix 构建中字段未被读取。
    #[cfg_attr(not(unix), allow(dead_code))]
    agent_socket: Option<PathBuf>,
    /// Session ID for logging/debugging。预留给后续 tracing span 使用。
    #[allow(dead_code)] // reserved for tracing span correlation
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
        tracing::info!("agent forwarding channel opened by server");
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
            let _ = data; // Suppress unused warning
        }
        Ok(())
    }
}

/// Shared application state containing all session management.
///
/// SSH sessions are managed directly by the `session::ssh` module to avoid
/// circular dependencies. Each `Mutex<HashMap>` owns its respective resources.
///
/// 部分字段是 *ownership-only*：它们只在 insert / drop 时被访问，
/// 用来托管子进程、socket 等资源的生命周期，不会被显式读取。
pub struct SharedState {
    /// Local PTY 会话（child + writer 由 `LocalPtySession` 持有以维持生命周期）。
    #[allow(dead_code)] // ownership-only: keeps PTY child processes alive
    pub local_sessions: Mutex<HashMap<String, LocalPtySession>>,
    /// SFTP sessions are wrapped in Arc so that long-running transfers
    /// can clone a handle out of the map and release the global lock immediately,
    /// allowing concurrent listings/uploads on the same SSH session.
    pub sftp_sessions: Mutex<HashMap<String, Arc<SftpSession>>>,
    /// Server 通道句柄缓存，未来用于 resize/kill；目前只在打开时写入。
    #[allow(dead_code)] // reserved for resize/kill once we wire shell control commands
    pub shell_channels: Mutex<HashMap<String, ChannelId>>,
    pub port_forwards: Mutex<HashMap<String, PortForwardTask>>,
    /// Agent 转发通道集合，仅托管 socket 生命周期。
    #[allow(dead_code)] // ownership-only: keeps agent forwarding sockets alive
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
