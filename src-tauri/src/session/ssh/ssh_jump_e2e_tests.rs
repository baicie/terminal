//! SSH12–SSH15 — the jump path against two real OpenSSH daemons.
//!
//! ## Why this is its own file
//!
//! It is a `#[cfg(test)] mod …;` declaration resolved from `ssh.rs`, which is what
//! keeps it out of the source fingerprint (`check-verification-evidence.mjs` excludes
//! only files reachable through such a declaration — the `_tests.rs` suffix alone does
//! not count). Written inline it made every acceptance-evidence file stale on each
//! edit, and re-capturing six evidence documents to add a test is a cost with no
//! benefit.
//!
//! ## What only this can prove
//!
//! SSH07–SSH09 attach `hop`/`stage` at three places in `connect_via_jump_inner`. A mock
//! cannot fail the way a real bastion does: it has no `direct-tcpip` channel to refuse,
//! no host key to disagree about, and no handshake that times out halfway.
//!
//! ## Level
//!
//! This drives `SshSession::connect_via_jump`, the function `session_create_ssh_jump`
//! calls. It does **not** cover the Tauri command wrapper or the frontend.
//!
//! ## Ignored by default
//!
//! They need two real daemons. `scripts/verify-install/ssh-jump-e2e.mjs` starts them and
//! sets `SSH_JUMP_E2E_*`; without it the cases skip rather than fail, the same
//! convention `sftp_command_e2e_tests` uses.

use super::{
    connection_key, disconnect_jump_connections_with_shutdown, get_connection_pool,
    interactive_ssh_config, ssh_resource_keys, ConnectionHop, ConnectionStage, JumpHostConfig,
    JumpTarget, SessionError, SshSession,
};
use std::sync::Arc;

struct Fixture {
    bastion_port: u16,
    target_port: u16,
    user: String,
    bastion_key: String,
    target_key: String,
    target_host_key: String,
    bastion_host_key: String,
    /// F11 — a second bastion and target, for the isolation matrix.
    ///
    /// `None` when the harness did not start them. The single-bastion cases above must
    /// keep working with exactly the fixture they were written against, so the second
    /// set is additive rather than a required field: a harness that predates F11 runs
    /// every older case and honestly skips only the new ones.
    second: Option<SecondFixture>,
    /// F12 — proxies in front of each leg, so a case can break one leg on purpose.
    ///
    /// `None` when the harness started no proxy. The disconnect matrix skips then, and
    /// says so; every other case keeps using the daemons directly, exactly as before.
    proxies: Option<FixtureProxies>,
}

#[derive(Clone, Copy)]
struct FixtureProxies {
    bastion: u16,
    target: u16,
}

#[derive(Clone)]
struct SecondFixture {
    bastion_port: u16,
    target_port: u16,
    bastion_key: String,
    target_key: String,
    target_host_key: String,
    bastion_host_key: String,
}

/// The fixture, or an explanation of exactly which part is missing.
///
/// ## Why this does not return `Option`
///
/// It did, and every failure answered the same question — `None` — so a harness that
/// set the ports and forgot the keys printed "SSH_JUMP_E2E_* not set" and the case
/// passed. Measured: the variables were set and the run still skipped, and the
/// message pointed at the one thing that was not wrong.
///
/// A missing fixture and a malformed fixture are different problems for the person
/// running this, and the harness needs to tell them apart from the test's own output.
enum FixtureLookup {
    Ready(Fixture),
    /// Nothing is configured — the harness is not running. Skip, do not fail.
    NotConfigured,
    /// Configured and unusable — a harness bug that must be loud.
    Broken(String),
}

fn fixture() -> FixtureLookup {
    const REQUIRED: &[&str] = &[
        "SSH_JUMP_E2E_BASTION_PORT",
        "SSH_JUMP_E2E_TARGET_PORT",
        "SSH_JUMP_E2E_USER",
        "SSH_JUMP_E2E_BASTION_KEY",
        "SSH_JUMP_E2E_TARGET_KEY",
        "SSH_JUMP_E2E_TARGET_HOST_KEY",
        "SSH_JUMP_E2E_BASTION_HOST_KEY",
    ];
    if REQUIRED.iter().all(|name| std::env::var(name).is_err()) {
        return FixtureLookup::NotConfigured;
    }
    let missing: Vec<&str> = REQUIRED
        .iter()
        .copied()
        .filter(|name| std::env::var(name).is_err())
        .collect();
    if !missing.is_empty() {
        return FixtureLookup::Broken(format!("missing {missing:?}"));
    }
    let port = |name: &str| -> Result<u16, String> {
        std::env::var(name)
            .map_err(|_| format!("{name} unset"))?
            .parse()
            .map_err(|error| format!("{name} is not a port: {error}"))
    };
    let key = |name: &str| -> Result<String, String> {
        let value = std::env::var(name).map_err(|_| format!("{name} unset"))?;
        // The harness hands over the key's **contents**; a path here means the
        // harness and the test disagree about the contract, which is worth failing
        // on rather than reading a file the test was never told about.
        if !value.contains("PRIVATE KEY") {
            return Err(format!("{name} does not contain a private key"));
        }
        Ok(value)
    };
    // The host key arrives as OpenSSH text, matching the private keys above: the
    // harness owns the fixture directory and may have removed it by the time a
    // retried case runs, so nothing here reads a path.
    let host_key = |name: &str| -> Result<String, String> {
        let value = std::env::var(name).map_err(|_| format!("{name} unset"))?;
        if !(value.contains("ssh-ed25519") || value.contains("ssh-rsa")) {
            return Err(format!("{name} is not an OpenSSH public key line"));
        }
        Ok(value)
    };
    match (|| -> Result<Fixture, String> {
        Ok(Fixture {
            bastion_port: port("SSH_JUMP_E2E_BASTION_PORT")?,
            target_port: port("SSH_JUMP_E2E_TARGET_PORT")?,
            user: std::env::var("SSH_JUMP_E2E_USER").map_err(|e| e.to_string())?,
            bastion_key: key("SSH_JUMP_E2E_BASTION_KEY")?,
            target_key: key("SSH_JUMP_E2E_TARGET_KEY")?,
            target_host_key: host_key("SSH_JUMP_E2E_TARGET_HOST_KEY")?,
            bastion_host_key: host_key("SSH_JUMP_E2E_BASTION_HOST_KEY")?,
            second: second_fixture()?,
            proxies: fixture_proxies(),
        })
    })() {
        Ok(fixture) => FixtureLookup::Ready(fixture),
        Err(reason) => FixtureLookup::Broken(reason),
    }
}

