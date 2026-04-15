//! Session Manager - 统一的会话管理器
//!
//! 管理所有类型的 Session（Local/SSH），提供统一的创建、获取、关闭接口。

use super::channel::{make_output, ChannelManager};
use super::local::LocalSession;
use super::ssh::SshSession;
use super::{SessionError, SessionInfo, SessionType};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Session 状态枚举 - 统一抽象
#[derive(Clone)]
pub enum SessionState {
    Local(LocalSession),
    Ssh(SshSession),
}

impl SessionState {
    pub fn session_id(&self) -> &str {
        match self {
            SessionState::Local(s) => s.session_id(),
            SessionState::Ssh(s) => s.session_id(),
        }
    }

    pub fn session_type(&self) -> SessionType {
        match self {
            SessionState::Local(_) => SessionType::Local,
            SessionState::Ssh(_) => SessionType::Ssh,
        }
    }

    pub fn write(&self, data: &str) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        match self {
            SessionState::Local(s) => s.write(data),
            SessionState::Ssh(s) => s.write(data),
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        match self {
            SessionState::Local(s) => s.resize(cols, rows),
            SessionState::Ssh(s) => s.resize(cols, rows),
        }
    }

    pub fn close(self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        match self {
            SessionState::Local(s) => s.close(),
            SessionState::Ssh(s) => s.close(),
        }
    }

    pub fn is_alive(&self) -> bool {
        match self {
            SessionState::Local(s) => s.is_alive(),
            SessionState::Ssh(s) => s.is_alive(),
        }
    }
}

/// Session 元信息
struct SessionMeta {
    /// Session 类型
    session_type: SessionType,
    /// 创建时间戳
    created_at: i64,
    /// 最后活跃时间
    #[allow(dead_code)]
    last_active: i64,
}

/// Session Manager - 统一管理所有 Session
///
/// 负责创建、存储、查询和销毁 Session 实例，
/// 同时管理对应的输出通道。
pub struct SessionManager {
    /// 所有活跃的 Session
    sessions: Arc<Mutex<HashMap<String, SessionState>>>,
    /// Channel 管理器
    channel_manager: Arc<ChannelManager>,
    /// Session 元信息
    session_meta: Arc<Mutex<HashMap<String, SessionMeta>>>,
}

impl SessionManager {
    /// 创建新的 SessionManager
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            channel_manager: Arc::new(ChannelManager::new()),
            session_meta: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 获取 Channel Manager
    pub fn channel_manager(&self) -> Arc<ChannelManager> {
        self.channel_manager.clone()
    }

    /// 注册 Session
    pub async fn register_session(&self, session: SessionState) {
        let session_id = session.session_id().to_string();
        let session_type = session.session_type();

        // 注册到 sessions
        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(session_id.clone(), session);
        }

        // 注册元信息
        {
            let mut meta = self.session_meta.lock().await;
            let now = chrono::Utc::now().timestamp();
            meta.insert(
                session_id.clone(),
                SessionMeta {
                    session_type,
                    created_at: now,
                    last_active: now,
                },
            );
        }

        // 创建对应的 channel
        self.channel_manager.create_channel(session_id);
    }

    /// 获取 Session
    pub async fn get_session(&self, session_id: &str) -> Option<SessionState> {
        let sessions = self.sessions.lock().await;
        sessions.get(session_id).cloned()
    }

    /// 检查 Session 是否存在
    pub async fn exists(&self, session_id: &str) -> bool {
        let sessions = self.sessions.lock().await;
        sessions.contains_key(session_id)
    }

    /// 获取所有 Session 信息
    pub async fn list_sessions(&self) -> Vec<SessionInfo> {
        let sessions = self.sessions.lock().await;
        let meta = self.session_meta.lock().await;

        sessions
            .iter()
            .filter_map(|(id, session)| {
                meta.get(id).map(|m| SessionInfo {
                    id: id.clone(),
                    session_type: m.session_type,
                    is_alive: session.is_alive(),
                    created_at: m.created_at,
                })
            })
            .collect()
    }

    /// 移除 Session
    pub async fn remove_session(&self, session_id: &str) -> Result<(), SessionError> {
        // 获取并关闭 session
        let session = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(session_id)
        };

        if let Some(session) = session {
            session.close().await;
        }

        // 清理 channel
        self.channel_manager.remove_channel(session_id);

        // 清理元信息
        {
            let mut meta = self.session_meta.lock().await;
            meta.remove(session_id);
        }

        Ok(())
    }

    /// 发送输出数据
    pub async fn send_output(&self, session_id: &str, data: &str, is_stderr: bool) {
        let output = make_output(session_id, data, is_stderr);
        let _ = self.channel_manager.send(session_id, output).await;
    }

    /// 广播输出
    pub async fn broadcast_output(&self, data: &str, is_stderr: bool) {
        let channels = self.channel_manager.list_sessions();
        for session_id in channels {
            let output = make_output(&session_id, data, is_stderr);
            let _ = self.channel_manager.send(&session_id, output).await;
        }
    }

    /// 获取活跃 Session 数量
    pub async fn len(&self) -> usize {
        let sessions = self.sessions.lock().await;
        sessions.len()
    }

    /// 检查是否为空
    pub async fn is_empty(&self) -> bool {
        let sessions = self.sessions.lock().await;
        sessions.is_empty()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for SessionManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionManager")
            .finish()
    }
}
