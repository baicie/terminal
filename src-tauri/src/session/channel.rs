//! Session Channel - 统一的异步输出通道
//!
//! 提供从 Session 到前端的异步数据流，通过 tokio channel 实现背压控制。

use super::types::{SessionError, SessionOutput};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

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
            let _data = output.clone();

            if let Err(e) = app.emit(&event_name, output) {
                eprintln!("Failed to emit session data for {}: {}", session_id, e);
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
    channels: Arc<std::sync::RwLock<std::collections::HashMap<String, mpsc::Sender<SessionOutput>>>>,
    /// 默认配置
    config: ChannelConfig,
}

impl ChannelManager {
    /// 创建新的 ChannelManager
    pub fn new() -> Self {
        Self {
            channels: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
            config: ChannelConfig::default(),
        }
    }

    /// 创建带自定义配置的 ChannelManager
    pub fn with_config(config: ChannelConfig) -> Self {
        Self {
            channels: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
            config,
        }
    }

    /// 创建新的 Channel 并注册
    pub fn create_channel(&self, session_id: String) -> mpsc::Sender<SessionOutput> {
        let channel = SessionChannel::new(session_id.clone(), self.config.clone());
        let sender = channel.sender().clone();

        {
            let mut channels = self.channels.write().unwrap();
            channels.insert(session_id, sender.clone());
        }

        sender
    }

    /// 获取已有的 Channel 发送端
    pub fn get_channel(&self, session_id: &str) -> Option<mpsc::Sender<SessionOutput>> {
        let channels = self.channels.read().unwrap();
        channels.get(session_id).cloned()
    }

    /// 移除 Channel
    pub fn remove_channel(&self, session_id: &str) {
        let mut channels = self.channels.write().unwrap();
        channels.remove(session_id);
    }

    /// 获取所有活跃的 Session ID
    pub fn list_sessions(&self) -> Vec<String> {
        let channels = self.channels.read().unwrap();
        channels.keys().cloned().collect()
    }

    /// 发送数据到指定 Session
    pub async fn send(&self, session_id: &str, output: SessionOutput) -> Result<(), SessionError> {
        let channels = self.channels.read().unwrap();
        if let Some(sender) = channels.get(session_id) {
            sender
                .send(output)
                .await
                .map_err(|e| SessionError::WriteFailed(format!("Channel closed: {}", e)))
        } else {
            Err(SessionError::SessionNotFound)
        }
    }

    /// 广播数据到所有 Session
    pub async fn broadcast(&self, output: SessionOutput) {
        let channels = self.channels.read().unwrap();
        for sender in channels.values() {
            let _ = sender.send(output.clone()).await;
        }
    }

    /// 获取活跃 Channel 数量
    pub fn len(&self) -> usize {
        let channels = self.channels.read().unwrap();
        channels.len()
    }

    /// 检查是否为空
    pub fn is_empty(&self) -> bool {
        let channels = self.channels.read().unwrap();
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
        f.debug_struct("ChannelManager")
            .field("active_channels", &self.len())
            .finish()
    }
}

/// 便捷函数：创建 SessionOutput
pub fn make_output(session_id: impl Into<String>, data: impl Into<String>, is_stderr: bool) -> SessionOutput {
    SessionOutput {
        session_id: session_id.into(),
        data: data.into(),
        is_stderr,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_channel_creation() {
        let manager = ChannelManager::new();
        let sender = manager.create_channel("test-session".to_string());

        assert!(manager.get_channel("test-session").is_some());
        assert_eq!(manager.len(), 1);
    }

    #[tokio::test]
    async fn test_channel_removal() {
        let manager = ChannelManager::new();
        manager.create_channel("test-session".to_string());

        manager.remove_channel("test-session");

        assert!(manager.get_channel("test-session").is_none());
        assert!(manager.is_empty());
    }

    #[tokio::test]
    async fn test_channel_send() {
        let manager = ChannelManager::new();
        manager.create_channel("test-session".to_string());

        let output = make_output("test-session", "hello", false);
        let result = manager.send("test-session", output).await;

        assert!(result.is_ok());
    }
}
