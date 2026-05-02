//! SSH Session 实现 - SSH 远程会话
//!
//! 使用 russh 实现 SSH 会话，支持直接连接和通过 Jump Host 连接。

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
use tokio::sync::{broadcast, Mutex};

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
    /// 关闭信号发送端
    shutdown_tx: broadcast::Sender<()>,
    /// 读取任务的 JoinHandle
    read_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
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
        Self::create(
            app,
            host,
            port,
            username,
            Some(password),
            None,
            false,
            None,
            cols,
            rows,
        )
        .await
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
        Self::create(
            app,
            host,
            port,
            username,
            password,
            Some(private_key),
            false,
            None,
            cols,
            rows,
        )
        .await
    }

    /// 创建新的 SSH Session（Agent 认证）
    pub async fn new_with_agent(
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        cols: u16,
        rows: u16,
    ) -> Result<Self, SessionError> {
        Self::create(
            app,
            host,
            port,
            username,
            None,
            None,
            true,
            None,
            cols,
            rows,
        )
        .await
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
            false,
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
        use_agent: bool,
        jump_host: Option<JumpHostConfig>,
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

        // 决定连接方式：直接连接 或 通过 Jump Host
        let handle: client::Handle<ClientHandler>;
        let target_channel: Option<russh::Channel<client::Msg>>;

        if let Some(ref jh) = jump_host {
            // 通过 Jump Host 连接到目标
            let (jh_handle, ch) = Self::connect_via_jump(
                config.clone(),
                host,
                port,
                username,
                password,
                private_key,
                jh,
            )
            .await?;
            handle = jh_handle;
            target_channel = Some(ch);
        } else {
            // 直接连接到主机
            let addr = format!("{}:{}", host, port);
            let mut direct_handle = client::connect(config, addr, ClientHandler::new())
                .await
                .map_err(|e| SessionError::ConnectionFailed(format!("Connection failed: {}", e)))?;

            // 认证
            Self::authenticate(&mut direct_handle, username, password, private_key, use_agent).await?;
            handle = direct_handle;
            target_channel = None;
        }

        // 打开 Shell Channel
        let mut channel = if let Some(jh_target_channel) = target_channel {
            // 通过 Jump Host 的 channel 连接目标 - 直接使用已建立的 channel
            jh_target_channel
        } else {
            // 直接打开 channel
            handle
                .channel_open_session()
                .await
                .map_err(|e| SessionError::ChannelError(format!("Failed to open channel: {}", e)))?
        };

        channel
            .request_pty(false, "xterm-256color", cols.into(), rows.into(), 0, 0, &[])
            .await
            .map_err(|e| SessionError::ChannelError(format!("Failed to request PTY: {}", e)))?;

        channel
            .request_shell(false)
            .await
            .map_err(|e| SessionError::ChannelError(format!("Failed to request shell: {}", e)))?;

        let channel_id = channel.id();

        // 创建关闭信号 channel
        let (shutdown_tx, _) = broadcast::channel(1);
        let shutdown_rx = shutdown_tx.subscribe();

        let read_handle = Arc::new(Mutex::new(None::<tokio::task::JoinHandle<()>>));

        let state = Arc::new(Mutex::new(SshSessionState {
            handle,
            channel_id,
            is_alive: true,
            shutdown_tx,
            read_handle: read_handle.clone(),
        }));

        // 启动读取任务
        let session_id_clone = session_id.clone();
        let app_clone = app.clone();
        let read_handle_clone = read_handle.clone();

        let handle = tokio::spawn(async move {
            let mut shutdown_rx = shutdown_rx;

            loop {
                tokio::select! {
                    // 监听关闭信号
                    _ = shutdown_rx.recv() => {
                        let _ = app_clone.emit("ssh-close", &session_id_clone);
                        break;
                    }
                    // 等待 channel 事件
                    msg = channel.wait() => {
                        match msg {
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
                }
            }

            // 清理 JoinHandle
            let mut handle_guard = read_handle_clone.lock().await;
            *handle_guard = None;
        });

        {
            let mut handle_guard = read_handle.lock().await;
            *handle_guard = Some(handle);
        }

        Ok(Self { session_id, state })
    }

    /// 通过 Jump Host 连接到目标主机
    ///
    /// 返回跳板机的 handle 和到目标主机的 channel
    async fn connect_via_jump(
        config: Arc<client::Config>,
        target_host: &str,
        target_port: u16,
        target_username: &str,
        target_password: Option<&str>,
        target_key: Option<&str>,
        jump_host: &JumpHostConfig,
    ) -> Result<(client::Handle<ClientHandler>, russh::Channel<client::Msg>), SessionError> {
        // 第一步：连接到跳板机
        let jump_addr = format!("{}:{}", jump_host.host, jump_host.port);
        let mut jump_handle = client::connect(config.clone(), jump_addr, ClientHandler::new())
            .await
            .map_err(|e| SessionError::ConnectionFailed(format!("Jump host connection failed: {}", e)))?;

        // 跳板机认证
        let jump_auth = match jump_host.auth_type.as_str() {
            "key" => {
                if let Some(ref key) = jump_host.private_key {
                    match russh::keys::decode_openssh(key.as_bytes(), jump_host.password.as_deref()) {
                        Ok(key) => {
                            let rsa_hash = jump_handle
                                .best_supported_rsa_hash()
                                .await
                                .map_err(|e| SessionError::ConnectionFailed(format!("RSA hash failed: {}", e)))?
                                .flatten();
                            let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
                            jump_handle.authenticate_publickey(&jump_host.username, key_with_hash).await
                        }
                        Err(_) => {
                            if let Some(ref pwd) = jump_host.password {
                                jump_handle.authenticate_password(&jump_host.username, pwd).await
                            } else {
                                return Err(SessionError::AuthenticationFailed(
                                    "Failed to parse jump host key and no password provided".to_string(),
                                ));
                            }
                        }
                    }
                } else if let Some(ref pwd) = jump_host.password {
                    jump_handle.authenticate_password(&jump_host.username, pwd).await
                } else {
                    return Err(SessionError::AuthenticationFailed(
                        "No authentication method provided for jump host".to_string(),
                    ));
                }
            }
            "password" | _ => {
                // 默认使用密码认证
                if let Some(ref pwd) = jump_host.password {
                    jump_handle.authenticate_password(&jump_host.username, pwd).await
                } else {
                    return Err(SessionError::AuthenticationFailed(
                        "Jump host password required".to_string(),
                    ));
                }
            }
        };

        if !jump_auth
            .map_err(|e| SessionError::AuthenticationFailed(format!("Jump host auth failed: {}", e)))?
            .success()
        {
            return Err(SessionError::AuthenticationFailed(
                "Jump host authentication failed".to_string(),
            ));
        }

        // 第二步：通过跳板机打开到目标主机的 direct-tcpip channel
        let peer_addr = format!("{}:{}", jump_host.host, jump_host.port);
        let mut target_channel = jump_handle
            .channel_open_direct_tcpip(target_host, target_port as u32, &peer_addr, jump_host.port as u32)
            .await
            .map_err(|e| SessionError::ChannelError(format!("Failed to open channel via jump host: {}", e)))?;

        // 第三步：在 channel 上尝试认证（部分跳板机支持此方式）
        Self::authenticate_channel_on_channel(
            &mut target_channel,
            target_username,
            target_password,
            target_key,
        )
        .await;

        Ok((jump_handle, target_channel))
    }

    /// 在 channel 上进行认证（实验性）
    async fn authenticate_channel_on_channel(
        _channel: &mut russh::Channel<client::Msg>,
        _username: &str,
        _password: Option<&str>,
        _private_key: Option<&str>,
    ) {
        // SSH 认证通常在 channel_open 之前完成
        // 对于通过跳板机的连接，认证信息已经在跳板机层处理
        // 这里不需要额外操作
    }

    /// 认证处理
    async fn authenticate(
        handle: &mut client::Handle<ClientHandler>,
        username: &str,
        password: Option<&str>,
        private_key: Option<&str>,
        use_agent: bool,
    ) -> Result<(), SessionError> {
        let rsa_hash = handle
            .best_supported_rsa_hash()
            .await
            .map_err(|e| SessionError::ConnectionFailed(format!("Failed to get RSA hash: {}", e)))?
            .flatten();

        if use_agent {
            #[cfg(unix)]
            {
                use russh::keys::agent::client::AgentClient;

                let mut agent = AgentClient::connect_env().await.map_err(|e| {
                    SessionError::AuthenticationFailed(format!("Failed to connect SSH agent: {}", e))
                })?;
                let identities = agent.request_identities().await.map_err(|e| {
                    SessionError::AuthenticationFailed(format!(
                        "Failed to read identities from SSH agent: {}",
                        e
                    ))
                })?;
                if identities.is_empty() {
                    return Err(SessionError::AuthenticationFailed(
                        "SSH agent has no available identities".to_string(),
                    ));
                }

                for identity in identities {
                    let public_key = identity.public_key().into_owned();
                    let alg = match public_key.algorithm() {
                        russh::keys::Algorithm::Dsa | russh::keys::Algorithm::Rsa { .. } => rsa_hash,
                        _ => None,
                    };
                    let auth = handle
                        .authenticate_publickey_with(username, public_key, alg, &mut agent)
                        .await
                        .map_err(|e| SessionError::AuthenticationFailed(format!("Agent auth failed: {}", e)))?;
                    if auth.success() {
                        return Ok(());
                    }
                }
                return Err(SessionError::AuthenticationFailed(
                    "Authentication failed: all SSH agent identities rejected".to_string(),
                ));
            }
            #[cfg(windows)]
            {
                use russh::keys::agent::client::AgentClient;
                use tokio::net::windows::named_pipe::ClientOptions;

                let explicit_pipe = std::env::var("SSH_AUTH_SOCK").ok();
                let candidates: Vec<String> = if let Some(pipe) = explicit_pipe.clone() {
                    vec![pipe]
                } else {
                    vec![
                        r"\\.\pipe\openssh-ssh-agent".to_string(),
                        r"\\.\pipe\pageant".to_string(),
                    ]
                };

                let mut selected_pipe: Option<String> = None;
                let mut stream_opt = None;
                let mut open_errors: Vec<(String, std::io::Error)> = Vec::new();
                for pipe in candidates {
                    match ClientOptions::new().open(&pipe) {
                        Ok(stream) => {
                            selected_pipe = Some(pipe);
                            stream_opt = Some(stream);
                            break;
                        }
                        Err(e) => open_errors.push((pipe, e)),
                    }
                }
                let selected_pipe = selected_pipe.ok_or_else(|| {
                    if let Some((pipe, e)) = open_errors.first() {
                        use std::io::ErrorKind;
                        let msg = match e.kind() {
                            ErrorKind::NotFound => {
                                if explicit_pipe.is_some() {
                                    format!(
                                        "SSH_AUTH_SOCK points to '{}', but the pipe was not found.",
                                        pipe
                                    )
                                } else {
                                    "No SSH agent pipe found. Start Windows OpenSSH Authentication Agent service or set SSH_AUTH_SOCK to a valid pipe.".to_string()
                                }
                            }
                            ErrorKind::PermissionDenied => format!(
                                "Permission denied when opening SSH agent pipe '{}'. Try running with matching user privileges.",
                                pipe
                            ),
                            _ => format!("Failed to open SSH agent pipe '{}': {}", pipe, e),
                        };
                        SessionError::AuthenticationFailed(msg)
                    } else {
                        SessionError::AuthenticationFailed(
                            "No SSH agent pipe candidate available".to_string(),
                        )
                    }
                })?;
                let stream = stream_opt.expect("stream must exist when selected_pipe exists");

                if selected_pipe.to_ascii_lowercase().contains("pageant") {
                    tracing::info!(
                        pipe = %selected_pipe,
                        "using Pageant named pipe for SSH agent auth (best-effort)"
                    );
                }
                let mut agent = AgentClient::connect(stream);
                let identities = agent.request_identities().await.map_err(|e| {
                    SessionError::AuthenticationFailed(format!(
                        "Failed to read identities from SSH agent: {}",
                        e
                    ))
                })?;
                if identities.is_empty() {
                    return Err(SessionError::AuthenticationFailed(
                        "SSH agent has no available identities".to_string(),
                    ));
                }

                for identity in identities {
                    let public_key = identity.public_key().into_owned();
                    let alg = match public_key.algorithm() {
                        russh::keys::Algorithm::Dsa | russh::keys::Algorithm::Rsa { .. } => rsa_hash,
                        _ => None,
                    };
                    let auth = handle
                        .authenticate_publickey_with(username, public_key, alg, &mut agent)
                        .await
                        .map_err(|e| SessionError::AuthenticationFailed(format!("Agent auth failed: {}", e)))?;
                    if auth.success() {
                        return Ok(());
                    }
                }
                return Err(SessionError::AuthenticationFailed(
                    "Authentication failed: all SSH agent identities rejected".to_string(),
                ));
            }
            #[cfg(not(any(unix, windows)))]
            {
                return Err(SessionError::AuthenticationFailed(
                    "SSH agent authentication is not available on this platform yet".to_string(),
                ));
            }
        }

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

        Ok(())
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

    /// 关闭会话 - 发送关闭信号并等待任务完成
    pub fn close(self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let state = self.state.clone();
        Box::pin(async move {
            let read_handle = {
                let mut s = state.lock().await;
                if s.is_alive {
                    let _ = s.shutdown_tx.send(());
                    let _ = s.handle.disconnect(russh::Disconnect::ByApplication, "", "en").await;
                    s.is_alive = false;
                }
                let h = s.read_handle.lock().await.take();
                h
            };
            // 等待读取任务完成（最多等待 2 秒）
            if let Some(h) = read_handle {
                let _ = tokio::time::timeout(tokio::time::Duration::from_secs(2), h).await;
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
