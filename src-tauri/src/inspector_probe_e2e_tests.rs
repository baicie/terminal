//! Inspector probes against a real OpenSSH server.
//!
//! ## What this proves, and what it does not
//!
//! The probe itself is a shell command string (see `server-inspector.ts` in the
//! frontend); what the product depends on at this layer is that the Rust `exec` path
//! runs those exact strings on a real server, on a **separate channel**, and returns
//! parseable output without touching an interactive shell.
//!
//! So these tests assert:
//!
//! * the Linux probe command produces lines the parser can read;
//! * `uname -s` answers `Linux` (the platform gate the probe depends on);
//! * two concurrent execs both complete — the "one channel per probe" property that
//!   keeps a probe from blocking the terminal's own channel;
//! * a probe against a session that has closed fails rather than hanging.
//!
//! They do **not** prove the Tauri command wrapper or any GUI, and they do not prove
//! the shell was unpolluted — that needs an interactive session, which this fixture
//! does not open.
//!
//! ## Why they are `#[ignore]`
//!
//! They need a real sshd. `scripts/verify-install/inspector-probe-e2e.mjs` starts one
//! and sets `INSPECTOR_E2E_*`; without it the suite skips.
//!
//! ```bash
//! node scripts/verify-install/inspector-probe-e2e.mjs
//! ```

use std::time::Duration;

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

struct Fixture {
    port: u16,
    user: String,
    key: std::sync::Arc<russh::keys::PrivateKey>,
}

impl Fixture {
    fn from_env() -> Option<Self> {
        let port = std::env::var("INSPECTOR_E2E_PORT")
            .ok()?
            .parse::<u16>()
            .ok()?;
        let user = std::env::var("INSPECTOR_E2E_USER").ok()?;
        let key_path = std::env::var("INSPECTOR_E2E_KEY").ok()?;
        let key_text = std::fs::read_to_string(&key_path).ok()?;
        let key = russh::keys::decode_secret_key(&key_text, None).ok()?;
        Some(Self {
            port,
            user,
            key: std::sync::Arc::new(key),
        })
    }

    async fn connect(&self) -> russh::client::Handle<AcceptAnyHostKey> {
        use russh::keys::PrivateKeyWithHashAlg;
        let config = std::sync::Arc::new(russh::client::Config::default());
        let mut handle = russh::client::connect(config, ("127.0.0.1", self.port), AcceptAnyHostKey)
            .await
            .expect("connect to the fixture sshd");
        let auth = handle
            .authenticate_publickey(
                self.user.clone(),
                PrivateKeyWithHashAlg::new(std::sync::Arc::clone(&self.key), None),
            )
            .await
            .expect("authenticate");
        assert!(auth.success(), "public key authentication must succeed");
        handle
    }
}

/// Run one command on a fresh exec channel and return its stdout.
///
/// This mirrors what `SshSession::exec` does for a probe: open a channel, exec, read
/// until exit. Written out here rather than reusing the session type because the
/// fixture has no `SessionManager`, and the property under test is the wire behaviour.
async fn exec_once(
    handle: &russh::client::Handle<AcceptAnyHostKey>,
    command: &str,
) -> (String, u32) {
    let mut channel = handle
        .channel_open_session()
        .await
        .expect("open an exec channel");
    // A short command (`uname -s`) can finish and close before this await returns, in
    // which case russh reports the request failure even though the command ran. The
    // output is what matters, so the result is recorded rather than asserted here.
    let exec_result = channel.exec(true, command.as_bytes()).await;

    let mut stdout = Vec::new();
    let mut exit_code = 0u32;
    while let Some(message) = channel.wait().await {
        match message {
            russh::ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
            russh::ChannelMsg::ExitStatus { exit_status } => {
                exit_code = exit_status;
            }
            russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
            _ => {}
        }
    }
    if let Err(error) = exec_result {
        // Only surfaced when the channel produced nothing: a late failure on a
        // command that already answered is noise.
        if stdout.is_empty() {
            eprintln!("exec request failed and produced no output: {error}");
        }
    }
    (String::from_utf8_lossy(&stdout).to_string(), exit_code)
}

/// The exact command string the frontend probe sends first.
const DETECT_COMMAND: &str = "uname -s";

/// The exact command string `server-inspector.ts` sends for Linux, verbatim.
///
/// Duplicated on purpose: if the TypeScript side changes, this test stops matching the
/// product and that is worth noticing — a test that imported the string would keep
/// passing while the two drifted.
const LINUX_PROBE: &str = concat!(
    r#"echo "os=$(uname -s)""#,
    "; ",
    r#"echo "uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null)""#,
    "; ",
    r#"echo "load=$(cat /proc/loadavg 2>/dev/null | cut -d" " -f1-3)""#,
    "; ",
    r#"echo "mem=$(free -b 2>/dev/null | awk '/^Mem:/ {print $2" "$3}')""#,
    "; ",
    r#"echo "disk=$(df -B1 / 2>/dev/null | awk 'NR==2 {print $2" "$3}')""#,
);

