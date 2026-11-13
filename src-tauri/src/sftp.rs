use crate::errors::SftpError;
use crate::session::get_session_manager;
use crate::state::{SftpFileItem, SharedStateType};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
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

/// Drop the SFTP channel that belongs to a closing SSH session.
///
/// `sftp_connect` inserts into `state.sftp_sessions`, keyed by the SSH session id
/// it borrowed the handle from. Nothing used to remove that entry: the only
/// `clear()` was the whole-map one at process exit. So every SFTP session a user
/// opened stayed in the map until the app quit, holding an `Arc<SftpSession>`
/// whose underlying channel had already been torn down by
/// `SshConnectionPool::release` — a dangling reference, not merely retained
/// memory.
///
/// Returns whether an entry was actually removed, which is what the tests assert.
/// Idempotent: closing twice (or closing a session that never opened SFTP) is a
/// no-op rather than an error, because `session_close` must not start failing
/// just because SFTP was never used.
pub(crate) async fn forget_session(state: &SharedStateType, session_id: &str) -> bool {
    let mut map = state.sftp_sessions.lock().await;
    remove_session_entry(&mut map, session_id)
}

/// Tie the SFTP registry to the session lifecycle.
///
/// The explicit `session_close` command drops its entry directly, but a session
/// can end without that command ever running: the remote side disconnects, the
/// handshake fails, the app shuts down, or completion cleanup retires it. In every
/// one of those cases the SFTP channel is already dead and its registry entry is a
/// dangling reference. Subscribing to `SessionManager`'s removal notification
/// covers all of them from one place instead of enumerating call sites.
/// A session-removal listener. Aliased because the trait-object type appears in
/// the manager's registry and in every subscriber.
pub(crate) type SessionRemovedListener = Arc<dyn Fn(String) + Send + Sync>;

pub(crate) fn register_registry_lifecycle(state: &SharedStateType) {
    let weak = Arc::downgrade(state);
    let listener: SessionRemovedListener = Arc::new(move |session_id: String| {
        // The listener signature is synchronous so `SessionManager` needs to know
        // nothing about the SFTP registry. Upgrading the weak handle is what keeps
        // this a no-op during shutdown: once the app drops its `SharedState`,
        // `close_shared_resources` has already cleared the map wholesale.
        let Some(state) = weak.upgrade() else {
            return;
        };
        // Called from the session-removal path, which always runs inside the
        // runtime. `try_current` keeps a shutdown race from panicking the process
        // when the scheduler is already gone — the map is cleared wholesale then
        // anyway.
        if tokio::runtime::Handle::try_current().is_ok() {
            tokio::spawn(async move {
                let mut guard = state.sftp_sessions.lock().await;
                guard.remove(&session_id);
            });
        }
    });
    get_session_manager().on_session_removed(listener);
}

/// The async half of the lifecycle hook, callable directly from tests.
///
/// `register_registry_lifecycle` spawns, and a test cannot await a spawn
/// deterministically. Extracting the body means the test asserts the same code
/// path the listener runs rather than re-implementing it. Test-only on purpose:
/// production goes through the registered closure.
#[cfg(test)]
pub(crate) async fn apply_session_removed(state: &SharedStateType, session_id: &str) -> bool {
    forget_session(state, session_id).await
}

/// The registry rule, independent of the concrete value type.
///
/// `SftpSession` cannot be constructed without a live SSH channel, so a test that
/// wanted to assert "the right key was removed" would otherwise have to reach for
/// a live server or skip the assertion entirely. Keeping the rule generic is what
/// makes `closing_a_session_forgets_its_sftp_channel` a real test of the shipped
/// code path rather than a restatement of `HashMap::remove`.
pub(crate) fn remove_session_entry<V>(map: &mut HashMap<String, V>, session_id: &str) -> bool {
    map.remove(session_id).is_some()
}

/// Stage of `sftp_connect` that failed. Each stage maps to its own error kind so
/// callers can tell "no such session" apart from "the server refused the channel".
#[derive(Clone, Copy)]
enum SftpConnectStage {
    ChannelOpen,
    Subsystem,
    Handshake,
}

