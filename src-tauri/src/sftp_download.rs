//! Receiving a download into a temporary file and only then replacing the target.
//!
//! ## Why this exists
//!
//! `sftp_download` used `tokio::fs::File::create(&local_path)`, which truncates the
//! destination immediately. Every later failure — remote read error, local write
//! error, flush failure — left the user with a **destroyed original** plus a
//! partial file at the path they chose. The upload path has protected the remote
//! side this way since the staged-upload work; the local side did not.
//!
//! ## The contract
//!
//! 1. The bytes are written to a temporary file **in the target's own directory**,
//!    so the final step is a rename within one filesystem (a cross-device rename
//!    fails, and `/tmp` is frequently a different mount).
//! 2. The temporary file is synced before the rename, so a power loss cannot leave
//!    the target pointing at unflushed bytes.
//! 3. The target is replaced with `rename`, which is atomic on POSIX. On Windows
//!    `rename` fails when the destination exists, so the sequence there is
//!    backup → rename → remove backup, with a restore step if the rename fails.
//! 4. **Any** failure removes the temporary file and leaves the target untouched —
//!    including a failure in the commit itself, which is issue #74.
//! 5. If the displaced original cannot be restored, the error names the backup path
//!    and the backup is **kept**. Losing the user's file silently is the one outcome
//!    that must be impossible.
//! 6. Commits to the same target serialise (issue #75). Without that, the Windows
//!    fallback's three steps can interleave across two downloads and strand one
//!    original in a backup file.
//!
//! ## Why the filesystem is behind a trait
//!
//! Every rule above is a failure path, and a failure path that can only be reached
//! by making a real disk fail is a failure path that is never tested. `FileOps` is
//! the injection point: the production implementation forwards to `tokio::fs`, and
//! tests supply one that fails a specific operation at a specific step. That is what
//! makes "the original survives a failed restore" a deterministic assertion instead
//! of a hope.

use crate::path_lock::PathLockRegistry;
use std::path::{Path, PathBuf};
use tokio::io::AsyncReadExt;

/// Marker for the temporary file, mirroring the upload side's naming.
const TEMP_MARKER: &str = ".terminal-download-tmp";
/// Marker for the displaced original during a Windows-style replace.
const BACKUP_MARKER: &str = ".terminal-download-backup";
/// How many names to try before giving up on preserving an existing backup.
const BACKUP_PRESERVE_ATTEMPTS: u32 = 64;

/// One registry for download commits, keyed by canonical target path.
static DOWNLOAD_LOCKS: PathLockRegistry = PathLockRegistry::new();

/// Test-only: how many commit locks the registry holds, and whether one is live.
#[cfg(test)]
pub(crate) fn download_lock_registry() -> &'static PathLockRegistry {
    &DOWNLOAD_LOCKS
}

/// The filesystem operations the commit performs.
///
/// Narrow on purpose: renames, existence checks and removals are the whole of the
/// commit, so a test that fails one of them is describing a real failure mode rather
/// than a contrived one.
#[async_trait::async_trait]
pub(crate) trait FileOps: Send + Sync {
    /// Rename, replacing the destination if the platform allows it.
    async fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()>;
    /// Does this path exist?
    ///
    /// Returns `Err` when the answer is unknown — a permission error or an I/O
    /// failure is **not** "absent". Treating the two as the same makes the commit
    /// skip the displace step for a file that is really there, so the promotion
    /// overwrites the user's original instead of moving it aside first.
    async fn exists(&self, path: &Path) -> std::io::Result<bool>;
    /// Remove a file, treating "not there" as success.
    async fn remove(&self, path: &Path) -> std::io::Result<()>;
}

/// The production implementation: real renames on the real filesystem.
pub(crate) struct RealFileOps;

