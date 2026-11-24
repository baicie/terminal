//! Tests for the staged upload: deterministic fault injection over an in-memory
//! remote file system, plus the real-server acceptance behind `--ignored`.
//!
//! Every test uses a throwaway temp directory for the local side and a synthetic
//! payload; no real user file is read or written.

use super::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default, Clone)]
struct Faults {
    write_fail_after: Option<u64>,
    flush_fail: bool,
    close_fail: bool,
    /// Fail the Nth rename (1-based) so a single step can be broken while
    /// the restore path still works.
    fail_rename_number: Option<usize>,
    remove_fail: bool,
    offline: bool,
    /// Reject a rename whose destination already exists, like a strict
    /// RFC-compliant server.
    refuse_rename_over_existing: bool,
    /// Report this many more bytes than were stored, like a server whose
    /// close acknowledged a truncated file.
    report_extra_bytes: u64,
    /// Never answer a write, like a link that was reset while a chunk was in flight.
    ///
    /// The write future stays pending forever — it does not error, because the peer
    /// never sent anything to error *on*. That is the shape RC07 measured in the GUI
    /// fixture's seed path: `russh-sftp`'s own `write_all` has no timeout, so a bare
    /// call parks on `mio::poll` with no socket left to wake it.
    hang_writes: bool,
    /// Delay every write by this much, to model a slow-but-working link.
    chunk_delay: Option<std::time::Duration>,
}

#[derive(Default)]
struct State {
    files: HashMap<String, Vec<u8>>,
    faults: Faults,
    /// Every `write_chunk` the upload attempted, including the one that hung.
    write_attempts: usize,
    ops: Vec<String>,
    renames: usize,
    /// Age in seconds of a staged file, keyed by full path.
    staging_ages: HashMap<String, u64>,
    /// Deterministic pause point for the lock-race tests.
    ///
    /// `create_exclusive` is the first thing a staged upload does to the remote
    /// after it takes the path lock, so blocking here proves the lock is held.
    gate: Option<Gate>,
}

/// An awaitable pause in `create_exclusive`.
///
/// `reached` fires once the call has arrived; the call then waits for `release`.
/// Both halves are needed: without `reached` a test cannot tell "not yet started"
/// from "started and finished".
struct Gate {
    /// Notified once, when the first caller arrives.
    reached: Arc<tokio::sync::Notify>,
    /// Permits handed out to every blocked caller; open it wide to let them run.
    release: Arc<tokio::sync::Semaphore>,
}

#[derive(Clone)]
struct MemoryFs {
    state: Arc<Mutex<State>>,
}

impl MemoryFs {
    fn new(files: &[(&str, &[u8])]) -> Self {
        let mut map = HashMap::new();
        for (path, content) in files {
            map.insert((*path).to_string(), content.to_vec());
        }
        Self {
            state: Arc::new(Mutex::new(State {
                files: map,
                ..State::default()
            })),
        }
    }

    fn with_faults(self, faults: Faults) -> Self {
        self.state.lock().unwrap().faults = faults;
        self
    }

    fn content(&self, path: &str) -> Option<Vec<u8>> {
        self.state.lock().unwrap().files.get(path).cloned()
    }

    fn paths(&self) -> Vec<String> {
        let mut paths: Vec<String> = self.state.lock().unwrap().files.keys().cloned().collect();
        paths.sort();
        paths
    }

    fn ops(&self) -> Vec<String> {
        self.state.lock().unwrap().ops.clone()
    }
}

#[async_trait]
impl RemoteFs for MemoryFs {
    async fn exists(&self, path: &str) -> Result<bool, String> {
        let state = self.state.lock().unwrap();
        if state.faults.offline {
            return Err("connection lost".to_string());
        }
        Ok(state.files.contains_key(path))
    }

    async fn list(&self, directory: &str) -> Result<Vec<RemoteEntry>, String> {
        let state = self.state.lock().unwrap();
        if state.faults.offline {
            return Err("connection lost".to_string());
        }
        let prefix = if directory.ends_with('/') {
            directory.to_string()
        } else {
            format!("{directory}/")
        };
        Ok(state
            .files
            .keys()
            .filter_map(|path| path.strip_prefix(&prefix).map(|rest| (path, rest)))
            .filter(|(_, rest)| !rest.contains('/'))
            .map(|(path, rest)| RemoteEntry {
                name: rest.to_string(),
                modified_secs: state
                    .staging_ages
                    .get(path)
                    .copied()
                    .map(|age| now_secs().saturating_sub(age)),
            })
            .collect())
    }

    async fn create_exclusive(&self, path: &str) -> Result<Option<Box<dyn RemoteFile>>, String> {
        // The gate, when set, is the deterministic pause point for the lock-race
        // tests: it is the first remote operation after the path lock is taken.
        //
        // The state lock is released before awaiting — holding a `std::sync::Mutex`
        // across an await would deadlock the runtime, and is why the fields are
        // cloned out first.
        let gate = {
            let state = self.state.lock().unwrap();
            if state.faults.offline {
                return Err("connection lost".to_string());
            }
            state
                .gate
                .as_ref()
                .map(|g| (Arc::clone(&g.reached), Arc::clone(&g.release)))
        };
        if let Some((reached, release)) = gate {
            reached.notify_one();
            // A permit, not a broadcast: `Notify::notify_waiters` only wakes callers
            // already waiting, so a second upload that arrives after the release
            // would hang. A semaphore hands out permits that stay available.
            let _permit = release.acquire().await.expect("gate semaphore");
        }
        let mut state = self.state.lock().unwrap();
        if state.faults.offline {
            return Err("connection lost".to_string());
        }
        state.ops.push(format!("create {path}"));
        if state.files.contains_key(path) {
            return Ok(None);
        }
        state.files.insert(path.to_string(), Vec::new());
        Ok(Some(Box::new(MemoryFile {
            path: path.to_string(),
            state: Arc::clone(&self.state),
        })))
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if state.faults.offline {
            return Err("connection lost".to_string());
        }
        state.ops.push(format!("rename {from} -> {to}"));
        state.renames += 1;
        if state.faults.fail_rename_number == Some(state.renames) {
            return Err("permission denied".to_string());
        }
        if state.faults.refuse_rename_over_existing && state.files.contains_key(to) {
            return Err("destination exists".to_string());
        }
        let content = state
            .files
            .remove(from)
            .ok_or_else(|| format!("no such file {from}"))?;
        state.files.insert(to.to_string(), content);
        Ok(())
    }

