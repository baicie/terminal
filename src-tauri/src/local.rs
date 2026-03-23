// Allow unused imports for cross-platform compatibility
#![allow(unused_imports)]

use crate::state::{LocalPtySession, ShellOutput, SharedStateType};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::task;

#[tauri::command]
pub async fn local_shell(
    app: AppHandle,
    state: tauri::State<'_, SharedStateType>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let session_id = format!("local-{}", uuid::Uuid::new_v4());

    // Create PTY pair
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: rows as u16,
            cols: cols as u16,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Get the default shell based on OS
    let shell = if cfg!(windows) {
        // Try PowerShell first, fall back to cmd.exe
        std::env::var("PSModulePath")
            .map(|_| "powershell.exe".to_string())
            .unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        // Unix-like: try SHELL env, fall back to /bin/bash
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };

    // Create command (mut needed for Windows cwd setting)
    let cmd = CommandBuilder::new(&shell);

    // Set working directory for Windows
    #[cfg(windows)]
    {
        use std::path::PathBuf;
        // Use user's home directory or current directory
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        cmd.cwd(PathBuf::from(&home));
    }

    // Spawn the child process
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Take the reader and writer
    let mut reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    // Take the writer
    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Disable PTY echo so xterm.js controls all display
    // This ensures characters typed by user are NOT echoed by PTY
    #[cfg(unix)]
    {
        use rustix::fd::BorrowedFd;
        use rustix::termios::{tcgetattr, tcsetattr, OptionalActions};

        // Get raw fd from master PTY using the trait method
        // as_raw_fd returns Option<RawFd>, we need to handle the None case
        if let Some(raw_fd) = pty_pair.master.as_raw_fd() {
            // Borrow the raw fd for use with rustix
            let fd = unsafe { BorrowedFd::borrow_raw(raw_fd) };
            if let Ok(mut t) = tcgetattr(fd) {
                // Use cfmakeraw to set raw mode (disables canonical mode, echo, etc.)
                t.make_raw();
                let _ = tcsetattr(fd, OptionalActions::Now, &t);
            }
        }
    }

    // Store the session with writer wrapped in Arc<Mutex>
    let session = LocalPtySession {
        pty_pair,
        child,
        writer: Arc::new(tokio::sync::Mutex::new(writer)),
    };

    {
        let mut sessions = state.local_sessions.lock().await;
        sessions.insert(session_id.clone(), session);
    }

    // Spawn a task to read from PTY and emit events
    let session_id_clone = session_id.clone();
    task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF
                    let _ = app.emit("local-close", &session_id_clone);
                    break;
                }
                Ok(n) => {
                    let output = ShellOutput {
                        session_id: session_id_clone.clone(),
                        data: String::from_utf8_lossy(&buf[..n]).to_string(),
                        is_stderr: false,
                    };
                    let _ = app.emit("local-data", output);
                }
                Err(_) => {
                    // Error reading
                    let _ = app.emit("local-close", &session_id_clone);
                    break;
                }
            }
        }
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn local_write(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.local_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    let mut writer = session.writer.lock().await;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn local_resize(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.local_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    session
        .pty_pair
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn local_disconnect(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.local_sessions.lock().await;
    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}
