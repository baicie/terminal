//! Issue #54 — a failed download must not destroy the file it was replacing.
//!
//! The original defect: `sftp_download` used `File::create(&local_path)`, which
//! truncates immediately. A remote read error, a local write error or a flush
//! failure then left the user with a destroyed original and a partial file at the
//! path they chose.
//!
//! ## Issues #74 and #75 — what the first round missed
//!
//! #74: the receive loop cleaned up on every *read/write/finish* failure, but a
//! failure in the **commit** returned early and left the temporary file behind. And
//! the Windows fallback swallowed a failed restore of the original with `let _ =`,
//! so the user's file could end up in a `.terminal-download-backup.<n>` sibling with
//! no record of where it went.
//!
//! #75: two downloads to the same target produced distinct temp names but did not
//! serialise their commits. Interleaved, A can move the original aside, B can promote
//! its own file, and A's restore then fails against B's file — stranding the original
//! in A's backup.
//!
//! Every commit case below drives `receive_download_with` and a `FileOps` that fails
//! a named operation at a named step. Real permissions are never involved: `chmod`
//! based tests depend on the runner, and the point is to prove the *branch*, not to
//! discover whether the filesystem honours a bit.

use super::sftp_download::*;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/// A reader over fixed chunks that ends cleanly, or fails after the last one.
struct ChunkReader {
    chunks: VecDeque<Vec<u8>>,
    /// When true, running out of chunks is an error rather than EOF.
    fail_at_end: bool,
    offset: usize,
}

impl ChunkReader {
    fn ending(chunks: Vec<Vec<u8>>) -> Self {
        Self {
            chunks: chunks.into(),
            fail_at_end: false,
            offset: 0,
        }
    }
    fn failing(chunks: Vec<Vec<u8>>) -> Self {
        Self {
            chunks: chunks.into(),
            fail_at_end: true,
            offset: 0,
        }
    }
}

impl tokio::io::AsyncRead for ChunkReader {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        _cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        loop {
            let Some(head) = self.chunks.front() else {
                return std::task::Poll::Ready(if self.fail_at_end {
                    Err(std::io::Error::new(
                        std::io::ErrorKind::ConnectionReset,
                        "the server stopped answering",
                    ))
                } else {
                    Ok(())
                });
            };
            if self.offset >= head.len() {
                self.chunks.pop_front();
                self.offset = 0;
                continue;
            }
            let remaining = &head[self.offset..];
            let n = remaining.len().min(buf.remaining());
            buf.put_slice(&remaining[..n]);
            self.offset += n;
            return std::task::Poll::Ready(Ok(()));
        }
    }
}

/// A sink that writes nothing and fails on the Nth `write`.
struct FailingSink {
    writes: usize,
    fail_on: usize,
    temp: PathBuf,
}

#[async_trait::async_trait]
impl DownloadSink for FailingSink {
    async fn write(&mut self, _chunk: &[u8]) -> Result<(), String> {
        self.writes += 1;
        if self.writes >= self.fail_on {
            return Err("disk full".to_string());
        }
        Ok(())
    }
    async fn finish(&mut self) -> Result<(), String> {
        Ok(())
    }
    async fn abandon(&mut self) -> Option<String> {
        let _ = tokio::fs::remove_file(&self.temp).await;
        None
    }
}

/// A sink whose `finish` fails, standing in for a flush/sync error.
struct FinishFailsSink {
    temp: PathBuf,
    writes: Arc<AtomicUsize>,
}

#[async_trait::async_trait]
impl DownloadSink for FinishFailsSink {
    async fn write(&mut self, _chunk: &[u8]) -> Result<(), String> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn finish(&mut self) -> Result<(), String> {
        Err("sync failed".to_string())
    }
    async fn abandon(&mut self) -> Option<String> {
        let _ = tokio::fs::remove_file(&self.temp).await;
        None
    }
}

fn target_for(dir: &Path, name: &str) -> DownloadTarget {
    DownloadTarget::new(&dir.join(name), 1).expect("target")
}

/// Every file in the directory, sorted. Used to assert the *set* of leftovers
/// rather than only the final bytes — a temp or backup file is a defect even when
/// the target happens to be correct.
fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

// ---------------------------------------------------------------------------
// The injectable filesystem
// ---------------------------------------------------------------------------

