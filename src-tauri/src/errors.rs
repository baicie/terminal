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
            SftpError::SessionNotFound => Self {
                kind: "session_not_found",
                message: None,
            },
            SftpError::ReadDirFailed(m) => Self {
                kind: "read_dir_failed",
                message: Some(m),
            },
            SftpError::UploadFailed(m) => Self {
                kind: "upload_failed",
                message: Some(m),
            },
            SftpError::DownloadFailed(m) => Self {
                kind: "download_failed",
                message: Some(m),
            },
            SftpError::MkdirFailed(m) => Self {
                kind: "mkdir_failed",
                message: Some(m),
            },
            SftpError::DeleteFailed(m) => Self {
                kind: "delete_failed",
                message: Some(m),
            },
            SftpError::RenameFailed(m) => Self {
                kind: "rename_failed",
                message: Some(m),
            },
            SftpError::InvalidPath(m) => Self {
                kind: "invalid_path",
                message: Some(m),
            },
            SftpError::ChecksumFailed(m) => Self {
                kind: "checksum_failed",
                message: Some(m),
            },
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
            SerialError::ListFailed(m) => Self {
                kind: "list_failed",
                message: Some(m),
            },
            SerialError::ConnectFailed(m) => Self {
                kind: "connect_failed",
                message: Some(m),
            },
            SerialError::WriteFailed(m) => Self {
                kind: "write_failed",
                message: Some(m),
            },
            SerialError::SessionNotFound => Self {
                kind: "session_not_found",
                message: None,
            },
            SerialError::CloneFailed(m) => Self {
                kind: "clone_failed",
                message: Some(m),
            },
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
            PortForwardError::SessionNotFound => Self {
                kind: "session_not_found",
                message: None,
            },
            PortForwardError::BindFailed(m) => Self {
                kind: "bind_failed",
                message: Some(m),
            },
            PortForwardError::ForwardNotFound => Self {
                kind: "forward_not_found",
                message: None,
            },
            PortForwardError::ConnectionFailed(m) => Self {
                kind: "connection_failed",
                message: Some(m),
            },
            PortForwardError::ChannelFailed(m) => Self {
                kind: "channel_failed",
                message: Some(m),
            },
            PortForwardError::SocksUnsupported(m) => Self {
                kind: "socks_unsupported",
                message: Some(m),
            },
            PortForwardError::SocksAuthFailed(m) => Self {
                kind: "socks_auth_failed",
                message: Some(m),
            },
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
            VaultError::VaultLocked => Self {
                kind: "vault_locked",
                message: None,
            },
            VaultError::KeyNotFound(m) => Self {
                kind: "key_not_found",
                message: Some(m),
            },
            VaultError::CreateFailed(m) => Self {
                kind: "create_failed",
                message: Some(m),
            },
            VaultError::UnlockFailed(m) => Self {
                kind: "unlock_failed",
                message: Some(m),
            },
            VaultError::EncryptFailed(m) => Self {
                kind: "encrypt_failed",
                message: Some(m),
            },
            VaultError::DecryptFailed(m) => Self {
                kind: "decrypt_failed",
                message: Some(m),
            },
            VaultError::SaveFailed(m) => Self {
                kind: "save_failed",
                message: Some(m),
            },
            VaultError::InvalidPassword => Self {
                kind: "invalid_password",
                message: None,
            },
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
            StorageError::NotConfigured => Self {
                kind: "not_configured",
                message: None,
            },
            StorageError::ConnectionFailed(m) => Self {
                kind: "connection_failed",
                message: Some(m),
            },
            StorageError::UploadFailed(m) => Self {
                kind: "upload_failed",
                message: Some(m),
            },
            StorageError::DownloadFailed(m) => Self {
                kind: "download_failed",
                message: Some(m),
            },
            StorageError::DeleteFailed(m) => Self {
                kind: "delete_failed",
                message: Some(m),
            },
            StorageError::ListFailed(m) => Self {
                kind: "list_failed",
                message: Some(m),
            },
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

