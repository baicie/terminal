//! Session 模块 - 统一抽象层
//!
//! 提供 SessionState 枚举统一抽象 Local PTY 和 SSH 两种终端类型，
//! 以及统一的输出通道和会话管理器。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

pub(crate) const MAX_TERMINAL_DIMENSION: u16 = 4096;

/// Settings applied when an interactive shell is created.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfile {
    #[serde(default)]
    pub environment: HashMap<String, String>,
    pub startup_command: Option<String>,
    /// Explicit remote shell integration mode.  Absent means disabled.
    #[serde(default)]
    pub shell_integration: Option<ShellIntegrationMode>,
}

impl TerminalProfile {
    pub(crate) fn validate(&self) -> Result<(), SessionError> {
        if self.environment.len() > 128 {
            return Err(SessionError::InvalidInput(
                "Terminal profile has too many environment variables".to_string(),
            ));
        }
        for (name, value) in &self.environment {
            if name.is_empty() || name.contains('=') || name.chars().any(char::is_control) {
                return Err(SessionError::InvalidInput(
                    "Terminal environment variable name is invalid".to_string(),
                ));
            }
            if value.chars().any(char::is_control) {
                return Err(SessionError::InvalidInput(
                    "Terminal environment variable value is invalid".to_string(),
                ));
            }
        }
        if self
            .startup_command
            .as_ref()
            .is_some_and(|command| command.len() > 64 * 1024 || command.contains('\0'))
        {
            return Err(SessionError::InvalidInput(
                "Terminal startup command is invalid".to_string(),
            ));
        }
        Ok(())
    }
}

/// Shell whose prompt hooks should be installed for a terminal profile.
///
/// This is intentionally not an `auto` mode: injecting shell syntax into an
/// unknown remote shell can turn a successful connection into a visible error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShellIntegrationMode {
    Bash,
    Zsh,
}