#[async_trait::async_trait]
impl FileOps for RealFileOps {
    async fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        tokio::fs::rename(from, to).await
    }

    async fn exists(&self, path: &Path) -> std::io::Result<bool> {
        // `try_exists` already separates "absent" (Ok(false)) from "could not
        // tell" (Err); the defect was discarding the distinction.
        tokio::fs::try_exists(path).await
    }

    async fn remove(&self, path: &Path) -> std::io::Result<()> {
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

/// What the sink does with the bytes.
///
/// Deliberately narrow: the caller reads from the remote and writes chunks, and the
/// sink owns durability and the replace decision. Nothing here knows about SFTP.
#[async_trait::async_trait]
pub(crate) trait DownloadSink: Send {
    /// Append one chunk. Called in order; an error aborts the whole download.
    async fn write(&mut self, chunk: &[u8]) -> Result<(), String>;
    /// Flush and fsync. Called once, after the last chunk and before the replace.
    async fn finish(&mut self) -> Result<(), String>;
    /// Give up: the sink must leave no temporary file behind.
    ///
    /// Returns the cleanup failure when the temp file could not be removed, so the
    /// caller can report that instead of claiming a clean abort.
    async fn abandon(&mut self) -> Option<String>;
}

/// Where the bytes go and how the target is replaced.
pub(crate) struct DownloadTarget {
    /// The file the user asked for.
    pub path: PathBuf,
    /// The temporary file, in the same directory as `path`.
    pub temp: PathBuf,
    /// The displaced original, used only on platforms whose rename cannot replace.
    pub backup: PathBuf,
}

impl DownloadTarget {
    /// Build the three paths for one download.
    ///
    /// The temporary name carries the pid and a counter so two concurrent downloads
    /// to the same target cannot collide on it — a collision would have them
    /// writing into each other's file.
    pub fn new(target: &Path, unique: u64) -> Result<Self, String> {
        let directory = target
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        let name = target
            .file_name()
            .ok_or_else(|| format!("the destination {} has no file name", target.display()))?
            .to_string_lossy()
            .to_string();
        Ok(Self {
            path: target.to_path_buf(),
            temp: directory.join(format!(".{name}.{TEMP_MARKER}.{unique}")),
            backup: directory.join(format!(".{name}.{BACKUP_MARKER}.{unique}")),
        })
    }

    /// The key two downloads to the same file must agree on.
    ///
    /// Canonicalised when the target already exists, so `./a.txt` and `a.txt` and a
    /// symlinked parent all serialise against each other. When it does not exist yet
    /// there is nothing to canonicalise, so the parent is resolved instead — the file
    /// name itself needs no resolution.
    async fn lock_key(&self) -> String {
        if let Ok(resolved) = tokio::fs::canonicalize(&self.path).await {
            return resolved.to_string_lossy().to_string();
        }
        let directory = self
            .path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let resolved_directory = tokio::fs::canonicalize(directory)
            .await
            .unwrap_or_else(|_| directory.to_path_buf());
        let name = self
            .path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        resolved_directory.join(name).to_string_lossy().to_string()
    }

    /// Where a pre-existing backup is moved to instead of being deleted.
    ///
    /// Distinct from `backup` so a commit in progress never confuses the two, and
    /// the suffix records that this file was kept on purpose.
    pub(crate) fn preserved_backup(&self, attempt: u32) -> PathBuf {
        let mut name = self.backup.clone().into_os_string();
        name.push(format!(".preserved-{attempt}"));
        PathBuf::from(name)
    }

    /// A copy of the three paths, for handing to a spawned task.
    #[cfg(test)]
    pub(crate) fn clone_paths(&self) -> Self {
        Self {
            path: self.path.clone(),
            temp: self.temp.clone(),
            backup: self.backup.clone(),
        }
    }

    /// The key this target's commit lock uses. Tests assert the registry entry
    /// survives while a second commit is queued.
    #[cfg(test)]
    pub(crate) async fn lock_key_for_tests(&self) -> String {
        self.lock_key().await
    }
}

fn is_already_exists(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::AlreadyExists
}

/// Replace `target` with `temp`, keeping the original until the new bytes are in
/// place.
///
/// POSIX `rename` replaces silently. Windows refuses when the destination exists, so
/// the fallback is: move the original aside, rename the temporary into place, delete
/// the displaced copy.
///
/// ## What the failure branches guarantee
///
/// * The temporary file is always removed when the commit fails, whatever the reason.
///   Before issue #74 a failed commit returned early and left a
///   `.terminal-download-tmp` file beside the user's file.
/// * If the promotion fails and the original was moved aside, the original is moved
///   back. If **that** fails, the backup is kept and the error says where it is —
///   the one thing that must never happen silently is the user's file ending up
///   somewhere they do not know about.
async fn replace_target_with(target: &DownloadTarget, ops: &dyn FileOps) -> Result<(), String> {
    // Issue #75: serialise the whole commit for this target. The Windows fallback is
    // three steps, and two commits interleaving them can leave one original stranded
    // in its backup file. The guard is dropped when this function returns.
    let _guard = DOWNLOAD_LOCKS.acquire(&target.lock_key().await).await;

    let outcome = match ops.rename(&target.temp, &target.path).await {
        Ok(()) => Ok(()),
        Err(error) if is_already_exists(&error) => promote_over_existing(target, ops).await,
        // Windows reports a plain rename onto an existing file as a permission
        // error rather than `AlreadyExists`, so the fallback has to cover both.
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            promote_over_existing(target, ops).await
        }
        Err(error) => Err(format!(
            "could not replace {}: {error}",
            target.path.display()
        )),
    };
    finish_commit(target, ops, outcome).await
}

