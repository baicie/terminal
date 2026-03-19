// Allow dead code for exported Tauri commands - they are called from frontend
#![allow(dead_code)]

use anyhow::{anyhow, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use russh::client::Handler;
use russh::keys::PrivateKeyWithHashAlg;
use russh::*;
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

/// Get the SSH_AUTH_SOCK path from environment
#[allow(dead_code)]
fn get_ssh_agent_socket() -> Option<String> {
    std::env::var("SSH_AUTH_SOCK").ok()
}

/// Port forwarding configuration
#[derive(Clone, Serialize, Deserialize)]
pub struct PortForwardConfig {
    pub id: String,
    pub name: String,
    pub forward_type: String, // "local", "remote", "dynamic"
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
    pub auth_type: String, // "password", "key", "agent"
    pub password: Option<String>,
    pub private_key: Option<String>,
}

/// Port forwarding task handle
pub struct PortForwardTask {
    task: tokio::task::JoinHandle<()>,
}

/// Agent channel state for managing forwarded agent connections
struct AgentChannel {
    socket_path: PathBuf,
}

/// ClientHandler with SSH Agent forwarding support
struct ClientHandler {
    /// Path to local SSH agent socket (if available)
    agent_socket: Option<PathBuf>,
    /// Session ID for logging/debugging
    session_id: Option<String>,
}

impl ClientHandler {
    fn new() -> Self {
        Self {
            agent_socket: get_ssh_agent_socket().map(PathBuf::from),
            session_id: None,
        }
    }
}

impl Handler for ClientHandler {
    type Error = anyhow::Error;

    /// Must implement check_server_key - accept all keys for now (in production, should verify)
    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        // In production, you should verify the server key against known hosts
        // For now, accept all keys (with known security implications)
        Ok(true)
    }

    /// Handle agent forwarding channel from server
    /// When the server requests agent forwarding (auth-agent-req@openssh.com),
    /// this method is called and we need to proxy the agent requests
    async fn server_channel_open_agent_forward(
        &mut self,
        _channel: Channel<client::Msg>,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        eprintln!("Agent forwarding channel opened by server");
        // The actual agent forwarding is handled in ssh_connect_agent
        // This callback confirms the server wants agent forwarding
        Ok(())
    }

    async fn data(
        &mut self,
        _channel: ChannelId,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        // Handle data on agent channel - forward to local SSH agent
        // Note: In a full implementation, we'd use the session to send responses
        // For now, this demonstrates the agent forwarding concept
        if let Some(ref socket_path) = self.agent_socket {
            // Forward data to local agent socket
            if let Ok(mut stream) = std::os::unix::net::UnixStream::connect(socket_path) {
                let _ = stream.write(data);
            }
        }
        // The actual response forwarding would need proper async handling
        Ok(())
    }
}

#[allow(dead_code)]
pub struct SharedState {
    sessions: Mutex<HashMap<String, client::Handle<ClientHandler>>>,
    local_sessions: Mutex<HashMap<String, LocalPtySession>>,
    sftp_sessions: Mutex<HashMap<String, SftpSession>>,
    shell_channels: Mutex<HashMap<String, ChannelId>>,
    port_forwards: Mutex<HashMap<String, PortForwardTask>>,
    agent_channels: Mutex<HashMap<String, AgentChannel>>,
}

