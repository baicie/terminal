use crate::errors::SftpError;
use crate::session::get_session_manager;
use crate::state::{SftpFileItem, SharedStateType};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Chunk size for streaming uploads/downloads. 64 KB ≈ a single SFTP packet,
/// keeps memory low while staying within sensible request boundaries.
const CHUNK_SIZE: usize = 64 * 1024;

/// Emit progress at most every ~64 KB OR every ~50 ms — whichever happens first —
/// to avoid drowning the front-end event bus on fast LAN transfers.
const PROGRESS_INTERVAL_MS: u128 = 50;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SftpProgress {
    transfer_id: String,
    /// "progress" | "done" | "error" | "checksum-start" | "checksum-progress" | "checksum-done"
    kind: String,
    bytes_done: u64,
    bytes_total: u64,
    /// Set when kind == "error"
    message: Option<String>,
    /// Which side this event belongs to: "local" | "remote" | "transfer"
    /// Used by checksum events to distinguish local vs remote file checksums.
    side: Option<String>,
}

fn emit_progress(
    app: &AppHandle,
    transfer_id: &str,
    kind: &str,
    bytes_done: u64,
    bytes_total: u64,
    message: Option<String>,
    side: Option<&str>,
) {
    let _ = app.emit(
        "sftp-progress",
        SftpProgress {
            transfer_id: transfer_id.to_string(),
            kind: kind.to_string(),
            bytes_done,
            bytes_total,
            message,
            side: side.map(String::from),
        },
    );
}

fn format_permissions(perms: &russh_sftp::protocol::FilePermissions) -> String {
    format!("{}", perms)
}

/// Helper: clone the Arc<SftpSession> out of the map so we can release the
/// global mutex immediately. Returns `Err(SessionNotFound)` if missing.
async fn get_sftp(
    state: &SharedStateType,
    session_id: &str,
) -> Result<Arc<SftpSession>, SftpError> {
    let map = state.sftp_sessions.lock().await;
    map.get(session_id)
        .cloned()
        .ok_or(SftpError::SessionNotFound)
}

#[tauri::command]
pub async fn sftp_connect(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }

    let handle = get_session_manager()
        .get_ssh_handle(&session_id)
        .await
        .ok_or(SftpError::SessionNotFound)?;

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|_e| SftpError::SessionNotFound)?;

    channel
        .request_subsystem(false, "sftp")
        .await
        .map_err(|_e| SftpError::SessionNotFound)?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|_e| SftpError::SessionNotFound)?;

    let mut sftp_sessions = state.sftp_sessions.lock().await;
    sftp_sessions.insert(session_id, Arc::new(sftp));

    Ok(())
}

#[tauri::command]
pub async fn sftp_list(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
) -> Result<Vec<SftpFileItem>, SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if path.is_empty() {
        return Err(SftpError::InvalidPath(String::from("Path cannot be empty")));
    }

    let sftp = get_sftp(&state, &session_id).await?;

    let dir_path = if path.ends_with('/') {
        path.trim_end_matches('/').to_string()
    } else {
        path.clone()
    };

    let mut items = Vec::new();
    match sftp.read_dir(&dir_path).await {
        Ok(entries) => {
            for entry in entries {
                let name = entry.file_name();
                let full_path = format!("{}/{}", dir_path.trim_end_matches('/'), name);
                let metadata = entry.metadata();

                let modified_time = match metadata.accessed() {
                    Ok(time) => match time.duration_since(std::time::UNIX_EPOCH) {
                        Ok(duration) => duration.as_secs() as i64,
                        Err(_) => 0,
                    },
                    Err(_) => 0,
                };

                items.push(SftpFileItem {
                    name,
                    path: full_path,
                    is_directory: metadata.is_dir(),
                    size: metadata.len(),
                    modified_time,
                    permissions: format_permissions(&metadata.permissions()),
                });
            }
            Ok(items)
        }
        Err(e) => Err(SftpError::ReadDirFailed(format!(
            "Failed to read directory: {}",
            e
        ))),
    }
}

