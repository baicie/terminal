//! Staged SFTP upload: the remote file is only replaced after the complete
//! payload is on the server, and a failed upload never truncates the file that
//! was already there.
//!
//! The old path opened the destination with `CREATE | TRUNCATE | WRITE`, so a
//! local read error, a dropped connection or a crash left the user's remote file
//! empty or half written. Here the destination is written in this order:
//!
//! 1. read the local file and open the staging file (fail before any remote
//!    byte changes);
//! 2. write the whole payload into `.<name>.terminal-upload-<uuid>` in the same
//!    remote directory (`CREATE | EXCLUSIVE`, so a collision is a new name, not
//!    a clobber);
//! 3. flush, fsync when the server supports it, close, and check the size the
//!    server reports against the bytes read locally;
//! 4. only then move the finished file onto the destination. When the
//!    destination already exists it is first moved to
//!    `.<name>.terminal-upload-backup`, the staging file takes its place, and
//!    the backup is removed. If any step fails the backup is moved back, so the
//!    old bytes survive.
//!
//! `rename` over an existing target is not portable SFTP: RFC-compliant servers
//! are allowed to refuse it, and others overwrite. That is why the existing file
//! is moved aside instead of relying on rename-over-target semantics, and why
//! this module never claims the replacement is atomic for a *reader*: there is a
//! short window where the destination name does not exist. What is guaranteed is
//! that the old bytes are never truncated and are restored on failure; a crash
//! inside the window leaves them under the backup name, which the next upload to
//! the same path restores before it starts.

use async_trait::async_trait;
use russh_sftp::client::fs::File;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex, OnceLock, Weak};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

pub(crate) const UPLOAD_CHUNK: usize = 64 * 1024;

/// Staging files older than this are debris from an upload whose connection died
/// before it could clean up; the next upload to the same destination removes
/// them. Younger ones are left alone: they may belong to another process that is
/// still writing.
const STALE_STAGING_SECS: u64 = 10 * 60;

const TEMP_MARKER: &str = ".terminal-upload-";
const BACKUP_MARKER: &str = ".terminal-upload-backup";
const CREATE_ATTEMPTS: u8 = 8;

/// A single remote round trip may not take longer than this. Without a bound a
/// connection that dies mid-transfer leaves the upload (and the per-path lock)
/// waiting forever, because the SFTP client's own request timeout does not cover
/// write acknowledgements after the channel is gone.
const REMOTE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

async fn bounded<T, F>(future: F) -> Result<T, UploadError>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    match tokio::time::timeout(REMOTE_TIMEOUT, future).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(UploadError::Remote(error)),
        Err(_) => Err(UploadError::Remote(
            "the server stopped answering; the transfer was abandoned".to_string(),
        )),
    }
}

async fn abandon_quietly(file: &mut Box<dyn RemoteFile>) {
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), file.abandon()).await;
}

async fn remove_quietly<F: RemoteFs + ?Sized>(fs: &F, path: &str) {
    let _ = tokio::time::timeout(REMOTE_TIMEOUT, fs.remove(path)).await;
}

/// What a completed upload did to the destination.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct UploadOutcome {
    pub bytes: u64,
    /// The destination already existed and its old bytes were replaced.
    pub replaced: bool,
    /// The backup could not be removed after a successful replace. The new file
    /// is in place; the leftover is the previous version and is cleaned up by
    /// the next upload to the same path.
    pub backup_leftover: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum UploadError {
    InvalidPath(String),
    LocalFile(String),
    Remote(String),
    Cancelled,
    SizeMismatch {
        expected: u64,
        written: u64,
        reported: u64,
    },
    Replace(String),
}

impl std::fmt::Display for UploadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPath(m) => write!(f, "{m}"),
            Self::LocalFile(m) => write!(f, "read local file failed: {m}"),
            Self::Remote(m) => write!(f, "remote file operation failed: {m}"),
            Self::Cancelled => write!(f, "upload cancelled"),
            Self::SizeMismatch { expected, written, reported } => write!(
                f,
                "upload size mismatch: local {expected} bytes, {written} written, server reports {reported}"
            ),
            Self::Replace(m) => write!(f, "replacing the destination failed: {m}"),
        }
    }
}

