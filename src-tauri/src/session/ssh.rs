//! SSH Session 实现 - SSH 远程会话
//!
//! 使用 russh 实现 SSH 会话。

use super::types::{JumpHostConfig, SessionError, SessionOutput, SessionType};
use anyhow::Result;
use russh::client;
use russh::keys::PrivateKeyWithHashAlg;
use russh::{ChannelId, ChannelMsg};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::state::ClientHandler;

/// SSH sessions storage for SFTP and port forwarding
type SshSessions = Arc<Mutex<HashMap<String, Arc<client::Handle<ClientHandler>>>>>;

/// Global SSH sessions storage
static SSH_SESSIONS: std::sync::OnceLock<SshSessions> = std::sync::OnceLock::new();

/// Get the global SSH sessions registry
pub fn get_ssh_sessions() -> SshSessions {
    SSH_SESSIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new()))).clone()
}

/// SSH Session 内部状态
pub struct SshSessionState {
    /// SSH 连接句柄
    handle: client::Handle<ClientHandler>,
    /// Channel ID
    channel_id: ChannelId,
    /// 是否存活
    is_alive: bool,
}

/// SSH Session - SSH 远程会话
#[derive(Clone)]
pub struct SshSession {
    /// Session ID
    session_id: String,
    /// 内部状态
    state: Arc<Mutex<SshSessionState>>,
}

impl SshSession {
    /// 创建新的 SSH Session（密码认证）
    pub async fn new_with_password(
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
        Self::create(app, host, port, username, Some(password), None, None, cols, rows).await
    }

    /// 创建新的 SSH Session（密钥认证）
    pub async fn new_with_key(
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        private_key: &str,
        password: Option<&str>,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
        Self::create(app, host, port, username, password, Some(private_key), None, cols, rows).await
    }

    /// 创建新的 SSH Session（通过 Jump Host）
    pub async fn new_with_jump(
        app: AppHandle,
        target_host: &str,
        target_port: u16,
        target_username: &str,
        target_password: Option<&str>,
        target_key: Option<&str>,
        jump_host: JumpHostConfig,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
        Self::create(
            app,
            target_host,
            target_port,
            target_username,
            target_password,
            target_key,
            Some(jump_host),
            cols,
            rows,
        )
        .await
    }

    /// 内部创建方法
    #[allow(dead_code)]
    async fn create(
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        private_key: Option<&str>,
        _jump_host: Option<JumpHostConfig>,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
        // 验证输入
        if host.is_empty() {
            return Err(SessionError::InvalidInput("Host cannot be empty".to_string()));
        }
        if !(1..=65535).contains(&port) {
            return Err(SessionError::InvalidInput(
                "Port must be between 1 and 65535".to_string(),
            ));
        }
        if username.is_empty() {
            return Err(SessionError::InvalidInput("Username cannot be empty".to_string()));
        }

        let session_id = format!("{}-{}:{}", username, host, port);

        // 构建 SSH 配置
        let config = Arc::new(client::Config {
            inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
            keepalive_interval: Some(std::time::Duration::from_secs(30)),
            keepalive_max: 3,
            ..Default::default()
        });

        // 连接
        let addr = format!("{}:{}", host, port);
        let mut handle = client::connect(config, addr, ClientHandler::new())
            .await
            .map_err(|e| SessionError::ConnectionFailed(format!("Connection failed: {}", e)))?;

        // 认证
        let rsa_hash = handle
            .best_supported_rsa_hash()
            .await
            .map_err(|e| SessionError::ConnectionFailed(format!("Failed to get RSA hash: {}", e)))?
            .flatten();

        let auth_result = if let Some(key_content) = private_key {
            match russh::keys::decode_openssh(key_content.as_bytes(), password) {
                Ok(key) => {
                    let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
                    handle.authenticate_publickey(username, key_with_hash).await
                }
                Err(_) => {
                    if let Some(pwd) = password {
                        handle.authenticate_password(username, pwd).await
                    } else {
                        return Err(SessionError::AuthenticationFailed(
                            "Failed to parse private key and no password provided".to_string(),
                        ));
                    }
                }
            }
        } else if let Some(pwd) = password {
            handle.authenticate_password(username, pwd).await
        } else {
            return Err(SessionError::AuthenticationFailed(
                "No authentication method provided".to_string(),
            ));
        };

        if !auth_result
            .map_err(|e| SessionError::AuthenticationFailed(format!("Auth failed: {}", e)))?
            .success()
        {
            return Err(SessionError::AuthenticationFailed(
                "Authentication failed: all methods rejected".to_string(),
            ));
        }

        // 打开 Shell Channel
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| SessionError::ChannelError(format!("Failed to open channel: {}", e)))?;