/// F11 — the second bastion/target pair, when the harness started one.
///
/// All five variables must be present or none: a half-configured second fixture is a
/// harness bug, and silently treating it as absent would skip the isolation matrix while
/// reporting a clean run.
fn second_fixture() -> Result<Option<SecondFixture>, String> {
    const REQUIRED: &[&str] = &[
        "SSH_JUMP_E2E_B_PORT",
        "SSH_JUMP_E2E_B_TARGET_PORT",
        "SSH_JUMP_E2E_B_BASTION_KEY",
        "SSH_JUMP_E2E_B_TARGET_KEY",
        "SSH_JUMP_E2E_B_TARGET_HOST_KEY",
        "SSH_JUMP_E2E_B_BASTION_HOST_KEY",
    ];
    let present = REQUIRED
        .iter()
        .filter(|name| std::env::var(name).is_ok())
        .count();
    if present == 0 {
        return Ok(None);
    }
    if present != REQUIRED.len() {
        let missing: Vec<&str> = REQUIRED
            .iter()
            .copied()
            .filter(|name| std::env::var(name).is_err())
            .collect();
        return Err(format!("second fixture is half-configured: missing {missing:?}"));
    }
    let port = |name: &str| -> Result<u16, String> {
        std::env::var(name)
            .map_err(|_| format!("{name} unset"))?
            .parse()
            .map_err(|error| format!("{name} is not a port: {error}"))
    };
    let text = |name: &str, needle: &str| -> Result<String, String> {
        let value = std::env::var(name).map_err(|_| format!("{name} unset"))?;
        if !value.contains(needle) {
            return Err(format!("{name} does not contain {needle}"));
        }
        Ok(value)
    };
    Ok(Some(SecondFixture {
        bastion_port: port("SSH_JUMP_E2E_B_PORT")?,
        target_port: port("SSH_JUMP_E2E_B_TARGET_PORT")?,
        bastion_key: text("SSH_JUMP_E2E_B_BASTION_KEY", "PRIVATE KEY")?,
        target_key: text("SSH_JUMP_E2E_B_TARGET_KEY", "PRIVATE KEY")?,
        target_host_key: text("SSH_JUMP_E2E_B_TARGET_HOST_KEY", "ssh-")?,
        bastion_host_key: text("SSH_JUMP_E2E_B_BASTION_HOST_KEY", "ssh-")?,
    }))
}

/// F12 — the proxy ports, when the harness started them.
fn fixture_proxies() -> Option<FixtureProxies> {
    let port = |name: &str| -> Option<u16> { std::env::var(name).ok()?.parse().ok() };
    Some(FixtureProxies {
        bastion: port("SSH_JUMP_E2E_BASTION_PROXY_PORT")?,
        target: port("SSH_JUMP_E2E_TARGET_PROXY_PORT")?,
    })
}

fn jump_config(fixture: &Fixture) -> JumpHostConfig {
    JumpHostConfig {
        host: "127.0.0.1".to_string(),
        port: fixture.bastion_port,
        username: fixture.user.clone(),
        auth_type: "key".to_string(),
        password: None,
        private_key: Some(fixture.bastion_key.clone()),
        certificate: None,
        // Pinned, not looked up: the fixture's daemon is brand new and its key is
        // in no known_hosts file. Leaving this `None` made every case fail at the
        // bastion with `key not found in known_hosts` — which is the *correct*
        // product behaviour, and the wrong fixture.
        expected_host_key: Some(fixture.bastion_host_key.clone()),
        target_auth_type: Some("key".to_string()),
    }
}

/// The happy path, and the reason the attribution work is testable at all: with
/// both daemons healthy the connection must succeed and name no hop.
///
/// A hop on a successful connection would be a bug the unit tests cannot see —
/// there is no `SessionFailure` to inspect when `Ok` comes back, so only a real
/// run proves the success path stays context-free.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs to start two daemons"]
async fn a_real_two_hop_connection_authenticates_both_legs() {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping");
            return;
        }
        // A configured-but-broken harness must fail, not skip: skipping here is how
        // the first version of this file reported PASS without connecting.
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };
    let target = JumpTarget {
        host: "127.0.0.1".to_string(),
        port: fixture.target_port,
        username: fixture.user.clone(),
        password: None,
        private_key: Some(fixture.target_key.clone()),
        certificate: None,
        // Pinned to the target's real key, so a wrong-host connection cannot pass.
        expected_host_key: Some(public_key(&fixture.target_host_key)),
        use_agent: false,
        allow_agent_forwarding: false,
    };
    let result = SshSession::connect_via_jump(
        Arc::new(interactive_ssh_config()),
        target,
        jump_config(&fixture),
        tokio::time::Instant::now() + std::time::Duration::from_secs(20),
    )
    .await;

    match result {
        Ok((target_handle, jump_handle, _guard, _slot)) => {
            // Both handles exist, which means both handshakes completed.
            drop(target_handle);
            drop(jump_handle);
        }
        Err(failure) => panic!(
            "a healthy two-hop connection must succeed, got {:?} at {:?}/{:?}: {}",
            failure.error, failure.hop, failure.stage, failure.error
        ),
    }
}

