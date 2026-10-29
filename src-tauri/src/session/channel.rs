//! Session Channel - 统一的异步输出通道
//!
//! 提供从 Session 到前端的异步数据流，通过 tokio channel 实现背压控制。

use super::types::{SessionError, SessionOutput};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, mpsc, RwLock};

/// Channel 配置
#[derive(Debug, Clone)]
pub struct ChannelConfig {
    /// Channel 缓冲区大小
    pub buffer_size: usize,
    /// 事件发射器名称
    pub event_name: String,
}

impl Default for ChannelConfig {
    fn default() -> Self {
        Self {
            buffer_size: 256,
            event_name: "session-data".to_string(),
        }
    }
}

/// Session Channel - 管理单个 Session 的输出流
///
/// 使用 tokio mpsc 实现带背压控制的异步输出通道，
/// 支持流控和优雅关闭。
pub struct SessionChannel {
    /// Session ID
    session_id: String,
    /// 事件名称
    event_name: String,
    /// 发送端（由 Session 使用）
    sender: mpsc::Sender<SessionOutput>,
    /// 接收端（由 Channel Manager 使用）
    receiver: mpsc::Receiver<SessionOutput>,
}

impl SessionChannel {
    /// 创建新的 SessionChannel
    pub fn new(session_id: String, config: ChannelConfig) -> Self {
        let (sender, receiver) = mpsc::channel(config.buffer_size);

        Self {
            session_id,
            event_name: config.event_name,
            sender,
            receiver,
        }
    }

    /// 获取发送端（用于 Session 写入数据）
    pub fn sender(&self) -> &mpsc::Sender<SessionOutput> {
        &self.sender
    }

    /// 获取 Session ID
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// 消费接收端，开始处理输出
    pub async fn start_receiving(
        mut receiver: mpsc::Receiver<SessionOutput>,
        app: AppHandle,
        event_name: String,
    ) {
        while let Some(output) = receiver.recv().await {
            let session_id = output.session_id.clone();

            if let Err(e) = app.emit(&event_name, output) {
                tracing::warn!(
                    session_id = %session_id,
                    event = %event_name,
                    error = %e,
                    "failed to emit session data event",
                );
            }
        }
    }

    /// 创建接收处理任务
    pub fn spawn_receiver(self, app: AppHandle) -> mpsc::Sender<SessionOutput> {
        let event_name = self.event_name.clone();
        let receiver = self.receiver;

        tokio::spawn(async move {
            Self::start_receiving(receiver, app, event_name).await;
        });

        self.sender
    }
}

impl std::fmt::Debug for SessionChannel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionChannel")
            .field("session_id", &self.session_id)
            .field("event_name", &self.event_name)
            .finish()
    }
}

/// Channel Manager - 管理所有 Session 的输出通道
///
/// 负责创建、存储和清理 SessionChannel 实例。
pub struct ChannelManager {
    /// 所有活跃的 Channel
    channels: Arc<RwLock<std::collections::HashMap<String, ChannelEntry>>>,
    /// 默认配置
    config: ChannelConfig,
}

struct ChannelEntry {
    sender: mpsc::Sender<SessionOutput>,
    events: broadcast::Sender<SessionOutput>,
}

impl ChannelManager {
    /// 创建新的 ChannelManager
    pub fn new() -> Self {
        Self {
            channels: Arc::new(RwLock::new(std::collections::HashMap::new())),
            config: ChannelConfig::default(),
        }
    }

    /// 创建带自定义配置的 ChannelManager
    pub fn with_config(config: ChannelConfig) -> Self {
        Self {
            channels: Arc::new(RwLock::new(std::collections::HashMap::new())),
            config,
        }
    }

    /// 创建新的 Channel 并注册
    pub async fn create_channel(&self, session_id: String) -> mpsc::Sender<SessionOutput> {
        let channel = SessionChannel::new(session_id.clone(), self.config.clone());
        let sender = channel.sender().clone();
        let mut receiver = channel.receiver;
        let (events, _) = broadcast::channel(self.config.buffer_size.max(1));
        let events_for_pump = events.clone();

        // SessionManager predates the AppHandle-based terminal output pump and
        // cannot attach an event emitter at construction time. Always consume
        // the compatibility mpsc queue so senders cannot stall after the
        // configured buffer fills; event consumers can subscribe explicitly.
        tokio::spawn(async move {
            while let Some(output) = receiver.recv().await {
                let _ = events_for_pump.send(output);
            }
        });

        let mut channels = self.channels.write().await;
        channels.insert(
            session_id,
            ChannelEntry {
                sender: sender.clone(),
                events,
            },
        );

        sender
    }

