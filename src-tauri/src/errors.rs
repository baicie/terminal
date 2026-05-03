// Error types for Tauri commands

use serde::Serialize;
use thiserror::Error;

/// SFTP-related errors
#[derive(Debug, Clone, Error, Serialize)]
#[serde(from = "SftpErrorDto", into = "SftpErrorDto")]
#[error(transparent)]
pub enum SftpError {
    #[error("session not found")]
    SessionNotFound,
    #[error("read directory failed: {0}")]
    ReadDirFailed(String),
    #[error("upload failed: {0}")]
    UploadFailed(String),
    #[error("download failed: {0}")]
    DownloadFailed(String),
    #[error("mkdir failed: {0}")]
    MkdirFailed(String),
    #[error("delete failed: {0}")]
    DeleteFailed(String),
    #[error("rename failed: {0}")]
    RenameFailed(String),
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("checksum failed: {0}")]
    ChecksumFailed(String),
}

#[derive(Serialize)]
struct SftpErrorDto {
    #[serde(rename = "type")]
    kind: &'static str,
    message: Option<String>,
}

impl From<SftpError> for SftpErrorDto {
    fn from(e: SftpError) -> Self {
        match e {
            SftpError::SessionNotFound => Self { kind: "session_not_found", message: None },
            SftpError::ReadDirFailed(m) => Self { kind: "read_dir_failed", message: Some(m) },
            SftpError::UploadFailed(m) => Self { kind: "upload_failed", message: Some(m) },
            SftpError::DownloadFailed(m) => Self { kind: "download_failed", message: Some(m) },
            SftpError::MkdirFailed(m) => Self { kind: "mkdir_failed", message: Some(m) },
            SftpError::DeleteFailed(m) => Self { kind: "delete_failed", message: Some(m) },
            SftpError::RenameFailed(m) => Self { kind: "rename_failed", message: Some(m) },
            SftpError::InvalidPath(m) => Self { kind: "invalid_path", message: Some(m) },
            SftpError::ChecksumFailed(m) => Self { kind: "checksum_failed", message: Some(m) },
        }
    }
}

impl From<SftpErrorDto> for SftpError {
    fn from(dto: SftpErrorDto) -> Self {
        match (dto.kind, dto.message) {
            ("session_not_found", _) => SftpError::SessionNotFound,
            ("read_dir_failed", Some(m)) => SftpError::ReadDirFailed(m),
            ("upload_failed", Some(m)) => SftpError::UploadFailed(m),
            ("download_failed", Some(m)) => SftpError::DownloadFailed(m),
            ("mkdir_failed", Some(m)) => SftpError::MkdirFailed(m),
            ("delete_failed", Some(m)) => SftpError::DeleteFailed(m),
            ("rename_failed", Some(m)) => SftpError::RenameFailed(m),
            ("invalid_path", Some(m)) => SftpError::InvalidPath(m),
            ("checksum_failed", Some(m)) => SftpError::ChecksumFailed(m),
            _ => SftpError::SessionNotFound,
        }
    }
}

/// Serial port errors
#[derive(Debug, Clone, Error, Serialize)]
#[serde(from = "SerialErrorDto", into = "SerialErrorDto")]
#[error(transparent)]
pub enum SerialError {
    #[error("failed to list serial ports: {0}")]
    ListFailed(String),
    #[error("failed to connect: {0}")]
    ConnectFailed(String),
    #[error("failed to write: {0}")]
    WriteFailed(String),
    #[error("session not found")]
    SessionNotFound,
    #[error("clone failed: {0}")]
    CloneFailed(String),
}

#[derive(Serialize)]
struct SerialErrorDto {
    #[serde(rename = "type")]
    kind: &'static str,
    message: Option<String>,
}

impl From<SerialError> for SerialErrorDto {
    fn from(e: SerialError) -> Self {
        match e {
            SerialError::ListFailed(m) => Self { kind: "list_failed", message: Some(m) },
            SerialError::ConnectFailed(m) => Self { kind: "connect_failed", message: Some(m) },
            SerialError::WriteFailed(m) => Self { kind: "write_failed", message: Some(m) },
            SerialError::SessionNotFound => Self { kind: "session_not_found", message: None },
            SerialError::CloneFailed(m) => Self { kind: "clone_failed", message: Some(m) },
        }
    }
}