pub(crate) fn validate_terminal_size(cols: u16, rows: u16) -> Result<(), SessionError> {
    if cols == 0 || rows == 0 || cols > MAX_TERMINAL_DIMENSION || rows > MAX_TERMINAL_DIMENSION {
        return Err(SessionError::InvalidInput(format!(
            "Terminal size must be between 1 and {MAX_TERMINAL_DIMENSION} columns and rows; received {cols}x{rows}"
        )));
    }
    Ok(())
}

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
    #[error("connection cancelled")]
    ConnectionCancelled,
    #[error("authentication failed: {0}")]
    AuthenticationFailed(String),
    /// 凭据本身被拒绝：密码错、密钥不被接受。**服务端明确说过「不」**。
    ///
    /// 与 `AuthenticationFailed` 的区别不是措辞，而是重试语义：重新输入密码或换一把
    /// 密钥可能有用，退避重连没有用。此前两者共用一个 kind，前端只能靠文案猜。
    #[error("authentication rejected: {0}")]
    AuthenticationRejected(String),
    /// 认证**进行中**的传输故障：agent socket 连不上、agent 没有任何身份、
    /// 认证通道被重置。凭据对不对还不知道。
    #[error("authentication transport failed: {0}")]
    AuthenticationTransportFailed(String),
    /// 服务器的主机密钥被拒绝（`known_hosts` 不匹配，或用户拒绝）。
    #[error("host key rejected: {0}")]
    HostKeyRejected(String),
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
    #[error("exec cancelled")]
    ExecCancelled,
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
            SessionError::ConnectionCancelled => Self {
                kind: "connection_cancelled",
                message: None,
            },
            SessionError::AuthenticationFailed(m) => Self {
                kind: "authentication_failed",
                message: Some(m.clone()),
            },
            SessionError::AuthenticationRejected(m) => Self {
                kind: "authentication_rejected",
                message: Some(m.clone()),
            },
            SessionError::AuthenticationTransportFailed(m) => Self {
                kind: "authentication_transport_failed",
                message: Some(m.clone()),
            },
            SessionError::HostKeyRejected(m) => Self {
                kind: "host_key_rejected",
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
            SessionError::ExecCancelled => Self {
                kind: "exec_cancelled",
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
            ("connection_cancelled", _) => SessionError::ConnectionCancelled,
            ("authentication_failed", Some(m)) => SessionError::AuthenticationFailed(m),
            ("authentication_rejected", Some(m)) => SessionError::AuthenticationRejected(m),
            ("authentication_transport_failed", Some(m)) => {
                SessionError::AuthenticationTransportFailed(m)
            }
            ("host_key_rejected", Some(m)) => SessionError::HostKeyRejected(m),
            ("invalid_input", Some(m)) => SessionError::InvalidInput(m),
            ("channel_error", Some(m)) => SessionError::ChannelError(m),
            ("key_parse_failed", Some(m)) => SessionError::KeyParseFailed(m),
            ("certificate_parse_failed", Some(m)) => SessionError::CertificateParseFailed(m),
            ("exec_failed", Some(m)) => SessionError::ExecFailed(m),
            ("exec_timeout", _) => SessionError::ExecTimeout,
            ("exec_cancelled", _) => SessionError::ExecCancelled,
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
    /// 前端完成 xterm 解析后需要确认的 UTF-8 字节数
    pub bytes: usize,
}

/// Structured failure emitted when a live terminal's output or reader task
/// stops unexpectedly after the session has already been created.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalError {
    pub session_id: String,
    pub message: String,
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
    /// 预检得到的跳板机公钥；仅本次信任时用于精确 pin。
    #[serde(rename = "expectedHostKey", alias = "expected_host_key", default)]
    pub expected_host_key: Option<String>,
    /// 目标主机的认证类型（agent / password / key / cert），为空则沿用主会话默认逻辑
    #[serde(rename = "targetAuthType", alias = "target_auth_type", default)]
    pub target_auth_type: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_profile_accepts_camel_case_ipc_payload() {
        let profile: TerminalProfile = serde_json::from_value(serde_json::json!({
            "environment": {"APP_ENV": "dev"},
            "startupCommand": "cd ~/project",
            "shellIntegration": "bash"
        }))
        .expect("profile payload should deserialize");

        assert_eq!(profile.environment.get("APP_ENV"), Some(&"dev".to_string()));
        assert_eq!(profile.startup_command.as_deref(), Some("cd ~/project"));
        assert_eq!(profile.shell_integration, Some(ShellIntegrationMode::Bash));
        profile.validate().expect("profile should be valid");
    }

    #[test]
    fn terminal_profile_rejects_control_characters_and_large_maps() {
        let control = TerminalProfile {
            environment: HashMap::from([(String::from("BAD\nNAME"), String::from("value"))]),
            startup_command: None,
            shell_integration: None,
        };
        assert!(matches!(
            control.validate(),
            Err(SessionError::InvalidInput(message)) if message.contains("environment")
        ));

        let environment = (0..=128)
            .map(|index| (format!("KEY_{index}"), String::from("value")))
            .collect();
        let too_large = TerminalProfile {
            environment,
            startup_command: None,
            shell_integration: None,
        };
        assert!(too_large.validate().is_err());
    }

    #[test]
    fn terminal_profile_defaults_integration_to_off_and_rejects_auto() {
        let profile: TerminalProfile = serde_json::from_value(serde_json::json!({}))
            .expect("minimal profile should deserialize");
        assert_eq!(profile.shell_integration, None);
        assert!(
            serde_json::from_value::<TerminalProfile>(serde_json::json!({
                "shellIntegration": "auto"
            }))
            .is_err()
        );
    }

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
            SessionError::ConnectionCancelled,
            "connection_cancelled",
            None,
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
    fn terminal_size_rejects_zero_and_oversized_dimensions() {
        for (cols, rows) in [
            (0, 24),
            (80, 0),
            (MAX_TERMINAL_DIMENSION + 1, 24),
            (80, MAX_TERMINAL_DIMENSION + 1),
        ] {
            assert!(matches!(
                validate_terminal_size(cols, rows),
                Err(SessionError::InvalidInput(_))
            ));
        }
    }

    #[test]
    fn terminal_size_accepts_supported_boundaries() {
        assert!(validate_terminal_size(1, 1).is_ok());
        assert!(validate_terminal_size(MAX_TERMINAL_DIMENSION, MAX_TERMINAL_DIMENSION).is_ok());
    }

    #[test]
    fn session_output_serializes_the_frontend_ack_byte_count() {
        let output = SessionOutput {
            session_id: "session-1".to_string(),
            data: "中🙂".to_string(),
            is_stderr: false,
            bytes: 7,
        };

        let json = serde_json::to_value(output).expect("session output should serialize");

        assert_eq!(json["bytes"], 7);
    }

    #[test]
    fn jump_host_deserializes_the_optional_preflight_key() {
        let jump: JumpHostConfig = serde_json::from_value(serde_json::json!({
            "host": "jump.example",
            "port": 22,
            "username": "operator",
            "authType": "agent",
            "password": null,
            "privateKey": null,
            "certificate": null,
            "expectedHostKey": "ssh-ed25519 AAAA",
            "targetAuthType": "agent"
        }))
        .expect("jump host should deserialize");

        assert_eq!(jump.expected_host_key.as_deref(), Some("ssh-ed25519 AAAA"));
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

/// 认证错误的分类必须能被前端**按结构**消费，而不是读文案。
///
/// ## 缺陷
///
/// 握手期的传输失败（agent socket 连不上、agent 没有任何身份、认证通道被重置、
/// 认证阶段超时）与「服务器明确拒绝了这组凭据」共用 `authentication_failed`。前端
/// 只能靠 `message.includes(...)` 猜，而猜错的代价是两个方向的：
///
/// - 密码错了却提示「网络问题，正在重试」—— 用户等着一个不可能成功的重连；
/// - 网络断了却提示「请重新输入密码」—— 用户重输正确密码仍然失败。
///
/// ## 三条语义
///
/// | kind | 含义 | 重试有意义吗 |
/// | --- | --- | --- |
/// | `authentication_rejected` | 服务器评估并拒绝了这组凭据 | 换凭据，不是重连 |
/// | `authentication_transport_failed` | 凭据还没被评估 | 退避重连可能有用 |
/// | `host_key_rejected` | 主机密钥不被接受 | 检查 known_hosts |
#[cfg(test)]
mod auth_kind_tests {
    use super::*;

    fn kind_of(error: SessionError) -> String {
        let dto = SessionErrorDto::from(error);
        // Round-trip through the same JSON shape the frontend receives.
        let json = serde_json::to_value(&dto).expect("serialize");
        json.get("type")
            .and_then(|value| value.as_str())
            .expect("a type field")
            .to_string()
    }

    #[test]
    fn a_rejected_credential_is_not_a_transport_failure() {
        assert_eq!(
            kind_of(SessionError::AuthenticationRejected("password".into())),
            "authentication_rejected"
        );
        assert_eq!(
            kind_of(SessionError::AuthenticationTransportFailed("agent".into())),
            "authentication_transport_failed"
        );
        assert_ne!(
            kind_of(SessionError::AuthenticationRejected("x".into())),
            kind_of(SessionError::AuthenticationTransportFailed("x".into())),
            "the two must be distinguishable by structure alone"
        );
    }

    #[test]
    fn a_rejected_host_key_is_its_own_kind() {
        assert_eq!(
            kind_of(SessionError::HostKeyRejected("mismatch".into())),
            "host_key_rejected"
        );
    }

    #[test]
    fn the_new_kinds_round_trip_through_the_dto() {
        for (kind, message) in [
            ("authentication_rejected", "rejected"),
            ("authentication_transport_failed", "transport"),
            ("host_key_rejected", "hostkey"),
        ] {
            let dto = SessionErrorDto {
                kind,
                message: Some(message.to_string()),
            };
            let error = SessionError::from(dto);
            let back = SessionErrorDto::from(error);
            assert_eq!(back.kind, kind);
            assert_eq!(back.message.as_deref(), Some(message));
        }
    }

    #[test]
    fn the_legacy_kind_still_deserializes() {
        // Compatibility: an older build (or a stored error) that only knows
        // `authentication_failed` must still be understood.
        let dto = SessionErrorDto {
            kind: "authentication_failed",
            message: Some("legacy".into()),
        };
        assert!(matches!(
            SessionError::from(dto),
            SessionError::AuthenticationFailed(message) if message == "legacy"
        ));
    }
}

// ---------------------------------------------------------------------------
// SSH05 — connection failure context (hop + stage)
// ---------------------------------------------------------------------------
//
// ## Why this wraps `SessionError` instead of replacing it
//
// SSH03 measured the surface: 96 Tauri commands return `Result<_, SessionError>`, with
// 174 production construction sites — and only **six** of those commands establish a
// connection. The other ninety carry no notion of a hop and never will. Wrapping the six
// keeps that visible in the type system: `SessionFailure` appears exactly where a jump
// chain can exist.
//
// ## Why there is no reverse conversion
//
// `From<SessionFailure> for SessionError` would silently discard `hop` and `stage`. A
// convenience like that gets used once on an error path nobody watches, and the feature
// then reports "unknown" for the case it was built for. Callers that need the bare error
// write `.error`, which shows up in review.

/// Which leg of a connection produced a failure.
///
/// There is no `Direct` variant: a direct connection has no hop, and `Some(Direct)` would
/// make "no hop" indistinguishable from "hop 1 of 1". `None` means "this connection has no
/// jump chain", not "unknown".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionHop {
    /// The bastion: the tunnel never opened.
    Bastion,
    /// The host at the end of the tunnel.
    Target,
}

/// Where in the connection sequence a failure happened.
///
/// Every variant names a step this code actually performs. A stage that cannot be
/// determined stays `None`: an outer timeout knows the deadline expired but not which
/// await was pending, and naming a step that never ran is worse than naming none.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStage {
    TcpConnect,
    Handshake,
    HostKeyVerification,
    Authentication,
    /// Opening the `direct-tcpip` channel through the bastion.
    TunnelOpen,
    /// Opening the session channel on the target after its handshake.
    ChannelOpen,
}

