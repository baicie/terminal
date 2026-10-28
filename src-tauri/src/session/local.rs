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

type LocalReadTask = tokio::task::JoinHandle<Result<(usize, [u8; 4096]), std::io::Error>>;

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

fn spawn_local_read(
    reader: Arc<ParkingMutex<Box<dyn std::io::Read + Send + 'static>>>,
) -> LocalReadTask {
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        let mut reader = reader.lock();
        let n = reader.read(&mut buf)?;
        Ok((n, buf))
    })
}

async fn await_local_read_task(task: LocalReadTask, session_id: &str) {
    await_local_read_task_with_timeout(task, session_id, LOCAL_CLOSE_TIMEOUT).await;
}

async fn await_local_read_task_with_timeout(
    mut task: LocalReadTask,
    session_id: &str,
    timeout: std::time::Duration,
) {
    if tokio::time::timeout(timeout, &mut task).await.is_err() {
        tracing::warn!(
            session_id,
            "local terminal blocking reader exceeded the close deadline"
        );
        // Tokio cannot cancel a blocking closure after it has started. Drop the
        // handle after aborting instead of awaiting it, otherwise close hangs
        // forever until the underlying PTY read happens to return.
        task.abort();
    }
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
    if is_powershell_executable(&shell) {
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
    // The frontend already parses OSC 133/7 in every terminal, but nothing
    // emitted those sequences, so prompt, command and cwd tracking were inert.
    // The decision is made from the shell actually being launched rather than
    // from `CommandBuilder::get_shell`, which answers with the user's login
    // shell and would hand bash the snippet when zsh is the one being started.
    let startup_command = match shell_integration_enabled()
        .then(|| shell_integration_script(&shell))
        .flatten()
    {
        Some(script) => {
            command.env("TERMINAL_SHELL_INTEGRATION", "1");
            Some(match startup_command {
                Some(existing) => format!("{script}\n{existing}"),
                None => script,
            })
        }
        None => startup_command,
    };
    setup_pty_with_command(cols, rows, command, startup_command)
}

fn is_powershell_executable(shell: &str) -> bool {
    shell.rsplit(['/', '\\']).next().is_some_and(|name| {
        name.eq_ignore_ascii_case("powershell.exe") || name.eq_ignore_ascii_case("pwsh.exe")
    })
}

/// Shell integration is on by default and switched off by setting
/// `TERMINAL_SHELL_INTEGRATION=0` in the environment.
///
/// The snippet is injected into the user's interactive shell, so a user whose
/// setup conflicts with it needs a way out that does not require rebuilding.
/// Any other value, including an unset one, leaves it enabled.
fn shell_integration_enabled() -> bool {
    !matches!(
        std::env::var("TERMINAL_SHELL_INTEGRATION").as_deref(),
        Ok("0")
    )
}

/// Returns the shell-integration snippet for the shell `command` launches, or
/// `None` when that shell has no supported hook and must be left alone.
///
/// The emitted sequences are the ones the frontend already parses: OSC 133
/// A/B/C/D for the prompt and command phases, and OSC 7 with a `file://` URL
/// for the working directory. The frontend's `parseCwd` rejects anything that
/// is not a `file:` URL, which is why the path is percent-encoded as a URI
/// rather than written raw.
///
/// The snippet is emitted as a single line because it is written into a live
/// PTY; a multi-line string would leave a continuation prompt on screen and
/// change what the user sees at startup.
fn shell_integration_script(shell: &str) -> Option<String> {
    match std::path::Path::new(shell)
        .file_name()
        .and_then(|name| name.to_str())
    {
        Some("bash") => Some(bash_shell_integration()),
        Some("zsh") => Some(zsh_shell_integration()),
        _ => None,
    }
}

/// Wraps the existing `PROMPT_COMMAND` list instead of overwriting it, so
/// shell integration composes with whatever the user's own rc files already
/// hook instead of silently disabling it.
fn bash_shell_integration() -> String {
    // Verified against a real interactive bash on a PTY: the DEBUG trap fires
    // `133;D;<status>` at prompt time, then `133;A`, then the OSC 7 cwd.
    // PROMPT_COMMAND is prepended to rather than replaced so an existing hook
    // keeps running, and PS1 is left untouched so the prompt survives.
    //
    // A `trap ... DEBUG` would be the only way to emit `133;B`, and it is
    // deliberately not used: bash has no additive trap, so setting one
    // silently replaces whatever the user's own rc already installed. A real
    // bashrc with a DEBUG trap was verified to lose it -- and with it every
    // `133;B` -- while `133;A`, `133;D` and the cwd kept working without the
    // trap. Since `command-start` only feeds an internal phase field with no
    // consumer, trading a user's own tooling for it is the wrong deal.
    "__TI_A(){ printf '\\033]133;D;%s\\007' \"$?\"; printf '\\033]133;A\\007'; printf '\\033]7;file://%s\\007' \"$PWD\"; }; \
     PROMPT_COMMAND=\"__TI_A${PROMPT_COMMAND:+;$PROMPT_COMMAND}\""
        .to_string()
}

fn zsh_shell_integration() -> String {
    // Verified against a real interactive zsh on a PTY. `add-zsh-hook` appends,
    // so the user's own precmd/preexec hooks keep running. Passing the hook a
    // quoted string instead of a function name fails with "function definition
    // file not found", so both hooks are named functions.
    "__TI_A(){ printf '\\033]133;D;%s\\007' \"$?\"; printf '\\033]133;A\\007'; printf '\\033]7;file://%s\\007' \"$PWD\"; }; \
     __TI_B(){ printf '\\033]133;B\\007'; }; \
     autoload -Uz add-zsh-hook; \
     add-zsh-hook precmd __TI_A; \
     add-zsh-hook preexec __TI_B"
        .to_string()
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
            // Keep the blocking read handle alive across select! cancellation.
            // Normal exits await it; a stuck PTY read is detached after the
            // bounded close timeout so shutdown cannot hang indefinitely.
            let mut read_task = Some(spawn_local_read(reader_clone.clone()));

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
                    result = read_task.as_mut().expect("local reader task must exist") => {
                        read_task = None;
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
                        read_task = Some(spawn_local_read(reader_clone.clone()));
                    }
                }
            }

            if let Some(read_task) = read_task.take() {
                await_local_read_task(read_task, &session_id_clone).await;
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

fn force_kill_local_process_group(
    master: &Arc<ParkingMutex<Box<dyn portable_pty::MasterPty + Send>>>,
    session_id: &str,
) {
    #[cfg(unix)]
    {
        let process_group = master.lock().process_group_leader();
        let Some(process_group) = process_group.filter(|group| *group > 1) else {
            tracing::debug!(
                session_id,
                "local PTY did not expose a process group to kill"
            );
            return;
        };

        // `ChildKiller::kill` only sends SIGHUP on Unix. A shell or one of its
        // descendants may ignore it, so kill the whole PTY foreground group on
        // the bounded reaper timeout to guarantee that wait can finish.
        let result = unsafe { libc::kill(-process_group, libc::SIGKILL) };
        if result != 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                tracing::warn!(
                    session_id,
                    process_group,
                    %error,
                    "failed to force-kill local PTY process group"
                );
            }
        }
    }

    #[cfg(not(unix))]
    {
        let _ = (master, session_id);
    }
}

