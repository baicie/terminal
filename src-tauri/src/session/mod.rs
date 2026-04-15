//! Session 模块 - 会话抽象层
//!
//! 提供统一的 Session 抽象，管理 Local 和 SSH 会话。

pub mod types;
pub mod local;
pub mod ssh;
pub mod manager;
pub mod channel;

pub use types::*;
pub use manager::{SessionManager, SessionState};
pub use channel::{ChannelConfig, ChannelManager, SessionChannel};
pub use ssh::get_ssh_sessions;
