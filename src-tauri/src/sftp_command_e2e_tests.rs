//! Issue #57 — command-level E2E against a real OpenSSH server.
//!
//! ## What layer this is, precisely
//!
//! The existing `sftp-roundtrip-live.e2e.test.ts` drives `/usr/bin/sftp`. That proves
//! the OpenSSH SFTP subsystem can move 24 MiB, and it proves nothing about this
//! project's code — the client is the system binary, not `staged_upload` or
//! `receive_download`.
//!
//! These tests drive the **production Rust implementations**:
//!
//!   * `sftp_upload::staged_upload` over `SftpRemote`, which is what
//!     `#[tauri::command] sftp_upload` calls after its argument checks;
//!   * `sftp_download::receive_download` over `russh_sftp::client::fs::File`, which is
//!     what `#[tauri::command] sftp_download` calls.
//!
//! The Tauri command wrapper itself (argument validation, `AppHandle` progress
//! emission) is not exercised — that needs a running app. So this is
//! **command-level**, not GUI-level, and the report says so.
//!
//! ## Why they are `#[ignore]`
//!
//! They need a real sshd with the SFTP subsystem. `scripts/verify-install/sftp-command-e2e.mjs`
//! starts one and sets `SFTP_E2E_*`; running the suite without that script skips them
//! rather than failing, which is the same convention `real_sftp_server_acceptance`
//! already used.
//!
//! Run them with:
//!
//! ```bash
//! node scripts/verify-install/sftp-command-e2e.mjs
//! ```

use super::sftp_download::{receive_download, DownloadSink, DownloadTarget};
use super::sftp_upload::{staged_upload, SftpRemote};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;

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

/// What the fixture script hands over through the environment.
struct Fixture {
    port: u16,
    user: String,
    key: Arc<russh::keys::PrivateKey>,
    /// A directory the fixture user can write to.
    dir: String,
}

impl Fixture {
    /// Read the fixture from the environment, or `None` when it was not started.
    fn from_env() -> Option<Self> {
        let port = std::env::var("SFTP_E2E_PORT").ok()?.parse::<u16>().ok()?;
        let user = std::env::var("SFTP_E2E_USER").ok()?;
        let key_path = std::env::var("SFTP_E2E_KEY").ok()?;
        let dir = std::env::var("SFTP_E2E_DIR").ok()?;
        let key_text = std::fs::read_to_string(&key_path).ok()?;
        let key = russh::keys::decode_secret_key(&key_text, None).ok()?;
        Some(Self {
            port,
            user,
            key: Arc::new(key),
            dir,
        })
    }

    async fn connect(
        &self,
    ) -> (
        russh::client::Handle<AcceptAnyHostKey>,
        russh_sftp::client::SftpSession,
    ) {
        use russh::keys::PrivateKeyWithHashAlg;
        let config = Arc::new(russh::client::Config::default());
        let mut handle = russh::client::connect(config, ("127.0.0.1", self.port), AcceptAnyHostKey)
            .await
            .expect("connect to the fixture sshd");
        let auth = handle
            .authenticate_publickey(
                self.user.clone(),
                PrivateKeyWithHashAlg::new(Arc::clone(&self.key), None),
            )
            .await
            .expect("authenticate");
        assert!(auth.success(), "public key authentication must succeed");
        let channel = handle.channel_open_session().await.expect("open a session");
        channel
            .request_subsystem(false, "sftp")
            .await
            .expect("request the sftp subsystem");
        let session = russh_sftp::client::SftpSession::new(channel.into_stream())
            .await
            .expect("sftp handshake");
        (handle, session)
    }
}

fn sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Deterministic bytes, so a mismatch points at the transport rather than the generator.
fn payload(len: usize) -> Vec<u8> {
    (0..len)
        .map(|index| ((index * 37 + 11) & 0xff) as u8)
        .collect()
}

/// Names in `dir` that look like this crate's temporary files.
async fn leftovers(session: &russh_sftp::client::SftpSession, dir: &str) -> Vec<String> {
    let mut names = Vec::new();
    for entry in session.read_dir(dir).await.expect("read the fixture dir") {
        let name = entry.file_name();
        if name.contains(".terminal-upload-") {
            names.push(name);
        }
    }
    names
}

/// Read a remote file through the SFTP session.
async fn read_remote(session: &russh_sftp::client::SftpSession, path: &str) -> Vec<u8> {
    session.read(path).await.expect("read the remote file")
}

macro_rules! require_fixture {
    () => {
        match Fixture::from_env() {
            Some(fixture) => fixture,
            None => {
                eprintln!(
                    "skipped: no SFTP fixture. Run scripts/verify-install/sftp-command-e2e.mjs"
                );
                return;
            }
        }
    };
}