/// The remote operations a staged upload needs. Kept deliberately small so the
/// failure paths can be driven deterministically by an in-memory fake, and so
/// the real implementation stays a thin layer over `SftpSession`.
/// One directory entry, reduced to what stale-staging cleanup needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteEntry {
    pub name: String,
    pub modified_secs: Option<u64>,
}

#[async_trait]
pub(crate) trait RemoteFs: Send + Sync {
    async fn exists(&self, path: &str) -> Result<bool, String>;
    async fn list(&self, directory: &str) -> Result<Vec<RemoteEntry>, String>;
    /// `Ok(None)` means the path already exists (the caller picks another name).
    async fn create_exclusive(&self, path: &str) -> Result<Option<Box<dyn RemoteFile>>, String>;
    async fn rename(&self, from: &str, to: &str) -> Result<(), String>;
    async fn remove(&self, path: &str) -> Result<(), String>;
}

#[async_trait]
pub(crate) trait RemoteFile: Send {
    async fn write_chunk(&mut self, data: &[u8]) -> Result<(), String>;
    /// Flush, fsync (when supported), close, then report the size the server
    /// says the file has. All of these errors are surfaced: a close that fails
    /// means the bytes are not proven durable.
    async fn finish(&mut self) -> Result<u64, String>;
    /// Give the handle back after a failure. Errors are deliberately swallowed:
    /// the caller is already on an error path and the staging file is removed.
    async fn abandon(&mut self);
}

/// Upload `local_path` to `remote_path` through a staging file.
///
/// `progress` receives `(bytes_written, total_bytes)` after every chunk;
/// `cancelled` is polled between chunks and before the replace.
pub(crate) async fn staged_upload<F, P, C>(
    fs: &F,
    local_path: &Path,
    remote_path: &str,
    mut progress: P,
    cancelled: C,
) -> Result<UploadOutcome, UploadError>
where
    F: RemoteFs + ?Sized,
    P: FnMut(u64, u64),
    C: Fn() -> bool,
{
    let (directory, name) = split_remote_path(remote_path)?;

    // The local side is validated before the remote is touched at all: a missing
    // or unreadable source must not even create a staging file.
    let metadata = tokio::fs::metadata(local_path)
        .await
        .map_err(|e| UploadError::LocalFile(e.to_string()))?;
    if !metadata.is_file() {
        return Err(UploadError::LocalFile(
            "the source is not a regular file".to_string(),
        ));
    }
    let total = metadata.len();
    let mut local = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| UploadError::LocalFile(e.to_string()))?;

    if cancelled() {
        return Err(UploadError::Cancelled);
    }

    // Two uploads to the same destination must not interleave their stage /
    // backup / replace steps. Serialising per path keeps the last writer's
    // result intact and makes the outcome deterministic.
    let _guard = upload_lock(remote_path).await;

    let backup = format!("{directory}.{name}{BACKUP_MARKER}");
    recover_backup(fs, &backup, remote_path).await?;
    cleanup_stale_staging(fs, &directory, &name).await;

    let (temp, mut remote) = create_staging_file(fs, &directory, &name).await?;

    let mut buf = vec![0u8; UPLOAD_CHUNK];
    let mut written: u64 = 0;
    loop {
        if cancelled() {
            abandon_quietly(&mut remote).await;
            remove_quietly(fs, &temp).await;
            return Err(UploadError::Cancelled);
        }
        let read = match local.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(error) => {
                abandon_quietly(&mut remote).await;
                remove_quietly(fs, &temp).await;
                return Err(UploadError::LocalFile(error.to_string()));
            }
        };
        if let Err(error) = bounded(remote.write_chunk(&buf[..read])).await {
            abandon_quietly(&mut remote).await;
            remove_quietly(fs, &temp).await;
            return Err(error);
        }
        written += read as u64;
        progress(written, total);
    }

    let reported = match bounded(remote.finish()).await {
        Ok(size) => size,
        Err(error) => {
            remove_quietly(fs, &temp).await;
            return Err(error);
        }
    };
    if written != total || reported != written {
        remove_quietly(fs, &temp).await;
        return Err(UploadError::SizeMismatch {
            expected: total,
            written,
            reported,
        });
    }

    if cancelled() {
        remove_quietly(fs, &temp).await;
        return Err(UploadError::Cancelled);
    }

    let replaced = bounded(fs.exists(remote_path)).await?;
    let mut backup_leftover = false;
    if replaced {
        // Move the old file aside first. If this fails nothing has changed yet
        // and the staging file is simply discarded.
        if let Err(error) = bounded(fs.rename(remote_path, &backup)).await {
            remove_quietly(fs, &temp).await;
            return Err(UploadError::Replace(format!(
                "could not move the existing file aside: {error}"
            )));
        }
        if let Err(error) = bounded(fs.rename(&temp, remote_path)).await {
            // Put the original back. Its content was never touched.
            let restore = bounded(fs.rename(&backup, remote_path)).await;
            remove_quietly(fs, &temp).await;
            return Err(UploadError::Replace(match restore {
                Ok(()) => format!("{error}; the previous file was restored"),
                Err(restore_error) => format!(
                    "{error}; restoring the previous file also failed: {restore_error}; \
                     it is preserved at {backup}"
                ),
            }));
        }
        backup_leftover = bounded(fs.remove(&backup)).await.is_err();
    } else if let Err(error) = bounded(fs.rename(&temp, remote_path)).await {
        // The destination appeared while we were uploading. Do not overwrite a
        // file this upload never saw: fail and leave it untouched.
        remove_quietly(fs, &temp).await;
        return Err(UploadError::Replace(format!(
            "the destination appeared during the upload: {error}"
        )));
    }

    Ok(UploadOutcome {
        bytes: written,
        replaced,
        backup_leftover,
    })
}