#[cfg(test)]
mod tests {
    #[test]
    fn test_sftp_error_roundtrip() {
        let check =
            |original: super::SftpError, expected_kind: &str, expected_msg: Option<&str>| {
                let dto = super::SftpErrorDto::from(original.clone());
                assert_eq!(dto.kind, expected_kind);
                assert_eq!(dto.message.as_deref(), expected_msg);
                let back: super::SftpError = dto.into();
                assert_eq!(back.to_string(), original.to_string());
            };
        check(super::SftpError::SessionNotFound, "session_not_found", None);
        check(
            super::SftpError::ReadDirFailed("ENOENT".into()),
            "read_dir_failed",
            Some("ENOENT"),
        );
        check(
            super::SftpError::UploadFailed("reset".into()),
            "upload_failed",
            Some("reset"),
        );
        check(
            super::SftpError::DownloadFailed("timeout".into()),
            "download_failed",
            Some("timeout"),
        );
        check(
            super::SftpError::MkdirFailed("denied".into()),
            "mkdir_failed",
            Some("denied"),
        );
        check(
            super::SftpError::DeleteFailed("busy".into()),
            "delete_failed",
            Some("busy"),
        );
        check(
            super::SftpError::RenameFailed("cross".into()),
            "rename_failed",
            Some("cross"),
        );
        check(
            super::SftpError::InvalidPath("/bad".into()),
            "invalid_path",
            Some("/bad"),
        );
        check(
            super::SftpError::ChecksumFailed("mismatch".into()),
            "checksum_failed",
            Some("mismatch"),
        );
    }

    #[test]
    fn test_sftp_error_unknown_kind_falls_back() {
        let dto = super::SftpErrorDto {
            kind: "bogus",
            message: None,
        };
        let back: super::SftpError = dto.into();
        assert!(matches!(back, super::SftpError::SessionNotFound));
    }

    #[test]
    fn test_serial_error_roundtrip() {
        let check =
            |original: super::SerialError, expected_kind: &str, expected_msg: Option<&str>| {
                let dto = super::SerialErrorDto::from(original.clone());
                assert_eq!(dto.kind, expected_kind);
                assert_eq!(dto.message.as_deref(), expected_msg);
                let back: super::SerialError = dto.into();
                assert_eq!(back.to_string(), original.to_string());
            };
        check(
            super::SerialError::ListFailed("no ports".into()),
            "list_failed",
            Some("no ports"),
        );
        check(
            super::SerialError::ConnectFailed("busy".into()),
            "connect_failed",
            Some("busy"),
        );
        check(
            super::SerialError::WriteFailed("overflow".into()),
            "write_failed",
            Some("overflow"),
        );
        check(
            super::SerialError::SessionNotFound,
            "session_not_found",
            None,
        );
        check(
            super::SerialError::CloneFailed("max".into()),
            "clone_failed",
            Some("max"),
        );
    }

    #[test]
    fn test_serial_error_unknown_kind_falls_back() {
        let dto = super::SerialErrorDto {
            kind: "invalid",
            message: Some("x".into()),
        };
        let back: super::SerialError = dto.into();
        assert!(matches!(back, super::SerialError::ListFailed(_)));
    }

    #[test]
    fn test_storage_error_roundtrip() {
        let check =
            |original: super::StorageError, expected_kind: &str, expected_msg: Option<&str>| {
                let dto = super::StorageErrorDto::from(original.clone());
                assert_eq!(dto.kind, expected_kind);
                assert_eq!(dto.message.as_deref(), expected_msg);
                let back: super::StorageError = dto.into();
                assert_eq!(back.to_string(), original.to_string());
            };
        check(super::StorageError::NotConfigured, "not_configured", None);
        check(
            super::StorageError::ConnectionFailed("unreachable".into()),
            "connection_failed",
            Some("unreachable"),
        );
        check(
            super::StorageError::UploadFailed("403".into()),
            "upload_failed",
            Some("403"),
        );
        check(
            super::StorageError::DownloadFailed("404".into()),
            "download_failed",
            Some("404"),
        );
        check(
            super::StorageError::DeleteFailed("locked".into()),
            "delete_failed",
            Some("locked"),
        );
        check(
            super::StorageError::ListFailed("err".into()),
            "list_failed",
            Some("err"),
        );
    }