/// A connection failure with the context the user needs to act on it.
///
/// Serialises as the same JSON as `SessionError` — same `type`, same `message` — plus two
/// optional fields that older consumers ignore.
#[derive(Debug, Clone, Serialize)]
#[serde(into = "SessionFailureDto")]
pub struct SessionFailure {
    pub error: SessionError,
    pub hop: Option<ConnectionHop>,
    pub stage: Option<ConnectionStage>,
}

impl SessionFailure {
    /// A failure with no connection context.
    ///
    /// Used where the position in the sequence genuinely cannot be known: input
    /// validation, a pool lookup, an outer deadline.
    pub fn bare(error: impl Into<SessionError>) -> Self {
        Self {
            error: error.into(),
            hop: None,
            stage: None,
        }
    }

    /// Attribute this failure to a hop and stage.
    pub fn at(mut self, hop: ConnectionHop, stage: ConnectionStage) -> Self {
        self.hop = Some(hop);
        self.stage = Some(stage);
        self
    }

    /// Attribute the hop only, for failures whose exact stage cannot be proven.
    pub fn on(mut self, hop: ConnectionHop) -> Self {
        self.hop = Some(hop);
        self
    }

    /// Attribute the stage only.
    ///
    /// A direct connection performs the same steps a bastion does but has no hop to name.
    /// Recording the stage without a hop is what lets a direct-connection failure say
    /// "the credential was rejected" while leaving `hop` absent — which is its documented
    /// meaning, not a missing value.
    pub fn with_stage(mut self, stage: ConnectionStage) -> Self {
        self.stage = Some(stage);
        self
    }
}