/// Remove staging files an earlier, dead upload could not clean up.
///
/// Best effort by design: a listing failure must not block an upload, and a
/// recent staging file is left alone because another process may still be
/// filling it.
async fn cleanup_stale_staging<F: RemoteFs + ?Sized>(fs: &F, directory: &str, name: &str) {
    let prefix = format!(".{name}{TEMP_MARKER}");
    let Ok(entries) = bounded(fs.list(directory)).await else {
        return;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    for entry in entries {
        if !entry.name.starts_with(&prefix) {
            continue;
        }
        match entry.modified_secs {
            Some(modified) if now.saturating_sub(modified) < STALE_STAGING_SECS => continue,
            Some(_) | None => {}
        }
        remove_quietly(fs, &format!("{directory}{}", entry.name)).await;
    }
}

/// A backup left by a crash inside the replace window is resolved before a new
/// upload starts: the old bytes go back if the destination is missing, and are
/// dropped only when a complete destination exists.
async fn recover_backup<F: RemoteFs + ?Sized>(
    fs: &F,
    backup: &str,
    remote_path: &str,
) -> Result<(), UploadError> {
    let backup_exists = bounded(fs.exists(backup)).await?;
    if !backup_exists {
        return Ok(());
    }
    let destination_exists = bounded(fs.exists(remote_path)).await?;
    if destination_exists {
        remove_quietly(fs, backup).await;
        return Ok(());
    }
    bounded(fs.rename(backup, remote_path)).await.map_err(|error| {
        UploadError::Replace(format!(
            "an interrupted upload left the previous file at {backup}, and restoring it failed: {error}"
        ))
    })
}

async fn create_staging_file<F: RemoteFs + ?Sized>(
    fs: &F,
    directory: &str,
    name: &str,
) -> Result<(String, Box<dyn RemoteFile>), UploadError> {
    // `CREATE | EXCLUSIVE` is the claim: a name that already exists comes back
    // as `None` and the next candidate is tried, so two writers can never end up
    // filling the same staging file.
    for _ in 0..CREATE_ATTEMPTS {
        let candidate = format!(
            "{directory}.{name}{TEMP_MARKER}{}",
            uuid::Uuid::new_v4().simple()
        );
        match bounded(fs.create_exclusive(&candidate)).await {
            Ok(Some(file)) => return Ok((candidate, file)),
            Ok(None) => continue,
            Err(error) => return Err(error),
        }
    }
    Err(UploadError::Remote(
        "could not create a unique staging file name".to_string(),
    ))
}

fn split_remote_path(path: &str) -> Result<(String, String), UploadError> {
    if path.is_empty() {
        return Err(UploadError::InvalidPath("Path cannot be empty".into()));
    }
    if path.ends_with('/') {
        return Err(UploadError::InvalidPath(format!(
            "{path} is a directory, not a file"
        )));
    }
    let (directory, name) = match path.rfind('/') {
        Some(0) => ("/".to_string(), path[1..].to_string()),
        Some(index) => (path[..=index].to_string(), path[index + 1..].to_string()),
        None => (String::new(), path.to_string()),
    };
    if name.is_empty() || name == "." || name == ".." {
        return Err(UploadError::InvalidPath(format!(
            "{path} does not name a file"
        )));
    }
    Ok((directory, name))
}

/// `Weak`, so the map never keeps a mutex alive past its last upload.
fn upload_locks() -> &'static StdMutex<HashMap<String, Weak<AsyncMutex<()>>>> {
    static LOCKS: OnceLock<StdMutex<HashMap<String, Weak<AsyncMutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| StdMutex::new(HashMap::new()))
}

