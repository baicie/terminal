// Error types for Tauri commands

use serde::Serialize;

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
    #[serde(rename = "connection_failed")]
    ConnectionFailed(String),
    #[serde(rename = "channel_failed")]
    ChannelFailed(String),
    #[serde(rename = "socks_unsupported")]
    SocksUnsupported(String),
    #[serde(rename = "socks_auth_failed")]
    SocksAuthFailed(String),
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

/// Storage service errors
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "message")]
#[allow(dead_code)]
pub enum StorageError {
    #[serde(rename = "not_configured")]
    NotConfigured,
    #[serde(rename = "connection_failed")]
    ConnectionFailed(String),
    #[serde(rename = "upload_failed")]
    UploadFailed(String),
    #[serde(rename = "download_failed")]
    DownloadFailed(String),
    #[serde(rename = "delete_failed")]
    DeleteFailed(String),
    #[serde(rename = "list_failed")]
    ListFailed(String),
}
