use anyhow::{anyhow, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use russh::client::Handler;
use russh::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

struct ClientHandler;

impl Handler for ClientHandler {
    type Error = anyhow::Error;
}

pub struct SharedState {
    sessions: Mutex<HashMap<String, client::Handle<ClientHandler>>>,
    local_sessions: Mutex<HashMap<String, LocalPtySession>>,
}

pub struct LocalPtySession {
    pty_pair: PtyPair,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

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
    _private_key: Option<&str>,
) -> Result<client::Handle<ClientHandler>> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
        keepalive_interval: Some(std::time::Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });

    let addr = format!("{}:{}", host, port);
    let mut handle = client::connect(config, addr, ClientHandler)
        .await
        .map_err(|e| anyhow!("Connection failed: {}", e))?;

    // Currently using password authentication
    // SSH key authentication will be implemented in a future update
    if let Some(pwd) = password {
        handle
            .authenticate_password(username, pwd)
            .await
            .map_err(|e| anyhow!("Password authentication failed: {}", e))?;
    } else {
        return Err(anyhow!("No authentication method provided"));
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

#[tauri::command]
pub async fn ssh_connect_agent(
    _state: tauri::State<'_, SharedStateType>,
    _host: String,
    _port: u16,
    _username: String,
) -> Result<String, String> {
    Err("Agent authentication not implemented".to_string())
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

    channel
        .request_pty(false, "xterm-256color", cols.into(), rows.into(), 0, 0, &[])
        .await
        .map_err(|e| format!("Failed to request PTY: {}", e))?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| format!("Failed to request shell: {}", e))?;

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
    let mut channel = handle
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
    _state: tauri::State<'_, SharedStateType>,
    _session_id: String,
    _cols: u16,
    _rows: u16,
) -> Result<(), String> {
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
    let mut cmd = CommandBuilder::new(&shell);

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
                Err(e) => {
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
pub async fn sftp_list(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
) -> Result<Vec<SftpFileItem>, String> {
    // This is a placeholder - actual SFTP implementation requires
    // maintaining an SFTP session per SSH connection
    // For now, we'll use a simple ls command to get file listing
    let sessions = state.sessions.lock().await;
    let _handle = sessions.get(&session_id).ok_or("Session not found")?;

    // Return empty list - actual SFTP implementation would use russh-sftp
    Ok(vec![])
}

#[tauri::command]
pub async fn sftp_upload(
    _session_id: String,
    _local_path: String,
    _remote_path: String,
) -> Result<(), String> {
    // Placeholder - SFTP upload implementation
    Err("SFTP upload not implemented".to_string())
}

#[tauri::command]
pub async fn sftp_download(
    _session_id: String,
    _remote_path: String,
    _local_path: String,
) -> Result<(), String> {
    // Placeholder - SFTP download implementation
    Err("SFTP download not implemented".to_string())
}

#[tauri::command]
pub async fn sftp_mkdir(
    _session_id: String,
    _path: String,
) -> Result<(), String> {
    // Placeholder - SFTP mkdir implementation
    Err("SFTP mkdir not implemented".to_string())
}

#[tauri::command]
pub async fn sftp_delete(
    _session_id: String,
    _path: String,
    _is_directory: bool,
) -> Result<(), String> {
    // Placeholder - SFTP delete implementation
    Err("SFTP delete not implemented".to_string())
}

#[tauri::command]
pub async fn sftp_rename(
    _session_id: String,
    _old_path: String,
    _new_path: String,
) -> Result<(), String> {
    // Placeholder - SFTP rename implementation
    Err("SFTP rename not implemented".to_string())
}
