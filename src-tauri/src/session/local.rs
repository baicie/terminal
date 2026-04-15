//! Local Session 实现 - 本地终端会话
//!
//! 使用 portable-pty 实现本地 PTY 会话。

use super::types::{SessionError, SessionOutput, SessionType};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::sync::Arc;
use std::future::Future;
use std::pin::Pin;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

/// Local Session 内部状态
pub struct LocalPtyState {
    /// PTY 主端
    pty_pair: portable_pty::PtyPair,
    /// 子进程
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// 写入器（需要 Mutex 保护因为 Write 不是 Sync）
    writer: Arc<Mutex<Box<dyn std::io::Write + Send + 'static>>>,
    /// 是否存活
    is_alive: bool,
}

/// Local Session - 本地 PTY 会话
#[derive(Clone)]
pub struct LocalSession {
    /// Session ID
    session_id: String,
    /// 内部状态
    state: Arc<Mutex<LocalPtyState>>,
}

impl LocalSession {
    /// 创建新的 LocalSession
    pub async fn new(app: AppHandle, cols: u16, rows: u16) -> Result<Self, SessionError> {
        let session_id = format!("local-{}", Uuid::new_v4());

        // 创建 PTY 对
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SessionError::ConnectionFailed(format!("Failed to open PTY: {}", e)))?;

        // 获取默认 shell
        let shell = if cfg!(windows) {
            std::env::var("PSModulePath")
                .map(|_| "powershell.exe".to_string())
                .unwrap_or_else(|_| "cmd.exe".to_string())
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        };

        // 创建命令
        let cmd = CommandBuilder::new(&shell);

        // 设置工作目录（Windows）
        #[cfg(windows)]
        {
            use std::path::PathBuf;
            let home = std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .unwrap_or_else(|_| ".".to_string());
            cmd.cwd(PathBuf::from(&home));
        }

        // 启动子进程
        let child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| SessionError::ConnectionFailed(format!("Failed to spawn shell: {}", e)))?;

        // 获取读写器
        let mut reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| SessionError::ConnectionFailed(format!("Failed to clone PTY reader: {}", e)))?;

        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| SessionError::ConnectionFailed(format!("Failed to take writer: {}", e)))?;

        // 禁用 PTY 回显，让 xterm.js 控制所有显示
        #[cfg(unix)]
        {
            use rustix::fd::BorrowedFd;
            use rustix::termios::{tcgetattr, tcsetattr, OptionalActions};
            use rustix::termios::LocalModes;

            if let Some(raw_fd) = pty_pair.master.as_raw_fd() {
                let fd = unsafe { BorrowedFd::borrow_raw(raw_fd) };
                if let Ok(mut t) = tcgetattr(fd) {
                    t.local_modes = t.local_modes.difference(
                        LocalModes::ECHO
                            | LocalModes::ECHOE
                            | LocalModes::ECHOK
                            | LocalModes::ECHOCTL
                            | LocalModes::ECHOKE,
                    );
                    let _ = tcsetattr(fd, OptionalActions::Now, &t);
                }
            }
        }

        let state = Arc::new(Mutex::new(LocalPtyState {
            pty_pair,
            child,
            writer: Arc::new(Mutex::new(writer)),
            is_alive: true,
        }));

        // 启动读取任务
        let session_id_clone = session_id.clone();
        let app_clone = app.clone();
        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = app_clone.emit("local-close", &session_id_clone);
                        break;
                    }
                    Ok(n) => {
                        let output = SessionOutput {
                            session_id: session_id_clone.clone(),
                            data: String::from_utf8_lossy(&buf[..n]).to_string(),
                            is_stderr: false,
                        };
                        let _ = app_clone.emit("local-data", output);
                    }
                    Err(_) => {
                        let _ = app_clone.emit("local-close", &session_id_clone);
                        break;
                    }
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
        SessionType::Local
    }

    /// 写入数据
    pub fn write(&self, data: &str) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        let data = data.to_string();
        let state = self.state.clone();
        Box::pin(async move {
            let state = state.lock().await;
            if !state.is_alive {
                return Err(SessionError::WriteFailed("Session is closed".to_string()));
            }

            let mut writer = state.writer.lock().await;
            writer
                .write_all(data.as_bytes())
                .map_err(|e| SessionError::WriteFailed(format!("Failed to write: {}", e)))?;
            writer
                .flush()
                .map_err(|e| SessionError::WriteFailed(format!("Failed to flush: {}", e)))?;

            Ok(())
        })
    }

    /// 调整大小
    pub fn resize(&self, cols: u16, rows: u16) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        let state = self.state.clone();
        Box::pin(async move {
            let state = state.lock().await;
            if !state.is_alive {
                return Err(SessionError::ResizeFailed("Session is closed".to_string()));
            }

            state
                .pty_pair
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| SessionError::ResizeFailed(format!("Failed to resize: {}", e)))?;

            Ok(())
        })
    }

    /// 关闭会话
    pub fn close(self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let state = self.state.clone();
        Box::pin(async move {
            let mut state = state.lock().await;
            if state.is_alive {
                let _ = state.child.kill();
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