/// Streaming upload with chunked progress events.
///
/// Frontend can correlate events to the originating call via `transferId`.
/// Emits `sftp-progress` events:
///   - kind="progress"  — periodically while transferring
///   - kind="done"      — exactly once on success
///   - kind="error"     — exactly once on failure
#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    state: tauri::State<'_, SharedStateType>,
    transfer_id: String,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if local_path.is_empty() || remote_path.is_empty() {
        return Err(SftpError::InvalidPath("Path cannot be empty".into()));
    }

    let sftp = get_sftp(&state, &session_id).await?;

    let total_bytes = match tokio::fs::metadata(&local_path).await {
        Ok(m) => m.len(),
        Err(e) => {
            let msg = format!("Failed to stat local file: {}", e);
            tracing::warn!(
                transfer_id = %transfer_id,
                local_path = %local_path,
                error = %e,
                "sftp_upload: stat local file failed",
            );
            emit_progress(&app, &transfer_id, "error", 0, 0, Some(msg.clone()), None);
            return Err(SftpError::UploadFailed(msg));
        }
    };

    tracing::info!(
        transfer_id = %transfer_id,
        session_id = %session_id,
        local_path = %local_path,
        remote_path = %remote_path,
        total_bytes,
        "sftp_upload: starting",
    );

    let mut local = match tokio::fs::File::open(&local_path).await {
        Ok(f) => f,
        Err(e) => {
            let msg = format!("Failed to open local file: {}", e);
            emit_progress(
                &app,
                &transfer_id,
                "error",
                0,
                total_bytes,
                Some(msg.clone()),
                None,
            );
            return Err(SftpError::UploadFailed(msg));
        }
    };

    let mut remote = match sftp
        .open_with_flags(
            &remote_path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
    {
        Ok(f) => f,
        Err(e) => {
            let msg = format!("Failed to open remote file: {}", e);
            emit_progress(
                &app,
                &transfer_id,
                "error",
                0,
                total_bytes,
                Some(msg.clone()),
                None,
            );
            return Err(SftpError::UploadFailed(msg));
        }
    };

    emit_progress(&app, &transfer_id, "progress", 0, total_bytes, None, None);

    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut sent: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    loop {
        let n = match local.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let msg = format!("Read local file failed: {}", e);
                emit_progress(
                    &app,
                    &transfer_id,
                    "error",
                    sent,
                    total_bytes,
                    Some(msg.clone()),
                    None,
                );
                return Err(SftpError::UploadFailed(msg));
            }
        };
        if let Err(e) = remote.write_all(&buf[..n]).await {
            let msg = format!("Write remote file failed: {}", e);
            emit_progress(
                &app,
                &transfer_id,
                "error",
                sent,
                total_bytes,
                Some(msg.clone()),
                None,
            );
            return Err(SftpError::UploadFailed(msg));
        }
        sent += n as u64;

        if last_emit.elapsed().as_millis() >= PROGRESS_INTERVAL_MS {
            emit_progress(
                &app,
                &transfer_id,
                "progress",
                sent,
                total_bytes,
                None,
                None,
            );
            last_emit = std::time::Instant::now();
        }
    }

    if let Err(e) = remote.flush().await {
        let msg = format!("Flush remote file failed: {}", e);
        emit_progress(
            &app,
            &transfer_id,
            "error",
            sent,
            total_bytes,
            Some(msg.clone()),
            None,
        );
        return Err(SftpError::UploadFailed(msg));
    }

    tracing::info!(
        transfer_id = %transfer_id,
        sent,
        total_bytes,
        "sftp_upload: completed",
    );
    emit_progress(&app, &transfer_id, "done", sent, total_bytes, None, None);
    Ok(())
}