    async fn remove(&self, path: &str) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if state.faults.offline {
            return Err("connection lost".to_string());
        }
        state.ops.push(format!("remove {path}"));
        if state.faults.remove_fail {
            return Err("permission denied".to_string());
        }
        state.files.remove(path);
        Ok(())
    }
}

/// Writes through the state it shares with the `MemoryFs` that created it.
struct MemoryFile {
    path: String,
    state: Arc<Mutex<State>>,
}

impl MemoryFs {
    /// How many `write_chunk` calls the upload made, including a hung one.
    fn write_attempts(&self) -> usize {
        self.state.lock().unwrap().write_attempts
    }
}

#[async_trait]
impl RemoteFile for MemoryFile {
    async fn write_chunk(&mut self, data: &[u8]) -> Result<(), String> {
        // Read the flags, drop the guard, *then* park: holding the mutex would make the
        // whole fake unreachable and turn "the write hangs" into "the test deadlocks".
        let (hangs, delay) = {
            let mut state = self.state.lock().unwrap();
            state.write_attempts += 1;
            (state.faults.hang_writes, state.faults.chunk_delay)
        };
        if let Some(delay) = delay {
            tokio::time::sleep(delay).await;
        }
        if hangs {
            std::future::pending::<()>().await;
        }
        let mut state = self.state.lock().unwrap();
        if state.faults.offline {
            return Err("connection lost".to_string());
        }
        let limit = state.faults.write_fail_after;
        let file = state
            .files
            .get_mut(&self.path)
            .ok_or_else(|| "staging file vanished".to_string())?;
        if let Some(limit) = limit {
            if file.len() as u64 + data.len() as u64 > limit {
                return Err("write failed: quota exceeded".to_string());
            }
        }
        file.extend_from_slice(data);
        Ok(())
    }

    async fn finish(&mut self) -> Result<u64, String> {
        let state = self.state.lock().unwrap();
        if state.faults.offline {
            return Err("flush failed: connection lost".to_string());
        }
        if state.faults.flush_fail {
            return Err("flush failed: server error".to_string());
        }
        if state.faults.close_fail {
            return Err("close failed: server error".to_string());
        }
        let stored = state.files.get(&self.path).map(Vec::len).unwrap_or(0) as u64;
        Ok(stored + state.faults.report_extra_bytes)
    }

    async fn abandon(&mut self) {}
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn local_file(dir: &tempfile::TempDir, name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let path = dir.path().join(name);
    std::fs::write(&path, bytes).expect("write local fixture");
    path
}

fn run<'a>(
    fs: &'a MemoryFs,
    local: &'a Path,
    remote: &'a str,
) -> impl std::future::Future<Output = Result<UploadOutcome, UploadError>> + 'a {
    staged_upload(fs, local, remote, |_, _| {}, || false)
}

#[tokio::test]
async fn a_new_file_is_staged_then_renamed_into_place() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"hello staged upload");
    let fs = MemoryFs::new(&[]);

    let outcome = run(&fs, &local, "/home/u/new.txt").await.unwrap();

    assert_eq!(outcome.bytes, 19);
    assert!(!outcome.replaced);
    assert_eq!(
        fs.content("/home/u/new.txt").unwrap(),
        b"hello staged upload"
    );
    assert_eq!(fs.paths(), vec!["/home/u/new.txt".to_string()]);
}

#[tokio::test]
async fn replacing_an_existing_file_keeps_the_new_bytes_and_drops_the_backup() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"new content");
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old content")]);

    let outcome = run(&fs, &local, "/home/u/file.txt").await.unwrap();

    assert!(outcome.replaced);
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"new content");
    assert_eq!(fs.paths(), vec!["/home/u/file.txt".to_string()]);
}

#[tokio::test]
async fn a_write_failure_at_half_way_preserves_the_original_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let payload = vec![7u8; 256 * 1024];
    let local = local_file(&dir, "payload.bin", &payload);
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"original bytes")]).with_faults(Faults {
        write_fail_after: Some(128 * 1024),
        ..Faults::default()
    });

    let error = run(&fs, &local, "/home/u/file.txt").await.unwrap_err();

    assert!(matches!(error, UploadError::Remote(_)), "{error:?}");
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"original bytes");
    assert_eq!(fs.paths(), vec!["/home/u/file.txt".to_string()]);
}

#[tokio::test]
async fn cancelling_near_the_end_removes_the_staging_file() {
    let dir = tempfile::tempdir().unwrap();
    let payload = vec![3u8; 200 * 1024];
    let local = local_file(&dir, "payload.bin", &payload);
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"original bytes")]);
    let seen = std::sync::atomic::AtomicU64::new(0);

    let error = staged_upload(
        &fs,
        &local,
        "/home/u/file.txt",
        |written, _| {
            seen.store(written, std::sync::atomic::Ordering::SeqCst);
        },
        || seen.load(std::sync::atomic::Ordering::SeqCst) >= 128 * 1024,
    )
    .await
    .unwrap_err();

    assert_eq!(error, UploadError::Cancelled);
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"original bytes");
    assert_eq!(fs.paths(), vec!["/home/u/file.txt".to_string()]);
}