/// Which filesystem operation a failure is injected into.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Op {
    /// `temp -> target`, the promotion itself.
    Promote,
    /// `target -> backup`, the displace step of the Windows fallback.
    Displace,
    /// `backup -> target`, the restore after a failed promotion.
    Restore,
    /// Any `remove_file`.
    Remove,
}

/// Real filesystem operations with one failure injected at a chosen step.
///
/// Counts calls per operation so a test can fail the *second* promotion (the one
/// inside the fallback) instead of the first, which is what makes "the original was
/// displaced and then the promotion failed" reachable.
struct FakeFs {
    fail_on: Option<(Op, usize)>,
    calls: Mutex<Vec<Op>>,
}

impl FakeFs {
    fn new(fail_on: Option<(Op, usize)>) -> Self {
        Self {
            fail_on,
            calls: Mutex::new(Vec::new()),
        }
    }

    /// Record a call and report whether this one is the injected failure.
    fn hits(&self, op: Op) -> bool {
        let mut calls = self.calls.lock().unwrap();
        calls.push(op);
        let seen = calls.iter().filter(|call| **call == op).count();
        matches!(self.fail_on, Some((target, nth)) if target == op && seen == nth)
    }
}

#[async_trait::async_trait]
impl FileOps for FakeFs {
    async fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        // Classify by path, not by extension: the temp and backup names both end in
        // a numeric suffix, so the marker in the file name is the reliable signal.
        let op = if from.to_string_lossy().contains(".terminal-download-tmp") {
            Op::Promote
        } else if to.to_string_lossy().contains(".terminal-download-backup") {
            Op::Displace
        } else {
            Op::Restore
        };
        if self.hits(op) {
            return Err(std::io::Error::other(format!("injected {op:?} failure")));
        }
        tokio::fs::rename(from, to).await
    }

    async fn exists(&self, path: &Path) -> bool {
        tokio::fs::try_exists(path).await.unwrap_or(false)
    }

    async fn remove(&self, path: &Path) -> std::io::Result<()> {
        if self.hits(Op::Remove) {
            return Err(std::io::Error::other("injected remove failure"));
        }
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

/// Run a complete download through the injected filesystem.
async fn download_with(
    target: &DownloadTarget,
    payload: &[u8],
    ops: &dyn FileOps,
) -> Result<u64, String> {
    let sink = FileSink::create(&target.temp).await.expect("sink");
    let mut reader = ChunkReader::ending(vec![payload.to_vec()]);
    receive_download_with(
        target,
        Some(payload.len() as u64),
        &mut reader,
        |_| {},
        sink,
        ops,
    )
    .await
}

// ---------------------------------------------------------------------------
// The happy path and the receive-stage failures (unchanged semantics)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_successful_download_replaces_the_target_and_leaves_no_temp() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf");
    tokio::fs::write(&target.path, b"old bytes").await.unwrap();

    let payload: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
    let sink = FileSink::create(&target.temp).await.expect("sink");
    let mut reader = ChunkReader::ending(payload.chunks(48 * 1024).map(<[u8]>::to_vec).collect());
    let received = receive_download(
        &target,
        Some(payload.len() as u64),
        &mut reader,
        |_| {},
        sink,
    )
    .await
    .expect("download");

    assert_eq!(received, payload.len() as u64);
    assert_eq!(tokio::fs::read(&target.path).await.unwrap(), payload);
    assert_eq!(
        entries(dir.path()),
        vec!["report.pdf".to_string()],
        "a successful download leaves exactly the target"
    );
}

#[tokio::test]
async fn a_remote_read_failure_leaves_the_original_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf");
    tokio::fs::write(&target.path, b"the original bytes")
        .await
        .unwrap();

    let sink = FileSink::create(&target.temp).await.expect("sink");
    let mut reader = ChunkReader::failing(vec![vec![b'x'; 1024]]);
    let result = receive_download(&target, Some(4096), &mut reader, |_| {}, sink).await;

    assert!(
        result.is_err(),
        "a half-read download must not report success"
    );
    assert_eq!(
        tokio::fs::read(&target.path).await.unwrap(),
        b"the original bytes"
    );
    assert_eq!(entries(dir.path()), vec!["report.pdf".to_string()]);
}