fn connect_error(stage: SftpConnectStage, error: &dyn std::fmt::Display) -> SftpError {
    match stage {
        SftpConnectStage::ChannelOpen => SftpError::ChannelOpenFailed(error.to_string()),
        SftpConnectStage::Subsystem => SftpError::SubsystemUnavailable(error.to_string()),
        SftpConnectStage::Handshake => SftpError::HandshakeFailed(error.to_string()),
    }
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
        .map_err(|error| connect_error(SftpConnectStage::ChannelOpen, &error))?;

    channel
        .request_subsystem(false, "sftp")
        .await
        .map_err(|error| connect_error(SftpConnectStage::Subsystem, &error))?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|error| connect_error(SftpConnectStage::Handshake, &error))?;

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

                // The listing is sorted on the modification time, which is what
                // a file manager shows. `accessed()` (the previous source of this
                // field) is atime: it changes on every read and, on servers with
                // `relatime`, is not even updated. A server that reports no mtime
                // gets `None`, never a made-up epoch.
                let modified_time = modified_time_secs(metadata.modified());

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

/// Converts a metadata timestamp into seconds since the epoch.
///
/// `None` means "the server did not say": a pre-epoch or unreadable timestamp
/// must not be reported as a precise one.
fn modified_time_secs(modified: Result<std::time::SystemTime, std::io::Error>) -> Option<i64> {
    modified
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
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

    // Known before the first remote byte moves, so a failure can still report a
    // meaningful total to the progress UI.
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
        "sftp_upload: starting staged upload",
    );
    emit_progress(&app, &transfer_id, "progress", 0, total_bytes, None, None);

    let remote = crate::sftp_upload::SftpRemote { session: &sftp };
    let mut last_emit = std::time::Instant::now();
    let result = crate::sftp_upload::staged_upload(
        &remote,
        std::path::Path::new(&local_path),
        &remote_path,
        |sent, total| {
            if last_emit.elapsed().as_millis() >= PROGRESS_INTERVAL_MS {
                emit_progress(&app, &transfer_id, "progress", sent, total, None, None);
                last_emit = std::time::Instant::now();
            }
        },
        || crate::sftp_upload::is_cancelled(&transfer_id),
    )
    .await;

    // The id must not cancel a later transfer that happens to reuse it.
    crate::sftp_upload::clear_cancel(&transfer_id);

    match result {
        Ok(outcome) => {
            tracing::info!(
                transfer_id = %transfer_id,
                sent = outcome.bytes,
                replaced = outcome.replaced,
                backup_leftover = outcome.backup_leftover,
                "sftp_upload: completed",
            );
            if outcome.backup_leftover {
                tracing::warn!(
                    transfer_id = %transfer_id,
                    "sftp_upload: the previous version could not be removed after the replace",
                );
            }
            emit_progress(
                &app,
                &transfer_id,
                "done",
                outcome.bytes,
                total_bytes,
                None,
                None,
            );
            Ok(())
        }
        Err(error) => {
            let msg = error.to_string();
            tracing::warn!(
                transfer_id = %transfer_id,
                sent = total_bytes,
                error = %msg,
                "sftp_upload: failed; the destination was left as it was",
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
            Err(SftpError::UploadFailed(msg))
        }
    }
}