/// Drop registry entries whose mutex is gone.
///
/// Called on the acquire path, which is the only place a dead key can be observed
/// as harmless. A `Weak` that fails to upgrade means no upload holds or awaits that
/// destination any more, so the key is pure residue.
fn prune_dead_locks(locks: &mut HashMap<String, Weak<AsyncMutex<()>>>) {
    locks.retain(|_, weak| weak.strong_count() > 0);
}

/// Per-destination serialisation for staged uploads.
///
/// ## The two failures this has to avoid at once
///
/// **Losing mutual exclusion.** The entry must not be forgotten while any upload
/// still holds or is waiting on that destination's mutex. Forgetting it lets the
/// next caller build a *fresh* mutex for the same path, and two uploads then
/// interleave their staging/backup/rename steps — exactly what the serialisation
/// exists to prevent.
///
/// **Growing without bound.** Every destination that ever uploaded used to leave its
/// entry behind forever. Measured: 200 sequential uploads to distinct paths left
/// 203 entries. A long-running app accumulates one per file it ever touched.
///
/// ## Why the old check never fired
///
/// It read `Arc::strong_count(&lock) == 2` after taking the guard. At that moment
/// there are always **three** strong references — the registry's, the local `lock`
/// binding, and the one the `OwnedMutexGuard` holds. Measured with a probe: the
/// value is 3, always. The branch was dead code, which is why the registry only
/// ever grew.
///
/// ## Why a `Weak` registry
///
/// Storing `Weak<Mutex>` makes the two requirements the same requirement. The
/// registry does not keep the mutex alive; the uploads do. So:
///
///   * a mutex disappears exactly when its last upload finishes — no counter to get
///     wrong, no threshold to tune;
///   * every caller that *is* holding or waiting on it holds a strong reference, so
///     the mutex cannot vanish underneath them;
///   * the map still needs pruning of dead keys, which happens on each call.
///
/// That is the whole mechanism. It is not a threshold on a reference count; it is
/// the language's own ownership rule doing the work.
async fn upload_lock(path: &str) -> OwnedMutexGuard<()> {
    let mutex = {
        let mut locks = upload_locks().lock().expect("upload lock registry");
        // Drop any entry whose mutex no longer exists, then take or create ours.
        // Pruning happens here rather than on a timer: the only time a dead key can
        // appear is between an upload finishing and the next one arriving.
        prune_dead_locks(&mut locks);
        match locks.get(path).and_then(Weak::upgrade) {
            Some(existing) => existing,
            None => {
                let fresh = Arc::new(AsyncMutex::new(()));
                locks.insert(path.to_string(), Arc::downgrade(&fresh));
                fresh
            }
        }
    };
    // The strong reference travels with the future, so the mutex stays alive for as
    // long as anyone is waiting on it.
    mutex.lock_owned().await
}