/// Remove the temporary file after a failed commit, and report a failure to do so.
///
/// Shared by the real path and the test entry point so the two cannot drift. The
/// received bytes are worthless once the commit fails — they are either at the
/// target or nowhere — but a leftover `.terminal-download-tmp` file beside the
/// user's file is a defect, and a cleanup that silently fails is worse than one that
/// says so (issue #74).
async fn finish_commit(
    target: &DownloadTarget,
    ops: &dyn FileOps,
    outcome: Result<(), String>,
) -> Result<(), String> {
    let Err(reason) = outcome else {
        return Ok(());
    };
    match ops.remove(&target.temp).await {
        Ok(()) => Err(reason),
        Err(cleanup) => Err(format!(
            "{reason}; the temporary file {} also could not be removed: {cleanup}",
            target.temp.display()
        )),
    }
}

/// Run the commit, but assume the platform refuses to replace in place.
///
/// Exists so the Windows fallback can be driven on a POSIX runner: `replace_target_with`
/// only reaches it when `rename` answers `AlreadyExists`/`PermissionDenied`, which a
/// Linux or macOS filesystem will not do for a plain rename. The tests need the branch
/// itself — displace, promote, restore — not the platform condition that selects it.
///
/// Holds the per-target commit lock exactly as the real path does, so a test using
/// this is also testing the serialisation.
#[cfg(test)]
pub(crate) async fn replace_target_as_windows_with(
    target: &DownloadTarget,
    ops: &dyn FileOps,
) -> Result<(), String> {
    let _guard = DOWNLOAD_LOCKS.acquire(&target.lock_key().await).await;
    let outcome = promote_over_existing(target, ops).await;
    finish_commit(target, ops, outcome).await
}

