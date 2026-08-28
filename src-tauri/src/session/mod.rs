//! Session 模块 - 会话抽象层
//!
//! 提供统一的 Session 抽象，管理 Local 和 SSH 会话。

pub mod channel;
pub(crate) mod lifecycle;
pub mod local;
pub mod manager;
pub mod ssh;
pub(crate) mod ssh_channel;
pub(crate) mod ssh_writer;
pub(crate) mod terminal_output;
pub mod types;

pub use channel::{ChannelConfig, ChannelManager, SessionChannel};
pub use manager::get_session_manager;
pub use manager::{SessionManager, SessionState};
pub use ssh::get_ssh_sessions;
pub use types::*;