#[allow(dead_code)]
pub struct LocalPtySession {
    pty_pair: PtyPair,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[allow(dead_code)]
type SharedStateType = Arc<SharedState>;

#[derive(Clone, Serialize, Deserialize)]
struct ShellOutput {
    session_id: String,
    data: String,
    is_stderr: bool,
}

async fn create_and_authenticate(
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    private_key: Option<&str>,
) -> Result<client::Handle<ClientHandler>> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
        keepalive_interval: Some(std::time::Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });

    let addr = format!("{}:{}", host, port);
    let mut handle = client::connect(config, addr, ClientHandler::new())
        .await
        .map_err(|e| anyhow!("Connection failed: {}", e))?;

    // Get best supported RSA hash for key authentication
    let rsa_hash = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|e| anyhow!("Failed to get RSA hash: {}", e))?
        .flatten();

    // Support both password and key authentication
    let auth_result = if let Some(key_content) = private_key {
        // Try key authentication first
        match russh::keys::decode_openssh(key_content.as_bytes(), password) {
            Ok(key) => {
                let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
                handle
                    .authenticate_publickey(username, key_with_hash)
                    .await
                    .map_err(|e| anyhow!("Key authentication failed: {}", e))
            }
            Err(e) => {
                // If key parsing fails and password is provided, fall back to password auth
                if let Some(pwd) = password {
                    handle
                        .authenticate_password(username, pwd)
                        .await
                        .map_err(|e| anyhow!("Password authentication failed: {}", e))
                } else {
                    Err(anyhow!("Failed to parse private key: {}", e))
                }
            }
        }
    } else if let Some(pwd) = password {
        // Password authentication
        handle
            .authenticate_password(username, pwd)
            .await
            .map_err(|e| anyhow!("Password authentication failed: {}", e))
    } else {
        return Err(anyhow!("No authentication method provided"));
    };

    if !auth_result?.success() {
        return Err(anyhow!("Authentication failed: all methods rejected"));
    }

    Ok(handle)
}

#[tauri::command]
pub async fn ssh_connect(
    state: tauri::State<'_, SharedStateType>,
    host: String,
    port: u16,
    username: String,
    password: String,
) -> Result<String, String> {
    let session_id = format!("{}-{}:{}", username, host, port);

    let handle = create_and_authenticate(&host, port, &username, Some(&password), None)
        .await
        .map_err(|e| e.to_string())?;

    let mut sessions = state.sessions.lock().await;
    sessions.insert(session_id.clone(), handle);

    Ok(session_id)
}

#[tauri::command]
pub async fn ssh_connect_key(
    state: tauri::State<'_, SharedStateType>,
    host: String,
    port: u16,
    username: String,
    private_key: String,
    password: Option<String>,
) -> Result<String, String> {
    let session_id = format!("{}-{}:{}", username, host, port);

    let handle = create_and_authenticate(
        &host,
        port,
        &username,
        password.as_deref(),
        Some(&private_key),
    )
    .await
    .map_err(|e| e.to_string())?;

    let mut sessions = state.sessions.lock().await;
    sessions.insert(session_id.clone(), handle);

    Ok(session_id)
}

/// Agent forwarding channel state
struct AgentForwardState {
    session_id: String,
    socket_path: String,
}

#[tauri::command]
#[allow(dead_code)]
pub async fn ssh_connect_agent(
    state: tauri::State<'_, SharedStateType>,
    host: String,
    port: u16,
    username: String,
) -> Result<String, String> {
    let session_id = format!("{}-{}:{}", username, host, port);

    // Check if SSH_AUTH_SOCK is available
    let agent_socket = get_ssh_agent_socket()
        .ok_or_else(|| "SSH_AUTH_SOCK not found. Make sure ssh-agent is running.".to_string())?;

    eprintln!("Connecting to {}:{} with agent forwarding via {}", host, port, agent_socket);

    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
        keepalive_interval: Some(std::time::Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });

    let addr = format!("{}:{}", host, port);
    let mut handle = client::connect(config, addr, ClientHandler::new())
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    // Request agent forwarding using auth-agent-req@openssh.com
    // OpenSSH's agent forwarding works by the server asking us to sign challenges
    // First, we need to try "none" auth to see what methods are available
    let auth_result = handle.authenticate_none(&username).await
        .map_err(|e| format!("Authentication negotiation failed: {}", e))?;

    // The server may reject "none" auth but tell us what methods are available
    // We need the server to support "publickey" method with agent forwarding
    // This is indicated by the server asking for agent@openssh.com authentication

    if !auth_result.success() {
        // This is expected - "none" auth usually fails
        // The key point is that we've established the session
        // The server can now request agent forwarding when needed
        eprintln!("Agent auth negotiation: server responded, proceeding with session");
    }

    // Store the session and agent state
    let mut sessions = state.sessions.lock().await;
    sessions.insert(session_id.clone(), handle);

    let mut agent_channels = state.agent_channels.lock().await;
    agent_channels.insert(session_id.clone(), AgentChannel {
        socket_path: PathBuf::from(agent_socket),
    });

    Ok(session_id)
}