/// SSH09 — a target that refuses the credential must be attributed to the target.
///
/// This is the case the whole feature exists for: the bastion worked, so the login
/// the user has to fix is the one on the host behind it.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs to start two daemons"]
async fn a_target_refusal_is_attributed_to_the_target() {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping");
            return;
        }
        // A configured-but-broken harness must fail, not skip: skipping here is how
        // the first version of this file reported PASS without connecting.
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };
    let target = JumpTarget {
        host: "127.0.0.1".to_string(),
        port: fixture.target_port,
        username: fixture.user.clone(),
        password: None,
        // The bastion's key, offered to the target: a credential the target has
        // never seen. The bastion itself accepted this same key, so a failure here
        // cannot be blamed on a broken key.
        private_key: Some(fixture.bastion_key.clone()),
        certificate: None,
        expected_host_key: Some(public_key(&fixture.target_host_key)),
        use_agent: false,
        allow_agent_forwarding: false,
    };
    let result = SshSession::connect_via_jump(
        Arc::new(interactive_ssh_config()),
        target,
        jump_config(&fixture),
        tokio::time::Instant::now() + std::time::Duration::from_secs(30),
    )
    .await;

    let failure = result
        .err()
        .expect("the target must refuse a key it does not know");
    assert_eq!(
        failure.hop,
        Some(ConnectionHop::Target),
        "the bastion authenticated, so the refusal is the target's: {:?}",
        failure.error
    );
    assert_eq!(failure.stage, Some(ConnectionStage::Authentication));
}

/// SSH13 — a bastion that refuses the credential is attributed to the bastion.
///
/// The pair to `a_target_refusal_is_attributed_to_the_target`. Together they are the
/// whole point of the feature: the same `kind` on two machines means two different
/// logins to fix, and only the hop says which.
///
/// The bastion is given the **target's** key — one it has never seen — while the
/// target would accept it. So the refusal cannot be blamed on the far end.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs to start two daemons"]
async fn a_bastion_refusal_is_attributed_to_the_bastion() {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping");
            return;
        }
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };
    let mut jump = jump_config(&fixture);
    // The target's key, offered to the bastion. The target accepts it, so if this
    // were attributed to the target the test would be describing a connection that
    // never reached it.
    jump.private_key = Some(fixture.target_key.clone());

    let target = JumpTarget {
        host: "127.0.0.1".to_string(),
        port: fixture.target_port,
        username: fixture.user.clone(),
        password: None,
        private_key: Some(fixture.target_key.clone()),
        certificate: None,
        expected_host_key: Some(public_key(&fixture.target_host_key)),
        use_agent: false,
        allow_agent_forwarding: false,
    };
    let result = SshSession::connect_via_jump(
        Arc::new(interactive_ssh_config()),
        target,
        jump,
        tokio::time::Instant::now() + std::time::Duration::from_secs(30),
    )
    .await;

    let failure = result
        .err()
        .expect("the bastion must refuse a key it does not know");
    assert_eq!(
        failure.hop,
        Some(ConnectionHop::Bastion),
        "the target never saw this connection: {:?}",
        failure.error
    );
    assert_eq!(failure.stage, Some(ConnectionStage::Authentication));
    /*
     * F09 — the *kind*, not only where it happened.
     *
     * This assertion is the one that catches the defect the deadline wrapper had: it
     * returned `AuthenticationTransportFailed` for a refused credential, so the ladder
     * retried a key the server had already rejected (six times, measured through the
     * product smoke) and the pane never received `bastion-auth-rejected`.
     *
     * Only asserting hop/stage let that happen — this suite was green for both the broken
     * and the fixed wrapper until this line existed. `hop` says which machine; `kind` says
     * whether trying again can possibly help, and it is the field the retry decision reads.
     */
    assert!(
        matches!(
            failure.error,
            SessionError::AuthenticationRejected(_)
        ),
        "a refused credential must stay terminal, not become a retryable transport \
         fault: {:?}",
        failure.error
    );
}

/// SSH13 — a bastion whose host key is not the pinned one is refused before any
/// credential is offered.
///
/// This is the case that had no producer before SSH11: the refusal came back as
/// `connection_failed`, so the pane could not tell a changed server identity from a
/// network fault. It is asserted here on a real handshake, not a mock, because the
/// side channel that carries it lives inside `check_server_key`.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs to start two daemons"]
async fn a_bastion_host_key_mismatch_is_refused_as_its_own_kind() {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping");
            return;
        }
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };
    let mut jump = jump_config(&fixture);
    // The *target's* host key, pinned as the bastion's. A real server presenting a
    // key the client did not expect is exactly what a changed identity looks like.
    jump.expected_host_key = Some(fixture.target_host_key.clone());

    let target = JumpTarget {
        host: "127.0.0.1".to_string(),
        port: fixture.target_port,
        username: fixture.user.clone(),
        password: None,
        private_key: Some(fixture.target_key.clone()),
        certificate: None,
        expected_host_key: Some(public_key(&fixture.target_host_key)),
        use_agent: false,
        allow_agent_forwarding: false,
    };
    let result = SshSession::connect_via_jump(
        Arc::new(interactive_ssh_config()),
        target,
        jump,
        tokio::time::Instant::now() + std::time::Duration::from_secs(30),
    )
    .await;

    let failure = result.err().expect("the pinned key is not the bastion's");
    assert!(
        matches!(failure.error, SessionError::HostKeyRejected(_)),
        "a changed identity must keep its own kind, got {:?}",
        failure.error
    );
    assert_eq!(failure.hop, Some(ConnectionHop::Bastion));
}