/// 24 MiB through the production upload path, into a real SFTP server.
#[tokio::test]
#[ignore = "needs a real sshd; run scripts/verify-install/sftp-command-e2e.mjs"]
async fn uploads_24_mib_through_the_production_upload_path() {
    let fixture = require_fixture!();
    let (_handle, sftp) = fixture.connect().await;
    let remote = SftpRemote { session: &sftp };
    let local_dir = tempfile::tempdir().expect("local temp dir");

    let bytes = payload(24 * 1024 * 1024);
    let local = local_dir.path().join("payload.bin");
    std::fs::write(&local, &bytes).expect("write the local payload");

    let remote_path = format!("{}/e2e-24mib.bin", fixture.dir);
    let outcome = staged_upload(&remote, &local, &remote_path, |_, _| {}, || false)
        .await
        .expect("upload 24 MiB");

    assert_eq!(outcome.bytes, bytes.len() as u64);
    let landed = read_remote(&sftp, &remote_path).await;
    assert_eq!(landed.len(), bytes.len(), "the server must hold every byte");
    assert_eq!(
        sha256(&landed),
        sha256(&bytes),
        "both sides must hash the same"
    );
    assert!(
        leftovers(&sftp, &fixture.dir).await.is_empty(),
        "a successful upload must leave no staging or backup file"
    );
}

/// Download the same 24 MiB through the production download path and compare hashes.
#[tokio::test]
#[ignore = "needs a real sshd; run scripts/verify-install/sftp-command-e2e.mjs"]
async fn downloads_24_mib_through_the_production_download_path() {
    let fixture = require_fixture!();
    let (_handle, sftp) = fixture.connect().await;
    let local_dir = tempfile::tempdir().expect("local temp dir");

    let bytes = payload(24 * 1024 * 1024);
    let remote_path = format!("{}/e2e-download-24mib.bin", fixture.dir);

    // Seed the remote file through the upload path so the bytes on the server are
    // known to be the ones the product wrote.
    let seed = local_dir.path().join("seed.bin");
    std::fs::write(&seed, &bytes).expect("write the seed");
    staged_upload(
        &SftpRemote { session: &sftp },
        &seed,
        &remote_path,
        |_, _| {},
        || false,
    )
    .await
    .expect("seed the remote file");

    // Now download it.
    let target_path = local_dir.path().join("downloaded.bin");
    let target = DownloadTarget::new(&target_path, 1).expect("download target");
    let mut remote_file = sftp.open(&remote_path).await.expect("open the remote file");
    let sink = super::sftp_download::FileSink::create(&target.temp)
        .await
        .expect("create the sink");
    let received = receive_download(
        &target,
        Some(bytes.len() as u64),
        &mut remote_file,
        |_| {},
        sink,
    )
    .await
    .expect("download 24 MiB");

    assert_eq!(received, bytes.len() as u64);
    let downloaded = std::fs::read(&target_path).expect("read the download");
    assert_eq!(
        sha256(&downloaded),
        sha256(&bytes),
        "the round trip must be byte-exact"
    );
    assert!(
        !tokio::fs::try_exists(&target.temp).await.unwrap_or(false),
        "a successful download must leave no temporary file"
    );
}

/// Replacing an existing remote file goes through staged replace and cleans up.
#[tokio::test]
#[ignore = "needs a real sshd; run scripts/verify-install/sftp-command-e2e.mjs"]
async fn replacing_an_existing_remote_file_leaves_no_debris() {
    let fixture = require_fixture!();
    let (_handle, sftp) = fixture.connect().await;
    let remote = SftpRemote { session: &sftp };
    let local_dir = tempfile::tempdir().expect("local temp dir");
    let remote_path = format!("{}/e2e-replace.txt", fixture.dir);

    // First upload creates it.
    let first = local_dir.path().join("first.txt");
    std::fs::write(&first, b"the first version").unwrap();
    staged_upload(&remote, &first, &remote_path, |_, _| {}, || false)
        .await
        .expect("first upload");

    // Second upload replaces it.
    let second = local_dir.path().join("second.txt");
    std::fs::write(&second, b"the second version").unwrap();
    let outcome = staged_upload(&remote, &second, &remote_path, |_, _| {}, || false)
        .await
        .expect("replacing upload");

    assert!(outcome.replaced, "the second upload must report a replace");
    assert_eq!(
        read_remote(&sftp, &remote_path).await,
        b"the second version",
        "the destination must hold the new bytes"
    );
    assert!(
        leftovers(&sftp, &fixture.dir).await.is_empty(),
        "a replace must leave no staging or backup file"
    );
}