/// Streaming download with chunked progress events. Mirror of `sftp_upload`.
#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    state: tauri::State<'_, SharedStateType>,
    transfer_id: String,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if remote_path.is_empty() || local_path.is_empty() {
        return Err(SftpError::InvalidPath("Path cannot be empty".into()));
    }

    let sftp = get_sftp(&state, &session_id).await?;

    // Probe size — best-effort, fall back to 0 (still functional, just no % bar)
    let total_bytes = sftp
        .metadata(&remote_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let mut remote = match sftp.open(&remote_path).await {
        Ok(f) => f,
        Err(e) => {
            let msg = format!("Failed to open remote file: {}", e);
            emit_progress(
                &app,
                &transfer_id,
                "error",
                0,
                total_bytes,
                Some(msg.clone()),
                None,
            );
            return Err(SftpError::DownloadFailed(msg));
        }
    };

    if let Some(parent) = std::path::Path::new(&local_path).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
    }

    let mut local = match tokio::fs::File::create(&local_path).await {
        Ok(f) => f,
        Err(e) => {
            let msg = format!("Failed to create local file: {}", e);
            tracing::warn!(
                transfer_id = %transfer_id,
                local_path = %local_path,
                error = %e,
                "sftp_download: create local file failed",
            );
            emit_progress(
                &app,
                &transfer_id,
                "error",
                0,
                total_bytes,
                Some(msg.clone()),
                None,
            );
            return Err(SftpError::DownloadFailed(msg));
        }
    };

    tracing::info!(
        transfer_id = %transfer_id,
        session_id = %session_id,
        local_path = %local_path,
        remote_path = %remote_path,
        total_bytes,
        "sftp_download: starting",
    );

    emit_progress(&app, &transfer_id, "progress", 0, total_bytes, None, None);

    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    loop {
        let n = match remote.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let msg = format!("Read remote file failed: {}", e);
                emit_progress(
                    &app,
                    &transfer_id,
                    "error",
                    received,
                    total_bytes,
                    Some(msg.clone()),
                    None,
                );
                return Err(SftpError::DownloadFailed(msg));
            }
        };
        if let Err(e) = local.write_all(&buf[..n]).await {
            let msg = format!("Write local file failed: {}", e);
            emit_progress(
                &app,
                &transfer_id,
                "error",
                received,
                total_bytes,
                Some(msg.clone()),
                None,
            );
            return Err(SftpError::DownloadFailed(msg));
        }
        received += n as u64;

        if last_emit.elapsed().as_millis() >= PROGRESS_INTERVAL_MS {
            emit_progress(
                &app,
                &transfer_id,
                "progress",
                received,
                total_bytes,
                None,
                None,
            );
            last_emit = std::time::Instant::now();
        }
    }

    if let Err(e) = local.flush().await {
        let msg = format!("Flush local file failed: {}", e);
        emit_progress(
            &app,
            &transfer_id,
            "error",
            received,
            total_bytes,
            Some(msg.clone()),
            None,
        );
        return Err(SftpError::DownloadFailed(msg));
    }

    tracing::info!(
        transfer_id = %transfer_id,
        received,
        total_bytes,
        "sftp_download: completed",
    );
    emit_progress(
        &app,
        &transfer_id,
        "done",
        received,
        total_bytes,
        None,
        None,
    );
    Ok(())
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if path.is_empty() {
        return Err(SftpError::InvalidPath("Path cannot be empty".into()));
    }

    let sftp = get_sftp(&state, &session_id).await?;
    sftp.create_dir(&path)
        .await
        .map_err(|e| SftpError::MkdirFailed(format!("Failed to create directory: {}", e)))
}

#[tauri::command]
pub async fn sftp_delete(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
    is_directory: bool,
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if path.is_empty() {
        return Err(SftpError::InvalidPath("Path cannot be empty".into()));
    }

    let sftp = get_sftp(&state, &session_id).await?;

    if is_directory {
        sftp.remove_dir(&path)
            .await
            .map_err(|e| SftpError::DeleteFailed(format!("Failed to remove directory: {}", e)))
    } else {
        sftp.remove_file(&path)
            .await
            .map_err(|e| SftpError::DeleteFailed(format!("Failed to remove file: {}", e)))
    }
}