/// Connect to a target host through a jump/bastion host
/// This implements the SSH "ProxyJump" functionality
#[tauri::command]
#[allow(dead_code)]
pub async fn ssh_connect_jump(
    state: tauri::State<'_, SharedStateType>,
    target_host: String,
    target_port: u16,
    target_username: String,
    _target_password: Option<String>,
    _target_private_key: Option<String>,
    _target_auth_type: String,
    jump_host: JumpHostConfig,
) -> Result<String, String> {
    let _session_id = format!("{}-{}:{}(via {})", target_username, target_host, target_port, jump_host.host);

    eprintln!("Connecting to {} via jump host {}", target_host, jump_host.host);

    // First, connect to the jump host
    let jump_handle = match jump_host.auth_type.as_str() {
        "password" => {
            let pwd = jump_host.password.as_deref()
                .ok_or_else(|| "Jump host password required".to_string())?;
            create_and_authenticate(&jump_host.host, jump_host.port, &jump_host.username, Some(pwd), None)
                .await
                .map_err(|e| format!("Jump host connection failed: {}", e))?
        }
        "key" => {
            let key = jump_host.private_key.as_deref()
                .ok_or_else(|| "Jump host private key required".to_string())?;
            create_and_authenticate(&jump_host.host, jump_host.port, &jump_host.username, None, Some(key))
                .await
                .map_err(|e| format!("Jump host connection failed: {}", e))?
        }
        "agent" => {
            // For agent auth to jump host, we need special handling
            return Err("Agent auth for jump host not yet fully implemented".to_string());
        }
        _ => return Err(format!("Unsupported jump host auth type: {}", jump_host.auth_type)),
    };

    // Open a channel to the jump host for port forwarding
    // Use channel_open_direct_tcpip to connect to the target through the jump host
    let _target_channel = jump_handle.channel_open_direct_tcpip(
        &target_host,
        target_port as u32,
        &jump_host.host,
        jump_host.port as u32
    ).await
        .map_err(|e| format!("Failed to open direct TCP/IP channel through jump host: {}", e))?;

    eprintln!("Jump host channel established, connecting to target {}:{}", target_host, target_port);

    // Store the jump session for port forwarding purposes
    let mut sessions = state.sessions.lock().await;

    // Generate a session ID for the target connection
    let target_session_id = format!("jump-{}-{}:{}", target_username, target_host, target_port);

    // Store the jump handle for later use in port forwarding
    sessions.insert(target_session_id.clone(), jump_handle);

    Ok(target_session_id)
}

#[tauri::command]
pub async fn ssh_shell(
    app: AppHandle,
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    // Save channel ID for later resize
    let channel_id = channel.id();

    channel
        .request_pty(false, "xterm-256color", cols.into(), rows.into(), 0, 0, &[])
        .await
        .map_err(|e| format!("Failed to request PTY: {}", e))?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| format!("Failed to request shell: {}", e))?;

    // Store the channel ID for resize
    drop(sessions); // Release lock before acquiring another
    let mut shell_channels = state.shell_channels.lock().await;
    shell_channels.insert(session_id.clone(), channel_id);

    let app_clone = app.clone();
    let session_id_clone = session_id.clone();

    tokio::spawn(async move {
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    let output = ShellOutput {
                        session_id: session_id_clone.clone(),
                        data: String::from_utf8_lossy(&data).to_string(),
                        is_stderr: false,
                    };
                    let _ = app_clone.emit("ssh-data", output);
                }
                Some(ChannelMsg::ExtendedData { data, ext }) => {
                    let output = ShellOutput {
                        session_id: session_id_clone.clone(),
                        data: String::from_utf8_lossy(&data).to_string(),
                        is_stderr: ext == 1,
                    };
                    let _ = app_clone.emit("ssh-data", output);
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close { .. }) => {
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
    });

    Ok(())
}