    /// 启动指定 Session 的事件接收器。
    pub async fn start_receiving(
        &self,
        session_id: &str,
        app: AppHandle,
    ) -> Result<(), SessionError> {
        let receiver = self
            .channels
            .read()
            .await
            .get(session_id)
            .map(|entry| entry.events.subscribe())
            .ok_or(SessionError::SessionNotFound)?;

        let event_name = self.config.event_name.clone();
        let session_id_for_task = session_id.to_string();
        tokio::spawn(async move {
            let mut receiver = receiver;
            loop {
                match receiver.recv().await {
                    Ok(output) => {
                        let session_id = output.session_id.clone();
                        if let Err(error) = app.emit(&event_name, output) {
                            tracing::warn!(
                                session_id = %session_id,
                                event = %event_name,
                                %error,
                                "failed to emit session data event",
                            );
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(count)) => {
                        tracing::warn!(
                            session_id = %session_id_for_task,
                            skipped = count,
                            "session event receiver lagged",
                        );
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        Ok(())
    }

    /// 获取已有的 Channel 发送端
    pub async fn get_channel(&self, session_id: &str) -> Option<mpsc::Sender<SessionOutput>> {
        let channels = self.channels.read().await;
        channels.get(session_id).map(|entry| entry.sender.clone())
    }

    /// 移除 Channel
    pub async fn remove_channel(&self, session_id: &str) {
        let mut channels = self.channels.write().await;
        channels.remove(session_id);
    }

    pub(crate) async fn clear(&self) {
        self.channels.write().await.clear();
    }

    /// 获取所有活跃的 Session ID
    pub async fn list_sessions(&self) -> Vec<String> {
        let channels = self.channels.read().await;
        channels.keys().cloned().collect()
    }

    /// 发送数据到指定 Session
    pub async fn send(&self, session_id: &str, output: SessionOutput) -> Result<(), SessionError> {
        let sender = self
            .channels
            .read()
            .await
            .get(session_id)
            .map(|entry| entry.sender.clone())
            .ok_or(SessionError::SessionNotFound)?;

        sender
            .send(output)
            .await
            .map_err(|e| SessionError::WriteFailed(format!("Channel closed: {}", e)))
    }

    /// 广播数据到所有 Session
    pub async fn broadcast(&self, output: SessionOutput) {
        let senders = self
            .channels
            .read()
            .await
            .values()
            .map(|entry| entry.sender.clone())
            .collect::<Vec<_>>();
        for sender in senders {
            let _ = sender.send(output.clone()).await;
        }
    }

    /// 获取活跃 Channel 数量
    pub async fn len(&self) -> usize {
        let channels = self.channels.read().await;
        channels.len()
    }

    /// 检查是否为空
    pub async fn is_empty(&self) -> bool {
        let channels = self.channels.read().await;
        channels.is_empty()
    }
}

impl Default for ChannelManager {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for ChannelManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // 尝试非阻塞获取数量（如果锁被占用则显示 -1）
        let count = self.channels.try_read().ok().map(|g| g.len()).unwrap_or(0);
        f.debug_struct("ChannelManager")
            .field("active_channels", &count)
            .finish()
    }
}

/// 便捷函数：创建 SessionOutput
pub fn make_output(
    session_id: impl Into<String>,
    data: impl Into<String>,
    is_stderr: bool,
) -> SessionOutput {
    let data = data.into();
    SessionOutput {
        session_id: session_id.into(),
        bytes: data.len(),
        data,
        is_stderr,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_channel_creation() {
        let manager = ChannelManager::new();
        let _sender = manager.create_channel("test-session".to_string()).await;

        assert!(manager.get_channel("test-session").await.is_some());
        assert_eq!(manager.len().await, 1);
    }

    #[tokio::test]
    async fn test_channel_removal() {
        let manager = ChannelManager::new();
        manager.create_channel("test-session".to_string()).await;

        manager.remove_channel("test-session").await;

        assert!(manager.get_channel("test-session").await.is_none());
        assert!(manager.is_empty().await);
    }

    #[tokio::test]
    async fn test_channel_send() {
        let config = ChannelConfig {
            buffer_size: 1,
            event_name: "test".to_string(),
        };
        let manager = ChannelManager::with_config(config);

        manager.create_channel("test-session".to_string()).await;
        for index in 0..32 {
            tokio::time::timeout(
                std::time::Duration::from_secs(1),
                manager.send(
                    "test-session",
                    make_output("test-session", format!("output-{index}"), false),
                ),
            )
            .await
            .expect("compatibility channel must continue draining after its buffer fills")
            .expect("channel sender must remain connected after creation");
        }
    }
}