#[tauri::command]
pub async fn sftp_rename(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if old_path.is_empty() || new_path.is_empty() {
        return Err(SftpError::InvalidPath("Path cannot be empty".into()));
    }

    let sftp = get_sftp(&state, &session_id).await?;
    sftp.rename(&old_path, &new_path)
        .await
        .map_err(|e| SftpError::RenameFailed(format!("Failed to rename: {}", e)))
}

/// Compute the SHA-256 hash of a local file by streaming it in chunks.
/// Returns the hex-encoded digest string.
#[tauri::command]
pub async fn sftp_local_checksum(
    app: AppHandle,
    transfer_id: String,
    local_path: String,
) -> Result<String, SftpError> {
    use tokio::fs::File;
    use tokio::io::BufReader;

    if local_path.is_empty() {
        return Err(SftpError::InvalidPath("Path cannot be empty".into()));
    }

    let total_bytes = tokio::fs::metadata(&local_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    tracing::info!(
        transfer_id = %transfer_id,
        local_path = %local_path,
        total_bytes,
        "sftp_local_checksum: starting",
    );

    emit_progress(
        &app,
        &transfer_id,
        "checksum-start",
        0,
        total_bytes,
        None,
        Some("local"),
    );

    let file = File::open(&local_path)
        .await
        .map_err(|e| SftpError::ChecksumFailed(format!("Failed to open file: {}", e)))?;

    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK_SIZE];

    loop {
        let n = reader
            .read(&mut buf)
            .await
            .map_err(|e| SftpError::ChecksumFailed(format!("Read failed: {}", e)))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    let digest = hasher.finalize();
    let hex = hex::encode(digest);

    tracing::info!(
        transfer_id = %transfer_id,
        hex = %hex,
        "sftp_local_checksum: done",
    );

    emit_progress(
        &app,
        &transfer_id,
        "checksum-done",
        total_bytes,
        total_bytes,
        Some(hex.clone()),
        Some("local"),
    );

    Ok(hex)
}

/// Compute SHA-256 hash of a remote file via SFTP protocol.
/// Uses a streaming read to avoid loading the whole file into memory.
#[tauri::command]
pub async fn sftp_remote_checksum(
    app: AppHandle,
    state: tauri::State<'_, SharedStateType>,
    transfer_id: String,
    session_id: String,
    remote_path: String,
) -> Result<String, SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if remote_path.is_empty() {
        return Err(SftpError::InvalidPath("Path cannot be empty".into()));
    }

    let sftp = get_sftp(&state, &session_id).await?;

    let total_bytes = sftp
        .metadata(&remote_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    tracing::info!(
        transfer_id = %transfer_id,
        session_id = %session_id,
        remote_path = %remote_path,
        total_bytes,
        "sftp_remote_checksum: starting",
    );

    emit_progress(
        &app,
        &transfer_id,
        "checksum-start",
        0,
        total_bytes,
        None,
        Some("remote"),
    );

    let mut remote = sftp
        .open(&remote_path)
        .await
        .map_err(|e| SftpError::ChecksumFailed(format!("Failed to open remote file: {}", e)))?;

    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut bytes_read: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    loop {
        let n = remote
            .read(&mut buf)
            .await
            .map_err(|e| SftpError::ChecksumFailed(format!("Read failed: {}", e)))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        bytes_read += n as u64;

        if last_emit.elapsed().as_millis() >= PROGRESS_INTERVAL_MS {
            emit_progress(
                &app,
                &transfer_id,
                "checksum-progress",
                bytes_read,
                total_bytes,
                None,
                Some("remote"),
            );
            last_emit = std::time::Instant::now();
        }
    }

    let digest = hasher.finalize();
    let hex = hex::encode(digest);

    tracing::info!(
        transfer_id = %transfer_id,
        hex = %hex,
        bytes_read,
        "sftp_remote_checksum: done",
    );

    emit_progress(
        &app,
        &transfer_id,
        "checksum-done",
        bytes_read,
        total_bytes,
        Some(hex.clone()),
        Some("remote"),
    );

    Ok(hex)
}