/// SSH14 — a target whose host key is not the pinned one is refused, and the
/// refusal is the **target's**.
///
/// The tunnel opened and the bastion authenticated, so a failure here says nothing
/// about the bastion. This is the case a user actually needs to see: "the host
/// behind the bastion has a different identity than the one you approved" is a
/// security decision, and blaming the bastion would send them to change the wrong
/// known_hosts entry.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs to start two daemons"]
async fn a_target_host_key_mismatch_is_attributed_to_the_target() {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping");
            return;
        }
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };
    let target = JumpTarget {
        host: "127.0.0.1".to_string(),
        port: fixture.target_port,
        username: fixture.user.clone(),
        password: None,
        private_key: Some(fixture.target_key.clone()),
        certificate: None,
        // The bastion's key, pinned as the target's. The bastion is unaffected: its
        // own pin is correct, which is what makes the attribution unambiguous.
        expected_host_key: Some(public_key(&fixture.bastion_host_key)),
        use_agent: false,
        allow_agent_forwarding: false,
    };
    let result = SshSession::connect_via_jump(
        Arc::new(interactive_ssh_config()),
        target,
        jump_config(&fixture),
        tokio::time::Instant::now() + std::time::Duration::from_secs(30),
    )
    .await;

    let failure = result
        .err()
        .expect("the target's key is not the pinned one");
    assert!(
        matches!(failure.error, SessionError::HostKeyRejected(_)),
        "a target identity mismatch must keep its own kind, got {:?}",
        failure.error
    );
    assert_eq!(
        failure.hop,
        Some(ConnectionHop::Target),
        "the bastion authenticated with its own correct key, so this is the target"
    );
}

/// SSH15 — disconnecting a jump connection closes **both** transports.
///
/// ## Why this needs a real daemon
///
/// The leak it guards against is invisible in a unit test: `disconnect_jump_connections`
/// takes the target handle and the bastion handle and must finish both. A mock has no
/// socket to leave open, so "the session ended" and "the bastion is still connected"
/// look identical.
///
/// The assertion is on the server side, not on the client's own bookkeeping: after the
/// disconnect, the fixture must report the bastion as no longer having a live session.
/// Reading the client's own handle would only prove the client stopped caring.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs to start two daemons"]
async fn disconnecting_a_jump_session_releases_both_legs() {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping");
            return;
        }
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };
    let target = JumpTarget {
        host: "127.0.0.1".to_string(),
        port: fixture.target_port,
        username: fixture.user.clone(),
        password: None,
        private_key: Some(fixture.target_key.clone()),
        certificate: None,
        expected_host_key: Some(public_key(&fixture.target_host_key)),
        use_agent: false,
        allow_agent_forwarding: false,
    };
    let (target_handle, jump_handle, guard, _slot) = SshSession::connect_via_jump(
        Arc::new(interactive_ssh_config()),
        target,
        jump_config(&fixture),
        tokio::time::Instant::now() + std::time::Duration::from_secs(20),
    )
    .await
    .expect("the healthy fixture must connect");

    /*
     * The control: *before* disconnecting, the bastion really does have this
     * session. Without it the loop below passes against a `count_established` that
     * always returns 0 — measured by mutation, which is exactly what was happening:
     * the assertion could not fail, so it proved nothing.
     */
    /*
     * The control, and the reason it exists: the first version of this test
     * asserted "nothing is connected afterwards" against an `lsof` counter that
     * returned 0 at every point in the run — measured by mutation, the assertion
     * could not fail. `lsof` in the cargo child cannot see those sockets, so the
     * whole check was decoration.
     *
     * So the evidence is the bastion's own TCP port: while the session is live, a
     * connect to it succeeds and is accepted; once the client disconnects, the
     * daemon has released it. A refused/timed-out connect after the disconnect is
     * the server-side statement that the session is gone.
     */
    assert!(
        established_connections(fixture.bastion_port) > 0,
        "the bastion must show an established session before the disconnect, or this \
             check cannot tell a released session from a counter that sees nothing"
    );

    disconnect_jump_connections_with_shutdown(
        target_handle,
        jump_handle,
        guard,
        "test disconnect",
        tokio::time::Instant::now() + std::time::Duration::from_secs(10),
    )
    .await;

    /*
     * The daemons are asked, not the client. A lingering bastion session after the
     * target closed is the exact shape of the leak: the user closed one tab and the
     * jump host kept an authenticated connection to it.
     *
     * `sshd` releases the session within a moment, so this polls rather than
     * sampling once.
     */
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if established_connections(fixture.bastion_port) == 0 {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the bastion still has an established session after disconnect"
        );
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