#[tokio::test]
async fn a_local_write_failure_leaves_the_original_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf");
    tokio::fs::write(&target.path, b"the original bytes")
        .await
        .unwrap();

    let sink = FailingSink {
        writes: 0,
        fail_on: 2,
        temp: target.temp.clone(),
    };
    let mut reader = ChunkReader::ending(vec![vec![b'a'; 1024], vec![b'b'; 1024]]);
    let result = receive_download(&target, Some(4096), &mut reader, |_| {}, sink).await;

    assert!(result.is_err());
    assert_eq!(
        tokio::fs::read(&target.path).await.unwrap(),
        b"the original bytes"
    );
    assert_eq!(entries(dir.path()), vec!["report.pdf".to_string()]);
}

#[tokio::test]
async fn a_flush_failure_leaves_the_original_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf");
    tokio::fs::write(&target.path, b"the original bytes")
        .await
        .unwrap();

    let writes = Arc::new(AtomicUsize::new(0));
    let sink = FinishFailsSink {
        temp: target.temp.clone(),
        writes: Arc::clone(&writes),
    };
    let mut reader = ChunkReader::ending(vec![vec![b'a'; 16]]);
    let result = receive_download(&target, None, &mut reader, |_| {}, sink).await;

    assert!(result.is_err());
    assert_eq!(
        writes.load(Ordering::SeqCst),
        1,
        "the write itself succeeded"
    );
    assert_eq!(
        tokio::fs::read(&target.path).await.unwrap(),
        b"the original bytes"
    );
}

#[tokio::test]
async fn a_failed_download_to_a_new_path_leaves_nothing_behind() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "brand-new.bin");
    assert!(!tokio::fs::try_exists(&target.path).await.unwrap());

    let sink = FileSink::create(&target.temp).await.expect("sink");
    let mut reader = ChunkReader::failing(vec![vec![b'x'; 64]]);
    let result = receive_download(&target, Some(4096), &mut reader, |_| {}, sink).await;

    assert!(result.is_err());
    assert!(
        entries(dir.path()).is_empty(),
        "no temporaries may survive: {:?}",
        entries(dir.path())
    );
}

#[tokio::test]
async fn a_short_read_is_an_error_when_the_length_is_known() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf");
    tokio::fs::write(&target.path, b"the original bytes")
        .await
        .unwrap();

    let sink = FileSink::create(&target.temp).await.expect("sink");
    let mut reader = ChunkReader::ending(vec![vec![b'a'; 1024]]);
    let result = receive_download(&target, Some(4096), &mut reader, |_| {}, sink).await;

    assert!(
        result.is_err(),
        "a truncated download must not report success"
    );
    assert_eq!(
        tokio::fs::read(&target.path).await.unwrap(),
        b"the original bytes"
    );
}

#[tokio::test]
async fn an_unknown_length_still_ends_cleanly_at_eof() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "stream.bin");

    let sink = FileSink::create(&target.temp).await.expect("sink");
    let mut reader = ChunkReader::ending(vec![vec![b'a'; 10], vec![b'b'; 5]]);
    let received = receive_download(&target, None, &mut reader, |_| {}, sink)
        .await
        .expect("download");

    assert_eq!(received, 15);
    assert_eq!(tokio::fs::read(&target.path).await.unwrap().len(), 15);
}

#[tokio::test]
async fn the_temporary_file_lives_beside_the_target() {
    // A rename across filesystems fails, and `/tmp` is frequently a different
    // mount from the user's home directory.
    let dir = tempfile::tempdir().unwrap();
    let target = DownloadTarget::new(&dir.path().join("nested/report.pdf"), 7).unwrap();
    assert_eq!(
        target.temp.parent(),
        Some(dir.path().join("nested").as_path())
    );
    assert_eq!(target.path.parent(), target.temp.parent());
}

#[tokio::test]
async fn two_downloads_to_one_target_do_not_share_a_temporary_name() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("report.pdf");
    let a = DownloadTarget::new(&path, 1).unwrap();
    let b = DownloadTarget::new(&path, 2).unwrap();
    assert_ne!(
        a.temp, b.temp,
        "a shared temp name means two writers, one file"
    );
    assert_ne!(a.backup, b.backup);
}

