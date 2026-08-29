//! Local Session 实现 - 本地终端会话
//!
//! 使用 portable-pty 实现本地 PTY 会话。

use super::lifecycle::{SessionCompletion, SessionLifecycle};
use super::terminal_output::{emit_terminal_error, spawn_session_output_pump, TerminalOutputChunk};
use super::types::{validate_terminal_size, SessionError, SessionType, TerminalProfile};
use parking_lot::Mutex as ParkingMutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::future::Future;
use std::io::Write;
use std::pin::Pin;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, Mutex};

const LOCAL_CLOSE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// Local Session 内部状态
pub struct LocalPtyState {
    /// PTY 主端；同步控制操作通过阻塞线程执行。
    master: Arc<ParkingMutex<Box<dyn portable_pty::MasterPty + Send>>>,
    /// 子进程；自然 EOF 与主动关闭共用一次性 wait/reap 路径。
    child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
    /// 可在线程间安全复制的终止句柄。
    child_killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
    /// 写入器（需要 Mutex 保护因为 Write 不是 Sync）
    writer: Arc<ParkingMutex<Box<dyn std::io::Write + Send + 'static>>>,
    /// 是否存活
    is_alive: bool,
    /// 关闭信号发送端
    shutdown_tx: broadcast::Sender<()>,
    /// 读取任务的 JoinHandle
    read_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

/// Local Session - 本地 PTY 会话
#[derive(Clone)]
pub struct LocalSession {
    /// Session ID
    session_id: String,
    /// 内部状态
    state: Arc<Mutex<LocalPtyState>>,
    /// 保留最终完成状态，覆盖 EOF 早于 manager 注册的竞态。
    lifecycle: SessionLifecycle,
}

struct LocalPtyResources {
    master: Arc<ParkingMutex<Box<dyn portable_pty::MasterPty + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    child_killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
    reader: Box<dyn std::io::Read + Send + 'static>,
    writer: Box<dyn std::io::Write + Send + 'static>,
    startup_command: Option<String>,
}

fn setup_pty(
    cols: u16,
    rows: u16,
    profile: Option<TerminalProfile>,
) -> Result<LocalPtyResources, SessionError> {
    if let Some(profile) = &profile {
        profile.validate()?;
    }
    // 获取默认 shell：允许通过环境变量覆盖；Windows 回退 cmd.exe，Unix 回退 bash。
    let shell = if let Ok(shell) = std::env::var("TERMINAL_DEFAULT_SHELL") {
        shell
    } else if cfg!(windows) {
        std::env::var("PSModulePath")
            .map(|_| "powershell.exe".to_string())
            .unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };

    let mut command = CommandBuilder::new(&shell);
    #[cfg(unix)]
    if matches!(
        std::path::Path::new(&shell)
            .file_name()
            .and_then(|name| name.to_str()),
        Some("zsh" | "bash" | "sh" | "fish")
    ) {
        command.arg("-l");
    }
    if shell.eq_ignore_ascii_case("powershell.exe") || shell.eq_ignore_ascii_case("pwsh.exe") {
        command.arg("-NoLogo");
    }
    if let Some(home) = dirs::home_dir() {
        command.cwd(home);
    }

    if let Some(profile) = &profile {
        for (name, value) in &profile.environment {
            command.env(name, value);
        }
    }
    let startup_command = profile.and_then(|profile| profile.startup_command);
    setup_pty_with_command(cols, rows, command, startup_command)
}

fn setup_pty_with_command(
    cols: u16,
    rows: u16,
    mut command: CommandBuilder,
    startup_command: Option<String>,
) -> Result<LocalPtyResources, SessionError> {
    validate_terminal_size(cols, rows)?;
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "Terminal");
    let pty_pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| SessionError::ConnectionFailed(format!("Failed to open PTY: {}", e)))?;

    let child = pty_pair
        .slave
        .spawn_command(command)
        .map_err(|e| SessionError::ConnectionFailed(format!("Failed to spawn shell: {}", e)))?;
    let mut child_guard = ChildReapGuard::new(child);
    let master = Arc::new(ParkingMutex::new(pty_pair.master));
    let reader = master.lock().try_clone_reader().map_err(|e| {
        SessionError::ConnectionFailed(format!("Failed to clone PTY reader: {}", e))
    })?;
    let writer = master
        .lock()
        .take_writer()
        .map_err(|e| SessionError::ConnectionFailed(format!("Failed to take writer: {}", e)))?;
    let child_killer = child_guard
        .child()
        .expect("the initialization guard must own the spawned child")
        .clone_killer();
    let child = child_guard
        .take()
        .expect("the initialization guard must return the spawned child");

    Ok(LocalPtyResources {
        master,
        child,
        child_killer,
        reader,
        writer,
        startup_command,
    })
}