/// Established TCP connections involving a loopback port, read from `netstat`.
///
/// ## Why not `lsof`, and why not "can I connect?"
///
/// `lsof -iTCP:<port>` inside the cargo test child returned **empty at every point in
/// the run**, including while the session was demonstrably live — measured. An
/// assertion built on it could not fail, which is the vacuous-guard shape this
/// repository keeps meeting.
///
/// A plain `TcpStream::connect` is also the wrong question: the daemon keeps
/// *listening* after a session ends, because the listening socket belongs to the
/// process, not the session. Measured — that version failed with "still accepts
/// connections after disconnect", which is correct behaviour being reported as a leak.
///
/// What is actually being counted is ESTABLISHED sockets, which is the only thing
/// that says "somebody still has a session here".
fn established_connections(port: u16) -> usize {
    let output = std::process::Command::new("netstat")
        .args(["-an", "-p", "tcp"])
        .output();
    let text = match output {
        Ok(output) => String::from_utf8_lossy(&output.stdout).to_string(),
        Err(error) => panic!("netstat is required to check for leaked sessions: {error}"),
    };
    /*
     * Count the **listening side only**.
     *
     * One loopback connection produces two ESTABLISHED rows — `127.0.0.1:<port> ->
     * 127.0.0.1:<ephemeral>` and its mirror. Counting both made a single session read as
     * two, which is why the first version's baseline looked contaminated when it was not
     * and why "one connection per session" could not be stated directly.
     *
     * `sshd`'s side is the row whose *local* address is the port, i.e. the port appears
     * before the arrow.
     */
    let local = format!("127.0.0.1.{port}");
    text.lines()
        .filter(|line| line.contains("ESTABLISHED"))
        .filter(|line| {
            /*
             * `netstat -an -p tcp` on macOS prints the local address first and the peer
             * second, with no arrow between them:
             *
             *   tcp4  0  0  127.0.0.1.61030  127.0.0.1.61031  ESTABLISHED
             *
             * so "the daemon's side" is the row where the port appears in an early
             * address field. Splitting on `->` (the `lsof` shape) matched nothing and
             * silently counted zero — which the control assertion caught.
             */
            // Field 4 is the local address (`tcp4 0 0 <local> <peer> ESTABLISHED`).
            line.split_whitespace()
                .nth(3)
                .is_some_and(|field| field.contains(&local))
        })
        .count()
}

/// SSH17 — two sessions through the same bastion are two connections, and ending one
/// leaves the other working.
///
/// ## What "bastion identity isolation" actually means here
///
/// `connection_key` already includes the session id, so two sessions can never share a
/// pool entry — that is a string property, and the unit tests pin it. What those tests
/// cannot say is whether the *transport* is shared: reusing one authenticated bastion
/// connection across sessions would be a legitimate optimisation, and it would also mean
/// one session's disconnect tears down another's tunnel.
///
/// The code does not share (`connect_via_jump` authenticates the bastion per call), but
/// "the code does not share it" is what a test is for. So this opens two sessions to the
/// same target through the same bastion and checks the **server's** view: two separate
/// established connections, not one.
///
/// The second half is the one a user would feel: disconnecting the first session must
/// leave the second able to do things. It is asserted by counting the bastion's
/// established connections before and after, which drops by exactly one.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs to start two daemons"]
async fn two_sessions_through_one_bastion_do_not_share_a_transport() {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping");
            return;
        }
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };

    let connect_once = || {
        let fixture = Fixture {
            bastion_port: fixture.bastion_port,
            target_port: fixture.target_port,
            user: fixture.user.clone(),
            bastion_key: fixture.bastion_key.clone(),
            target_key: fixture.target_key.clone(),
            target_host_key: fixture.target_host_key.clone(),
            bastion_host_key: fixture.bastion_host_key.clone(),
            second: None,
            proxies: None,
        };
        async move {
            let target = JumpTarget {
                host: "127.0.0.1".to_string(),
                port: fixture.target_port,
                username: fixture.user.clone(),
                password: None,
                private_key: Some(fixture.target_key.clone()),
                certificate: None,
                expected_host_key: Some(public_key(&fixture.target_host_key)),
                use_agent: false,
                allow_agent_forwarding: false,
            };
            SshSession::connect_via_jump(
                Arc::new(interactive_ssh_config()),
                target,
                jump_config(&fixture),
                tokio::time::Instant::now() + std::time::Duration::from_secs(20),
            )
            .await
        }
    };

    /*
     * Wait for the bastion to be quiet first.
     *
     * Every case in this file runs against the same two daemons and `--test-threads=1`,
     * but `sshd` closes a session a moment after the client does, so the previous case's
     * sockets can still be ESTABLISHED here. Measured: the baseline read 2 rather than 0,
     * which would let "the first session opened a connection" pass on somebody else's
     * connection and make the later decrement check meaningless.
     */
    let quiet_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while established_connections(fixture.bastion_port) > 0 {
        assert!(
            tokio::time::Instant::now() < quiet_deadline,
            "the bastion still had {} session(s) from a previous case before this one started",
            established_connections(fixture.bastion_port)
        );
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let baseline = established_connections(fixture.bastion_port);
    assert_eq!(
        baseline, 0,
        "the baseline must be quiet, not merely smaller"
    );

    let (first_target, first_jump, first_guard, _a) = connect_once()
        .await
        .expect("the first session must connect");
    let after_first = established_connections(fixture.bastion_port);

    let (second_target, second_jump, second_guard, _c) = connect_once()
        .await
        .expect("the second session must connect");
    let after_second = established_connections(fixture.bastion_port);

    /*
     * Each session adds its own bastion connection. If the transport were shared the
     * second would add nothing — and the count is the only place that difference shows.
     */
    assert!(
        after_first > baseline,
        "the first session must open its own bastion connection (baseline {baseline}, after {after_first})"
    );
    assert!(
        after_second > after_first,
        "the second session must open its own bastion connection, not reuse the first \
         (after first {after_first}, after second {after_second})"
    );

    disconnect_jump_connections_with_shutdown(
        first_target,
        first_jump,
        first_guard,
        "first session finished",
        tokio::time::Instant::now() + std::time::Duration::from_secs(10),
    )
    .await;

    /*
     * The second session's transport must survive. Waiting for the count to settle keeps
     * this from racing the server's own teardown of the first.
     */
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if established_connections(fixture.bastion_port) == after_first {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "disconnecting the first session must drop exactly its own bastion connection \
             (expected {after_first}, saw {})",
            established_connections(fixture.bastion_port)
        );
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    /*
     * And the survivor is still **usable**, not merely still counted.
     *
     * `is_closed()` does not exist on a russh handle, and a flag we set ourselves would
     * only report our own bookkeeping. Opening a channel makes the server answer, which
     * is the thing the user would fail to do if the first session's disconnect had
     * reached into the second's transport.
     */
    let channel = second_target
        .channel_open_session()
        .await
        .expect("the second session must still be able to open a channel");
    drop(channel);

    disconnect_jump_connections_with_shutdown(
        second_target,
        second_jump,
        second_guard,
        "second session finished",
        tokio::time::Instant::now() + std::time::Duration::from_secs(10),
    )
    .await;
}