/// Pins **why** the helper exists, by demonstrating the old failure.
#[tokio::test]
async fn writing_directly_to_the_target_destroys_it_even_when_the_download_fails() {
    use tokio::io::AsyncWriteExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("report.pdf");
    tokio::fs::write(&path, b"the original bytes")
        .await
        .unwrap();

    // The pre-fix opening move.
    let mut file = tokio::fs::File::create(&path).await.unwrap();
    file.write_all(&[b'x'; 64]).await.unwrap();
    drop(file);

    assert_eq!(
        tokio::fs::read(&path).await.unwrap(),
        vec![b'x'; 64],
        "File::create truncates on open, so the original is already gone before any \
         byte is written — this is what the temporary file prevents"
    );
}

// ---------------------------------------------------------------------------
// #74 — the commit stage cleans up
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_failed_promotion_removes_the_temporary_file() {
    // The defect: the receive loop called `abandon()` on every failure, but a
    // failure *after* `finish()` returned early and left the temp file behind —
    // `finish()` had already taken the handle, so nothing else could delete it.
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf");
    tokio::fs::write(&target.path, b"the original bytes")
        .await
        .unwrap();

    let ops = FakeFs::new(Some((Op::Promote, 1)));
    let result = download_with(&target, b"new payload", &ops).await;

    assert!(result.is_err(), "a failed commit must not report success");
    assert_eq!(
        entries(dir.path()),
        vec!["report.pdf".to_string()],
        "the temporary file must be gone: {:?}",
        entries(dir.path())
    );
    assert_eq!(
        tokio::fs::read(&target.path).await.unwrap(),
        b"the original bytes",
        "the original is untouched"
    );
}

#[tokio::test]
async fn a_failed_promotion_to_a_new_path_removes_the_temporary_file() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "brand-new.bin");
    let ops = FakeFs::new(Some((Op::Promote, 1)));

    let result = download_with(&target, b"new payload", &ops).await;

    assert!(result.is_err());
    assert!(
        entries(dir.path()).is_empty(),
        "nothing may remain for a target that never existed: {:?}",
        entries(dir.path())
    );
}

#[tokio::test]
async fn a_failed_cleanup_is_reported_with_the_path_instead_of_being_hidden() {
    // The opposite failure of #74: cleaning up is best-effort in the sense that it
    // must not mask the real error, but it must not be *silent* either. A leftover
    // temp file the error does not mention is a file the user cannot account for.
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf");
    tokio::fs::write(&target.path, b"the original bytes")
        .await
        .unwrap();

    // Promotion fails, and so does the cleanup of the temp file.
    let ops = FakeFs::new(Some((Op::Promote, 1)));
    let result = download_with(&target, b"new payload", &FailingRemoval { inner: &ops }).await;

    let error = result.expect_err("the commit cannot succeed");
    assert!(
        error.contains(".terminal-download-tmp"),
        "the error must name the temporary file it could not remove: {error}"
    );
    assert!(
        error.contains("could not be removed"),
        "and must say that removal failed: {error}"
    );
}

/// Wraps a `FakeFs` and fails every removal — used to prove the cleanup failure is
/// surfaced rather than swallowed.
struct FailingRemoval<'a> {
    inner: &'a FakeFs,
}

#[async_trait::async_trait]
impl FileOps for FailingRemoval<'_> {
    async fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        self.inner.rename(from, to).await
    }
    async fn exists(&self, path: &Path) -> bool {
        self.inner.exists(path).await
    }
    async fn remove(&self, _path: &Path) -> std::io::Result<()> {
        Err(std::io::Error::other("injected remove failure"))
    }
}

// ---------------------------------------------------------------------------
// #74 — the Windows fallback restores the original, or says where it is
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_failed_promotion_restores_the_original_and_cleans_up() {
    // The Windows sequence: displace the original, promote, fail, restore. The user
    // ends up exactly where they started — same bytes, same file set.
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf");

    let outcome = drive_windows_fallback(&target, &FailPromoteOnly).await;

    let error = outcome.expect_err("the commit cannot succeed");
    assert!(
        error.contains("could not replace"),
        "the promotion failure is what gets reported: {error}"
    );
    assert_eq!(
        tokio::fs::read(&target.path).await.unwrap(),
        b"the original bytes",
        "the original must be byte-identical after a failed commit"
    );
    assert_eq!(
        entries(dir.path()),
        vec!["report.pdf".to_string()],
        "no backup or temp file may survive a successful restore: {:?}",
        entries(dir.path())
    );
}