/// A write failure mid-upload must leave the previous remote file intact.
#[tokio::test]
#[ignore = "needs a real sshd; run scripts/verify-install/sftp-command-e2e.mjs"]
async fn a_failed_upload_keeps_the_previous_remote_file() {
    let fixture = require_fixture!();
    let (_handle, sftp) = fixture.connect().await;
    let remote = SftpRemote { session: &sftp };
    let local_dir = tempfile::tempdir().expect("local temp dir");
    let remote_path = format!("{}/e2e-failure.txt", fixture.dir);

    // Seed a good version.
    let good = local_dir.path().join("good.txt");
    std::fs::write(&good, b"the good version").unwrap();
    staged_upload(&remote, &good, &remote_path, |_, _| {}, || false)
        .await
        .expect("seed the good version");

    // Now a "cancelled" upload: the cancellation closure returns true, which is how
    // the production path stops between chunks. That is the closest deterministic
    // failure this layer can inject without a proxy in front of the server.
    let failing = local_dir.path().join("failing.txt");
    std::fs::write(&failing, payload(2 * 1024 * 1024)).unwrap();
    let result = staged_upload(&remote, &failing, &remote_path, |_, _| {}, || true).await;

    assert!(
        result.is_err(),
        "a cancelled upload must not report success"
    );
    assert_eq!(
        read_remote(&sftp, &remote_path).await,
        b"the good version",
        "the previous version must survive a failed upload"
    );
    assert!(
        leftovers(&sftp, &fixture.dir).await.is_empty(),
        "a failed upload must not leave staging or backup files"
    );
}

/// Distinct destinations may upload concurrently; one path serialises with itself.
#[tokio::test]
#[ignore = "needs a real sshd; run scripts/verify-install/sftp-command-e2e.mjs"]
async fn distinct_paths_upload_concurrently() {
    let fixture = require_fixture!();
    let (_handle, sftp) = fixture.connect().await;
    let local_dir = tempfile::tempdir().expect("local temp dir");

    let mut locals = Vec::new();
    for index in 0..4 {
        let path = local_dir.path().join(format!("p{index}.bin"));
        std::fs::write(&path, payload(256 * 1024 + index)).unwrap();
        locals.push(path);
    }

    let remote = SftpRemote { session: &sftp };
    let paths: Vec<String> = (0..locals.len())
        .map(|index| format!("{}/e2e-concurrent-{index}.bin", fixture.dir))
        .collect();
    let results =
        futures::future::join_all(locals.iter().zip(paths.iter()).map(|(local, remote_path)| {
            staged_upload(&remote, local, remote_path, |_, _| {}, || false)
        }))
        .await;

    for (index, result) in results.into_iter().enumerate() {
        let outcome = result.expect("concurrent upload");
        assert_eq!(outcome.bytes, (256 * 1024 + index) as u64);
    }
    assert!(leftovers(&sftp, &fixture.dir).await.is_empty());
}

/// The local download target is only replaced after the bytes are durable.
///
/// This one needs no fixture: it is the property `receive_download` guarantees, and
/// it runs everywhere so the guarantee is checked on every `cargo test`.
#[tokio::test]
async fn a_download_that_fails_never_replaces_the_local_target() {
    struct FailingSink {
        temp: std::path::PathBuf,
    }
    #[async_trait::async_trait]
    impl DownloadSink for FailingSink {
        async fn write(&mut self, _chunk: &[u8]) -> Result<(), String> {
            Err("the disk is full".to_string())
        }
        async fn finish(&mut self) -> Result<(), String> {
            Ok(())
        }
        async fn abandon(&mut self) {
            let _ = tokio::fs::remove_file(&self.temp).await;
        }
    }

    let dir = tempfile::tempdir().unwrap();
    let target_path = dir.path().join("report.pdf");
    tokio::fs::write(&target_path, b"the original")
        .await
        .unwrap();
    let target = DownloadTarget::new(&target_path, 1).unwrap();

    // A reader that yields one chunk; the sink fails on it.
    struct OneChunk(bool);
    impl tokio::io::AsyncRead for OneChunk {
        fn poll_read(
            mut self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
            buf: &mut tokio::io::ReadBuf<'_>,
        ) -> std::task::Poll<std::io::Result<()>> {
            if self.0 {
                return std::task::Poll::Ready(Ok(()));
            }
            self.0 = true;
            buf.put_slice(b"replacement");
            std::task::Poll::Ready(Ok(()))
        }
    }
    let mut reader = OneChunk(false);

    let result = receive_download(
        &target,
        None,
        &mut reader,
        |_| {},
        FailingSink {
            temp: target.temp.clone(),
        },
    )
    .await;

    assert!(result.is_err());
    assert_eq!(
        tokio::fs::read(&target_path).await.unwrap(),
        b"the original",
        "a failed download must leave the original file untouched"
    );
    assert!(!Path::new(&target.temp).exists());
}

/// Keep `AsyncWriteExt` in scope for the helper above on all platforms.
#[allow(dead_code)]
async fn _touch_write_ext(file: &mut tokio::fs::File) {
    let _ = file.write_all(b"").await;
}