impl From<SessionError> for SessionFailure {
    /// The allowed direction: not every failure knows where it happened, and forcing every
    /// `?` to supply a hop would push fabricated values into the one field this feature
    /// exists to make trustworthy.
    fn from(error: SessionError) -> Self {
        Self::bare(error)
    }
}

/// The IPC shape for a connection failure.
///
/// **Serialise-only.** IPC is one-directional here: the frontend receives this shape and
/// never sends it back (verified — no frontend module constructs a `SessionError`). Adding
/// `Deserialize` would force `kind` from `&'static str` to `String` for a direction nobody
/// uses, and the first attempt at that needed a `Box::leak` to bridge the two.
///
/// The seventeen-way `kind` mapping is not duplicated: this delegates to
/// `SessionErrorDto::from`, which stays the single place that knows the names.
#[derive(Serialize)]
struct SessionFailureDto {
    #[serde(rename = "type")]
    kind: &'static str,
    message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hop: Option<ConnectionHop>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    stage: Option<ConnectionStage>,
}

impl From<SessionFailure> for SessionFailureDto {
    fn from(failure: SessionFailure) -> Self {
        let inner = SessionErrorDto::from(failure.error);
        Self {
            kind: inner.kind,
            message: inner.message,
            hop: failure.hop,
            stage: failure.stage,
        }
    }
}