#[tokio::test]
async fn a_failed_restore_keeps_the_backup_and_names_it_in_the_error() {
    // The one outcome that must never be silent. The promotion fails *and* putting
    // the original back fails, so the original is only at the backup path. The
    // error has to say so, and the backup must still be there.
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf");

    let outcome = drive_windows_fallback(&target, &FailPromoteAndRestore).await;

    let error = outcome.expect_err("the commit cannot succeed");
    assert!(
        error.contains("could not be restored"),
        "the error must say the restore failed: {error}"
    );
    assert!(
        error.contains(".terminal-download-backup"),
        "the error must name where the original is: {error}"
    );
    assert!(
        tokio::fs::try_exists(&target.backup).await.unwrap(),
        "the backup must be kept — deleting it destroys the only copy"
    );
    assert_eq!(
        tokio::fs::read(&target.backup).await.unwrap(),
        b"the original bytes",
        "and the backup must be the user's original bytes"
    );
    assert!(
        !tokio::fs::try_exists(&target.temp).await.unwrap(),
        "the temporary file is still cleaned up, even here"
    );
    assert!(
        !tokio::fs::try_exists(&target.path).await.unwrap(),
        "the target never received the new bytes: the promotion failed"
    );
}

/// Run the Windows fallback directly: pretend the platform's `rename` refuses to
/// replace, then fail both the promotion and the restore.
async fn drive_windows_fallback(target: &DownloadTarget, ops: &dyn FileOps) -> Result<(), String> {
    // Put the original in place and a temp file with new bytes — the state the
    // receive loop leaves behind when it hands the commit its work.
    tokio::fs::write(&target.path, b"the original bytes")
        .await
        .unwrap();
    tokio::fs::write(&target.temp, b"new payload")
        .await
        .unwrap();
    super::sftp_download::replace_target_as_windows_with(target, ops).await
}

/// Fails the promotion out of the temp file, but lets the restore succeed.
struct FailPromoteOnly;