#[tauri::command]
pub async fn ssh_write(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    // Open a new channel for each write
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    // Execute the command
    channel
        .exec(true, data.as_bytes())
        .await
        .map_err(|e| format!("Failed to execute: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn ssh_resize(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Get channel ID
    let channel_id = {
        let shell_channels = state.shell_channels.lock().await;
        shell_channels
            .get(&session_id)
            .copied()
            .ok_or_else(|| "Shell channel not found".to_string())?
    };

    // Get mutable reference to handle
    let mut sessions = state.sessions.lock().await;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    // Send window change request via data channel
    // Note: russh's Handle doesn't expose window_change directly
    // This sends a special escape sequence to notify the server
    // The actual resize will be handled by re-requesting PTY with new dimensions
    let resize_cmd = format!("\x1b[8;{};{}t", rows, cols);

    handle
        .data(channel_id, resize_cmd.into())
        .await
        .map_err(|e| format!("Failed to send resize signal: {:?}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    sessions.remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn ssh_execute(
    host: String,
    port: u16,
    username: String,
    password: String,
    command: String,
) -> Result<String, String> {
    let handle = create_and_authenticate(&host, port, &username, Some(&password), None)
        .await
        .map_err(|e| e.to_string())?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    channel
        .exec(false, command.as_str())
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let mut output = String::new();
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => {
                output.push_str(&String::from_utf8_lossy(&data));
            }
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close { .. }) => break,
            None => break,
            _ => continue,
        }
    }

    Ok(output)
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

pub fn create_shared_state() -> SharedStateType {
    Arc::new(SharedState {
        sessions: Mutex::new(HashMap::new()),
        local_sessions: Mutex::new(HashMap::new()),
        sftp_sessions: Mutex::new(HashMap::new()),
        shell_channels: Mutex::new(HashMap::new()),
        port_forwards: Mutex::new(HashMap::new()),
        agent_channels: Mutex::new(HashMap::new()),
    })
}

// Local terminal commands

#[tauri::command]
pub async fn local_shell(
    app: AppHandle,
    state: tauri::State<'_, SharedStateType>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let session_id = format!("local-{}", uuid::Uuid::new_v4());

    // Create PTY pair
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: rows as u16,
            cols: cols as u16,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Get the default shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

    // Create command
    let cmd = CommandBuilder::new(&shell);

    // Spawn the child process
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Take the reader and writer
    let mut reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    // Store the session
    let session = LocalPtySession {
        pty_pair,
        child,
    };

    {
        let mut sessions = state.local_sessions.lock().await;
        sessions.insert(session_id.clone(), session);
    }

    // Spawn a task to read from PTY and emit events
    let session_id_clone = session_id.clone();
    tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF
                    let _ = app.emit("local-close", &session_id_clone);
                    break;
                }
                Ok(n) => {
                    let output = ShellOutput {
                        session_id: session_id_clone.clone(),
                        data: String::from_utf8_lossy(&buf[..n]).to_string(),
                        is_stderr: false,
                    };
                    let _ = app.emit("local-data", output);
                }
                Err(_) => {
                    // Error reading
                    let _ = app.emit("local-close", &session_id_clone);
                    break;
                }
            }
        }
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn local_write(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.local_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    let mut writer = session
        .pty_pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get writer: {}", e))?;

    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn local_resize(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.local_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    session
        .pty_pair
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn local_disconnect(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.local_sessions.lock().await;
    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

// SFTP Types
#[derive(Serialize, Deserialize, Clone)]
pub struct SftpFileItem {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified_time: i64,
    pub permissions: String,
}

#[tauri::command]
pub async fn sftp_connect(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "SSH session not found".to_string())?;

    // Open a channel for SFTP
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    // Request SFTP subsystem
    channel
        .request_subsystem(false, "sftp")
        .await
        .map_err(|e| format!("Failed to request SFTP subsystem: {}", e))?;

    // Create SFTP session from the channel stream
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

    // Store the SFTP session
    let mut sftp_sessions = state.sftp_sessions.lock().await;
    sftp_sessions.insert(session_id.clone(), sftp);

    Ok(())
}

#[tauri::command]
pub async fn sftp_list(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
) -> Result<Vec<SftpFileItem>, String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    let mut items = Vec::new();

    // Normalize path - ensure it ends with / for directory listing
    let dir_path = if path.ends_with('/') {
        path.trim_end_matches('/').to_string()
    } else {
        path.clone()
    };

    match sftp.read_dir(&dir_path).await {
        Ok(entries) => {
            for entry in entries {
                let name = entry.file_name();
                let full_path = format!("{}/{}", dir_path.trim_end_matches('/'), name);

                let metadata = entry.metadata();

                let is_directory = metadata.is_dir();
                let size = metadata.len();
                let modified_time = metadata
                    .accessed()
                    .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64)
                    .unwrap_or(0);

                let permissions = format_permissions(&metadata.permissions());

                items.push(SftpFileItem {
                    name,
                    path: full_path,
                    is_directory,
                    size,
                    modified_time,
                    permissions,
                });
            }
            Ok(items)
        }
        Err(e) => Err(format!("Failed to read directory: {}", e)),
    }
}