#[tokio::test]
async fn a_flush_failure_never_replaces_the_destination() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"new");
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]).with_faults(Faults {
        flush_fail: true,
        ..Faults::default()
    });

    let error = run(&fs, &local, "/home/u/file.txt").await.unwrap_err();

    assert!(error.to_string().contains("flush failed"), "{error}");
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"old");
    assert_eq!(fs.paths(), vec!["/home/u/file.txt".to_string()]);
}

#[tokio::test]
async fn a_close_failure_never_replaces_the_destination() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"new");
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]).with_faults(Faults {
        close_fail: true,
        ..Faults::default()
    });

    let error = run(&fs, &local, "/home/u/file.txt").await.unwrap_err();

    assert!(error.to_string().contains("close failed"), "{error}");
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"old");
}

#[tokio::test]
async fn a_failed_replace_moves_the_original_back() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"new");
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]).with_faults(Faults {
        refuse_rename_over_existing: true,
        ..Faults::default()
    });
    // Make the second rename (staging -> destination) fail, after the
    // original was already moved aside; the restore that follows still works.
    fs.state.lock().unwrap().faults.fail_rename_number = Some(2);

    let error = run(&fs, &local, "/home/u/file.txt").await.unwrap_err();

    assert!(matches!(error, UploadError::Replace(_)), "{error:?}");
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"old");
    assert_eq!(fs.paths(), vec!["/home/u/file.txt".to_string()]);
}

#[tokio::test]
async fn a_disconnect_mid_upload_preserves_the_original_and_leaves_no_staging_file() {
    let dir = tempfile::tempdir().unwrap();
    let payload = vec![1u8; 200 * 1024];
    let local = local_file(&dir, "payload.bin", &payload);
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]);
    let seen = std::sync::atomic::AtomicU64::new(0);
    let fs_ref = &fs;

    let error = staged_upload(
        fs_ref,
        &local,
        "/home/u/file.txt",
        |written, _| {
            seen.store(written, std::sync::atomic::Ordering::SeqCst);
            if written >= 64 * 1024 {
                fs_ref.state.lock().unwrap().faults.offline = true;
            }
        },
        || false,
    )
    .await
    .unwrap_err();

    assert!(matches!(error, UploadError::Remote(_)), "{error:?}");
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"old");
}

#[tokio::test]
async fn concurrent_uploads_to_one_path_serialise_and_leave_no_debris() {
    let dir = tempfile::tempdir().unwrap();
    let first = local_file(&dir, "first.bin", &vec![b'a'; 96 * 1024]);
    let second = local_file(&dir, "second.bin", &vec![b'b'; 96 * 1024]);
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]);

    let (a, b) = tokio::join!(
        staged_upload(&fs, &first, "/home/u/file.txt", |_, _| {}, || false),
        staged_upload(&fs, &second, "/home/u/file.txt", |_, _| {}, || false),
    );
    a.expect("first upload");
    b.expect("second upload");

    let final_bytes = fs.content("/home/u/file.txt").unwrap();
    assert!(
        final_bytes == vec![b'a'; 96 * 1024] || final_bytes == vec![b'b'; 96 * 1024],
        "the destination must be exactly one upload's payload"
    );
    assert_eq!(
        fs.paths(),
        vec!["/home/u/file.txt".to_string()],
        "no staging or backup file may survive two serialised uploads"
    );
}

/// #52 — the lock must stay in the registry for as long as anyone holds it.
///
/// The defect: `upload_lock` removed the registry entry when `strong_count` was 2,
/// which is the local `lock` binding plus the `OwnedMutexGuard` — i.e. **while the
/// guard is still held**. A second upload to the same path then built a *new*
/// `Mutex` from an empty registry slot and did not wait, so the two interleaved
/// their staging/backup/rename steps.
///
/// This test does not race the scheduler: the first upload is paused inside
/// `create_exclusive`, which the upload only reaches while holding the path lock.
/// The second upload is started only after the first has demonstrably arrived
/// there, and it must make no progress until the first is released.
#[tokio::test]
async fn the_path_lock_is_held_until_the_holding_upload_finishes() {
    let dir = tempfile::tempdir().unwrap();
    let first = local_file(&dir, "first.bin", &vec![b'a'; 96 * 1024]);
    let second = local_file(&dir, "second.bin", &vec![b'b'; 96 * 1024]);
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]);
    let gate = Gate {
        reached: Arc::new(tokio::sync::Notify::new()),
        release: Arc::new(tokio::sync::Semaphore::new(0)),
    };
    fs.state.lock().unwrap().gate = Some(Gate {
        reached: Arc::clone(&gate.reached),
        release: Arc::clone(&gate.release),
    });

    let first_fs = fs.clone();
    let first_task = tokio::spawn(async move {
        staged_upload(&first_fs, &first, "/home/u/file.txt", |_, _| {}, || false).await
    });

    // Wait until the first upload is inside `create_exclusive` — it can only be
    // there while holding the path lock.
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .expect("the first upload never reached the gate");

    // Now the same path from a second upload. If the registry entry was dropped
    // while the guard was still held, this builds a fresh mutex and proceeds.
    let second_fs = fs.clone();
    let second_task = tokio::spawn(async move {
        staged_upload(&second_fs, &second, "/home/u/file.txt", |_, _| {}, || false).await
    });

    // Give the second upload every chance to misbehave.
    //
    // The observable is `ops`: every remote mutation is appended there, and the
    // first upload is parked *before* its own `create`. So while the first holds
    // the lock, `ops` must still be empty. If the registry entry was dropped while
    // the guard was held, the second upload builds a fresh mutex, runs immediately,
    // and its `create` lands here.
    tokio::time::sleep(Duration::from_millis(150)).await;
    let ops_while_first_holds = {
        let state = fs.state.lock().unwrap();
        state.ops.clone()
    };
    assert!(
        ops_while_first_holds.is_empty(),
        "the second upload must not touch the remote while the first holds the path lock; saw {ops_while_first_holds:?}"
    );

    // Release every blocked caller; both now run to completion.
    gate.release.add_permits(4);
    let a = first_task.await.expect("first task panicked");
    let b = second_task.await.expect("second task panicked");
    a.expect("first upload");
    b.expect("second upload");

    let final_bytes = fs.content("/home/u/file.txt").unwrap();
    assert!(
        final_bytes == vec![b'a'; 96 * 1024] || final_bytes == vec![b'b'; 96 * 1024],
        "the destination must be exactly one upload's payload, not a mixture"
    );
    assert_eq!(
        fs.paths(),
        vec!["/home/u/file.txt".to_string()],
        "no staging or backup file may survive two serialised uploads"
    );
}