impl From<SerialErrorDto> for SerialError {
    fn from(dto: SerialErrorDto) -> Self {
        match (dto.kind, dto.message) {
            ("list_failed", Some(m)) => SerialError::ListFailed(m),
            ("connect_failed", Some(m)) => SerialError::ConnectFailed(m),
            ("write_failed", Some(m)) => SerialError::WriteFailed(m),
            ("session_not_found", _) => SerialError::SessionNotFound,
            ("clone_failed", Some(m)) => SerialError::CloneFailed(m),
            _ => SerialError::ListFailed("unknown error".to_string()),
        }
    }
}

/// Port forwarding errors
#[derive(Debug, Clone, Error, Serialize)]
#[serde(from = "PortForwardErrorDto", into = "PortForwardErrorDto")]
#[error(transparent)]
pub enum PortForwardError {
    #[error("session not found")]
    SessionNotFound,
    #[error("bind failed: {0}")]
    BindFailed(String),
    #[error("forward not found")]
    ForwardNotFound,
    #[error("connection failed: {0}")]
    ConnectionFailed(String),
    #[error("channel failed: {0}")]
    ChannelFailed(String),
    #[error("SOCKS unsupported: {0}")]
    SocksUnsupported(String),
    #[error("SOCKS auth failed: {0}")]
    SocksAuthFailed(String),
}

#[derive(Serialize)]
struct PortForwardErrorDto {
    #[serde(rename = "type")]
    kind: &'static str,
    message: Option<String>,
}

impl From<PortForwardError> for PortForwardErrorDto {
    fn from(e: PortForwardError) -> Self {
        match e {
            PortForwardError::SessionNotFound => Self { kind: "session_not_found", message: None },
            PortForwardError::BindFailed(m) => Self { kind: "bind_failed", message: Some(m) },
            PortForwardError::ForwardNotFound => Self { kind: "forward_not_found", message: None },
            PortForwardError::ConnectionFailed(m) => Self { kind: "connection_failed", message: Some(m) },
            PortForwardError::ChannelFailed(m) => Self { kind: "channel_failed", message: Some(m) },
            PortForwardError::SocksUnsupported(m) => Self { kind: "socks_unsupported", message: Some(m) },
            PortForwardError::SocksAuthFailed(m) => Self { kind: "socks_auth_failed", message: Some(m) },
        }
    }
}

impl From<PortForwardErrorDto> for PortForwardError {
    fn from(dto: PortForwardErrorDto) -> Self {
        match (dto.kind, dto.message) {
            ("session_not_found", _) => PortForwardError::SessionNotFound,
            ("bind_failed", Some(m)) => PortForwardError::BindFailed(m),
            ("forward_not_found", _) => PortForwardError::ForwardNotFound,
            ("connection_failed", Some(m)) => PortForwardError::ConnectionFailed(m),
            ("channel_failed", Some(m)) => PortForwardError::ChannelFailed(m),
            ("socks_unsupported", Some(m)) => PortForwardError::SocksUnsupported(m),
            ("socks_auth_failed", Some(m)) => PortForwardError::SocksAuthFailed(m),
            _ => PortForwardError::BindFailed("unknown error".to_string()),
        }
    }
}

/// Vault errors
#[derive(Debug, Clone, Error, Serialize)]
#[serde(from = "VaultErrorDto", into = "VaultErrorDto")]
#[error(transparent)]
pub enum VaultError {
    #[error("vault is locked")]
    VaultLocked,
    #[error("key not found: {0}")]
    KeyNotFound(String),
    #[error("create failed: {0}")]
    CreateFailed(String),
    #[error("unlock failed: {0}")]
    UnlockFailed(String),
    #[error("encrypt failed: {0}")]
    EncryptFailed(String),
    #[error("decrypt failed: {0}")]
    DecryptFailed(String),
    #[error("save failed: {0}")]
    SaveFailed(String),
    #[error("invalid password")]
    InvalidPassword,
}