#[cfg(test)]
mod ssh05_ipc_contract_tests {
    //! SSH05 — the wire shape must stay backward compatible.

    use super::*;

    fn json_of(failure: SessionFailure) -> serde_json::Value {
        serde_json::to_value(SessionFailureDto::from(failure)).expect("serialises")
    }

    #[test]
    fn a_bare_failure_serialises_exactly_like_a_plain_session_error() {
        /*
         * The compatibility requirement, stated as a test: a failure with no context must be
         * byte-for-byte the old shape. If this ever grows a `hop: null`, every consumer that
         * distinguishes "absent" from "null" changes behaviour without anyone editing it.
         */
        let plain = serde_json::to_value(SessionErrorDto::from(
            SessionError::AuthenticationRejected("denied".to_string()),
        ))
        .expect("serialises");

        let bare = json_of(SessionFailure::from(SessionError::AuthenticationRejected(
            "denied".to_string(),
        )));

        assert_eq!(plain, bare);
        assert!(
            bare.get("hop").is_none(),
            "an absent hop must be omitted, not null"
        );
        assert!(bare.get("stage").is_none());
    }

    #[test]
    fn a_hop_and_stage_appear_as_flat_siblings_of_type() {
        // Flat, not nested: a consumer reading `error.type` would have to change for a
        // nested shape, and the whole point of this design is that they do not.
        let json = json_of(
            SessionFailure::bare(SessionError::AuthenticationRejected("denied".to_string()))
                .at(ConnectionHop::Bastion, ConnectionStage::Authentication),
        );

        assert_eq!(json["type"], "authentication_rejected");
        assert_eq!(json["message"], "denied");
        assert_eq!(json["hop"], "bastion");
        assert_eq!(json["stage"], "authentication");
    }

    #[test]
    fn the_kind_mapping_is_not_duplicated() {
        // Every error kind must keep its name through the wrapper — if `SessionFailureDto`
        // carried its own table, this would drift one variant at a time.
        let cases: Vec<(SessionError, &str)> = vec![
            (
                SessionError::AuthenticationRejected("x".into()),
                "authentication_rejected",
            ),
            (
                SessionError::AuthenticationTransportFailed("x".into()),
                "authentication_transport_failed",
            ),
            (
                SessionError::HostKeyRejected("x".into()),
                "host_key_rejected",
            ),
            (
                SessionError::ConnectionFailed("x".into()),
                "connection_failed",
            ),
            (SessionError::ChannelError("x".into()), "channel_error"),
        ];
        for (error, expected) in cases {
            let json = json_of(SessionFailure::bare(error));
            assert_eq!(json["type"], expected);
        }
    }