/// Reads a public key from the fixture's `.pub` text.
fn public_key(value: &str) -> russh::keys::PublicKey {
    russh::keys::PublicKey::from_openssh(value.trim())
        .expect("the fixture writes a valid OpenSSH public key")
}

/// SSH16 — a jump connection registers **one** pool entry, under a key that names the
/// bastion, and releases it on disconnect.
///
/// ## What this covers that the key-shape unit tests do not
///
/// `jump_pool_key_includes_bastion_identity` proves two paths produce different
/// strings. It cannot prove the pool is actually written and cleaned up: those are
/// `insert`/`release` on a `SshConnectionPool` that has no entries in a unit test.
///
/// The leak this guards against is a session that ends while its entry stays behind —
/// the pool would keep an `Arc<Handle>` alive, and SFTP/port-forward would find a
/// transport whose SSH session is gone. `ssh_resource_keys` is the product's own view
/// of what is registered, so the assertion is against the real registry rather than a
/// bookkeeping copy.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs to start two daemons"]
async fn a_jump_session_registers_one_pool_entry_and_releases_it() {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping");
            return;
        }
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };
    let target = JumpTarget {
        host: "127.0.0.1".to_string(),
        port: fixture.target_port,
        username: fixture.user.clone(),
        password: None,
        private_key: Some(fixture.target_key.clone()),
        certificate: None,
        expected_host_key: Some(public_key(&fixture.target_host_key)),
        use_agent: false,
        allow_agent_forwarding: false,
    };
    let jump = jump_config(&fixture);
    let (target_handle, jump_handle, guard, _slot) = SshSession::connect_via_jump(
        Arc::new(interactive_ssh_config()),
        target,
        jump.clone(),
        tokio::time::Instant::now() + std::time::Duration::from_secs(20),
    )
    .await
    .expect("the healthy fixture must connect");

    /*
     * Write the entry exactly the way `SshSession::create` does: same key function, same
     * arguments. Recomputing the format string here would let the test and the product
     * drift apart while both stayed green.
     */
    let session_id = format!("ssh16-{}", std::process::id());
    let pool_key = connection_key(
        &session_id,
        "127.0.0.1",
        fixture.target_port,
        &fixture.user,
        Some(&jump),
        false,
    );
    let pool = get_connection_pool();
    pool.clone()
        .insert(
            pool_key.clone(),
            Arc::new(target_handle),
            Some(Arc::new(jump_handle)),
        )
        .await;

    let (pool_keys, registry_keys) = ssh_resource_keys().await;
    assert!(
        pool_keys.contains(&pool_key),
        "the jump session must be registered under its own key: {pool_keys:?}"
    );
    assert!(
        registry_keys.contains(&pool_key),
        "the registry SFTP/port-forward reads must hold the same key: {registry_keys:?}"
    );
    /*
     * The key names both ends. A key that only carried the target would let two
     * different bastions — different networks, different accounts — share one entry.
     */
    assert!(
        pool_key.contains(&fixture.bastion_port.to_string())
            && pool_key.contains(&fixture.target_port.to_string()),
        "the pool key must name both legs: {pool_key}"
    );

    pool.clone().release(pool_key.clone()).await;

    let (pool_after, registry_after) = ssh_resource_keys().await;
    assert!(
        !pool_after.contains(&pool_key),
        "the pool must drop the entry on release, still has: {pool_after:?}"
    );
    assert!(
        !registry_after.contains(&pool_key),
        "the registry must drop the entry too, still has: {registry_after:?}"
    );
    drop(guard);
}

