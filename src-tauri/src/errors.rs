// Error types for Tauri commands
// Provides typed error enums instead of stringly-typed errors

use serde::Serialize;

/// SSH-related errors
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum SshError {
    #[serde(rename = "connection_failed")]
    ConnectionFailed(String),
    #[serde(rename = "authentication_failed")]
    AuthenticationFailed(String),
    #[serde(rename = "session_not_found")]
    SessionNotFound(String),
    #[serde(rename = "channel_error")]
    ChannelError(String),
    #[serde(rename = "invalid_input")]
    InvalidInput(String),
    #[serde(rename = "jump_host_error")]
    JumpHostError(String),
    #[serde(rename = "key_generation_error")]
    KeyGenerationError(String),
}

/// SFTP-related errors
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum SftpError {
    #[serde(rename = "session_not_found")]
    SessionNotFound,
    #[serde(rename = "read_dir_failed")]
    ReadDirFailed(String),
    #[serde(rename = "upload_failed")]
    UploadFailed(String),
    #[serde(rename = "download_failed")]
    DownloadFailed(String),
    #[serde(rename = "mkdir_failed")]
    MkdirFailed(String),
    #[serde(rename = "delete_failed")]
    DeleteFailed(String),
    #[serde(rename = "rename_failed")]
    RenameFailed(String),
    #[serde(rename = "invalid_path")]
    InvalidPath(String),
}

/// Serial port errors
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum SerialError {
    #[serde(rename = "list_failed")]
    ListFailed(String),
    #[serde(rename = "connect_failed")]
    ConnectFailed(String),
    #[serde(rename = "write_failed")]
    WriteFailed(String),
    #[serde(rename = "session_not_found")]
    SessionNotFound,
    #[serde(rename = "clone_failed")]
    CloneFailed(String),
}

/// Local shell errors
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum LocalError {
    #[serde(rename = "pty_failed")]
    PtyFailed(String),
    #[serde(rename = "shell_failed")]
    ShellFailed(String),
    #[serde(rename = "write_failed")]
    WriteFailed(String),
    #[serde(rename = "resize_failed")]
    ResizeFailed(String),
    #[serde(rename = "session_not_found")]
    SessionNotFound,
    #[allow(dead_code)]
    #[serde(rename = "kill_failed")]
    KillFailed(String),
}

/// Port forwarding errors
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum PortForwardError {
    #[serde(rename = "session_not_found")]
    SessionNotFound,
    #[serde(rename = "bind_failed")]
    BindFailed(String),
    #[serde(rename = "forward_not_found")]
    ForwardNotFound,
}

/// Vault errors
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum VaultError {
    #[serde(rename = "vault_locked")]
    VaultLocked,
    #[serde(rename = "key_not_found")]
    KeyNotFound(String),
    #[serde(rename = "create_failed")]
    CreateFailed(String),
    #[serde(rename = "unlock_failed")]
    UnlockFailed(String),
    #[serde(rename = "encrypt_failed")]
    EncryptFailed(String),
    #[serde(rename = "decrypt_failed")]
    DecryptFailed(String),
    #[serde(rename = "save_failed")]
    SaveFailed(String),
    #[serde(rename = "invalid_password")]
    InvalidPassword,
}

/// Input validation errors
#[derive(Debug, Clone, Serialize)]
pub enum ValidationError {
    #[serde(rename = "empty_host")]
    EmptyHost,
    #[serde(rename = "host_too_long")]
    HostTooLong,
    #[serde(rename = "invalid_port")]
    InvalidPort,
    #[serde(rename = "empty_username")]
    EmptyUsername,
    #[allow(dead_code)]
    #[serde(rename = "empty_password")]
    EmptyPassword,
    #[allow(dead_code)]
    #[serde(rename = "empty_session_id")]
    EmptySessionId,
    #[allow(dead_code)]
    #[serde(rename = "empty_path")]
    EmptyPath,
    #[allow(dead_code)]
    #[serde(rename = "unsupported_key_type")]
    UnsupportedKeyType(String),
}

/// Common input validation helper
pub fn validate_ssh_input(host: &str, port: u16, username: &str) -> Result<(), ValidationError> {
    if host.is_empty() {
        return Err(ValidationError::EmptyHost);
    }
    if host.len() > 253 {
        return Err(ValidationError::HostTooLong);
    }
    if !(1..=65535).contains(&port) {
        return Err(ValidationError::InvalidPort);
    }
    if username.is_empty() {
        return Err(ValidationError::EmptyUsername);
    }
    Ok(())
}