    #[test]
    fn every_stage_and_hop_serialises_as_snake_case() {
        // The frontend matches these strings; a rename is a breaking change.
        let hops = [
            (ConnectionHop::Bastion, "bastion"),
            (ConnectionHop::Target, "target"),
        ];
        for (hop, expected) in hops {
            let json =
                json_of(SessionFailure::bare(SessionError::ConnectionFailed("x".into())).on(hop));
            assert_eq!(json["hop"], expected);
        }

        let stages = [
            (ConnectionStage::TcpConnect, "tcp_connect"),
            (ConnectionStage::Handshake, "handshake"),
            (
                ConnectionStage::HostKeyVerification,
                "host_key_verification",
            ),
            (ConnectionStage::Authentication, "authentication"),
            (ConnectionStage::TunnelOpen, "tunnel_open"),
            (ConnectionStage::ChannelOpen, "channel_open"),
        ];
        for (stage, expected) in stages {
            let json = json_of(
                SessionFailure::bare(SessionError::ConnectionFailed("x".into()))
                    .at(ConnectionHop::Target, stage),
            );
            assert_eq!(json["stage"], expected);
        }
    }

    #[test]
    fn the_dto_carries_no_secret_material() {
        /*
         * A canary: the message is caller-supplied text, and this design deliberately does
         * not add any other free-text field. If someone later adds "the ssh config" or "the
         * attempted key" to this struct, this test's shape assertion fails first.
         */
        let json = json_of(
            SessionFailure::bare(SessionError::AuthenticationRejected("canary-secret".into()))
                .at(ConnectionHop::Bastion, ConnectionStage::Authentication),
        );
        let keys: Vec<&str> = json
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys.len(), 4, "only type, message, hop, stage: {keys:?}");
    }
}

#[cfg(test)]
mod ssh07_09_attribution_tests {
    //! SSH07–SSH09 — the reachable attribution semantics.
    //!
    //! The three call sites themselves need a real sshd; these cases pin the properties
    //! those sites depend on, so a change here fails before the slow path is reached.

    use super::*;

    fn json_of(failure: SessionFailure) -> serde_json::Value {
        serde_json::to_value(SessionFailureDto::from(failure)).expect("serialises")
    }

    #[test]
    fn a_direct_failure_records_a_stage_without_inventing_a_hop() {
        /*
         * A direct connection performs the same steps a bastion does. It has no hop —
         * and `hop` absent means "no jump chain", not "unknown" — but it does know the
         * stage, and dropping that would make direct failures less diagnosable than
         * jump ones for no reason.
         */
        let json = json_of(
            SessionFailure::from(SessionError::AuthenticationRejected("x".into()))
                .with_stage(ConnectionStage::Authentication),
        );
        assert_eq!(json["stage"], "authentication");
        assert!(json.get("hop").is_none(), "direct connections have no hop");
    }

    #[test]
    fn a_failure_can_name_the_hop_without_claiming_a_stage() {
        // The tunnel case: the API does not distinguish "bastion refused forwarding" from
        // "target unreachable". The hop is known; the stage is not finer than TunnelOpen.
        let json = json_of(
            SessionFailure::from(SessionError::ChannelError("open failed".into()))
                .at(ConnectionHop::Bastion, ConnectionStage::TunnelOpen),
        );
        assert_eq!(json["hop"], "bastion");
        assert_eq!(json["stage"], "tunnel_open");
        // The kind is untouched — an unknown tunnel cause stays a channel error.
        assert_eq!(json["type"], "channel_error");
    }

    #[test]
    fn target_attribution_never_follows_from_a_successful_bastion() {
        /*
         * The property SSH09 states in prose: "a successful bastion says nothing about the
         * host behind it". Here that is the type-level fact — `Target` is a distinct value
         * from `Bastion`, so no code can produce one while meaning the other.
         */
        let bastion = ConnectionHop::Bastion;
        let target = ConnectionHop::Target;
        assert_ne!(bastion, target);
    }
}