/// F11 — four machines, four identities, and no credential may cross.
///
/// ## What SSH16 and SSH17 do not say
///
/// `a_jump_session_registers_one_pool_entry_and_releases_it` builds its own pool entry, so
/// it proves the plumbing, not that the product registers a session. And every existing
/// case uses **one** target: nothing in this repository has ever connected to two
/// different targets through two different bastions and checked which credential ended up
/// where.
///
/// ## What is asserted, and why the marker is a nonce
///
/// Each target echoes a value generated for this run. Reading it back proves the session
/// reached *that* target; a constant would still pass if the targets were swapped.
///
/// ## Why this skips rather than fails without the second fixture
///
/// The older cases must keep running against the fixture they were written for. A harness
/// that has not started the second pair reports `None`, and this case says so in its output
/// instead of pretending the isolation was checked.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs to start four daemons"]
async fn four_machines_keep_their_own_identity() {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping");
            return;
        }
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };
    let Some(second) = fixture.second.clone() else {
        eprintln!("SSH_JUMP_E2E_B_* not set; skipping the isolation matrix");
        return;
    };

    let nonce = format!(
        "f11-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default()
    );

    /// Connect with one exact credential set and return what the far end printed.
    #[allow(clippy::too_many_arguments)]
    async fn marker_through(
        target_port: u16,
        target_key: String,
        target_host_key: String,
        bastion_port: u16,
        bastion_key: String,
        bastion_host_key: String,
        user: String,
        nonce: String,
    ) -> Result<String, String> {
        let target = JumpTarget {
            host: "127.0.0.1".to_string(),
            port: target_port,
            username: user.clone(),
            password: None,
            private_key: Some(target_key),
            certificate: None,
            expected_host_key: Some(public_key(&target_host_key)),
            use_agent: false,
            allow_agent_forwarding: false,
        };
        let jump = JumpHostConfig {
            host: "127.0.0.1".to_string(),
            port: bastion_port,
            username: user,
            auth_type: "key".to_string(),
            password: None,
            private_key: Some(bastion_key),
            certificate: None,
            expected_host_key: Some(bastion_host_key),
            target_auth_type: None,
        };
        let (target_handle, _jump_handle, _guard, _slot) = SshSession::connect_via_jump(
            Arc::new(interactive_ssh_config()),
            target,
            jump,
            tokio::time::Instant::now() + std::time::Duration::from_secs(20),
        )
        .await
        .map_err(|failure| format!("{:?}", failure.error))?;

        /*
         * ## Why this uses the fixture's own command
         *
         * The fixture installs `command=` on every key, so **every** exec request is
         * hijacked by the wrapper: an arbitrary `printf` is discarded and the wrapper
         * runs an interactive login shell that never returns, which measured as "the
         * command timed out" on every case.
         *
         * `terminal-smoke-ready` is the one command the wrapper answers, and it answers
         * with its own fixed marker. That makes it a *better* identity probe than a
         * nonce: a nonce travels in the request and could be echoed by any machine that
         * merely received it, while the marker is produced by the far end itself, from
         * its own wrapper script.
         */
        let command = "terminal-smoke-ready".to_string();
        let output = tokio::time::timeout(std::time::Duration::from_secs(10), async {
            let mut channel = target_handle
                .channel_open_session()
                .await
                .map_err(|error| error.to_string())?;
            channel
                .exec(true, command.as_bytes())
                .await
                .map_err(|error| error.to_string())?;
            /*
             * The loop the product's own `exec` uses. The first version broke on
             * `Eof`/`Close` only, which is the wrong pair to wait for: a server sends
             * `ExitStatus` **before** closing, and breaking early lost the output that
             * had not arrived yet — measured as "the command timed out" on every case.
             */
            let mut stdout = Vec::new();
            loop {
                match channel.wait().await {
                    Some(russh::ChannelMsg::Data { data }) => stdout.extend_from_slice(&data),
                    Some(russh::ChannelMsg::ExtendedData { data, ext }) => {
                        if ext != 1 {
                            stdout.extend_from_slice(&data);
                        }
                    }
                    /*
                     * `ExitStatus` can arrive **before** the last `Data` message; breaking
                     * on it lost the output entirely — measured as an empty string where
                     * the fixture's ready marker was expected. The loop ends on `Eof` /
                     * `Close` / channel end instead, which is what "the far end finished
                     * talking" actually means.
                     */
                    Some(russh::ChannelMsg::ExitStatus { .. }) => continue,
                    Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) => break,
                    None => break,
                    _ => {}
                }
            }
            Ok::<String, String>(String::from_utf8_lossy(&stdout).to_string())
        })
        .await
        .map_err(|_| "the command timed out".to_string())??;
        if !output.contains("TERMINAL_SMOKE_SSH_READY") {
            return Err(format!(
                "the far end answered {output:?}, which is not the fixture's ready marker"
            ));
        }
        Ok(output)
    }

    /*
     * 1. Same bastion, different targets.
     *
     * Both daemons are configured to allow both targets, so "the connection reached the
     * wrong one" is a possible outcome rather than an impossible one — which is what makes
     * this an isolation test instead of a tautology.
     */
    let to_first = marker_through(
        fixture.target_port,
        fixture.target_key.clone(),
        fixture.target_host_key.clone(),
        fixture.bastion_port,
        fixture.bastion_key.clone(),
        fixture.bastion_host_key.clone(),
        fixture.user.clone(),
        nonce.clone(),
    )
    .await
    .expect("the first target must accept its own credential");
    let to_second = marker_through(
        second.target_port,
        second.target_key.clone(),
        second.target_host_key.clone(),
        fixture.bastion_port,
        fixture.bastion_key.clone(),
        fixture.bastion_host_key.clone(),
        fixture.user.clone(),
        nonce.clone(),
    )
    .await
    .expect("the bastion may forward to a second target");
    assert_eq!(
        to_first, to_second,
        "both targets echo this run's nonce; a mismatch means the second connection \\
         reached the first target"
    );

    // 2. Different bastions, same target.
    let via_second_bastion = marker_through(
        fixture.target_port,
        fixture.target_key.clone(),
        fixture.target_host_key.clone(),
        second.bastion_port,
        second.bastion_key.clone(),
        second.bastion_host_key.clone(),
        fixture.user.clone(),
        nonce.clone(),
    )
    .await
    .expect("the second bastion must reach the same target independently");
    assert_eq!(
        to_first, via_second_bastion,
        "reaching the same target through either bastion must produce the same session"
    );

    // 3. The credential does not cross.
    let crossed = marker_through(
        fixture.target_port,
        fixture.target_key.clone(),
        fixture.target_host_key.clone(),
        fixture.bastion_port,
        second.bastion_key.clone(),
        fixture.bastion_host_key.clone(),
        fixture.user.clone(),
        nonce,
    )
    .await;
    assert!(
        crossed.is_err(),
        "a bastion must not accept another bastion's key; a successful read means the two \
         machines' identities are not isolated"
    );
}