#[async_trait::async_trait]
impl FileOps for FailPromoteOnly {
    async fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        if from.to_string_lossy().contains(".terminal-download-tmp") {
            return Err(std::io::Error::other("injected promotion failure"));
        }
        tokio::fs::rename(from, to).await
    }
    async fn exists(&self, path: &Path) -> bool {
        tokio::fs::try_exists(path).await.unwrap_or(false)
    }
    async fn remove(&self, path: &Path) -> std::io::Result<()> {
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

/// Fails the promotion out of the temp file *and* the restore from the backup.
struct FailPromoteAndRestore;

#[async_trait::async_trait]
impl FileOps for FailPromoteAndRestore {
    async fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        let from_temp = from
            .file_name()
            .map(|name| name.to_string_lossy().contains(".terminal-download-tmp"))
            .unwrap_or(false);
        if from_temp {
            return Err(std::io::Error::other("injected promotion failure"));
        }
        let to_backup = to
            .file_name()
            .map(|name| name.to_string_lossy().contains(".terminal-download-backup"))
            .unwrap_or(false);
        if to_backup {
            // The displacement itself succeeds; make it real.
            return tokio::fs::rename(from, to).await;
        }
        Err(std::io::Error::other("injected restore failure"))
    }
    async fn exists(&self, path: &Path) -> bool {
        tokio::fs::try_exists(path).await.unwrap_or(false)
    }
    async fn remove(&self, path: &Path) -> std::io::Result<()> {
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

// ---------------------------------------------------------------------------
// #75 — commits to one target serialise
// ---------------------------------------------------------------------------

/// A `FileOps` that pauses after displacing the original, so a second commit can be
/// made to race for the same target at the worst possible moment.
///
/// Deterministic by construction: the first commit announces it reached the pause
/// point and then waits for permission, so the test drives the interleaving instead
/// of sleeping and hoping.
struct PausingAfterDisplace {
    reached: Arc<tokio::sync::Notify>,
    resume: Arc<tokio::sync::Semaphore>,
}

#[async_trait::async_trait]
impl FileOps for PausingAfterDisplace {
    async fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        let displacing = to.to_string_lossy().contains(".terminal-download-backup");
        tokio::fs::rename(from, to).await?;
        if displacing {
            // Announce, then block until the test says go. This is the window in
            // which the original exists only at the backup path.
            self.reached.notify_waiters();
            let _permit = self.resume.acquire().await.expect("resume semaphore");
        }
        Ok(())
    }
    async fn exists(&self, path: &Path) -> bool {
        tokio::fs::try_exists(path).await.unwrap_or(false)
    }
    async fn remove(&self, path: &Path) -> std::io::Result<()> {
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

#[tokio::test]
async fn two_commits_to_one_target_do_not_interleave() {
    // The interleaving #75 describes, made deterministic. A pauses with the original
    // in its backup; B would then see no target, promote its own file, and leave A's
    // restore failing against B's file — stranding the original in backup-A.
    //
    // With the per-target lock, B cannot enter the commit at all until A finishes.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("report.pdf");
    tokio::fs::write(&path, b"the original bytes")
        .await
        .unwrap();

    let a_target = DownloadTarget::new(&path, 1).unwrap();
    let b_target = DownloadTarget::new(&path, 2).unwrap();
    tokio::fs::write(&a_target.temp, b"payload from A")
        .await
        .unwrap();
    tokio::fs::write(&b_target.temp, b"payload from B")
        .await
        .unwrap();

    let reached = Arc::new(tokio::sync::Notify::new());
    let resume = Arc::new(tokio::sync::Semaphore::new(0));
    let pausing = Arc::new(PausingAfterDisplace {
        reached: Arc::clone(&reached),
        resume: Arc::clone(&resume),
    });

    // A enters the commit and parks after displacing the original.
    let a_ops = Arc::clone(&pausing);
    let a_target_task = a_target.clone_paths();
    let a = tokio::spawn(async move {
        super::sftp_download::replace_target_as_windows_with(&a_target_task, a_ops.as_ref()).await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), reached.notified())
        .await
        .expect("A never reached the pause point");

    // B tries to commit the same target. It must block on the lock, not proceed.
    let b_ops = Arc::new(RealFileOps);
    let b_target_task = b_target.clone_paths();
    let b = tokio::spawn(async move {
        super::sftp_download::replace_target_as_windows_with(&b_target_task, b_ops.as_ref()).await
    });
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // B has not touched anything: the target is still absent (A moved it aside) and
    // B's own backup does not exist, which is what would appear if B had entered.
    assert!(
        !tokio::fs::try_exists(&b_target.backup).await.unwrap(),
        "B must not have started its commit while A holds the target lock"
    );
    assert!(
        tokio::fs::try_exists(&a_target.backup).await.unwrap(),
        "A is parked with the original displaced"
    );

    // Let A finish. It promotes its payload and removes its backup.
    resume.add_permits(4);
    a.await.expect("A task").expect("A commit");

    // Then B proceeds and overwrites with its own payload. Last writer wins, which
    // is the only acceptable outcome for two downloads to one path.
    b.await.expect("B task").expect("B commit");

    assert_eq!(
        tokio::fs::read(&path).await.unwrap(),
        b"payload from B",
        "the final target is a complete payload, not a mix"
    );
    assert_eq!(
        entries(dir.path()),
        vec!["report.pdf".to_string()],
        "no temporary or backup file survives either commit: {:?}",
        entries(dir.path())
    );
}

#[tokio::test]
async fn a_failed_commit_does_not_block_the_next_one() {
    // A fails after displacing; the lock must be released so B can commit normally
    // and the original is either restored (A succeeded in restoring) or explicitly
    // reported. Either way B's download succeeds.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("report.pdf");
    tokio::fs::write(&path, b"the original bytes")
        .await
        .unwrap();

    let a_target = DownloadTarget::new(&path, 1).unwrap();
    tokio::fs::write(&a_target.temp, b"payload from A")
        .await
        .unwrap();
    let a = super::sftp_download::replace_target_as_windows_with(&a_target, &FailPromoteOnly).await;
    assert!(a.is_err(), "A's promotion is injected to fail");
    // A's restore succeeded, so the original is back in place.
    assert_eq!(tokio::fs::read(&path).await.unwrap(), b"the original bytes");

    let b_target = DownloadTarget::new(&path, 2).unwrap();
    tokio::fs::write(&b_target.temp, b"payload from B")
        .await
        .unwrap();
    super::sftp_download::replace_target_as_windows_with(&b_target, &RealFileOps)
        .await
        .expect("B's commit must not be blocked by A's failure");

    assert_eq!(tokio::fs::read(&path).await.unwrap(), b"payload from B");
    assert_eq!(entries(dir.path()), vec!["report.pdf".to_string()]);
}

#[tokio::test]
async fn different_targets_commit_concurrently() {
    // The lock is per target, not global: two downloads to different files must not
    // serialise against each other, or a slow disk would make unrelated transfers
    // queue behind one another.
    let dir = tempfile::tempdir().unwrap();
    let a_target = target_for(dir.path(), "a.bin");
    let b_target = target_for(dir.path(), "b.bin");
    tokio::fs::write(&a_target.temp, b"payload A")
        .await
        .unwrap();
    tokio::fs::write(&b_target.temp, b"payload B")
        .await
        .unwrap();

    let (a, b) = tokio::join!(
        super::sftp_download::replace_target_as_windows_with(&a_target, &RealFileOps),
        super::sftp_download::replace_target_as_windows_with(&b_target, &RealFileOps),
    );
    a.expect("A commit");
    b.expect("B commit");

    assert_eq!(tokio::fs::read(&a_target.path).await.unwrap(), b"payload A");
    assert_eq!(tokio::fs::read(&b_target.path).await.unwrap(), b"payload B");
    assert_eq!(
        entries(dir.path()),
        vec!["a.bin".to_string(), "b.bin".to_string()]
    );
}

#[tokio::test]
async fn the_commit_lock_registry_does_not_grow_with_history() {
    // Same bound as the upload side: the registry holds a mutex only while somebody
    // is committing to that path. 100 distinct targets, all settled.
    let dir = tempfile::tempdir().unwrap();
    let registry = super::sftp_download::download_lock_registry();
    let before = registry.tracked();

    for index in 0..100 {
        let target = target_for(dir.path(), &format!("file{index}.bin"));
        tokio::fs::write(&target.temp, b"payload").await.unwrap();
        receive_download_with(
            &target,
            Some(7),
            &mut ChunkReader::ending(vec![b"payload".to_vec()]),
            |_| {},
            FileSink::create(&target.temp).await.expect("sink"),
            &RealFileOps,
        )
        .await
        .expect("download");
    }

    assert!(
        registry.tracked() <= before + 1,
        "100 settled commits grew the registry from {before} to {}",
        registry.tracked()
    );
}

#[tokio::test]
async fn a_queued_commit_keeps_the_lock_entry_alive() {
    // The mirror of the upload-side test: an entry may not be pruned while a second
    // commit is waiting on it. If it were, the waiter would build a fresh mutex and
    // the two commits would stop serialising.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("report.pdf");
    tokio::fs::write(&path, b"the original bytes")
        .await
        .unwrap();

    let a_target = DownloadTarget::new(&path, 1).unwrap();
    tokio::fs::write(&a_target.temp, b"payload A")
        .await
        .unwrap();
    let reached = Arc::new(tokio::sync::Notify::new());
    let resume = Arc::new(tokio::sync::Semaphore::new(0));
    let pausing = Arc::new(PausingAfterDisplace {
        reached: Arc::clone(&reached),
        resume: Arc::clone(&resume),
    });

    let a_ops = Arc::clone(&pausing);
    let a_paths = a_target.clone_paths();
    let a = tokio::spawn(async move {
        super::sftp_download::replace_target_as_windows_with(&a_paths, a_ops.as_ref()).await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), reached.notified())
        .await
        .expect("A never reached the pause point");

    let key = a_target.lock_key_for_tests().await;
    let registry = super::sftp_download::download_lock_registry();
    assert!(
        registry.is_registered(&key),
        "the entry must exist while a commit holds it"
    );

    let b_target = DownloadTarget::new(&path, 2).unwrap();
    tokio::fs::write(&b_target.temp, b"payload B")
        .await
        .unwrap();
    let b = tokio::spawn(async move {
        super::sftp_download::replace_target_as_windows_with(&b_target, &RealFileOps).await
    });
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;

    assert!(
        registry.is_registered(&key),
        "the entry must survive while a second commit is queued on it"
    );

    resume.add_permits(4);
    a.await.expect("A task").expect("A commit");
    b.await.expect("B task").expect("B commit");
}