struct ChildReapGuard {
    child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
}

impl ChildReapGuard {
    fn new(child: Box<dyn portable_pty::Child + Send + Sync>) -> Self {
        Self { child: Some(child) }
    }

    fn child(&self) -> Option<&(dyn portable_pty::Child + Send + Sync)> {
        self.child.as_deref()
    }

    fn take(&mut self) -> Option<Box<dyn portable_pty::Child + Send + Sync>> {
        self.child.take()
    }
}

impl Drop for ChildReapGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = terminate_and_reap_child(&mut *child);
        }
    }
}

impl LocalSession {
    /// 创建新的 LocalSession
    pub async fn new(
        app: AppHandle,
        cols: u16,
        rows: u16,
        profile: Option<TerminalProfile>,
    ) -> Result<Self, SessionError> {
        let session_id = format!("local-{}", uuid::Uuid::new_v4());

        let resources = tokio::task::spawn_blocking(move || setup_pty(cols, rows, profile))
            .await
            .map_err(|e| {
                SessionError::ConnectionFailed(format!("PTY setup task failed: {}", e))
            })??;
        let LocalPtyResources {
            master,
            child,
            child_killer,
            reader,
            writer,
            startup_command,
        } = resources;

        // 创建关闭信号 channel
        let (shutdown_tx, _) = broadcast::channel(1);
        let shutdown_rx = shutdown_tx.subscribe();

        let read_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>> =
            Arc::new(Mutex::new(None));

        // 将 reader 包装在 Arc 中以便在循环中共享
        let reader = Arc::new(ParkingMutex::new(reader));

        let lifecycle = SessionLifecycle::new();
        let state = Arc::new(Mutex::new(LocalPtyState {
            master,
            child: Some(child),
            child_killer,
            writer: Arc::new(ParkingMutex::new(writer)),
            is_alive: true,
            shutdown_tx,
            read_handle: read_handle.clone(),
        }));

        // 启动读取任务
        let session_id_clone = session_id.clone();
        let app_clone = app.clone();
        let reader_clone = reader.clone();
        let state_clone = Arc::clone(&state);
        let lifecycle_clone = lifecycle.clone();
        let (output_tx, mut output_handle) =
            spawn_session_output_pump(app, session_id.clone(), "local-data");

        let handle = tokio::spawn(async move {
            let mut shutdown_rx = shutdown_rx;
            let mut output_result = None;

            loop {
                tokio::select! {
                    biased;

                    // 优先处理关闭信号
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                    result = &mut output_handle => {
                        output_result = Some(result);
                        break;
                    }
                    // 读取 PTY 数据：buffer 必须放在 spawn_blocking 内，
                    // 否则跨 await 会被 borrow-checker 拒绝。
                    result = tokio::task::spawn_blocking({
                        let reader = reader_clone.clone();
                        move || {
                            let mut buf = [0u8; 4096];
                            let mut r = reader.lock();
                            let n = r.read(&mut buf)?;
                            Ok::<(usize, [u8; 4096]), std::io::Error>((n, buf))
                        }
                    }) => {
                        match result {
                            Ok(Ok((0, _))) => {
                                break;
                            }
                            Ok(Ok((n, buf))) => {
                                if output_tx
                                    .send(TerminalOutputChunk::new(&buf[..n], false))
                                    .await
                                    .is_err()
                                {
                                    tracing::error!(
                                        session_id = %session_id_clone,
                                        "local terminal output pump stopped before the PTY reader",
                                    );
                                    break;
                                }
                            }
                            Ok(Err(error)) => {
                                emit_terminal_error(
                                    &app_clone,
                                    &session_id_clone,
                                    format!("local PTY read failed: {error}"),
                                );
                                break;
                            }
                            Err(error) => {
                                emit_terminal_error(
                                    &app_clone,
                                    &session_id_clone,
                                    format!("local PTY reader task failed: {error}"),
                                );
                                break;
                            }
                        }
                    }
                }
            }

            drop(output_tx);
            let output_result = match output_result {
                Some(result) => result,
                None => output_handle.await,
            };
            match output_result {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    tracing::error!(session_id = %session_id_clone, %error, "local terminal output pump failed");
                    emit_terminal_error(&app_clone, &session_id_clone, error);
                }
                Err(error) => {
                    tracing::error!(session_id = %session_id_clone, %error, "local terminal output pump task failed");
                    emit_terminal_error(
                        &app_clone,
                        &session_id_clone,
                        format!("terminal output task failed: {error}"),
                    );
                }
            }
            let _ = app_clone.emit("local-close", &session_id_clone);
            finish_local_session(&state_clone, &lifecycle_clone, &session_id_clone).await;
        });

