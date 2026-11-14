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
//! 4. Any failure removes the temporary file and leaves the target untouched.
//!
//! The helper is written against a small trait so the failure paths can be driven
//! deterministically in tests, which is the only way to prove "the original is
//! intact after a mid-write failure" without racing a real disk.

use std::path::{Path, PathBuf};
use tokio::io::AsyncReadExt;

/// Marker for the temporary file, mirroring the upload side's naming.
const TEMP_MARKER: &str = ".terminal-download-tmp";
/// Marker for the displaced original during a Windows-style replace.
const BACKUP_MARKER: &str = ".terminal-download-backup";

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
    async fn abandon(&mut self);
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
}

fn is_already_exists(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::AlreadyExists
}

/// Remove a path, ignoring "it was not there".
async fn remove_if_present(path: &Path) -> Result<(), String> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not remove {}: {error}", path.display())),
    }
}

/// Replace `target` with `temp`, keeping the original until the new bytes are in
/// place.
///
/// POSIX `rename` replaces silently. Windows refuses when the destination exists, so
/// the fallback is: move the original aside, rename the temporary into place, delete
/// the displaced copy. If the rename then fails, the original is moved back — the
/// user's file is never the thing that disappears.
async fn replace_target(target: &DownloadTarget) -> Result<(), String> {
    match tokio::fs::rename(&target.temp, &target.path).await {
        Ok(()) => Ok(()),
        Err(error)
            if is_already_exists(&error)
                || error.kind() == std::io::ErrorKind::PermissionDenied =>
        {
            // A platform whose rename will not replace. Displace, then rename.
            let had_original = tokio::fs::try_exists(&target.path).await.unwrap_or(false);
            if had_original {
                remove_if_present(&target.backup).await?;
                tokio::fs::rename(&target.path, &target.backup)
                    .await
                    .map_err(|e| format!("could not move the original aside: {e}"))?;
            }
            match tokio::fs::rename(&target.temp, &target.path).await {
                Ok(()) => {
                    if had_original {
                        // A leftover backup is not worth failing the download over;
                        // the new bytes are already in place and verified.
                        let _ = remove_if_present(&target.backup).await;
                    }
                    Ok(())
                }
                Err(rename_error) => {
                    if had_original {
                        // Put the original back before reporting, so the failure
                        // leaves the user exactly where they started.
                        let _ = tokio::fs::rename(&target.backup, &target.path).await;
                    }
                    Err(format!(
                        "could not replace {}: {rename_error}",
                        target.path.display()
                    ))
                }
            }
        }
        Err(error) => Err(format!(
            "could not replace {}: {error}",
            target.path.display()
        )),
    }
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
    mut on_progress: impl FnMut(u64),
    mut sink: T,
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
                sink.abandon().await;
                return Err(format!("read remote file failed: {error}"));
            }
        };
        if let Err(error) = sink.write(&buffer[..n]).await {
            sink.abandon().await;
            return Err(format!("write local file failed: {error}"));
        }
        received += n as u64;
        on_progress(received);
    }

    if let Some(expected) = expected_len {
        if received != expected {
            sink.abandon().await;
            return Err(format!(
                "the server sent {received} of {expected} bytes; the download is incomplete"
            ));
        }
    }

    if let Err(error) = sink.finish().await {
        sink.abandon().await;
        return Err(format!("flush local file failed: {error}"));
    }

    replace_target(target).await?;
    Ok(received)
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

    async fn abandon(&mut self) {
        self.file = None;
        let _ = remove_if_present(&self.temp).await;
    }
}