fn cancelled_transfers() -> &'static StdMutex<HashSet<String>> {
    static CANCELLED: OnceLock<StdMutex<HashSet<String>>> = OnceLock::new();
    CANCELLED.get_or_init(|| StdMutex::new(HashSet::new()))
}

/// Ask the upload with this transfer id to stop between chunks.
pub(crate) fn request_cancel(transfer_id: &str) {
    cancelled_transfers()
        .lock()
        .expect("transfer cancellation registry")
        .insert(transfer_id.to_string());
}

pub(crate) fn is_cancelled(transfer_id: &str) -> bool {
    cancelled_transfers()
        .lock()
        .expect("transfer cancellation registry")
        .contains(transfer_id)
}

/// Clear the flag once the upload has returned, so the id cannot cancel a later
/// transfer that happens to reuse it.
pub(crate) fn clear_cancel(transfer_id: &str) {
    cancelled_transfers()
        .lock()
        .expect("transfer cancellation registry")
        .remove(transfer_id);
}

// ==================== Real SFTP implementation ====================

pub(crate) struct SftpRemote<'a> {
    pub session: &'a SftpSession,
}

#[async_trait]
impl RemoteFs for SftpRemote<'_> {
    async fn exists(&self, path: &str) -> Result<bool, String> {
        self.session
            .try_exists(path)
            .await
            .map_err(|error| error.to_string())
    }

    async fn list(&self, directory: &str) -> Result<Vec<RemoteEntry>, String> {
        let mut entries = Vec::new();
        for entry in self
            .session
            .read_dir(directory)
            .await
            .map_err(|error| error.to_string())?
        {
            let modified_secs = entry.metadata().modified().ok().and_then(|time| {
                time.duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|duration| duration.as_secs())
            });
            entries.push(RemoteEntry {
                name: entry.file_name(),
                modified_secs,
            });
        }
        Ok(entries)
    }

    async fn create_exclusive(&self, path: &str) -> Result<Option<Box<dyn RemoteFile>>, String> {
        match self
            .session
            .open_with_flags(
                path,
                OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
            )
            .await
        {
            Ok(file) => Ok(Some(Box::new(SftpRemoteFile { file }))),
            Err(error) => {
                // A server that refuses an existing path reports any status code;
                // ask directly instead of parsing the message.
                match self.session.try_exists(path).await {
                    Ok(true) => Ok(None),
                    _ => Err(error.to_string()),
                }
            }
        }
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        self.session
            .rename(from, to)
            .await
            .map_err(|error| error.to_string())
    }

    async fn remove(&self, path: &str) -> Result<(), String> {
        self.session
            .remove_file(path)
            .await
            .map_err(|error| error.to_string())
    }
}

struct SftpRemoteFile {
    file: File,
}

#[async_trait]
impl RemoteFile for SftpRemoteFile {
    async fn write_chunk(&mut self, data: &[u8]) -> Result<(), String> {
        self.file
            .write_all(data)
            .await
            .map_err(|error| error.to_string())
    }

    async fn finish(&mut self) -> Result<u64, String> {
        // `flush` drains the write acknowledgements of the chunks above and runs
        // fsync@openssh.com when the server advertises it.
        self.file
            .flush()
            .await
            .map_err(|error| format!("flush failed: {error}"))?;
        self.file
            .sync_all()
            .await
            .map_err(|error| format!("fsync failed: {error}"))?;
        let size = self
            .file
            .metadata()
            .await
            .map_err(|error| format!("size check failed: {error}"))?
            .len();
        self.file
            .shutdown()
            .await
            .map_err(|error| format!("close failed: {error}"))?;
        Ok(size)
    }

    async fn abandon(&mut self) {
        let _ = self.file.shutdown().await;
    }
}
#[cfg(test)]
#[path = "sftp_upload_tests.rs"]
mod tests;
