//! Issue #53 — a failed download must not destroy the file it was replacing.
//!
//! The defect: `sftp_download` used `File::create(&local_path)`, which truncates
//! immediately. A remote read error, a local write error or a flush failure then
//! left the user with a destroyed original and a partial file at the path they
//! chose. The upload path has protected the remote side this way since the staged
//! upload work; the local side did not.
//!
//! These tests drive the real `receive_download` against a real temporary
//! directory. The sink is the production `FileSink` for the success cases, and a
//! failing sink for the fault cases — the point is that the *target* is what gets
//! asserted on, not the sink.

use super::sftp_download::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// A reader over fixed chunks that ends cleanly, or fails after the last one.
///
/// Implements `AsyncRead` rather than a closure so the production call shape is
/// exercised: `receive_download` takes `&mut R where R: AsyncRead`.
struct ChunkReader {
    chunks: std::collections::VecDeque<Vec<u8>>,
    /// When true, running out of chunks is an error rather than EOF.
    fail_at_end: bool,
    /// Bytes handed out from the current head chunk.
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
    async fn abandon(&mut self) {
        let _ = tokio::fs::remove_file(&self.temp).await;
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
    async fn abandon(&mut self) {
        let _ = tokio::fs::remove_file(&self.temp).await;
    }
}

async fn target_for(dir: &std::path::Path, name: &str) -> DownloadTarget {
    DownloadTarget::new(&dir.join(name), 1).expect("target")
}

#[tokio::test]
async fn a_successful_download_replaces_the_target_and_leaves_no_temp() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf").await;
    tokio::fs::write(&target.path, b"old bytes").await.unwrap();

    let payload: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
    // Several chunks, because `receive_download`'s buffer is 64 KiB and a single
    // oversized chunk would be truncated by the reader.
    let chunks: Vec<Vec<u8>> = payload.chunks(48 * 1024).map(<[u8]>::to_vec).collect();
    let sink = FileSink::create(&target.temp).await.expect("sink");
    let mut reader = ChunkReader::ending(chunks);
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
    assert!(
        !tokio::fs::try_exists(&target.temp).await.unwrap(),
        "the temporary file must not survive a successful download"
    );
}

#[tokio::test]
async fn a_remote_read_failure_leaves_the_original_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf").await;
    tokio::fs::write(&target.path, b"the original bytes")
        .await
        .unwrap();

    let sink = FileSink::create(&target.temp).await.expect("sink");
    // One chunk lands, then the server dies.
    let mut reader = ChunkReader::failing(vec![vec![b'x'; 1024]]);
    let result = receive_download(&target, Some(4096), &mut reader, |_| {}, sink).await;

    assert!(
        result.is_err(),
        "a half-read download must not report success"
    );
    assert_eq!(
        tokio::fs::read(&target.path).await.unwrap(),
        b"the original bytes",
        "the original must be byte-identical after a failed download"
    );
    assert!(
        !tokio::fs::try_exists(&target.temp).await.unwrap(),
        "the temporary file must be cleaned up"
    );
}

#[tokio::test]
async fn a_local_write_failure_leaves_the_original_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf").await;
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
}

#[tokio::test]
async fn a_flush_failure_leaves_the_original_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf").await;
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
    let target = target_for(dir.path(), "brand-new.bin").await;
    assert!(!tokio::fs::try_exists(&target.path).await.unwrap());

    let sink = FileSink::create(&target.temp).await.expect("sink");
    let mut reader = ChunkReader::failing(vec![vec![b'x'; 64]]);
    let result = receive_download(&target, Some(4096), &mut reader, |_| {}, sink).await;

    assert!(result.is_err());
    assert!(
        !tokio::fs::try_exists(&target.path).await.unwrap(),
        "a failed download must not leave a partial file at the target"
    );
    let leftovers: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    assert!(
        leftovers.is_empty(),
        "no temporaries may survive: {leftovers:?}"
    );
}

#[tokio::test]
async fn a_short_read_is_an_error_when_the_length_is_known() {
    // The server said 4096 bytes and closed after 1024. Reporting success here is
    // how a truncated download becomes the user's "complete" file.
    let dir = tempfile::tempdir().unwrap();
    let target = target_for(dir.path(), "report.pdf").await;
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
    let target = target_for(dir.path(), "stream.bin").await;

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
}

/// Pins **why** the helper exists, by demonstrating the old failure.
///
/// `File::create` truncates immediately. This test does not exercise the helper at
/// all — it shows what the previous `sftp_download` did to the user's file, so a
/// future refactor that reaches for `File::create` again has a failing test waiting
/// for it rather than a comment nobody reads.
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
    // …and then the transfer fails; the function returns DownloadFailed.
    drop(file);

    let after = tokio::fs::read(&path).await.unwrap();
    assert_eq!(
        after,
        vec![b'x'; 64],
        "File::create truncates on open, so the original is already gone before any \
         byte is written — this is what the temporary file prevents"
    );
}