/// The Windows-shaped branch: move the original aside, promote, then tidy up.
///
/// Reached from `replace_target_with` when the platform's `rename` will not replace
/// an existing file. Exposed to the crate for tests, which drive it directly because
/// no POSIX filesystem produces the failure that leads here.
pub(crate) async fn promote_over_existing(
    target: &DownloadTarget,
    ops: &dyn FileOps,
) -> Result<(), String> {
    let had_original = ops.exists(&target.path).await.map_err(|error| {
        format!(
            "could not tell whether {} exists: {error}; the download was not \
                 committed and the original was left untouched",
            target.path.display()
        )
    })?;

    // ## Why an existing backup is moved, never deleted
    //
    // A backup file here is not debris. There are exactly two ways one exists:
    //
    //   1. a previous commit's restore failed, so **the user's only copy of the
    //      original is inside it** — the error from that commit said so;
    //   2. a previous commit succeeded and its cleanup failed, so it is a leftover
    //      duplicate.
    //
    // Deleting it is correct in case 2 and destroys the user's file in case 1, and
    // nothing at this layer can tell them apart. So it is never deleted: it is
    // renamed to a free name that records why it was kept. That costs a file on
    // disk and cannot cost the user their data.
    //
    // This runs whether or not the target exists. A missing target does not make the
    // backup less valuable — a host that came back after a failed restore may have
    // no target *because* the restore failed.
    if let Err(error) = preserve_existing_backup(target, ops).await {
        return Err(format!(
            "could not set aside the existing backup {}: {error}; the download \
             was not committed and nothing was deleted",
            target.backup.display()
        ));
    }
    if had_original {
        if let Err(error) = ops.rename(&target.path, &target.backup).await {
            return Err(format!(
                "could not move the original {} aside: {error}",
                target.path.display()
            ));
        }
    }

    match ops.rename(&target.temp, &target.path).await {
        Ok(()) => {
            if had_original {
                // The new bytes are in place, so this backup is a duplicate of a file
                // the user still has. Failing the download over it would be worse
                // than leaving it, but it must not be silent.
                if let Err(error) = ops.remove(&target.backup).await {
                    eprintln!(
                        "sftp_download: the new file is in place but the displaced \
                         original {} could not be removed: {error}",
                        target.backup.display()
                    );
                }
            }
            Ok(())
        }
        Err(promotion_error) => {
            let promotion = format!(
                "could not replace {}: {promotion_error}",
                target.path.display()
            );
            if !had_original {
                // Nothing was displaced, so there is nothing to restore. The target
                // never existed and still does not.
                return Err(promotion);
            }
            if let Err(restore_error) = ops.rename(&target.backup, &target.path).await {
                // The one case that must never be silent or lossy. The backup is
                // left exactly where it is — deleting it would destroy the only
                // copy of the user's file.
                return Err(format!(
                    "{promotion}; the original could not be restored to {} \
                     ({restore_error}) and is still at {}",
                    target.path.display(),
                    target.backup.display()
                ));
            }
            Err(promotion)
        }
    }
}

/// Move a pre-existing backup out of the way without ever deleting it.
///
/// The name it lands on says why it was kept, so a user who finds one has a path
/// back: `<backup>.preserved-<n>`. The suffix is chosen to be free, and a bounded
/// search stops rather than overwriting when it cannot find one — at that point the
/// honest answer is "could not commit", not "deleted something".
async fn preserve_existing_backup(
    target: &DownloadTarget,
    ops: &dyn FileOps,
) -> Result<(), String> {
    let existing = ops
        .exists(&target.backup)
        .await
        .map_err(|error| format!("could not read {}: {error}", target.backup.display()))?;
    if !existing {
        return Ok(());
    }
    for attempt in 0..BACKUP_PRESERVE_ATTEMPTS {
        let candidate = target.preserved_backup(attempt);
        let taken = ops
            .exists(&candidate)
            .await
            .map_err(|error| format!("could not read {}: {error}", candidate.display()))?;
        if !taken {
            return ops
                .rename(&target.backup, &candidate)
                .await
                .map_err(|error| error.to_string());
        }
    }
    Err(format!(
        "{} already exists and no free name was found to keep it under; \
         it was left in place",
        target.backup.display()
    ))
}