async fn finish_local_session(
    state: &Arc<Mutex<LocalPtyState>>,
    lifecycle: &SessionLifecycle,
    session_id: &str,
) {
    let (child, master) = {
        let mut state = state.lock().await;
        state.is_alive = false;
        (state.child.take(), state.master.clone())
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
                force_kill_local_process_group(&master, session_id);
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

    #[test]
    fn shell_integration_snippets_stay_on_one_line_and_emit_the_parsed_sequences() {
        // The snippet is written into a live PTY, so a newline would leave the
        // user at a continuation prompt instead of a shell. Every sequence the
        // frontend parses has to appear literally, because that parser is the
        // only consumer and it does not tolerate a variant spelling.
        for script in [bash_shell_integration(), zsh_shell_integration()] {
            assert!(!script.contains('\n'), "script must stay on one line");
            assert!(script.contains("133;D;%s"));
            assert!(script.contains("133;A"));
            assert!(script.contains("7;file://%s"));
            // bash has no additive DEBUG trap, so installing one would replace
            // whatever the user's rc already set. Losing a user's own trap to
            // gain a `133;B` that nothing consumes is a bad trade.
            assert!(!script.contains("trap "));
            // PS1 must never be reassigned: overwriting it would replace the
            // user's prompt instead of hooking alongside it.
            assert!(!script.contains("PS1="));
        }
    }

    #[test]
    fn print_shell_integration_snippets_for_manual_pty_verification() {
        // Not an assertion: this exists so the exact strings the app injects can
        // be dumped and replayed against a real interactive shell on a PTY,
        // which is the only way to prove the quoting survives a live shell.
        if std::env::var_os("TERMINAL_DUMP_SHELL_INTEGRATION").is_none() {
            return;
        }
        for (name, script) in [
            ("bash", bash_shell_integration()),
            ("zsh", zsh_shell_integration()),
        ] {
            println!("SNIPPET_{name}={script}");
        }
    }

    #[test]
    fn shell_integration_is_offered_only_for_shells_with_a_supported_hook() {
        // A shell that cannot parse the snippet has to be launched untouched
        // rather than be handed a script it would report as a syntax error.
        assert!(shell_integration_script("/bin/bash").is_some());
        assert!(shell_integration_script("/usr/local/bin/zsh").is_some());
        // `-l` is appended for these shells, so the snippet has to be found
        // from a bare name as well as an absolute path.
        assert!(shell_integration_script("bash").is_some());
        assert!(shell_integration_script("/bin/fish").is_none());
        assert!(shell_integration_script("/bin/sh").is_none());
        assert!(shell_integration_script("C:\\Windows\\System32\\cmd.exe").is_none());
    }

    #[test]
    fn powershell_detection_handles_absolute_windows_paths() {
        assert!(is_powershell_executable("powershell.exe"));
        assert!(is_powershell_executable("pwsh.exe"));
        assert!(is_powershell_executable(
            r"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.EXE"
        ));
        assert!(is_powershell_executable(
            r"C:\\Program Files\\PowerShell\\7\\pwsh.exe"
        ));
        assert!(!is_powershell_executable(r"C:\\Windows\\System32\\cmd.exe"));
        assert!(!is_powershell_executable("bash"));
    }

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

    pub(in crate::session) fn fake_local_session_with_blocking_reader(
        session_id: impl Into<String>,
    ) -> (LocalSession, ChildProbe, tokio::sync::oneshot::Sender<()>) {
        let probe = ChildProbe::default();
        let (shutdown_tx, _) = broadcast::channel(1);
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let read_handle = tokio::spawn(async move {
            let _ = release_rx.await;
        });
        let child: Box<dyn Child + Send + Sync> = Box::new(TrackingChild {
            probe: probe.clone(),
        });
        let child_killer = child.clone_killer();
        let state = LocalPtyState {
            master: Arc::new(ParkingMutex::new(Box::new(FakeMasterPty))),
            child: Some(child),
            child_killer,
            writer: Arc::new(ParkingMutex::new(Box::new(std::io::sink()))),
            is_alive: true,
            shutdown_tx,
            read_handle: Arc::new(Mutex::new(Some(read_handle))),
        };

        (
            LocalSession {
                session_id: session_id.into(),
                state: Arc::new(Mutex::new(state)),
                lifecycle: SessionLifecycle::new(),
            },
            probe,
            release_tx,
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
    #[test]
    fn force_kill_local_process_group_stops_a_shell_ignoring_sighup() {
        let resources = setup_pty_with_command(
            80,
            24,
            deterministic_test_command("trap '' HUP; while :; do sleep 1; done"),
            None,
        )
        .expect("PTY should start for the process-group kill test");
        let LocalPtyResources {
            master,
            mut child,
            reader,
            writer,
            child_killer: _,
            startup_command: _,
        } = resources;

        std::thread::sleep(std::time::Duration::from_millis(20));
        assert!(
            master.lock().process_group_leader().is_some(),
            "the PTY should expose the shell process group"
        );
        force_kill_local_process_group(&master, "local-process-group-kill-test");
        let status = child.wait().expect("SIGKILL should let the child reap");
        assert!(!status.success(), "the ignored-SIGHUP shell must be killed");

        drop(reader);
        drop(writer);
        drop(master);
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

    #[tokio::test]
    async fn local_reader_shutdown_waits_for_active_blocking_read() {
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let completed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let completed_clone = completed.clone();
        let task = tokio::task::spawn_blocking(move || {
            started_tx
                .send(())
                .expect("the test reader should report that it started");
            release_rx
                .recv()
                .expect("the test reader should be released during shutdown");
            completed_clone.store(true, Ordering::Release);
            Ok::<(usize, [u8; 4096]), std::io::Error>((0, [0; 4096]))
        });

        started_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("the blocking read should start");

        let mut waiter = Box::pin(await_local_read_task(task, "local-reader-test"));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut waiter)
                .await
                .is_err(),
            "shutdown must keep waiting while the active blocking read is pending"
        );

        release_tx
            .send(())
            .expect("the test reader should accept the shutdown release");
        waiter.await;
        assert!(
            completed.load(Ordering::Acquire),
            "shutdown must await the blocking read before completing"
        );
    }

    #[tokio::test]
    async fn local_reader_shutdown_does_not_await_aborted_blocking_read() {
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let task = tokio::task::spawn_blocking(move || {
            started_tx
                .send(())
                .expect("the test reader should report that it started");
            release_rx
                .recv()
                .expect("the test reader should be released after shutdown returns");
            Ok::<(usize, [u8; 4096]), std::io::Error>((0, [0; 4096]))
        });

        started_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("the blocking read should start");

        let waiter = await_local_read_task_with_timeout(
            task,
            "local-reader-timeout-test",
            std::time::Duration::from_millis(20),
        );
        tokio::time::timeout(std::time::Duration::from_millis(250), waiter)
            .await
            .expect("shutdown must return after aborting an active blocking read");

        release_tx
            .send(())
            .expect("the blocking read should be released after its handle is detached");
    }
}