#[derive(Serialize)]
struct VaultErrorDto {
    #[serde(rename = "type")]
    kind: &'static str,
    message: Option<String>,
}

impl From<VaultError> for VaultErrorDto {
    fn from(e: VaultError) -> Self {
        match e {
            VaultError::VaultLocked => Self { kind: "vault_locked", message: None },
            VaultError::KeyNotFound(m) => Self { kind: "key_not_found", message: Some(m) },
            VaultError::CreateFailed(m) => Self { kind: "create_failed", message: Some(m) },
            VaultError::UnlockFailed(m) => Self { kind: "unlock_failed", message: Some(m) },
            VaultError::EncryptFailed(m) => Self { kind: "encrypt_failed", message: Some(m) },
            VaultError::DecryptFailed(m) => Self { kind: "decrypt_failed", message: Some(m) },
            VaultError::SaveFailed(m) => Self { kind: "save_failed", message: Some(m) },
            VaultError::InvalidPassword => Self { kind: "invalid_password", message: None },
        }
    }
}

impl From<VaultErrorDto> for VaultError {
    fn from(dto: VaultErrorDto) -> Self {
        match (dto.kind, dto.message) {
            ("vault_locked", _) => VaultError::VaultLocked,
            ("key_not_found", Some(m)) => VaultError::KeyNotFound(m),
            ("create_failed", Some(m)) => VaultError::CreateFailed(m),
            ("unlock_failed", Some(m)) => VaultError::UnlockFailed(m),
            ("encrypt_failed", Some(m)) => VaultError::EncryptFailed(m),
            ("decrypt_failed", Some(m)) => VaultError::DecryptFailed(m),
            ("save_failed", Some(m)) => VaultError::SaveFailed(m),
            ("invalid_password", _) => VaultError::InvalidPassword,
            _ => VaultError::VaultLocked,
        }
    }
}

/// Storage service errors
#[allow(dead_code)]
#[derive(Debug, Clone, Error, Serialize)]
#[serde(from = "StorageErrorDto", into = "StorageErrorDto")]
#[error(transparent)]
pub enum StorageError {
    #[error("storage not configured")]
    NotConfigured,
    #[error("connection failed: {0}")]
    ConnectionFailed(String),
    #[error("upload failed: {0}")]
    UploadFailed(String),
    #[error("download failed: {0}")]
    DownloadFailed(String),
    #[error("delete failed: {0}")]
    DeleteFailed(String),
    #[error("list failed: {0}")]
    ListFailed(String),
}

#[allow(dead_code)]
#[derive(Serialize)]
struct StorageErrorDto {
    #[serde(rename = "type")]
    kind: &'static str,
    message: Option<String>,
}

#[allow(dead_code)]
impl From<StorageError> for StorageErrorDto {
    fn from(e: StorageError) -> Self {
        match e {
            StorageError::NotConfigured => Self { kind: "not_configured", message: None },
            StorageError::ConnectionFailed(m) => Self { kind: "connection_failed", message: Some(m) },
            StorageError::UploadFailed(m) => Self { kind: "upload_failed", message: Some(m) },
            StorageError::DownloadFailed(m) => Self { kind: "download_failed", message: Some(m) },
            StorageError::DeleteFailed(m) => Self { kind: "delete_failed", message: Some(m) },
            StorageError::ListFailed(m) => Self { kind: "list_failed", message: Some(m) },
        }
    }
}

#[allow(dead_code)]
impl From<StorageErrorDto> for StorageError {
    fn from(dto: StorageErrorDto) -> Self {
        match (dto.kind, dto.message) {
            ("not_configured", _) => StorageError::NotConfigured,
            ("connection_failed", Some(m)) => StorageError::ConnectionFailed(m),
            ("upload_failed", Some(m)) => StorageError::UploadFailed(m),
            ("download_failed", Some(m)) => StorageError::DownloadFailed(m),
            ("delete_failed", Some(m)) => StorageError::DeleteFailed(m),
            ("list_failed", Some(m)) => StorageError::ListFailed(m),
            _ => StorageError::NotConfigured,
        }
    }
}