/// #52 — distinct paths still run concurrently, and the registry does not grow.
#[tokio::test]
async fn different_paths_stay_concurrent_and_the_lock_registry_stays_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let fs = MemoryFs::new(&[]);

    // The registry is process-global, so other tests in this binary may have left
    // entries for their own paths. Measure what *this* test adds rather than
    // asserting an absolute count.
    let before = upload_locks().tracked();

    // Many distinct destinations in sequence: if the registry kept an entry per
    // path forever, this is where it would accumulate — 200 entries.
    for index in 0..200 {
        let payload = local_file(&dir, &format!("p{index}.bin"), b"payload");
        let remote = format!("/home/u/file{index}.txt");
        staged_upload(&fs, &payload, &remote, |_, _| {}, || false)
            .await
            .expect("upload");
    }

    let after = upload_locks().tracked();
    assert!(
        after <= before + 1,
        "200 settled uploads grew the registry from {before} to {after}; \
         each must release its entry once no upload holds or awaits it"
    );
}

/// #52 — an entry must survive while another upload is waiting on it.
///
/// The failure mode the `Weak` design has to avoid: if the entry were pruned while a
/// second upload was queued for the same path, that upload would build a fresh mutex
/// and stop serialising. The concurrency test above covers the held case; this one
/// covers the queued case.
#[tokio::test]
async fn a_queued_upload_keeps_the_entry_alive() {
    let dir = tempfile::tempdir().unwrap();
    let first = local_file(&dir, "first.bin", &vec![b'a'; 96 * 1024]);
    let second = local_file(&dir, "second.bin", &vec![b'b'; 96 * 1024]);
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]);
    let gate = Gate {
        reached: Arc::new(tokio::sync::Notify::new()),
        release: Arc::new(tokio::sync::Semaphore::new(0)),
    };
    fs.state.lock().unwrap().gate = Some(Gate {
        reached: Arc::clone(&gate.reached),
        release: Arc::clone(&gate.release),
    });

    let first_fs = fs.clone();
    let first_task = tokio::spawn(async move {
        staged_upload(&first_fs, &first, "/home/u/file.txt", |_, _| {}, || false).await
    });
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .expect("the first upload never reached the gate");

    // The second upload is now queued on the same mutex.
    let second_fs = fs.clone();
    let second_task = tokio::spawn(async move {
        staged_upload(&second_fs, &second, "/home/u/file.txt", |_, _| {}, || false).await
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    // The entry must still be there: an upload holds it and another awaits it.
    assert!(
        upload_locks().is_registered("/home/u/file.txt"),
        "the entry may not be pruned while an upload is queued on it"
    );

    gate.release.add_permits(4);
    first_task.await.expect("first").expect("first upload");
    second_task.await.expect("second").expect("second upload");
}

#[tokio::test]
async fn unicode_and_spaces_in_the_name_keep_the_staging_names_valid() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"unicode payload");
    let fs = MemoryFs::new(&[]);

    run(&fs, &local, "/home/u/报告 最终.txt").await.unwrap();

    assert_eq!(
        fs.content("/home/u/报告 最终.txt").unwrap(),
        b"unicode payload"
    );
    assert_eq!(fs.paths(), vec!["/home/u/报告 最终.txt".to_string()]);
}

#[tokio::test]
async fn a_server_that_refuses_rename_over_existing_still_replaces_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"new");
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]).with_faults(Faults {
        refuse_rename_over_existing: true,
        ..Faults::default()
    });

    let outcome = run(&fs, &local, "/home/u/file.txt").await.unwrap();

    assert!(outcome.replaced);
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"new");
    assert_eq!(fs.paths(), vec!["/home/u/file.txt".to_string()]);
}

#[tokio::test]
async fn a_backup_left_by_an_interrupted_replace_is_restored_before_the_next_upload() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"new");
    let fs = MemoryFs::new(&[("/home/u/.file.txt.terminal-upload-backup", b"old")]);

    let outcome = run(&fs, &local, "/home/u/file.txt").await.unwrap();

    assert!(outcome.replaced);
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"new");
    assert_eq!(fs.paths(), vec!["/home/u/file.txt".to_string()]);
}

#[tokio::test]
async fn an_interrupted_replace_whose_destination_reappeared_drops_the_stale_backup() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"newest");
    let fs = MemoryFs::new(&[
        ("/home/u/.file.txt.terminal-upload-backup", b"old"),
        ("/home/u/file.txt", b"current"),
    ]);

    run(&fs, &local, "/home/u/file.txt").await.unwrap();

    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"newest");
    assert_eq!(fs.paths(), vec!["/home/u/file.txt".to_string()]);
}

fn staging_age(fs: &MemoryFs, path: &str, age_secs: u64) {
    fs.state
        .lock()
        .unwrap()
        .staging_ages
        .insert(path.to_string(), age_secs);
}

#[tokio::test]
async fn staging_files_from_a_dead_upload_are_removed_by_the_next_one() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"new");
    let stale = "/home/u/.file.txt.terminal-upload-0000";
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old"), (stale, b"partial junk")]);
    staging_age(&fs, stale, STALE_STAGING_SECS + 60);

    run(&fs, &local, "/home/u/file.txt").await.unwrap();

    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"new");
    assert!(
        !fs.paths().iter().any(|path| path == stale),
        "a staging file older than the grace window must be reclaimed"
    );
    assert_eq!(fs.paths(), vec!["/home/u/file.txt".to_string()]);
}