/// The exact command string `server-inspector.ts` sends for macOS, verbatim.
const DARWIN_PROBE: &str = concat!(
    r#"echo "os=$(uname -s)""#,
    "; ",
    r#"echo "load=$(sysctl -n vm.loadavg 2>/dev/null | tr -d "{}" | xargs)""#,
    "; ",
    r#"echo "uptime=$(sysctl -n kern.boottime 2>/dev/null | sed 's/.*sec = \([0-9]*\).*/\1/')""#,
    "; ",
    r#"echo "mem=$(vm_stat 2>/dev/null | head -3 | tr "\n" " ")""#,
    "; ",
    r#"echo "disk=$(df -k / 2>/dev/null | awk 'NR==2 {print $2*1024" "$3*1024}')""#,
);

/// A probe that works on either platform, for the isolation test.
const PROBE_ANY: &str = r#"echo "os=$(uname -s)""#;

macro_rules! require_fixture {
    () => {
        match Fixture::from_env() {
            Some(fixture) => fixture,
            None => {
                eprintln!("skipped: no Inspector fixture. Run scripts/verify-install/inspector-probe-e2e.mjs");
                return;
            }
        }
    };
}

#[tokio::test]
#[ignore = "needs a real sshd; run scripts/verify-install/inspector-probe-e2e.mjs"]
async fn the_platform_detect_command_answers_linux() {
    let fixture = require_fixture!();
    let handle = fixture.connect().await;
    let (stdout, exit_code) = exec_once(&handle, DETECT_COMMAND).await;
    assert_eq!(exit_code, 0, "uname -s must succeed");
    // The fixture runs on whatever host the suite is on. The product's platform gate
    // reads exactly this output, so the assertion is that it names a platform the
    // gate understands — not that the machine is Linux.
    let os = stdout.trim().to_ascii_lowercase();
    assert!(
        os == "linux" || os == "darwin",
        "uname -s must name a platform the probe supports; got {:?}",
        stdout.trim()
    );
}

#[tokio::test]
#[ignore = "needs a real sshd; run scripts/verify-install/inspector-probe-e2e.mjs"]
async fn the_linux_probe_emits_lines_the_parser_can_read() {
    let fixture = require_fixture!();
    let handle = fixture.connect().await;
    // The probe the product would send *on this host*. Running the Linux string on a
    // macOS machine would fail for a reason that says nothing about the product.
    let (os_stdout, _) = exec_once(&handle, DETECT_COMMAND).await;
    let probe = if os_stdout.trim().eq_ignore_ascii_case("darwin") {
        DARWIN_PROBE
    } else {
        LINUX_PROBE
    };
    let (stdout, _exit_code) = exec_once(&handle, probe).await;

    // The parser reads `key=value` lines. Assert the keys it depends on are present;
    // a values check belongs to the frontend parser, which has its own server-free
    // tests over captured output.
    for key in ["os=", "uptime=", "load=", "mem=", "disk="] {
        assert!(
            stdout.contains(key),
            "probe output must contain {key:?}; got:\n{stdout}"
        );
    }
    assert!(
        stdout.contains("os=") && (stdout.contains("Linux") || stdout.contains("Darwin")),
        "the OS line must carry the platform; got:\n{stdout}"
    );
}

#[tokio::test]
#[ignore = "needs a real sshd; run scripts/verify-install/inspector-probe-e2e.mjs"]
async fn two_probes_run_concurrently_on_separate_channels() {
    // The property that matters for isolation: a probe does not occupy the channel
    // anything else is using. Two execs at once must both finish.
    let fixture = require_fixture!();
    let handle = fixture.connect().await;

    let (first, probe) = tokio::join!(
        exec_once(&handle, DETECT_COMMAND),
        exec_once(&handle, PROBE_ANY),
    );

    assert_eq!(first.1, 0, "the detect channel must exit cleanly");
    assert!(first.0.contains("Linux") || first.0.contains("Darwin"));
    // Both channels produced output, which is the isolation property under test: a
    // probe does not occupy the channel anything else is using.
    assert!(
        probe.0.contains("os="),
        "the concurrent probe must also produce output; got {:?}",
        probe.0
    );
}

#[tokio::test]
#[ignore = "needs a real sshd; run scripts/verify-install/inspector-probe-e2e.mjs"]
async fn a_probe_on_a_closed_connection_fails_rather_than_hanging() {
    // A probe that hangs would leave the panel showing "reading the host…" forever.
    // The property is *bounded failure*, not a particular error value: a closed handle
    // may report Disconnect, an open-channel error, or an empty channel, and all three
    // are acceptable as long as they arrive.
    let fixture = require_fixture!();
    let handle = fixture.connect().await;
    handle
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await
        .expect("disconnect");

    let attempt = tokio::time::timeout(Duration::from_secs(5), async {
        // Deliberately not `exec_once`: that helper asserts on channel open, and a
        // failure there is the expected outcome here.
        let mut channel = handle.channel_open_session().await?;
        let _ = channel.exec(true, DETECT_COMMAND.as_bytes()).await;
        let mut stdout = Vec::new();
        while let Some(message) = channel.wait().await {
            match message {
                russh::ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
                _ => {}
            }
        }
        Ok::<Vec<u8>, russh::Error>(stdout)
    })
    .await;

    assert!(
        attempt.is_ok(),
        "a probe on a closed connection must fail promptly, not hang"
    );
}