    #[test]
    fn test_storage_error_unknown_kind_falls_back() {
        let dto = super::StorageErrorDto {
            kind: "unknown",
            message: Some("x".into()),
        };
        let back: super::StorageError = dto.into();
        assert!(matches!(back, super::StorageError::NotConfigured));
    }

    #[test]
    fn test_port_forward_error_roundtrip() {
        let check =
            |original: super::PortForwardError, expected_kind: &str, expected_msg: Option<&str>| {
                let dto = super::PortForwardErrorDto::from(original.clone());
                assert_eq!(dto.kind, expected_kind);
                assert_eq!(dto.message.as_deref(), expected_msg);
                let back: super::PortForwardError = dto.into();
                assert_eq!(back.to_string(), original.to_string());
            };
        check(
            super::PortForwardError::SessionNotFound,
            "session_not_found",
            None,
        );
        check(
            super::PortForwardError::BindFailed("addr in use".into()),
            "bind_failed",
            Some("addr in use"),
        );
        check(
            super::PortForwardError::ForwardNotFound,
            "forward_not_found",
            None,
        );
        check(
            super::PortForwardError::ConnectionFailed("refused".into()),
            "connection_failed",
            Some("refused"),
        );
        check(
            super::PortForwardError::ChannelFailed("closed".into()),
            "channel_failed",
            Some("closed"),
        );
        check(
            super::PortForwardError::SocksUnsupported("no auth".into()),
            "socks_unsupported",
            Some("no auth"),
        );
        check(
            super::PortForwardError::SocksAuthFailed("bad pwd".into()),
            "socks_auth_failed",
            Some("bad pwd"),
        );
    }

    #[test]
    fn test_port_forward_error_unknown_kind_falls_back() {
        let dto = super::PortForwardErrorDto {
            kind: "bogus",
            message: None,
        };
        let back: super::PortForwardError = dto.into();
        assert!(matches!(back, super::PortForwardError::BindFailed(_)));
    }

    #[test]
    fn test_vault_error_roundtrip() {
        let check = |original: super::VaultError, expected_kind: &str| {
            let dto = super::VaultErrorDto::from(original.clone());
            assert_eq!(dto.kind, expected_kind);
            // DTO round-trips back through the From impl
            let back: super::VaultError = dto.into();
            // The error format is "variant: msg" so just verify it's non-empty
            assert!(!back.to_string().is_empty());
        };
        check(super::VaultError::VaultLocked, "vault_locked");
        check(super::VaultError::InvalidPassword, "invalid_password");
        check(
            super::VaultError::KeyNotFound("missing-key".into()),
            "key_not_found",
        );
        check(
            super::VaultError::CreateFailed("failed".into()),
            "create_failed",
        );
        check(
            super::VaultError::UnlockFailed("wrong".into()),
            "unlock_failed",
        );
        check(
            super::VaultError::EncryptFailed("enc err".into()),
            "encrypt_failed",
        );
        check(
            super::VaultError::DecryptFailed("dec err".into()),
            "decrypt_failed",
        );
        check(
            super::VaultError::SaveFailed("io err".into()),
            "save_failed",
        );
    }

    #[test]
    fn test_vault_error_unknown_kind_falls_back_to_vault_locked() {
        let dto = super::VaultErrorDto {
            kind: "bogus",
            message: None,
        };
        let back: super::VaultError = dto.into();
        assert!(matches!(back, super::VaultError::VaultLocked));
    }
}