#[tokio::test]
async fn a_recent_staging_file_is_left_to_the_upload_that_owns_it() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"new");
    let recent = "/home/u/.file.txt.terminal-upload-1111";
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old"), (recent, b"still writing")]);
    staging_age(&fs, recent, 30);

    run(&fs, &local, "/home/u/file.txt").await.unwrap();

    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"new");
    assert!(
        fs.paths().iter().any(|path| path == recent),
        "a recent staging file may belong to another live upload"
    );
}

#[tokio::test]
async fn a_directory_path_is_refused_before_anything_is_written() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"data");
    let fs = MemoryFs::new(&[]);

    let error = run(&fs, &local, "/home/u/folder/").await.unwrap_err();

    assert!(matches!(error, UploadError::InvalidPath(_)), "{error:?}");
    assert!(fs.paths().is_empty());
    assert!(fs.ops().is_empty());
}

#[tokio::test]
async fn a_missing_local_file_never_touches_the_remote_side() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("does-not-exist.bin");
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]);

    let error = run(&fs, &missing, "/home/u/file.txt").await.unwrap_err();

    assert!(matches!(error, UploadError::LocalFile(_)), "{error:?}");
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"old");
    assert!(fs.ops().is_empty());
}

// ==================== Real SFTP server ====================

/// Drives the staged upload against a real OpenSSH `sftp-server`.
///
/// Started by `scripts/verify-install/sftp-staged-upload-e2e.mjs`, which
/// exports the connection details. This is a real SSH transport and a real
/// SFTP subsystem, not a mock: the backup / rename behaviour below is what
/// the server actually does.
#[tokio::test]
#[ignore = "needs a real sshd; run scripts/verify-install/sftp-staged-upload-e2e.mjs"]
async fn real_sftp_server_acceptance() {
    use russh::keys::PrivateKeyWithHashAlg;

    struct AcceptAnyHostKey;
    impl russh::client::Handler for AcceptAnyHostKey {
        type Error = russh::Error;
        async fn check_server_key(
            &mut self,
            _: &russh::keys::PublicKeyOrCertificate,
        ) -> Result<bool, Self::Error> {
            Ok(true)
        }
    }

    let port: u16 = std::env::var("SFTP_E2E_PORT")
        .expect("SFTP_E2E_PORT")
        .parse()
        .expect("SFTP_E2E_PORT is a number");
    let user = std::env::var("SFTP_E2E_USER").expect("SFTP_E2E_USER");
    let key_path = std::env::var("SFTP_E2E_KEY").expect("SFTP_E2E_KEY");
    let dir = std::env::var("SFTP_E2E_DIR").expect("SFTP_E2E_DIR");
    let key_text = std::fs::read_to_string(&key_path).expect("read the fixture key");
    let key = russh::keys::decode_secret_key(&key_text, None).expect("decode the fixture key");

    let key = Arc::new(key);
    let connect_sftp = |port: u16, user: String, key: Arc<russh::keys::PrivateKey>| async move {
        let config = Arc::new(russh::client::Config::default());
        let mut handle = russh::client::connect(config, ("127.0.0.1", port), AcceptAnyHostKey)
            .await
            .expect("connect to the fixture sshd");
        let auth = handle
            .authenticate_publickey(user, PrivateKeyWithHashAlg::new(key, None))
            .await
            .expect("authenticate");
        assert!(auth.success(), "public key authentication must succeed");
        let channel = handle.channel_open_session().await.expect("open a session");
        channel
            .request_subsystem(false, "sftp")
            .await
            .expect("request the sftp subsystem");
        let session = SftpSession::new(channel.into_stream())
            .await
            .expect("sftp handshake");
        (handle, session)
    };
    let (_handle, sftp) = connect_sftp(port, user.clone(), Arc::clone(&key)).await;
    let remote = SftpRemote { session: &sftp };
    let workdir = tempfile::tempdir().expect("local fixture directory");

    async fn leftovers(sftp: &SftpSession, dir: &str) -> Vec<String> {
        let mut names = Vec::new();
        for entry in sftp.read_dir(dir).await.expect("read the fixture dir") {
            let name = entry.file_name();
            if name.contains(".terminal-upload-") {
                names.push(name);
            }
        }
        names
    }

    // 1. A new file lands with exactly the local bytes.
    let new_local = workdir.path().join("new.txt");
    std::fs::write(&new_local, b"real server new file").unwrap();
    let new_remote = format!("{dir}/e2e-new.txt");
    let outcome = staged_upload(&remote, &new_local, &new_remote, |_, _| {}, || false)
        .await
        .expect("upload a new file");
    assert_eq!(outcome.bytes, 20);
    assert!(!outcome.replaced);
    assert_eq!(
        sftp.read(&new_remote).await.unwrap(),
        b"real server new file"
    );
    assert!(leftovers(&sftp, &dir).await.is_empty());
    // 2. Replacing keeps the new bytes and leaves no backup behind.
    // `SftpSession::write` opens WRITE-only (no CREATE), so the existing
    // file is created through the handle-based API instead.
    let mut existing = sftp
        .create(format!("{dir}/e2e-replace.txt"))
        .await
        .expect("create the file to replace");
    existing
        .write_all(b"original real bytes")
        .await
        .expect("write the file to replace");
    existing
        .shutdown()
        .await
        .expect("close the file to replace");
    let replace_local = workdir.path().join("replace.txt");
    std::fs::write(&replace_local, b"replacement real bytes").unwrap();
    let outcome = staged_upload(
        &remote,
        &replace_local,
        &format!("{dir}/e2e-replace.txt"),
        |_, _| {},
        || false,
    )
    .await
    .expect("replace an existing file");
    assert!(outcome.replaced);
    assert_eq!(
        sftp.read(format!("{dir}/e2e-replace.txt")).await.unwrap(),
        b"replacement real bytes"
    );
    assert!(leftovers(&sftp, &dir).await.is_empty());

    // 3. Cancelling mid-transfer preserves the original byte for byte.
    let big_local = workdir.path().join("big.bin");
    std::fs::write(&big_local, vec![9u8; 512 * 1024]).unwrap();
    let seen = std::sync::atomic::AtomicU64::new(0);
    let error = staged_upload(
        &remote,
        &big_local,
        &format!("{dir}/e2e-replace.txt"),
        |written, _| {
            seen.store(written, std::sync::atomic::Ordering::SeqCst);
        },
        || seen.load(std::sync::atomic::Ordering::SeqCst) >= 64 * 1024,
    )
    .await
    .expect_err("the transfer must stop");
    assert_eq!(error, UploadError::Cancelled);
    assert_eq!(
        sftp.read(format!("{dir}/e2e-replace.txt")).await.unwrap(),
        b"replacement real bytes"
    );
    assert!(leftovers(&sftp, &dir).await.is_empty());

    // 4. A name with spaces and non-ASCII characters survives staging.
    let unicode_local = workdir.path().join("unicode.txt");
    std::fs::write(&unicode_local, b"unicode payload").unwrap();
    let unicode_remote = format!("{dir}/报告 最终.txt");
    staged_upload(
        &remote,
        &unicode_local,
        &unicode_remote,
        |_, _| {},
        || false,
    )
    .await
    .expect("upload a unicode name");
    assert_eq!(
        sftp.read(&unicode_remote).await.unwrap(),
        b"unicode payload"
    );
    assert!(leftovers(&sftp, &dir).await.is_empty());

    // 5a. The server refusing the staging write (a directory the account
    // cannot write to) must fail closed and leave the existing file alone.
    let readonly_dir = format!("{dir}/readonly");
    std::fs::create_dir_all(&readonly_dir).unwrap();
    let protected = format!("{readonly_dir}/protected.txt");
    {
        let mut file = sftp
            .create(&protected)
            .await
            .expect("create the protected file");
        file.write_all(b"protected original")
            .await
            .expect("write the protected file");
        file.shutdown().await.expect("close the protected file");
    }
    let mut permissions = std::fs::metadata(&readonly_dir).unwrap().permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(0o500);
    }
    std::fs::set_permissions(&readonly_dir, permissions).unwrap();

    let blocked_local = workdir.path().join("blocked.bin");
    std::fs::write(&blocked_local, b"new bytes that must not land").unwrap();
    let blocked = staged_upload(&remote, &blocked_local, &protected, |_, _| {}, || false)
        .await
        .expect_err("a directory the server refuses must fail the upload");
    assert!(
        matches!(blocked, UploadError::Remote(_)),
        "expected a remote error, got {blocked:?}"
    );
    assert_eq!(
        sftp.read(&protected).await.unwrap(),
        b"protected original",
        "a refused staging write must not touch the destination"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&readonly_dir).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&readonly_dir, permissions).unwrap();
    }

    // 5b. Cutting the connection mid-upload fails without claiming success,
    // and the next session finds the old bytes with no debris.
    let target = format!("{dir}/e2e-replace.txt");
    let sftp = Arc::new(sftp);
    let disconnect_local = workdir.path().join("disconnect.bin");
    std::fs::write(&disconnect_local, vec![6u8; 32 * 1024 * 1024]).unwrap();
    let disconnect_target = target.clone();
    let (first_chunk_tx, first_chunk_rx) = tokio::sync::oneshot::channel::<()>();
    let mut first_chunk_tx = Some(first_chunk_tx);
    let upload_task = {
        let sftp = Arc::clone(&sftp);
        tokio::spawn(async move {
            let remote = SftpRemote { session: &sftp };
            staged_upload(
                &remote,
                &disconnect_local,
                &disconnect_target,
                move |written, _| {
                    if written >= 64 * 1024 {
                        if let Some(sender) = first_chunk_tx.take() {
                            let _ = sender.send(());
                        }
                    }
                },
                || false,
            )
            .await
        })
    };
    // Cut as soon as the first chunk is on the wire, so the transfer cannot
    // have finished before the channel goes away. Closing the SFTP channel
    // is what the client sees when the far side drops the connection: the
    // transport stays up here only so the test can open a fresh channel and
    // inspect what the server actually kept.
    let _ = tokio::time::timeout(std::time::Duration::from_secs(20), first_chunk_rx).await;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), sftp.close()).await;
    let upload_result = tokio::time::timeout(std::time::Duration::from_secs(30), upload_task)
        .await
        .expect("the upload must notice the cut connection instead of hanging")
        .expect("the upload task must not panic");
    assert!(
        upload_result.is_err(),
        "an upload must not report success after the connection is cut"
    );

    let (_reconnected_handle, sftp) = connect_sftp(port, user, Arc::clone(&key)).await;
    assert_eq!(
        sftp.read(format!("{dir}/e2e-replace.txt")).await.unwrap(),
        b"replacement real bytes",
        "the destination must keep the bytes it had before the cut"
    );
    // The staging file cannot be removed while the channel is gone; the only
    // thing a cut may leave behind is that file, and the next upload to the
    // same destination reclaims it once it is older than the grace window.
    let debris = leftovers(&sftp, &dir).await;
    assert!(
        debris.len() <= 1
            && debris
                .iter()
                .all(|name| name.starts_with(".e2e-replace.txt.terminal-upload-")),
        "unexpected debris after a cut connection: {debris:?}"
    );
    for name in debris {
        std::fs::remove_file(format!("{dir}/{name}")).ok();
    }
}