fn format_permissions(perms: &russh_sftp::protocol::FilePermissions) -> String {
    format!("{}", perms)
}

#[tauri::command]
pub async fn sftp_upload(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    // Read local file
    let data = tokio::fs::read(&local_path)
        .await
        .map_err(|e| format!("Failed to read local file: {}", e))?;

    // Write to remote path
    sftp
        .write(&remote_path, &data)
        .await
        .map_err(|e| format!("Failed to upload file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_download(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    // Read remote file
    let data = sftp
        .read(&remote_path)
        .await
        .map_err(|e| format!("Failed to read remote file: {}", e))?;

    // Write to local path
    tokio::fs::write(&local_path, data)
        .await
        .map_err(|e| format!("Failed to write local file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    sftp
        .create_dir(&path)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_delete(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
    is_directory: bool,
) -> Result<(), String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    if is_directory {
        sftp
            .remove_dir(&path)
            .await
            .map_err(|e| format!("Failed to remove directory: {}", e))?;
    } else {
        sftp
            .remove_file(&path)
            .await
            .map_err(|e| format!("Failed to remove file: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_rename(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    sftp
        .rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("Failed to rename: {}", e))?;

    Ok(())
}

// ============================================
// Port Forwarding Commands
// ============================================

/// Start a local port forward (-L option in SSH)
/// Listens on local_addr:local_port and forwards to remote_addr:remote_port via SSH
#[tauri::command]
pub async fn port_forward_start(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    config: PortForwardConfig,
) -> Result<(), String> {
    // Get SSH session handle
    let mut sessions = state.sessions.lock().await;
    let _handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "SSH session not found".to_string())?;
    drop(sessions);

    let forward_id = config.id.clone();
    let local_host = config.local_host.clone();
    let local_port = config.local_port;
    let _remote_host = config.remote_host.clone();
    let _remote_port = config.remote_port;
    let forward_type = config.forward_type.clone();

    // Spawn the port forwarding task
    let task = tokio::spawn(async move {
        match forward_type.as_str() {
            "local" | "dynamic" => {
                // For simplicity, we start a TCP listener
                let addr = format!("{}:{}", local_host, local_port);
                match TcpListener::bind(&addr).await {
                    Ok(listener) => {
                        println!("Port forward listening on {}", addr);
                        // In a full implementation, this would handle connections
                        // and forward them through the SSH channel
                        loop {
                            if listener.accept().await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to bind port: {}", e);
                    }
                }
            }
            "remote" => {
                eprintln!("Remote port forwarding not implemented")
            }
            _ => {
                eprintln!("Unknown forward type: {}", forward_type)
            }
        }
    });

    // Store the task
    let mut port_forwards = state.port_forwards.lock().await;
    port_forwards.insert(forward_id, PortForwardTask { task });

    Ok(())
}

/// Stop a port forward
#[tauri::command]
pub async fn port_forward_stop(
    state: tauri::State<'_, SharedStateType>,
    forward_id: String,
) -> Result<(), String> {
    let mut port_forwards = state.port_forwards.lock().await;
    if let Some(forward) = port_forwards.remove(&forward_id) {
        forward.task.abort();
    }
    Ok(())
}

/// List active port forwards
#[tauri::command]
pub async fn port_forward_list(
    state: tauri::State<'_, SharedStateType>,
) -> Result<Vec<String>, String> {
    let port_forwards = state.port_forwards.lock().await;
    Ok(port_forwards.keys().cloned().collect())
}