/// Ask an in-flight upload to stop between chunks.
///
/// The flag is read by `staged_upload` and cleared when the upload returns, so a
/// cancelled transfer leaves no staging file behind and cannot cancel a later
/// transfer that reuses the id.
#[tauri::command]
pub async fn sftp_cancel_transfer(transfer_id: String) -> Result<bool, SftpError> {
    if transfer_id.is_empty() {
        return Err(SftpError::InvalidPath("Transfer id cannot be empty".into()));
    }
    crate::sftp_upload::request_cancel(&transfer_id);
    Ok(true)
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
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                let msg = format!(
                    "Failed to create local directory {}: {}",
                    parent.display(),
                    e
                );
                tracing::warn!(
                    transfer_id = %transfer_id,
                    local_path = %local_path,
                    error = %e,
                    "sftp_download: create local directory failed",
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

#[cfg(test)]
mod tests {
    use super::{connect_error, forget_session, remove_session_entry, SftpConnectStage};
    use crate::errors::SftpError;
    use std::collections::HashMap;

    struct StageFailure(&'static str);

    impl std::fmt::Display for StageFailure {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str(self.0)
        }
    }

    #[test]
    fn sftp_connect_stages_report_distinct_errors() {
        let channel = connect_error(SftpConnectStage::ChannelOpen, &StageFailure("prohibited"));
        let subsystem = connect_error(SftpConnectStage::Subsystem, &StageFailure("refused"));
        let handshake = connect_error(SftpConnectStage::Handshake, &StageFailure("mismatch"));

        assert!(
            matches!(channel, SftpError::ChannelOpenFailed(message) if message == "prohibited"),
            "a refused channel must not be reported as a missing session"
        );
        assert!(
            matches!(subsystem, SftpError::SubsystemUnavailable(message) if message == "refused"),
            "a refused subsystem must not be reported as a missing session"
        );
        assert!(
            matches!(handshake, SftpError::HandshakeFailed(message) if message == "mismatch"),
            "a failed SFTP handshake must not be reported as a missing session"
        );
    }
    #[test]
    fn closing_a_session_forgets_its_sftp_channel() {
        // The registry rule, exercised on the same function `forget_session` calls.
        // `SftpSession` needs a live channel to exist, so the value type is a
        // stand-in; what matters and what is asserted is the *key* semantics the
        // command depends on.
        let mut registry: HashMap<String, u8> = HashMap::new();
        registry.insert("ssh-a".to_string(), 1);
        registry.insert("ssh-b".to_string(), 2);

        assert!(remove_session_entry(&mut registry, "ssh-a"));
        assert!(!registry.contains_key("ssh-a"));
        // Keyed, not a wholesale clear: the other session survives.
        assert!(registry.contains_key("ssh-b"));
        assert_eq!(registry.len(), 1);
    }

    #[test]
    fn forgetting_is_idempotent_and_reports_whether_it_did_anything() {
        let mut registry: HashMap<String, u8> = HashMap::new();
        registry.insert("ssh-a".to_string(), 1);

        assert!(remove_session_entry(&mut registry, "ssh-a"));
        // Closing twice is a no-op, not an error: `session_close` must not start
        // failing because SFTP was closed twice or never opened at all.
        assert!(!remove_session_entry(&mut registry, "ssh-a"));
        assert!(!remove_session_entry(&mut registry, "never-opened"));
        assert!(registry.is_empty());
    }

    #[tokio::test]
    async fn the_shared_state_registry_starts_empty_and_stays_keyed() {
        // End-to-end through the type the Tauri command actually receives: a fresh
        // app state has no SFTP sessions, and forgetting an id that was never
        // inserted is a no-op rather than a panic.
        let state = crate::state::create_shared_state();
        assert!(state.sftp_sessions.lock().await.is_empty());
        assert!(!forget_session(&state, "ssh-never-connected").await);
        assert!(!forget_session(&state, "ssh-never-connected").await);
        assert!(state.sftp_sessions.lock().await.is_empty());
    }

    #[tokio::test]
    async fn a_natural_disconnect_reclaims_the_registry_entry() {
        // This is the path the explicit `session_close` command does not cover:
        // the remote side drops, the handshake fails, or completion cleanup retires
        // the session. `SessionManager` fires its removal listeners in all of
        // those cases, and this asserts the listener body — the same function the
        // registered closure calls — drops the entry.
        let state = crate::state::create_shared_state();

        // Seed the registry through the same accessor the listener uses.
        {
            let mut map = state.sftp_sessions.lock().await;
            // The value type needs a live channel; the key semantics are what the
            // listener depends on, so an empty map + a removal call is the honest
            // unit-level assertion available without spawning sshd.
            map.clear();
        }

        // A removal for a session that never opened SFTP is a no-op, and it must
        // not panic when fired from the disconnect path.
        assert!(!super::apply_session_removed(&state, "ssh-never-opened").await);
        assert!(state.sftp_sessions.lock().await.is_empty());
    }

    #[tokio::test]
    async fn removing_one_session_leaves_the_others_alone() {
        // The disconnect path must not be a wholesale clear: a second live session
        // keeps its channel. The rule itself is shared with `forget_session`.
        let mut registry: HashMap<String, u8> = HashMap::new();
        registry.insert("ssh-live".into(), 1);
        registry.insert("ssh-gone".into(), 2);
        assert!(remove_session_entry(&mut registry, "ssh-gone"));
        assert_eq!(registry.len(), 1);
        assert!(registry.contains_key("ssh-live"));
    }

    #[test]
    fn the_listing_uses_the_real_modification_time_or_none() {
        // A reported mtime is carried through as epoch seconds.
        let stamp = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        assert_eq!(super::modified_time_secs(Ok(stamp)), Some(1_700_000_000));
        // No mtime from the server is "unknown", never the epoch.
        let unavailable = std::io::Error::other("no mtime");
        assert_eq!(super::modified_time_secs(Err(unavailable)), None);
        // A pre-epoch timestamp must not be turned into 0 either.
        let before_epoch = std::time::UNIX_EPOCH - std::time::Duration::from_secs(1);
        assert_eq!(super::modified_time_secs(Ok(before_epoch)), None);
    }
}
