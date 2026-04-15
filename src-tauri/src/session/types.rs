//! Session 模块 - 统一抽象层
//!
//! 提供 SessionState 枚举统一抽象 Local PTY 和 SSH 两种终端类型，
//! 以及统一的输出通道和会话管理器。

use serde::{Deserialize, Serialize};

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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "message")]
pub enum SessionError {
    /// 会话不存在
    #[serde(rename = "session_not_found")]
    SessionNotFound,
    /// 写入失败
    #[serde(rename = "write_failed")]
    WriteFailed(String),
    /// 调整大小失败
    #[serde(rename = "resize_failed")]
    ResizeFailed(String),
    /// 关闭失败
    #[serde(rename = "close_failed")]
    CloseFailed(String),
    /// 连接失败
    #[serde(rename = "connection_failed")]
    ConnectionFailed(String),
    /// 认证失败
    #[serde(rename = "authentication_failed")]
    AuthenticationFailed(String),
    /// 无效输入
    #[serde(rename = "invalid_input")]
    InvalidInput(String),
    /// 通道错误
    #[serde(rename = "channel_error")]
    ChannelError(String),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionError::SessionNotFound => write!(f, "Session not found"),
            SessionError::WriteFailed(msg) => write!(f, "Write failed: {}", msg),
            SessionError::ResizeFailed(msg) => write!(f, "Resize failed: {}", msg),
            SessionError::CloseFailed(msg) => write!(f, "Close failed: {}", msg),
            SessionError::ConnectionFailed(msg) => write!(f, "Connection failed: {}", msg),
            SessionError::AuthenticationFailed(msg) => write!(f, "Authentication failed: {}", msg),
            SessionError::InvalidInput(msg) => write!(f, "Invalid input: {}", msg),
            SessionError::ChannelError(msg) => write!(f, "Channel error: {}", msg),
        }
    }
}

impl std::error::Error for SessionError {}

impl From<SessionError> for String {
    fn from(err: SessionError) -> Self {
        err.to_string()
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
    /// 认证类型 (password | key | agent)
    pub auth_type: String,
    /// 密码
    pub password: Option<String>,
    /// 私钥
    pub private_key: Option<String>,
}