        {
            let mut handle_guard = read_handle.lock().await;
            *handle_guard = Some(handle);
        }

        if let Some(command) = startup_command {
            let writer = {
                let state = state.lock().await;
                state.writer.clone()
            };
            let mut data = command.into_bytes();
            if !data.ends_with(b"\n") {
                data.push(b'\n');
            }
            match tokio::task::spawn_blocking(move || write_local_data(&mut *writer.lock(), &data))
                .await
            {
                Err(error) => tracing::warn!(%error, "local startup command task failed"),
                Ok(Err(error)) => tracing::warn!(%error, "local startup command failed"),
                Ok(Ok(())) => {}
            }
        }

        Ok(Self {
            session_id,
            state,
            lifecycle,
        })
    }

    /// 获取会话 ID
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// 获取 Session 类型
    pub fn session_type(&self) -> SessionType {
        SessionType::Local
    }

    pub(crate) fn completion(&self) -> SessionCompletion {
        self.lifecycle.completion()
    }

    /// 写入 UTF-8 文本数据。
    pub fn write(
        &self,
        data: &str,
    ) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        self.write_raw(data.as_bytes().to_vec())
    }

    /// 写入不经过 UTF-8 转换的原始终端字节。
    pub fn write_raw(
        &self,
        data: Vec<u8>,
    ) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        let state = self.state.clone();
        Box::pin(async move {
            let writer = {
                let state = state.lock().await;
                if !state.is_alive {
                    return Err(SessionError::WriteFailed("Session is closed".to_string()));
                }
                state.writer.clone()
            };

            tokio::task::spawn_blocking(move || {
                let mut writer = writer.lock();
                write_local_data(&mut *writer, &data)?;
                Ok::<(), String>(())
            })
            .await
            .map_err(|e| SessionError::WriteFailed(format!("Write task failed: {}", e)))?
            .map_err(SessionError::WriteFailed)
        })
    }

    /// 调整大小
    pub fn resize(
        &self,
        cols: u16,
        rows: u16,
    ) -> Pin<Box<dyn Future<Output = Result<(), SessionError>> + Send>> {
        let state = self.state.clone();
        Box::pin(async move {
            validate_terminal_size(cols, rows)?;
            let master = {
                let state = state.lock().await;
                if !state.is_alive {
                    return Err(SessionError::ResizeFailed("Session is closed".to_string()));
                }
                state.master.clone()
            };

            tokio::task::spawn_blocking(move || {
                master.lock().resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
            })
            .await
            .map_err(|e| SessionError::ResizeFailed(format!("Resize task failed: {}", e)))?
            .map_err(|e| SessionError::ResizeFailed(format!("Failed to resize: {}", e)))
        })
    }

    /// 关闭会话 - 发送关闭信号并等待任务完成
    pub fn close(self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let state = self.state.clone();
        let lifecycle = self.lifecycle.clone();
        let session_id = self.session_id.clone();
        Box::pin(async move {
            let (child_killer, read_handle) = {
                let mut s = state.lock().await;
                let child_killer = if s.is_alive {
                    let _ = s.shutdown_tx.send(());
                    s.is_alive = false;
                    Some(s.child_killer.clone_killer())
                } else {
                    None
                };
                let h = s.read_handle.lock().await.take();
                (child_killer, h)
            };

            if let Some(mut child_killer) = child_killer {
                let mut kill_task = tokio::task::spawn_blocking(move || child_killer.kill());
                if tokio::time::timeout(LOCAL_CLOSE_TIMEOUT, &mut kill_task)
                    .await
                    .is_err()
                {
                    tracing::warn!(
                        session_id,
                        "local terminal child kill exceeded the close deadline"
                    );
                    kill_task.abort();
                }
            }

            // 等待读取任务完成（最多等待 2 秒）
            if let Some(mut task) = read_handle {
                if tokio::time::timeout(LOCAL_CLOSE_TIMEOUT, &mut task)
                    .await
                    .is_err()
                {
                    tracing::warn!(
                        session_id,
                        "local terminal reader task exceeded the close deadline"
                    );
                    task.abort();
                    let _ = task.await;
                }
            }

            finish_local_session(&state, &lifecycle, &session_id).await;
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

fn write_local_data(writer: &mut dyn Write, data: &[u8]) -> Result<(), String> {
    writer
        .write_all(data)
        .map_err(|error| format!("Failed to write: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Failed to flush: {error}"))
}

fn terminate_and_reap_child(child: &mut dyn portable_pty::Child) -> Result<(), String> {
    let initial_wait_error = match child.try_wait() {
        Ok(Some(_)) => return Ok(()),
        Ok(None) => None,
        Err(error) => Some(error),
    };
    let kill_error = child.kill().err();

    match child.wait() {
        Ok(_) => Ok(()),
        Err(wait_error) => {
            let mut failures = Vec::new();
            if let Some(error) = initial_wait_error {
                failures.push(format!("initial wait failed: {error}"));
            }
            if let Some(error) = kill_error {
                failures.push(format!("kill failed: {error}"));
            }
            failures.push(format!("final wait failed: {wait_error}"));
            Err(failures.join("; "))
        }
    }
}

async fn finish_local_session(
    state: &Arc<Mutex<LocalPtyState>>,
    lifecycle: &SessionLifecycle,
    session_id: &str,
) {
    let child = {
        let mut state = state.lock().await;
        state.is_alive = false;
        state.child.take()
    };

    if let Some(mut child) = child {
        let mut reaper = tokio::task::spawn_blocking(move || terminate_and_reap_child(&mut *child));
        match tokio::time::timeout(LOCAL_CLOSE_TIMEOUT, &mut reaper).await {
            Ok(Ok(Ok(()))) => {}
            Ok(Ok(Err(error))) => tracing::warn!(
                session_id,
                %error,
                "failed to reap local terminal child",
            ),
            Ok(Err(error)) => tracing::warn!(
                session_id,
                %error,
                "local terminal child reaper task failed",
            ),
            Err(_) => {
                tracing::warn!(
                    session_id,
                    "local terminal child reaper exceeded the close deadline"
                );
                reaper.abort();
            }
        }
    }

    lifecycle.complete();
}

#[cfg(test)]
pub(in crate::session) mod tests {
    use super::*;
    use portable_pty::{Child, ChildKiller, ExitStatus, MasterPty};
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[cfg(unix)]
    use rustix::fd::BorrowedFd;
    #[cfg(unix)]
    use rustix::termios::{tcgetattr, LocalModes};

    #[derive(Clone, Debug, Default)]
    pub(in crate::session) struct ChildProbe {
        kill_calls: Arc<AtomicUsize>,
        reap_calls: Arc<AtomicUsize>,
    }

    impl ChildProbe {
        pub(in crate::session) fn kill_calls(&self) -> usize {
            self.kill_calls.load(Ordering::Acquire)
        }

        pub(in crate::session) fn reap_calls(&self) -> usize {
            self.reap_calls.load(Ordering::Acquire)
        }
    }

    #[derive(Debug, Default)]
    struct FakeMasterPty;

    impl MasterPty for FakeMasterPty {
        fn resize(&self, _size: PtySize) -> Result<(), anyhow::Error> {
            Ok(())
        }

        fn get_size(&self) -> Result<PtySize, anyhow::Error> {
            Ok(PtySize::default())
        }

        fn try_clone_reader(&self) -> Result<Box<dyn std::io::Read + Send>, anyhow::Error> {
            Ok(Box::new(std::io::empty()))
        }

        fn take_writer(&self) -> Result<Box<dyn std::io::Write + Send>, anyhow::Error> {
            Ok(Box::new(std::io::sink()))
        }

        #[cfg(unix)]
        fn process_group_leader(&self) -> Option<libc::pid_t> {
            None
        }

        #[cfg(unix)]
        fn as_raw_fd(&self) -> Option<portable_pty::unix::RawFd> {
            None
        }

        #[cfg(unix)]
        fn tty_name(&self) -> Option<std::path::PathBuf> {
            None
        }
    }

    #[derive(Debug)]
    struct TrackingChild {
        probe: ChildProbe,
    }

    impl ChildKiller for TrackingChild {
        fn kill(&mut self) -> std::io::Result<()> {
            self.probe.kill_calls.fetch_add(1, Ordering::AcqRel);
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(TrackingKiller {
                probe: self.probe.clone(),
            })
        }
    }

    impl Child for TrackingChild {
        fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
            self.probe.reap_calls.fetch_add(1, Ordering::AcqRel);
            Ok(Some(ExitStatus::with_exit_code(0)))
        }

        fn wait(&mut self) -> std::io::Result<ExitStatus> {
            self.probe.reap_calls.fetch_add(1, Ordering::AcqRel);
            Ok(ExitStatus::with_exit_code(0))
        }

        fn process_id(&self) -> Option<u32> {
            None
        }

        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    #[derive(Debug)]
    struct TrackingKiller {
        probe: ChildProbe,
    }

    impl ChildKiller for TrackingKiller {
        fn kill(&mut self) -> std::io::Result<()> {
            self.probe.kill_calls.fetch_add(1, Ordering::AcqRel);
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(Self {
                probe: self.probe.clone(),
            })
        }
    }

    #[derive(Clone, Debug, Default)]
    struct CleanupProbe {
        try_wait_calls: Arc<AtomicUsize>,
        kill_calls: Arc<AtomicUsize>,
        wait_calls: Arc<AtomicUsize>,
    }

    #[derive(Debug)]
    struct KillFailsChild {
        probe: CleanupProbe,
    }

    impl ChildKiller for KillFailsChild {
        fn kill(&mut self) -> std::io::Result<()> {
            self.probe.kill_calls.fetch_add(1, Ordering::AcqRel);
            Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "process already exited",
            ))
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(Self {
                probe: self.probe.clone(),
            })
        }
    }

    impl Child for KillFailsChild {
        fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
            self.probe.try_wait_calls.fetch_add(1, Ordering::AcqRel);
            Ok(None)
        }

        fn wait(&mut self) -> std::io::Result<ExitStatus> {
            self.probe.wait_calls.fetch_add(1, Ordering::AcqRel);
            Ok(ExitStatus::with_exit_code(0))
        }

        fn process_id(&self) -> Option<u32> {
            None
        }

        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    #[cfg(unix)]
    struct RealPtyTestGuard {
        master: Option<Arc<ParkingMutex<Box<dyn MasterPty + Send>>>>,
        child: Option<Box<dyn Child + Send + Sync>>,
        writer: Option<Box<dyn std::io::Write + Send + 'static>>,
        reader_handle: Option<std::thread::JoinHandle<()>>,
    }

    #[cfg(unix)]
    impl RealPtyTestGuard {
        fn new(resources: LocalPtyResources) -> (Self, std::sync::mpsc::Receiver<Option<Vec<u8>>>) {
            let LocalPtyResources {
                master,
                child,
                child_killer: _,
                mut reader,
                writer,
                startup_command: _,
            } = resources;
            let (output_tx, output_rx) = std::sync::mpsc::channel();
            let reader_handle = std::thread::spawn(move || loop {
                let mut buffer = [0u8; 4096];
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => {
                        let _ = output_tx.send(None);
                        break;
                    }
                    Ok(read) => {
                        if output_tx.send(Some(buffer[..read].to_vec())).is_err() {
                            break;
                        }
                    }
                }
            });

            (
                Self {
                    master: Some(master),
                    child: Some(child),
                    writer: Some(writer),
                    reader_handle: Some(reader_handle),
                },
                output_rx,
            )
        }

        fn master(&self) -> &Arc<ParkingMutex<Box<dyn MasterPty + Send>>> {
            self.master.as_ref().expect("test PTY master should exist")
        }

        fn write(&mut self, data: &[u8]) -> Result<(), String> {
            let writer = self
                .writer
                .as_mut()
                .ok_or_else(|| "test PTY writer is closed".to_string())?;
            write_local_data(&mut **writer, data)
        }

        fn wait_for_exit(&mut self, timeout: std::time::Duration) -> Result<ExitStatus, String> {
            let deadline = std::time::Instant::now() + timeout;
            let child = self
                .child
                .as_mut()
                .ok_or_else(|| "test PTY child is missing".to_string())?;
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => return Ok(status),
                    Ok(None) if std::time::Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Ok(None) => {
                        return Err("test PTY child did not exit before deadline".to_string())
                    }
                    Err(error) => return Err(format!("failed to poll test PTY child: {error}")),
                }
            }
        }
    }

    #[cfg(unix)]
    impl Drop for RealPtyTestGuard {
        fn drop(&mut self) {
            self.writer.take();
            if let Some(mut child) = self.child.take() {
                let _ = terminate_and_reap_child(&mut *child);
            }
            self.master.take();
            if let Some(reader_handle) = self.reader_handle.take() {
                let _ = reader_handle.join();
            }
        }
    }

    #[cfg(unix)]
    fn deterministic_test_command(script: &str) -> CommandBuilder {
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg(script);
        command.env("HOME", std::env::temp_dir());
        command.env("ENV", "/dev/null");
        command.env("BASH_ENV", "/dev/null");
        command.cwd(std::env::temp_dir());
        command
    }

    pub(in crate::session) fn fake_local_session(
        session_id: impl Into<String>,
        is_alive: bool,
    ) -> (LocalSession, ChildProbe) {
        let probe = ChildProbe::default();
        let (shutdown_tx, _) = broadcast::channel(1);
        let master: Box<dyn MasterPty + Send> = Box::new(FakeMasterPty);
        let writer: Box<dyn std::io::Write + Send + 'static> = Box::new(std::io::sink());
        let mut child: Box<dyn Child + Send + Sync> = Box::new(TrackingChild {
            probe: probe.clone(),
        });
        let child_killer = child.clone_killer();
        let lifecycle = SessionLifecycle::new();
        let child = if is_alive {
            Some(child)
        } else {
            child
                .try_wait()
                .expect("completed fake child should be reapable");
            lifecycle.complete();
            None
        };
        let state = LocalPtyState {
            master: Arc::new(ParkingMutex::new(master)),
            child,
            child_killer,
            writer: Arc::new(ParkingMutex::new(writer)),
            is_alive,
            shutdown_tx,
            read_handle: Arc::new(Mutex::new(None)),
        };

        (
            LocalSession {
                session_id: session_id.into(),
                state: Arc::new(Mutex::new(state)),
                lifecycle,
            },
            probe,
        )
    }

    pub(in crate::session) async fn simulate_natural_eof(session: &LocalSession) {
        finish_local_session(&session.state, &session.lifecycle, session.session_id()).await;
    }

    #[cfg(unix)]
    #[test]
    fn setup_pty_preserves_echo_and_requested_size() {
        let resources = setup_pty_with_command(
            97,
            31,
            deterministic_test_command("printf '\\036PTY_READY\\037\\n'; read value"),
            None,
        )
        .expect("PTY should start for the test");
        let (guard, output_rx) = RealPtyTestGuard::new(resources);
        let mut output = Vec::new();
        receive_pty_output_until(&output_rx, &mut output, b"\x1ePTY_READY\x1f")
            .expect("the deterministic test shell should become ready");

        let size = guard
            .master()
            .lock()
            .get_size()
            .expect("PTY size should be readable");
        assert_eq!(size.cols, 97);
        assert_eq!(size.rows, 31);

        let raw_fd = guard
            .master()
            .lock()
            .as_raw_fd()
            .expect("Unix PTY should expose its master fd");
        // SAFETY: `raw_fd` is borrowed from the live `master` held above and
        // remains valid until the termios query completes.
        let fd = unsafe { BorrowedFd::borrow_raw(raw_fd) };
        let termios = tcgetattr(fd).expect("PTY termios should be readable");
        assert!(
            termios.local_modes.contains(LocalModes::ECHO),
            "the shell must retain PTY echo semantics"
        );
    }

    #[cfg(unix)]
    #[test]
    fn setup_pty_runs_a_real_shell_round_trip_at_the_requested_size() {
        let input = "terminal-input-中文🙂";
        let script = "printf '\\036PTY_BEGIN\\037\\n'; stty size; printf '\\036PTY_READY\\037\\n'; IFS= read -r value; printf '\\036PTY_VALUE:%s\\037\\n' \"$value\"; exit 0";
        let resources = setup_pty_with_command(97, 31, deterministic_test_command(script), None)
            .expect("PTY should start for the test");
        let (mut guard, output_rx) = RealPtyTestGuard::new(resources);
        let mut output = Vec::new();

        receive_pty_output_until(&output_rx, &mut output, b"\x1ePTY_READY\x1f")
            .expect("the deterministic test shell should become ready for input");

        guard
            .write(format!("{input}\n").as_bytes())
            .expect("the real PTY should accept the read input");
        receive_pty_output_until(
            &output_rx,
            &mut output,
            format!("\u{1e}PTY_VALUE:{input}\u{1f}").as_bytes(),
        )
        .expect("the shell should return the exact input");
        let status = guard
            .wait_for_exit(std::time::Duration::from_secs(10))
            .expect("the deterministic test shell should exit before the deadline");

        let output = String::from_utf8_lossy(&output);
        assert!(status.success(), "shell exited unsuccessfully: {status:?}");
        assert!(
            output.contains("\u{1e}PTY_BEGIN\u{1f}"),
            "the shell command did not execute: {output:?}"
        );
        assert!(
            output.contains("31 97"),
            "the shell did not observe the requested PTY size: {output:?}"
        );
        assert!(
            output.matches(input).count() >= 2,
            "the PTY should echo the input and the shell should print it: {output:?}"
        );
        assert!(
            output.contains(&format!("\u{1e}PTY_VALUE:{input}\u{1f}")),
            "the shell did not receive the exact UTF-8 input: {output:?}"
        );
    }

    #[test]
    fn child_reap_guard_waits_after_kill_reports_process_not_found() {
        let probe = CleanupProbe::default();

        drop(ChildReapGuard::new(Box::new(KillFailsChild {
            probe: probe.clone(),
        })));

        assert_eq!(
            (
                probe.try_wait_calls.load(Ordering::Acquire),
                probe.kill_calls.load(Ordering::Acquire),
                probe.wait_calls.load(Ordering::Acquire),
            ),
            (1, 1, 1),
            "the initialization guard must wait even when kill reports an already-exited child"
        );
    }

    #[cfg(unix)]
    fn receive_pty_output_until(
        receiver: &std::sync::mpsc::Receiver<Option<Vec<u8>>>,
        output: &mut Vec<u8>,
        marker: &[u8],
    ) -> Result<(), String> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Err(format!(
                    "timed out with output {:?}",
                    String::from_utf8_lossy(output)
                ));
            }
            match receiver.recv_timeout(remaining) {
                Ok(Some(chunk)) => {
                    output.extend_from_slice(&chunk);
                    if output.windows(marker.len()).any(|window| window == marker) {
                        return Ok(());
                    }
                }
                Ok(None) => {
                    return Err(format!(
                        "PTY closed with output {:?}",
                        String::from_utf8_lossy(output)
                    ));
                }
                Err(error) => return Err(error.to_string()),
            }
        }
    }

    #[test]
    fn local_byte_writer_preserves_non_utf8_input() {
        let mut writer = Vec::new();
        write_local_data(&mut writer, &[0x00, 0x80, 0xff]).unwrap();
        assert_eq!(writer, vec![0x00, 0x80, 0xff]);
    }

    #[tokio::test]
    async fn session_lifecycle_repeated_close_reaps_child_exactly_once() {
        let (session, probe) = fake_local_session("local-close-race", true);

        tokio::join!(session.clone().close(), session.close());

        assert_eq!(
            (probe.kill_calls(), probe.reap_calls()),
            (1, 1),
            "duplicate close must terminate and reap the child exactly once"
        );
    }
}
