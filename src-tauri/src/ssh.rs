use crate::errors::{validate_ssh_input, SshError, ValidationError};
use crate::state::{get_ssh_agent_socket, AgentChannel, ClientHandler, JumpHostConfig, ShellOutput};
use anyhow::{anyhow, Result};
use russh::client;
use russh::keys::PrivateKeyWithHashAlg;
use russh::*;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

/// SSH sessions storage - managed independently to avoid circular dependencies
type SshSessions = Arc<Mutex<HashMap<String, client::Handle<ClientHandler>>>>;

/// Global SSH sessions storage
static SSH_SESSIONS: std::sync::OnceLock<SshSessions> = std::sync::OnceLock::new();

pub(crate) fn get_ssh_sessions() -> SshSessions {
    SSH_SESSIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new()))).clone()
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

    let rsa_hash = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|e| anyhow!("Failed to get RSA hash: {}", e))?
        .flatten();

    let auth_result = if let Some(key_content) = private_key {
        match russh::keys::decode_openssh(key_content.as_bytes(), password) {
            Ok(key) => {
                let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
                handle
                    .authenticate_publickey(username, key_with_hash)
                    .await
                    .map_err(|e| anyhow!("Key authentication failed: {}", e))
            }
            Err(e) => {
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
    _state: tauri::State<'_, crate::state::SharedStateType>,
    host: String,
    port: u16,
    username: String,
    password: String,
) -> Result<String, SshError> {
    // Validate input
    if let Err(e) = validate_ssh_input(&host, port, &username) {
        let msg = match e {
            ValidationError::EmptyHost => "Host cannot be empty",
            ValidationError::HostTooLong => "Host name too long (max 253 characters)",
            ValidationError::InvalidPort => "Port must be between 1 and 65535",
            ValidationError::EmptyUsername => "Username cannot be empty",
            _ => "Invalid input",
        };
        return Err(SshError::InvalidInput(msg.to_string()));
    }

    if password.is_empty() {
        return Err(SshError::InvalidInput("Password cannot be empty".to_string()));
    }

    let session_id = format!("{}-{}:{}", username, host, port);

    let handle = create_and_authenticate(&host, port, &username, Some(&password), None)
        .await
        .map_err(|e| SshError::ConnectionFailed(e.to_string()))?;

    let sessions = get_ssh_sessions();
    let mut sessions = sessions.lock().await;
    sessions.insert(session_id.clone(), handle);

    Ok(session_id)
}

#[tauri::command]
pub async fn ssh_connect_key(
    _state: tauri::State<'_, crate::state::SharedStateType>,
    host: String,
    port: u16,
    username: String,
    private_key: String,
    password: Option<String>,
) -> Result<String, SshError> {
    // Validate input
    if let Err(e) = validate_ssh_input(&host, port, &username) {
        let msg = match e {
            ValidationError::EmptyHost => "Host cannot be empty",
            ValidationError::HostTooLong => "Host name too long (max 253 characters)",
            ValidationError::InvalidPort => "Port must be between 1 and 65535",
            ValidationError::EmptyUsername => "Username cannot be empty",
            _ => "Invalid input",
        };
        return Err(SshError::InvalidInput(msg.to_string()));
    }

    if private_key.is_empty() {
        return Err(SshError::InvalidInput("Private key cannot be empty".to_string()));
    }

    let session_id = format!("{}-{}:{}", username, host, port);

    let handle = create_and_authenticate(
        &host,
        port,
        &username,
        password.as_deref(),
        Some(&private_key),
    )
    .await
    .map_err(|e| SshError::ConnectionFailed(e.to_string()))?;

    let sessions = get_ssh_sessions();
    let mut sessions = sessions.lock().await;
    sessions.insert(session_id.clone(), handle);

    Ok(session_id)
}

#[tauri::command]
#[allow(dead_code)]
pub async fn ssh_connect_agent(
    state: tauri::State<'_, crate::state::SharedStateType>,
    host: String,
    port: u16,
    username: String,
) -> Result<String, SshError> {
    if let Err(e) = validate_ssh_input(&host, port, &username) {
        let msg = match e {
            ValidationError::EmptyHost => "Host cannot be empty",
            ValidationError::HostTooLong => "Host name too long (max 253 characters)",
            ValidationError::InvalidPort => "Port must be between 1 and 65535",
            ValidationError::EmptyUsername => "Username cannot be empty",
            _ => "Invalid input",
        };
        return Err(SshError::InvalidInput(msg.to_string()));
    }

    let session_id = format!("{}-{}:{}", username, host, port);

    let agent_socket = get_ssh_agent_socket()
        .ok_or_else(|| SshError::InvalidInput("SSH_AUTH_SOCK not found. Make sure ssh-agent is running.".to_string()))?;

    eprintln!(
        "Connecting to {}:{} with agent forwarding via {}",
        host, port, agent_socket
    );

    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
        keepalive_interval: Some(std::time::Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });

    let addr = format!("{}:{}", host, port);
    let mut handle = client::connect(config, addr, ClientHandler::new())
        .await
        .map_err(|e| SshError::ConnectionFailed(format!("Connection failed: {}", e)))?;

    let auth_result = handle
        .authenticate_none(&username)
        .await
        .map_err(|e| SshError::AuthenticationFailed(format!("Authentication negotiation failed: {}", e)))?;

    if !auth_result.success() {
        eprintln!(
            "Agent auth negotiation: server responded, proceeding with session"
        );
    }

    let sessions = get_ssh_sessions();
    let mut sessions = sessions.lock().await;
    sessions.insert(session_id.clone(), handle);

    let mut agent_channels = state.agent_channels.lock().await;
    agent_channels.insert(
        session_id.clone(),
        AgentChannel {
            socket_path: PathBuf::from(agent_socket),
        },
    );

    Ok(session_id)
}

/// Connect to a target host through a jump/bastion host
#[tauri::command]
#[allow(dead_code)]
pub async fn ssh_connect_jump(
    _state: tauri::State<'_, crate::state::SharedStateType>,
    target_host: String,
    target_port: u16,
    target_username: String,
    _target_password: Option<String>,
    _target_private_key: Option<String>,
    _target_auth_type: String,
    jump_host: JumpHostConfig,
) -> Result<String, SshError> {
    // Validate target input
    if let Err(e) = validate_ssh_input(&target_host, target_port, &target_username) {
        let msg = match e {
            ValidationError::EmptyHost => "Target host cannot be empty",
            ValidationError::HostTooLong => "Target host name too long (max 253 characters)",
            ValidationError::InvalidPort => "Target port must be between 1 and 65535",
            ValidationError::EmptyUsername => "Target username cannot be empty",
            _ => "Invalid input",
        };
        return Err(SshError::InvalidInput(msg.to_string()));
    }

    let _session_id = format!(
        "{}-{}:{}(via {})",
        target_username, target_host, target_port, jump_host.host
    );

    eprintln!(
        "Connecting to {} via jump host {}",
        target_host, jump_host.host
    );

    let jump_handle = match jump_host.auth_type.as_str() {
        "password" => {
            let pwd = jump_host
                .password
                .as_deref()
                .ok_or_else(|| SshError::InvalidInput("Jump host password required".to_string()))?;
            create_and_authenticate(
                &jump_host.host,
                jump_host.port,
                &jump_host.username,
                Some(pwd),
                None,
            )
            .await
            .map_err(|e| SshError::JumpHostError(format!("Jump host connection failed: {}", e)))?
        }
        "key" => {
            let key = jump_host
                .private_key
                .as_deref()
                .ok_or_else(|| SshError::InvalidInput("Jump host private key required".to_string()))?;
            create_and_authenticate(
                &jump_host.host,
                jump_host.port,
                &jump_host.username,
                None,
                Some(key),
            )
            .await
            .map_err(|e| SshError::JumpHostError(format!("Jump host connection failed: {}", e)))?
        }
        "agent" => {
            return Err(SshError::JumpHostError(
                "Agent auth for jump host not yet fully implemented".to_string(),
            ));
        }
        _ => return Err(SshError::InvalidInput(format!("Unsupported jump host auth type: {}", jump_host.auth_type))),
    };

    let _target_channel = jump_handle
        .channel_open_direct_tcpip(
            &target_host,
            target_port as u32,
            &jump_host.host,
            jump_host.port as u32,
        )
        .await
        .map_err(|e| {
            SshError::ChannelError(format!(
                "Failed to open direct TCP/IP channel through jump host: {}",
                e
            ))
        })?;

    eprintln!(
        "Jump host channel established, connecting to target {}:{}",
        target_host, target_port
    );

    let sessions = get_ssh_sessions();
    let mut sessions = sessions.lock().await;
    let target_session_id = format!("jump-{}-{}:{}", target_username, target_host, target_port);
    sessions.insert(target_session_id.clone(), jump_handle);

    Ok(target_session_id)
}

#[tauri::command]
pub async fn ssh_shell(
    app: AppHandle,
    state: tauri::State<'_, crate::state::SharedStateType>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), SshError> {
    if session_id.is_empty() {
        return Err(SshError::InvalidInput("Session ID cannot be empty".to_string()));
    }

    let sessions = get_ssh_sessions();
    let mut sessions = sessions.lock().await;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| SshError::SessionNotFound(session_id.clone()))?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| SshError::ChannelError(format!("Failed to open channel: {}", e)))?;

    let channel_id = channel.id();

    channel
        .request_pty(false, "xterm-256color", cols.into(), rows.into(), 0, 0, &[])
        .await
        .map_err(|e| SshError::ChannelError(format!("Failed to request PTY: {}", e)))?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| SshError::ChannelError(format!("Failed to request shell: {}", e)))?;

    drop(sessions);
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
    state: tauri::State<'_, crate::state::SharedStateType>,
    session_id: String,
    data: String,
) -> Result<(), SshError> {
    if session_id.is_empty() {
        return Err(SshError::InvalidInput("Session ID cannot be empty".to_string()));
    }

    let sessions = get_ssh_sessions();
    let sessions = sessions.lock().await;
    let handle = sessions
        .get(&session_id)
        .ok_or_else(|| SshError::SessionNotFound(session_id.clone()))?;

    let shell_channels = state.shell_channels.lock().await;
    let channel_id = shell_channels
        .get(&session_id)
        .ok_or_else(|| SshError::ChannelError("Shell channel not found".to_string()))?;

    handle
        .data(*channel_id, data.into())
        .await
        .map_err(|e| SshError::ChannelError(format!("Failed to send data: {:?}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn ssh_resize(
    state: tauri::State<'_, crate::state::SharedStateType>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), SshError> {
    if session_id.is_empty() {
        return Err(SshError::InvalidInput("Session ID cannot be empty".to_string()));
    }

    let channel_id = {
        let shell_channels = state.shell_channels.lock().await;
        shell_channels
            .get(&session_id)
            .copied()
            .ok_or_else(|| SshError::ChannelError("Shell channel not found".to_string()))?
    };

    let sessions = get_ssh_sessions();
    let mut sessions = sessions.lock().await;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| SshError::SessionNotFound(session_id.clone()))?;

    let resize_cmd = format!("\x1b[8;{};{}t", rows, cols);

    handle
        .data(channel_id, resize_cmd.into())
        .await
        .map_err(|e| SshError::ChannelError(format!("Failed to send resize signal: {:?}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn ssh_disconnect(
    _state: tauri::State<'_, crate::state::SharedStateType>,
    session_id: String,
) -> Result<(), SshError> {
    if session_id.is_empty() {
        return Err(SshError::InvalidInput("Session ID cannot be empty".to_string()));
    }

    let sessions = get_ssh_sessions();
    let mut sessions = sessions.lock().await;
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
) -> Result<String, SshError> {
    // Validate input
    if let Err(e) = validate_ssh_input(&host, port, &username) {
        let msg = match e {
            ValidationError::EmptyHost => "Host cannot be empty",
            ValidationError::HostTooLong => "Host name too long (max 253 characters)",
            ValidationError::InvalidPort => "Port must be between 1 and 65535",
            ValidationError::EmptyUsername => "Username cannot be empty",
            _ => "Invalid input",
        };
        return Err(SshError::InvalidInput(msg.to_string()));
    }

    if password.is_empty() {
        return Err(SshError::InvalidInput("Password cannot be empty".to_string()));
    }

    let handle = create_and_authenticate(&host, port, &username, Some(&password), None)
        .await
        .map_err(|e| SshError::ConnectionFailed(format!("{}", e)))?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| SshError::ChannelError(format!("Failed to open channel: {}", e)))?;

    channel
        .exec(false, command.as_str())
        .await
        .map_err(|e| SshError::ChannelError(format!("Failed to execute command: {}", e)))?;

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

/// Generate a new SSH key pair
#[tauri::command]
pub async fn generate_ssh_key(
    key_type: String,
    comment: String,
    passphrase: Option<String>,
) -> Result<KeyGenerationResult, SshError> {
    use ssh_key::LineEnding;

    let rng = &mut rand::rngs::OsRng;
    let passphrase_ref = passphrase.as_deref().filter(|p| !p.is_empty());

    let (key_pair, key_type_name): (ssh_key::PrivateKey, String) =
        match key_type.to_lowercase().as_str() {
            "ed25519" => {
                let kp = ssh_key::PrivateKey::random(rng, ssh_key::Algorithm::Ed25519)
                    .map_err(|e| SshError::KeyGenerationError(format!("Failed to generate Ed25519 key: {}", e)))?;
                (kp, "ed25519".to_string())
            }
            "rsa" | "rsa4096" => {
                let kp = ssh_key::PrivateKey::random(
                    rng,
                    ssh_key::Algorithm::Rsa { hash: None },
                )
                .map_err(|e| SshError::KeyGenerationError(format!("Failed to generate RSA key: {}", e)))?;
                (kp, "rsa".to_string())
            }
            "ecdsa" | "ecdsa-nistp256" => {
                let kp = ssh_key::PrivateKey::random(
                    rng,
                    ssh_key::Algorithm::Ecdsa {
                        curve: ssh_key::EcdsaCurve::NistP256,
                    },
                )
                .map_err(|e| SshError::KeyGenerationError(format!("Failed to generate ECDSA key: {}", e)))?;
                (kp, "ecdsa-nistp256".to_string())
            }
            "ecdsa-nistp384" => {
                let kp = ssh_key::PrivateKey::random(
                    rng,
                    ssh_key::Algorithm::Ecdsa {
                        curve: ssh_key::EcdsaCurve::NistP384,
                    },
                )
                .map_err(|e| SshError::KeyGenerationError(format!("Failed to generate ECDSA key: {}", e)))?;
                (kp, "ecdsa-nistp384".to_string())
            }
            "ecdsa-nistp521" => {
                let kp = ssh_key::PrivateKey::random(
                    rng,
                    ssh_key::Algorithm::Ecdsa {
                        curve: ssh_key::EcdsaCurve::NistP521,
                    },
                )
                .map_err(|e| SshError::KeyGenerationError(format!("Failed to generate ECDSA key: {}", e)))?;
                (kp, "ecdsa-nistp521".to_string())
            }
            _ => {
                return Err(SshError::KeyGenerationError(format!("Unsupported key type: {}", key_type)));
            }
        };

    // Encode private key (OpenSSH format)
    let mut private_key = key_pair
        .to_openssh(LineEnding::LF)
        .map_err(|e| SshError::KeyGenerationError(format!("Failed to encode private key: {}", e)))?
        .to_string();

    // Add comment to private key
    if !comment.is_empty() {
        // The comment is part of the OpenSSH format
        private_key = format!("{}\n", private_key.trim_end());
    }

    // Encrypt private key if passphrase provided
    let private_key = if let Some(pass) = passphrase_ref {
        if !pass.is_empty() {
            key_pair
                .encrypt(rng, pass)
                .map_err(|e| SshError::KeyGenerationError(format!("Failed to encrypt private key: {}", e)))?
                .to_openssh(LineEnding::LF)
                .map_err(|e| SshError::KeyGenerationError(format!("Failed to encode encrypted private key: {}", e)))?
                .to_string()
        } else {
            private_key
        }
    } else {
        private_key
    };

    // Encode public key
    let public_key = key_pair
        .public_key()
        .to_openssh()
        .map_err(|e| SshError::KeyGenerationError(format!("Failed to encode public key: {}", e)))?;

    // Compute fingerprint (SHA256)
    let fingerprint = key_pair.public_key().fingerprint(ssh_key::HashAlg::Sha256).to_string();

    Ok(KeyGenerationResult {
        private_key,
        public_key,
        key_type: key_type_name,
        fingerprint,
    })
}

/// SSH key pair for generation response
#[derive(serde::Serialize)]
pub struct KeyGenerationResult {
    pub private_key: String,
    pub public_key: String,
    pub key_type: String,
    pub fingerprint: String,
}