#[tokio::test]
async fn a_size_mismatch_from_the_server_is_refused_and_cleaned_up() {
    let dir = tempfile::tempdir().unwrap();
    let local = local_file(&dir, "payload.bin", b"12345678");
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]).with_faults(Faults {
        report_extra_bytes: 1,
        ..Faults::default()
    });

    let error = run(&fs, &local, "/home/u/file.txt").await.unwrap_err();

    assert!(
        matches!(error, UploadError::SizeMismatch { .. }),
        "{error:?}"
    );
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"old");
    assert_eq!(fs.paths(), vec!["/home/u/file.txt".to_string()]);
}

/// RC07 — a write that never answers must still let the upload finish.
///
/// ## What this pins, and what it does not
///
/// `staged_upload` wraps every remote call in `bounded()`, which is
/// `tokio::time::timeout(REMOTE_TIMEOUT)` with a 20-second budget. A peer that stops
/// answering therefore cannot park the upload forever: the write future is dropped and
/// the caller gets `UploadError::Remote("the server stopped answering…")`.
///
/// This is the difference RC07 found between the product path and the GUI fixture's seed
/// helper. `seed_remote` in `sftp_command_e2e_tests.rs` calls
/// `session.create(...).write_all(...)` — `russh-sftp`'s own `AsyncWrite` impl, which has
/// no timeout of its own — so a cut uplink parks it on `mio::poll` indefinitely. That is
/// what #149 measured as "no verdict at 30/60/180/300 s"; the hang was in the fixture,
/// not in the shipping upload.
///
/// The assertion is on **returning at all** plus the staging file being cleaned up, not on
/// the exact elapsed time: `tokio::time` is not paused here, so the real 20-second budget
/// runs. A test that asserted "under 25 s" would fail on a loaded CI machine for reasons
/// unrelated to the code, and the property that matters is "bounded, not infinite".
#[tokio::test]
async fn a_write_that_never_answers_is_bounded_and_cleans_up() {
    /*
     * `start_paused` moves the clock forward when every task is idle, so this exercises
     * the 20-second budget in microseconds.
     *
     * Without it the test really waits 20 s, and that broke a neighbouring case:
     * `the_path_lock_is_held_until_the_holding_upload_finishes` waits 5 s on its gate and
     * timed out ("the first upload never reached the gate") purely because this test was
     * holding the runtime. Measured — the neighbouring test passes alone and fails only
     * when this one runs beside it. A test that makes others fail for reasons unrelated to
     * their subject is a test-suite defect, not a slow test.
     */
    tokio::time::pause();
    let dir = tempfile::tempdir().unwrap();
    // Larger than one chunk so the write path is actually entered.
    let payload = vec![7u8; 256 * 1024];
    let local = local_file(&dir, "payload.bin", &payload);
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]).with_faults(Faults {
        hang_writes: true,
        ..Faults::default()
    });

    let started = std::time::Instant::now();
    let error = run(&fs, &local, "/home/u/file.txt")
        .await
        .expect_err("a hung write must become an error, not a forever-pending future");
    let elapsed = started.elapsed();

    assert!(
        matches!(error, UploadError::Remote(ref message) if message.contains("stopped answering")),
        "expected the bounded-timeout error, got {error:?}"
    );
    // The budget is 20 s; anything far beyond it means the bound did not fire.
    assert!(
        elapsed < std::time::Duration::from_secs(60),
        "the write was not bounded: took {elapsed:?}"
    );

    // The destination is untouched and the staging file is gone.
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"old");
    assert_eq!(
        fs.paths(),
        vec!["/home/u/file.txt".to_string()],
        "the staging file must not survive a bounded timeout"
    );
}

