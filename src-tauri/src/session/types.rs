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
            SessionError::SessionNotFound => Self { kind: "session_not_found", message: None },
            SessionError::WriteFailed(m) => Self { kind: "write_failed", message: Some(m.clone()) },
            SessionError::ResizeFailed(m) => Self { kind: "resize_failed", message: Some(m.clone()) },
            SessionError::CloseFailed(m) => Self { kind: "close_failed", message: Some(m.clone()) },
            SessionError::ConnectionFailed(m) => Self { kind: "connection_failed", message: Some(m.clone()) },
            SessionError::AuthenticationFailed(m) => Self { kind: "authentication_failed", message: Some(m.clone()) },
            SessionError::InvalidInput(m) => Self { kind: "invalid_input", message: Some(m.clone()) },
            SessionError::ChannelError(m) => Self { kind: "channel_error", message: Some(m.clone()) },
            SessionError::KeyParseFailed(m) => Self { kind: "key_parse_failed", message: Some(m.clone()) },
            SessionError::CertificateParseFailed(m) => Self { kind: "certificate_parse_failed", message: Some(m.clone()) },
            SessionError::ExecFailed(m) => Self { kind: "exec_failed", message: Some(m.clone()) },
            SessionError::ExecTimeout => Self { kind: "exec_timeout", message: None },
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
    pub private_key: Option<String>,
    /// SSH 证书
    pub certificate: Option<String>,
    /// 目标主机的认证类型（agent / password / key / cert），为空则沿用主会话默认逻辑
    pub target_auth_type: Option<String>,
}