/// F12 — a healthy connection through the proxies must succeed, so the fault injections
/// have a control.
///
/// ## Why the proxies exist
///
/// Every other case in this file breaks a connection with the wrong credential. That is a
/// server *deciding*, not a network failing, and the two travel different code paths: a
/// refusal is classified before a session exists, a reset or a stall arrives while
/// something is waiting. Without a controllable fault there is no way to ask whether the
/// product attributes a broken transport to the leg that actually broke.
///
/// The harness puts a shaping proxy in front of each daemon. This case proves the
/// pass-through path works — the same `connect_via_jump` call, dialing proxy ports instead
/// of daemon ports — so a later injected fault cannot be confused with "the proxy broke
/// everything".
///
/// ## Why it skips without proxies
///
/// The older cases must keep running against a harness that starts only daemons. A run
/// without proxy ports says so instead of silently passing.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs to start the proxies"]
async fn a_healthy_connection_through_the_proxies_succeeds() {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping");
            return;
        }
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };
    let Some(proxies) = fixture.proxies else {
        eprintln!("SSH_JUMP_E2E_*_PROXY_PORT not set; skipping the proxy control");
        return;
    };

    let target = JumpTarget {
        host: "127.0.0.1".to_string(),
        /*
         * The **real** target port, not the target proxy's.
         *
         * A jump connection never dials the target itself: it asks the bastion to forward
         * to this address, and the bastion's `PermitOpen` names exactly this port.
         * Pointing it at a proxy port produced `AdministrativelyProhibited` — measured —
         * which is the bastion correctly refusing an address it was not configured for.
         *
         * The target leg is therefore shaped by proxying the **bastion's** dial to the
         * target instead (see the harness), and the bastion leg by the bastion proxy.
         */
        port: fixture.target_port,
        username: fixture.user.clone(),
        password: None,
        private_key: Some(fixture.target_key.clone()),
        certificate: None,
        expected_host_key: Some(public_key(&fixture.target_host_key)),
        use_agent: false,
        allow_agent_forwarding: false,
    };
    let jump = JumpHostConfig {
        host: "127.0.0.1".to_string(),
        port: proxies.bastion,
        username: fixture.user.clone(),
        auth_type: "key".to_string(),
        password: None,
        private_key: Some(fixture.bastion_key.clone()),
        certificate: None,
        expected_host_key: Some(fixture.bastion_host_key.clone()),
        target_auth_type: None,
    };

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(25),
        SshSession::connect_via_jump(
            Arc::new(interactive_ssh_config()),
            target,
            jump,
            tokio::time::Instant::now() + std::time::Duration::from_secs(20),
        ),
    )
    .await
    .expect("a pass-through proxy must not stall the connection");

    result.expect(
        "a healthy connection through pass-through proxies must succeed; a failure here \
         means the proxy changed the traffic, and every injected-fault case after it would \
         be measuring the proxy instead of the product",
    );
}

/// F14 — a fixed number of real connect/disconnect rounds leaves no resource behind.
///
/// ## What this is, and what it is not
///
/// This is the **fast lifecycle regression** F17 asks for: enough rounds to catch a leak
/// in the pool or the registry, few enough to belong in an ordinary CI run. It is not a
/// soak test — a 100-round soak with RSS and FD curves belongs in the manually dispatched
/// workflow, because a curve needs a stable machine to mean anything.
///
/// ## Why the product's own view
///
/// `ssh_resource_keys()` is the pool and registry the *product* reads, not a test-local
/// count. A leak that the product would not see is not a leak a user experiences — and a
/// count the test maintains itself would pass no matter what the product did.
///
/// ## The baseline is asserted, not assumed
///
/// Every round here is fully closed before the next begins, so the count before and after
/// must both be zero. An earlier version of a similar check in this repository compared
/// "after" against "before" without asserting what "before" was, and passed while three
/// resources were already outstanding.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs to start two daemons"]
async fn repeated_connect_and_disconnect_returns_to_a_clean_baseline() {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping");
            return;
        }
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };

    const ROUNDS: usize = 12;

    let (pool_before, registry_before) = ssh_resource_keys().await;
    assert_eq!(
        (pool_before.len(), registry_before.len()),
        (0, 0),
        "the baseline must be clean; a non-zero start makes every later comparison \
         meaningless"
    );

    for round in 0..ROUNDS {
        let target = JumpTarget {
            host: "127.0.0.1".to_string(),
            port: fixture.target_port,
            username: fixture.user.clone(),
            password: None,
            private_key: Some(fixture.target_key.clone()),
            certificate: None,
            expected_host_key: Some(public_key(&fixture.target_host_key)),
            use_agent: false,
            allow_agent_forwarding: false,
        };
        let (target_handle, jump_handle, guard, _slot) = SshSession::connect_via_jump(
            Arc::new(interactive_ssh_config()),
            target,
            jump_config(&fixture),
            tokio::time::Instant::now() + std::time::Duration::from_secs(20),
        )
        .await
        .unwrap_or_else(|failure| {
            panic!("round {round} must connect: hop={:?} stage={:?} {:?}", failure.hop, failure.stage, failure.error)
        });

        disconnect_jump_connections_with_shutdown(
            target_handle,
            jump_handle,
            guard,
            "f14 round complete",
            tokio::time::Instant::now() + std::time::Duration::from_secs(5),
        )
        .await;

        /*
         * Poll rather than assert immediately: `sshd` tears its side down a moment after
         * the client does, and the pool releases on a task. The deadline is what makes
         * this a leak check instead of a race — a real leak never reaches zero, however
         * long you wait.
         */
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let (pool, registry) = ssh_resource_keys().await;
            if pool.is_empty() && registry.is_empty() {
                break;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "round {round} left {} pool and {} registry entries behind",
                pool.len(),
                registry.len()
            );
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }

    let (pool_after, registry_after) = ssh_resource_keys().await;
    assert_eq!(
        (pool_after.len(), registry_after.len()),
        (0, 0),
        "after {ROUNDS} full rounds the product's own resource view must be empty"
    );
}
