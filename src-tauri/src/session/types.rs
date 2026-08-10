//! Session 模块 - 统一抽象层
//!
//! 提供 SessionState 枚举统一抽象 Local PTY 和 SSH 两种终端类型，
//! 以及统一的输出通道和会话管理器。

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Session 类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionType {
    /// 本地终端
    Local,
    /// SSH 远程终端
    Ssh,
}

impl std::fmt::Display for SessionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionType::Local => write!(f, "local"),
            SessionType::Ssh => write!(f, "ssh"),
        }
    }
}

/// Session 错误类型
#[derive(Debug, Clone, Error, Serialize)]
#[serde(from = "SessionErrorDto", into = "SessionErrorDto")]
pub enum SessionError {
    #[error("session not found")]
    SessionNotFound,
    #[error("write failed: {0}")]
    WriteFailed(String),
    #[error("resize failed: {0}")]
    ResizeFailed(String),
    #[error("close failed: {0}")]
    CloseFailed(String),
    #[error("connection failed: {0}")]
    ConnectionFailed(String),
    #[error("authentication failed: {0}")]
    AuthenticationFailed(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("channel error: {0}")]
    ChannelError(String),
    #[error("key parse failed: {0}")]
    KeyParseFailed(String),
    #[error("certificate parse failed: {0}")]
    CertificateParseFailed(String),
    #[error("exec failed: {0}")]
    ExecFailed(String),
    #[error("exec timed out")]
    ExecTimeout,
    #[error("key generation failed: {0}")]
    KeyGenerationFailed(String),
}

#[derive(Serialize)]
struct SessionErrorDto {
    #[serde(rename = "type")]
    kind: &'static str,
    message: Option<String>,
}

impl From<SessionError> for SessionErrorDto {
    fn from(e: SessionError) -> Self {
        match &e {
            SessionError::SessionNotFound => Self {
                kind: "session_not_found",
                message: None,
            },
            SessionError::WriteFailed(m) => Self {
                kind: "write_failed",
                message: Some(m.clone()),
            },
            SessionError::ResizeFailed(m) => Self {
                kind: "resize_failed",
                message: Some(m.clone()),
            },
            SessionError::CloseFailed(m) => Self {
                kind: "close_failed",
                message: Some(m.clone()),
            },
            SessionError::ConnectionFailed(m) => Self {
                kind: "connection_failed",
                message: Some(m.clone()),
            },
            SessionError::AuthenticationFailed(m) => Self {
                kind: "authentication_failed",
                message: Some(m.clone()),
            },
            SessionError::InvalidInput(m) => Self {
                kind: "invalid_input",
                message: Some(m.clone()),
            },
            SessionError::ChannelError(m) => Self {
                kind: "channel_error",
                message: Some(m.clone()),
            },
            SessionError::KeyParseFailed(m) => Self {
                kind: "key_parse_failed",
                message: Some(m.clone()),
            },
            SessionError::CertificateParseFailed(m) => Self {
                kind: "certificate_parse_failed",
                message: Some(m.clone()),
            },
            SessionError::ExecFailed(m) => Self {
                kind: "exec_failed",
                message: Some(m.clone()),
            },
            SessionError::ExecTimeout => Self {
                kind: "exec_timeout",
                message: None,
            },
            SessionError::KeyGenerationFailed(m) => Self {
                kind: "key_generation_failed",
                message: Some(m.clone()),
            },
        }
    }
}

impl From<SessionErrorDto> for SessionError {
    fn from(dto: SessionErrorDto) -> Self {
        match (dto.kind, dto.message) {
            ("session_not_found", _) => SessionError::SessionNotFound,
            ("write_failed", Some(m)) => SessionError::WriteFailed(m),
            ("resize_failed", Some(m)) => SessionError::ResizeFailed(m),
            ("close_failed", Some(m)) => SessionError::CloseFailed(m),
            ("connection_failed", Some(m)) => SessionError::ConnectionFailed(m),
            ("authentication_failed", Some(m)) => SessionError::AuthenticationFailed(m),
            ("invalid_input", Some(m)) => SessionError::InvalidInput(m),
            ("channel_error", Some(m)) => SessionError::ChannelError(m),
            ("key_parse_failed", Some(m)) => SessionError::KeyParseFailed(m),
            ("certificate_parse_failed", Some(m)) => SessionError::CertificateParseFailed(m),
            ("exec_failed", Some(m)) => SessionError::ExecFailed(m),
            ("exec_timeout", _) => SessionError::ExecTimeout,
            ("key_generation_failed", Some(m)) => SessionError::KeyGenerationFailed(m),
            _ => SessionError::ConnectionFailed("unknown error".to_string()),
        }
    }
}

/// 终端输出数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionOutput {
    /// 会话 ID
    pub session_id: String,
    /// 输出数据
    pub data: String,
    /// 是否为 stderr
    pub is_stderr: bool,
}

/// Shell exec result (used for completion / RC file parsing)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// SSH key generation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyGenResult {
    pub private_key: String,
    pub public_key: String,
    pub key_type: String,
    pub fingerprint: String,
}

/// Session 信息（用于列表和调试）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    /// 会话 ID
    pub id: String,
    /// Session 类型
    pub session_type: SessionType,
    /// 是否活跃
    pub is_alive: bool,
    /// 创建时间戳
    pub created_at: i64,
}