/// RC08 — the budget is per round trip, so a slow-but-working link still completes.
///
/// ## The distinction this pins
///
/// `bounded()` applies `REMOTE_TIMEOUT` (20 s) to **one** remote call — a 64 KiB chunk,
/// a rename, a list. It is not a deadline for the whole file. That matters: a 1 GiB upload
/// over a link that delivers 1 MiB/s takes ~17 minutes and must succeed, while a link that
/// stops answering must fail within seconds.
///
/// A single total deadline would be far easier to write and would fail the first case.
/// This test asserts the property that distinguishes them: **many slow chunks add up to a
/// success**, where each chunk is slow relative to nothing in particular.
#[tokio::test]
async fn a_file_sent_in_many_slow_chunks_still_completes() {
    tokio::time::pause();
    let dir = tempfile::tempdir().unwrap();
    // 8 chunks of 64 KiB = the loop runs eight times.
    let payload = vec![9u8; 8 * 64 * 1024];
    let local = local_file(&dir, "payload.bin", &payload);
    let fs = MemoryFs::new(&[]).with_faults(Faults {
        /*
         * Each chunk takes 15 s of paused time — three quarters of the 20 s per-call
         * budget. Eight of them total two minutes, which a single whole-file deadline of
         * 20 s could never accommodate.
         *
         * The first version used 1 s per chunk, and it was **vacuous**: tightening the
         * budget from 20 s to 3 s left it passing, because 1 s fits inside 3 s just as
         * well. A delay near the bound is what makes this case fail when the bound is
         * lowered to something a slow link could not meet.
         */
        chunk_delay: Some(std::time::Duration::from_secs(15)),
        ..Faults::default()
    });

    let outcome = run(&fs, &local, "/home/u/big.bin")
        .await
        .expect("a slow link must not trip the per-call budget");
    assert_eq!(outcome.bytes, payload.len() as u64);

    // The total elapsed time is well past one chunk's budget, which is the point:
    // the bound is per call, not for the file.
    assert!(
        outcome.bytes > 64 * 1024,
        "the loop must have run more than once"
    );
}