/// Copy from a remote reader into the target through a temporary file.
///
/// `expected_len` is the remote size when it is known. When it is known, a short
/// read is an error: a server that closes early must not be reported as a
/// successful download of a truncated file.
///
/// The sink is supplied by the caller so this function has no opinion about where
/// the bytes come from; tests inject a sink that fails on the Nth chunk.
pub(crate) async fn receive_download<T, R>(
    target: &DownloadTarget,
    expected_len: Option<u64>,
    reader: &mut R,
    on_progress: impl FnMut(u64),
    sink: T,
) -> Result<u64, String>
where
    T: DownloadSink,
    R: tokio::io::AsyncRead + Unpin,
{
    receive_download_with(
        target,
        expected_len,
        reader,
        on_progress,
        sink,
        &RealFileOps,
    )
    .await
}

/// `receive_download` with the filesystem injected. See `FileOps`.
pub(crate) async fn receive_download_with<T, R>(
    target: &DownloadTarget,
    expected_len: Option<u64>,
    reader: &mut R,
    mut on_progress: impl FnMut(u64),
    mut sink: T,
    ops: &dyn FileOps,
) -> Result<u64, String>
where
    T: DownloadSink,
    R: tokio::io::AsyncRead + Unpin,
{
    let mut received: u64 = 0;
    let mut buffer = vec![0u8; 64 * 1024];

    loop {
        let n = match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(error) => {
                return Err(aborted(
                    sink.abandon().await,
                    format!("read remote file failed: {error}"),
                ))
            }
        };
        if let Err(error) = sink.write(&buffer[..n]).await {
            return Err(aborted(
                sink.abandon().await,
                format!("write local file failed: {error}"),
            ));
        }
        received += n as u64;
        on_progress(received);
    }

    if let Some(expected) = expected_len {
        if received != expected {
            return Err(aborted(
                sink.abandon().await,
                format!(
                    "the server sent {received} of {expected} bytes; the download is incomplete"
                ),
            ));
        }
    }

    if let Err(error) = sink.finish().await {
        return Err(aborted(
            sink.abandon().await,
            format!("flush local file failed: {error}"),
        ));
    }

    // The data is on disk and synced; the sink no longer owns the temp file, so the
    // commit path is the only thing that can clean it up now. That is why
    // `replace_target_with` removes it on every failure.
    replace_target_with(target, ops).await?;
    Ok(received)
}

/// Attach a cleanup failure to an abort message, so a caller never reports a clean
/// abort when a temp file was actually left behind.
fn aborted(cleanup: Option<String>, message: String) -> String {
    match cleanup {
        Some(cleanup) => format!("{message}; {cleanup}"),
        None => message,
    }
}

/// The production sink: a temporary file that is synced before it is promoted.
pub(crate) struct FileSink {
    file: Option<tokio::fs::File>,
    temp: PathBuf,
}

impl FileSink {
    /// Create the temporary file, failing before any remote bytes are read.
    pub async fn create(temp: &Path) -> Result<Self, String> {
        let file = tokio::fs::File::create(temp)
            .await
            .map_err(|e| format!("could not create {}: {e}", temp.display()))?;
        Ok(Self {
            file: Some(file),
            temp: temp.to_path_buf(),
        })
    }
}

#[async_trait::async_trait]
impl DownloadSink for FileSink {
    async fn write(&mut self, chunk: &[u8]) -> Result<(), String> {
        use tokio::io::AsyncWriteExt;
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| "the sink was already finished".to_string())?;
        file.write_all(chunk).await.map_err(|e| e.to_string())
    }

    async fn finish(&mut self) -> Result<(), String> {
        use tokio::io::AsyncWriteExt;
        let mut file = self
            .file
            .take()
            .ok_or_else(|| "the sink was already finished".to_string())?;
        file.flush().await.map_err(|e| e.to_string())?;
        // Durability before the rename: otherwise a power loss after the rename
        // leaves the target pointing at bytes that never reached the platter.
        file.sync_all().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn abandon(&mut self) -> Option<String> {
        self.file = None;
        match tokio::fs::remove_file(&self.temp).await {
            Ok(()) => None,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => Some(format!(
                "the temporary file {} could not be removed: {error}",
                self.temp.display()
            )),
        }
    }
}