/// 会话创建配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    /// 配置类型
    #[serde(rename = "type")]
    pub config_type: SessionType,
    /// 终端列数
    pub cols: u16,
    /// 终端行数
    pub rows: u16,
    /// SSH 配置（仅 SSH 类型）
    pub ssh: Option<SshConfig>,
}

/// SSH 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    /// 主机地址
    pub host: String,
    /// 端口
    pub port: u16,
    /// 用户名
    pub username: String,
    /// 密码认证
    pub password: Option<String>,
    /// 私钥认证
    pub private_key: Option<String>,
    /// SSH 证书（BASE64 编码的 SSH 证书，authenticate_with_sig）
    pub certificate: Option<String>,
    /// 跳转主机配置
    pub jump_host: Option<JumpHostConfig>,
}

/// 跳转主机配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JumpHostConfig {
    /// 主机地址
    pub host: String,
    /// 端口
    pub port: u16,
    /// 用户名
    pub username: String,
    /// 认证类型 (password | key | agent | cert)
    #[serde(rename = "authType", default)]
    pub auth_type: String,
    /// 密码
    pub password: Option<String>,
    /// 私钥
    #[serde(rename = "privateKey", alias = "private_key", default)]
    pub private_key: Option<String>,
    /// SSH 证书
    pub certificate: Option<String>,
    /// 目标主机的认证类型（agent / password / key / cert），为空则沿用主会话默认逻辑
    #[serde(rename = "targetAuthType", alias = "target_auth_type", default)]
    pub target_auth_type: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_error_roundtrip() {
        let check = |original: SessionError, expected_kind: &str, expected_msg: Option<&str>| {
            let dto = SessionErrorDto::from(original.clone());
            assert_eq!(dto.kind, expected_kind);
            assert_eq!(dto.message.as_deref(), expected_msg);
            let back: SessionError = dto.into();
            assert_eq!(back.to_string(), original.to_string());
        };
        check(SessionError::SessionNotFound, "session_not_found", None);
        check(
            SessionError::WriteFailed("broken".into()),
            "write_failed",
            Some("broken"),
        );
        check(
            SessionError::ResizeFailed("bad".into()),
            "resize_failed",
            Some("bad"),
        );
        check(
            SessionError::CloseFailed("closed".into()),
            "close_failed",
            Some("closed"),
        );
        check(
            SessionError::ConnectionFailed("refused".into()),
            "connection_failed",
            Some("refused"),
        );
        check(
            SessionError::AuthenticationFailed("bad".into()),
            "authentication_failed",
            Some("bad"),
        );
        check(
            SessionError::InvalidInput("null".into()),
            "invalid_input",
            Some("null"),
        );
        check(
            SessionError::ChannelError("win".into()),
            "channel_error",
            Some("win"),
        );
        check(
            SessionError::KeyParseFailed("bad".into()),
            "key_parse_failed",
            Some("bad"),
        );
        check(
            SessionError::CertificateParseFailed("exp".into()),
            "certificate_parse_failed",
            Some("exp"),
        );
        check(
            SessionError::ExecFailed("exit 1".into()),
            "exec_failed",
            Some("exit 1"),
        );
        check(SessionError::ExecTimeout, "exec_timeout", None);
        check(
            SessionError::KeyGenerationFailed("bad params".into()),
            "key_generation_failed",
            Some("bad params"),
        );
    }

    #[test]
    fn test_session_error_unknown_kind_falls_back_to_connection_failed() {
        let dto = SessionErrorDto {
            kind: "bogus",
            message: Some("x".into()),
        };
        let back: SessionError = dto.into();
        assert!(matches!(back, SessionError::ConnectionFailed(_)));
    }

    #[test]
    fn test_session_type_display() {
        assert_eq!(SessionType::Local.to_string(), "local");
        assert_eq!(SessionType::Ssh.to_string(), "ssh");
    }

    #[test]
    fn test_session_type_serde() {
        use serde_json;
        let local = serde_json::to_string(&SessionType::Local).unwrap();
        let ssh = serde_json::to_string(&SessionType::Ssh).unwrap();
        assert_eq!(local, "\"local\"");
        assert_eq!(ssh, "\"ssh\"");
        let back_local: SessionType = serde_json::from_str(&local).unwrap();
        let back_ssh: SessionType = serde_json::from_str(&ssh).unwrap();
        assert_eq!(back_local, SessionType::Local);
        assert_eq!(back_ssh, SessionType::Ssh);
    }

    #[test]
    fn jump_host_config_accepts_tauri_camel_case_fields() {
        let config: JumpHostConfig = serde_json::from_value(serde_json::json!({
            "host": "bastion.example",
            "port": 22,
            "username": "jump-user",
            "authType": "key",
            "privateKey": "private-key",
            "targetAuthType": "agent"
        }))
        .unwrap();

        assert_eq!(config.auth_type, "key");
        assert_eq!(config.private_key.as_deref(), Some("private-key"));
        assert_eq!(config.target_auth_type.as_deref(), Some("agent"));
    }

    #[test]
    fn test_exec_result_serde() {
        let result = ExecResult {
            stdout: "hello".into(),
            stderr: "err".into(),
            exit_code: 0,
        };
        let json = serde_json::to_string(&result).unwrap();
        let back: ExecResult = serde_json::from_str(&json).unwrap();
        assert_eq!(back.stdout, "hello");
        assert_eq!(back.stderr, "err");
        assert_eq!(back.exit_code, 0);
    }
}