        channel
            .request_pty(false, "xterm-256color", cols.into(), rows.into(), 0, 0, &[])
            .await
            .map_err(|e| SessionError::ChannelError(format!("Failed to request PTY: {}", e)))?;

        channel
            .request_shell(false)
            .await
            .map_err(|e| SessionError::ChannelError(format!("Failed to request shell: {}", e)))?;

        let channel_id = channel.id();

        let state = Arc::new(Mutex::new(SshSessionState {
            handle,
            channel_id,
            is_alive: true,
        }));

        // 启动读取任务
        let session_id_clone = session_id.clone();
        let app_clone = app.clone();

        tokio::spawn(async move {
            loop {
                match channel.wait().await {
                    Some(ChannelMsg::Data { data }) => {
                        let output = SessionOutput {
                            session_id: session_id_clone.clone(),
                            data: String::from_utf8_lossy(&data).to_string(),
                            is_stderr: false,
                        };
                        let _ = app_clone.emit("ssh-data", output);
                    }
                    Some(ChannelMsg::ExtendedData { data, ext }) => {
                        let output = SessionOutput {
                            session_id: session_id_clone.clone(),
                            data: String::from_utf8_lossy(&data).to_string(),
                            is_stderr: ext == 1,
                        };
                        let _ = app_clone.emit("ssh-data", output);
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close { .. }) => {
                        let _ = app_clone.emit("ssh-close", &session_id_clone);
                        break;
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        let _ = app_clone.emit("ssh-exit", (&session_id_clone, exit_status));
                    }
                    None => break,
                    _ => continue,
                }
            }
        });

        Ok(Self { session_id, state })
    }

    /// 获取会话 ID
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// 获取 Session 类型
    pub fn session_type(&self) -> SessionType {
        SessionType::Ssh
    }

    /// 写入数据
    pub fn write(&self, data: &str) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        let data_bytes = bytes::Bytes::copy_from_slice(data.as_bytes());
        let state = self.state.clone();
        Box::pin(async move {
            let state = state.lock().await;
            if !state.is_alive {
                return Err(SessionError::WriteFailed("Session is closed".to_string()));
            }

            state
                .handle
                .data(state.channel_id, data_bytes)
                .await
                .map_err(|e| SessionError::ChannelError(format!("Failed to send data: {:?}", e)))?;

            Ok(())
        })
    }

    /// 调整大小
    pub fn resize(&self, cols: u16, rows: u16) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        let resize_cmd = format!("\x1b[8;{};{}t", rows, cols);
        let resize_bytes = bytes::Bytes::from(resize_cmd);
        let state = self.state.clone();
        Box::pin(async move {
            let state = state.lock().await;
            if !state.is_alive {
                return Err(SessionError::ResizeFailed("Session is closed".to_string()));
            }

            state
                .handle
                .data(state.channel_id, resize_bytes)
                .await
                .map_err(|e| SessionError::ChannelError(format!("Failed to send resize: {:?}", e)))?;

            Ok(())
        })
    }

    /// 关闭会话
    pub fn close(self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let state = self.state.clone();
        Box::pin(async move {
            let mut state = state.lock().await;
            if state.is_alive {
                let _ = state.handle.disconnect(russh::Disconnect::ByApplication, "", "en").await;
                state.is_alive = false;
            }
        })
    }

    /// 检查会话是否活跃
    pub fn is_alive(&self) -> bool {
        let state = self.state.try_lock();
        match state {
            Ok(s) => s.is_alive,
            Err(_) => false,
        }
    }
}