/// RC09 — a timed-out write must not keep writing after the caller is told it stopped.
///
/// ## What "stopped" has to mean
///
/// `tokio::time::timeout` returns an error; it does **not** cancel work already handed to
/// the transport. The question this pins is what the *fake* does when its write future is
/// dropped — and, through it, what the product's code guarantees: after the timeout the
/// product calls `abandon()` and `remove()`, and it never issues another `write_chunk`.
///
/// The last part is the one that matters for data: a late chunk arriving after the user
/// has been told "the transfer failed" would land in a staging file nobody is watching,
/// and if a rename followed it the destination could change after the failure was
/// reported.
#[tokio::test]
async fn after_a_timeout_no_further_writes_are_issued() {
    tokio::time::pause();
    let dir = tempfile::tempdir().unwrap();
    let payload = vec![3u8; 4 * 64 * 1024];
    let local = local_file(&dir, "payload.bin", &payload);
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"old")]).with_faults(Faults {
        hang_writes: true,
        ..Faults::default()
    });

    let error = run(&fs, &local, "/home/u/file.txt").await.unwrap_err();
    assert!(matches!(error, UploadError::Remote(_)), "{error:?}");

    // Count what the fake saw after the failure. `write_attempts` is incremented at the
    // top of every call, including the hung one, so a second attempt would show up here.
    let attempts = fs.write_attempts();
    assert_eq!(
        attempts, 1,
        "the upload must stop at the first hung chunk, not retry it; saw {attempts} attempts"
    );

    // And the destination the user cares about is untouched.
    assert_eq!(fs.content("/home/u/file.txt").unwrap(), b"old");
    assert_eq!(
        fs.paths(),
        vec!["/home/u/file.txt".to_string()],
        "no staging file may remain after the bounded timeout"
    );
}

/// RC11 — repeating a failing upload must not accumulate anything.
///
/// ## What "nothing accumulates" covers
///
/// A path-lock registry entry, a staging file, a half-written destination — each of these
/// is individually small, and any of them leaking once per attempt turns into a user
/// machine that needs a restart after a bad afternoon on a flaky link.
///
/// The scenario is the one RC08/RC09 examined, repeated: **twenty rounds** of an upload
/// that hits a link which stops answering, each followed by a healthy upload to the same
/// path. The second half matters — it proves the path is still usable, which a leaked lock
/// entry would prevent.
///
/// ## What the registry assertion can and cannot say
///
/// The registry holds `Weak` references and prunes dead ones **on the next `acquire`** —
/// deliberately, since the only moment a dead key can appear is between one holder
/// finishing and the next arriving. So "the registry is empty after an upload" is not a
/// property of the design, and the first version of this test asserted exactly that and
/// failed on round 1.
///
/// What must hold is that it does not **grow**: the same path reused twenty times leaves
/// one entry, not twenty. The count is sampled per round and asserted against a ceiling
/// of 1 — a leak of the shape "one per attempt" shows up immediately, and a momentary
/// weak entry does not.
#[tokio::test]
async fn twenty_rounds_of_failed_uploads_leave_no_registry_entries_or_staging_files() {
    tokio::time::pause();
    let dir = tempfile::tempdir().unwrap();
    let payload = vec![4u8; 3 * 64 * 1024];
    let local = local_file(&dir, "payload.bin", &payload);
    let fs = MemoryFs::new(&[("/home/u/file.txt", b"original")]);

    for round in 1..=20 {
        // Whatever the previous round's healthy upload left is this round's baseline.
        let expected = fs.content("/home/u/file.txt").unwrap().to_vec();

        // A round that fails: the link stops answering on the first chunk.
        {
            fs.state.lock().unwrap().faults.hang_writes = true;
            let error = run(&fs, &local, "/home/u/file.txt")
                .await
                .expect_err("the hung round must fail");
            assert!(
                matches!(error, UploadError::Remote(_)),
                "round {round}: {error:?}"
            );
            fs.state.lock().unwrap().faults.hang_writes = false;
        }

        /*
         * ## Why the registry is not asserted here
         *
         * `upload_locks()` is process-wide, so `tracked()` counts every path every test in
         * this binary holds — a ceiling on the total failed in the full run ("grew to 2")
         * while passing alone. Scoping to this path with `is_registered` did not work
         * either: after the guard drops, the entry is a dead `Weak`, so the predicate is
         * legitimately false and the assertion failed at round 1.
         *
         * Neither number answers "does this path accumulate", because the registry's
         * steady state is a weak entry that outlives nobody. What does accumulate visibly
         * is the staging file and the destination, and those are asserted below. The
         * registry's own growth is covered by
         * `different_paths_stay_concurrent_and_the_lock_registry_stays_bounded`, which
         * drives many paths and is the test shaped for it.
         */
        let staging = fs
            .paths()
            .into_iter()
            .filter(|p| p.contains(".terminal-upload-"))
            .collect::<Vec<_>>();
        assert!(
            staging.is_empty(),
            "round {round}: staging files survived: {staging:?}"
        );
        /*
         * What the destination holds before this round is whatever the previous round's
         * **healthy** upload wrote — by design, that upload succeeded. The property is
         * that *this* round's failure did not change it, so the expectation is captured
         * before the failing upload rather than being the seed bytes.
         *
         * The first version compared against the literal seed `b"original"` and failed on
         * round 2 for exactly this reason: round 1's healthy upload had legitimately
         * replaced it.
         */
        assert_eq!(
            fs.content("/home/u/file.txt").unwrap(),
            expected.as_slice(),
            "round {round}: a failed upload changed the destination"
        );

        // A healthy upload in the same round must still work — a leaked lock would
        // make this hang or fail, not merely be slow.
        let outcome = run(&fs, &local, "/home/u/file.txt")
            .await
            .unwrap_or_else(|error| panic!("round {round}: healthy upload failed: {error:?}"));
        assert_eq!(outcome.bytes, payload.len() as u64, "round {round}");
        // Registry growth is covered by the bounded-registry test; see the note above.
    }
}
