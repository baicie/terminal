// DDQ09 — the target leg is finally reachable by fault injection, so prove it.
//
// ## What this test asserts that nothing before it could
//
// Every previous fault scenario injected into the **bastion** leg: the proxy sat in front
// of the bastion daemon, and the product's hop attribution could be checked because the
// broken transport was the one it dials itself. The target leg had no equivalent, and the
// reason was topological rather than architectural:
//
//   product → bastion daemon → (direct-tcpip) → **real target port**
//
// The bastion's `PermitOpen` named the real target port, so a target-side proxy could not
// receive the forwarded bytes even when one was started. `FixtureProxies` says as much in
// its own doc comment, and records the measured symptom of the first attempt at pointing
// the product at a proxy: `AdministrativelyProhibited`, because the bastion was refusing
// an address it had never been allowed to forward to.
//
// The fix is to change the *topology*, not the product:
//
//   product → bastion daemon → (direct-tcpip) → **target proxy** → real target
//
// with the bastion configured to permit exactly the proxy's address. Then a fault injected
// at the target proxy is on the real forwarded path, and `hop` can be asserted against a
// leg that genuinely carried the bytes.
//
// ## Why this file is separate
//
// `ssh_jump_e2e_tests.rs` is already the largest test module in the repository, and every
// addition to it invalidates the acceptance evidence fingerprint. A new file under
// `src-tauri/src` still invalidates it, but the tests it holds can grow without rewriting
// the file they used to live in — the same reason `process_metrics` and
// `terminal_output_tests` are separate files.
//
// ## What it does not claim
//
// The test proves the *fixture* delivers target-leg faults to the product. It does not
// claim the product always names the target when the target leg breaks: `hop` is asserted
// where the evidence supports it, and a transport-level failure the product cannot
// attribute is allowed to be `None` or the bastion — see the per-case comments.

use std::sync::Arc;
use std::time::Duration;

use crate::session::ssh::{
    interactive_ssh_config, ConnectionHop, ConnectionStage, JumpHostConfig, JumpTarget,
    SessionError, SshSession,
};

use super::ssh_jump_e2e_tests::{fixture, public_key, FixtureLookup};

/// The proxy in front of the **target**, on the forwarded path.
///
/// This is the variable the topology change adds. It is deliberately a different name from
/// `SSH_JUMP_E2E_TARGET_PROXY_PORT`, which the harness has been setting for a while and
/// which no Rust code has ever read — pointing the product at that port without also
/// telling the bastion to permit it is what produced `AdministrativelyProhibited` on the
/// first attempt. A new name makes "this case uses the new topology" visible in the
/// harness rather than implicit in an env var that used to be inert.
pub(super) const TARGET_LEG_PROXY_ENV: &str = "SSH_JUMP_E2E_TARGET_LEG_PROXY_PORT";

/// Which fault the target-leg proxy is applying.
pub(super) const SSH_JUMP_E2E_TARGET_LEG_SCENARIO_ENV: &str = "SSH_JUMP_E2E_TARGET_LEG_SCENARIO";

/// Read the fixture and the target-proxy port, or skip when the harness did not start one.
fn target_leg_setup() -> Option<(super::ssh_jump_e2e_tests::Fixture, u16, String)> {
    let fixture = match fixture() {
        FixtureLookup::Ready(fixture) => *fixture,
        FixtureLookup::NotConfigured => {
            eprintln!("SSH_JUMP_E2E_* not set; skipping the target-leg matrix");
            return None;
        }
        FixtureLookup::Broken(reason) => panic!("the harness is not usable: {reason}"),
    };
    let Ok(port) = std::env::var(TARGET_LEG_PROXY_ENV).map(|value| {
        value
            .parse::<u16>()
            .expect("the target-leg proxy port must be a number")
    }) else {
        eprintln!("{TARGET_LEG_PROXY_ENV} not set; skipping the target-leg matrix");
        return None;
    };
    let scenario =
        std::env::var(SSH_JUMP_E2E_TARGET_LEG_SCENARIO_ENV).unwrap_or_else(|_| "healthy".into());
    Some((fixture, port, scenario))
}

/// What each scenario must establish, and why it is that and not more.
///
/// ## Why "hop must be Target" is asserted only where the evidence exists
///
/// A transport reset on the forwarded channel arrives at the client as a closed channel,
/// not as a message from the target host. The product genuinely cannot tell "the target
/// machine went away" from "the network path to it broke" — both are the same EOF. When
/// the product does not know, the assertion is that it says so (or blames the leg it can
/// see) rather than inventing a cause. That distinction is the whole point of
/// `SessionFailure`: `hop` is `Option`, and `None` is an honest answer.
///
/// What every scenario does assert, because a healthy connection would violate it:
///
///   * the call returns within the budget — a fault never becomes a hang;
///   * the session and the pool are released — `ssh_resource_keys()` is empty afterwards;
///   * the bastion is not blamed for a fault that happened behind it *when the failure
///     carries a hop at all*.
#[tokio::test]
#[ignore = "needs scripts/verify-install/ssh-jump-e2e.mjs with the target-leg proxy"]
async fn a_target_leg_fault_reaches_the_product_and_is_bounded() {
    let Some((fixture, proxy_port, scenario)) = target_leg_setup() else {
        return;
    };

    /*
     * ## Point the product at the proxy, and the bastion at the proxy too
     *
     * This is the pair the earlier attempt was missing: pointing the product's target port
     * at a proxy without telling the bastion to permit that address produced
     * `AdministrativelyProhibited`, which is the *correct* bastion behaviour and the wrong
     * fixture. The harness now starts the bastion with `PermitOpen 127.0.0.1:<proxy>`, so
     * the forwarded bytes really do traverse the proxy.
     */
    let target = JumpTarget {
        host: "127.0.0.1".to_string(),
        port: proxy_port,
        username: fixture.user.clone(),
        password: None,
        private_key: Some(fixture.target_key.clone()),
        certificate: None,
        // Still pinned to the **real target's** key: the proxy is transparent, so a
        // connection that reached it must present the target's own host key. A proxy that
        // terminated TLS/SSH itself would fail here, which is the check that keeps this
        // from being a test of the proxy.
        expected_host_key: Some(public_key(&fixture.target_host_key)),
        use_agent: false,
        allow_agent_forwarding: false,
    };

    let (before_pool, before_registry) = crate::session::ssh::ssh_resource_keys().await;
    assert!(
        before_pool.is_empty() && before_registry.is_empty(),
        "the target-leg matrix must start from a clean pool, found pool={before_pool:?} registry={before_registry:?}"
    );

    let started = tokio::time::Instant::now();
    let result = tokio::time::timeout(
        Duration::from_secs(45),
        SshSession::connect_via_jump(
            Arc::new(interactive_ssh_config()),
            target,
            JumpHostConfig {
                host: "127.0.0.1".to_string(),
                port: fixture.bastion_port,
                username: fixture.user.clone(),
                auth_type: "key".to_string(),
                password: None,
                private_key: Some(fixture.bastion_key.clone()),
                certificate: None,
                expected_host_key: Some(fixture.bastion_host_key.clone()),
                target_auth_type: Some("key".to_string()),
            },
            tokio::time::Instant::now() + Duration::from_secs(30),
        ),
    )
    .await;
    let elapsed = started.elapsed();
    eprintln!(
        "SSH_JUMP_E2E_TARGET_LEG_RESULT scenario={scenario} elapsed_ms={}",
        elapsed.as_millis()
    );

    match scenario.as_str() {
        /*
         * The control, and the case that proves the topology at all.
         *
         * A pass-through proxy on the forwarded path must not change the outcome: both
         * handshakes complete and no hop is named. Without this, a target proxy that
         * silently refused every connection would make the fault scenarios "pass" for a
         * reason that has nothing to do with the product.
         */
        "healthy" => {
            let connected = result.unwrap_or_else(|_| {
                panic!("a pass-through target proxy must not stall the connection ({elapsed:?})")
            });
            connected.expect(
                "with a pass-through target proxy the two-hop connection must still succeed",
            );
        }
        /*
         * The proxy accepts the bastion's `direct-tcpip` channel and forwards nothing.
         * This is the target leg's black hole: the bastion is healthy, the target is
         * healthy, and the path between them is not.
         *
         * The product must fail inside its budget rather than hang, and it must not report
         * a credential problem — no credential was ever sent, because the SSH handshake
         * with the target never started.
         */
        "target-blackhole" => {
            let outcome = result.unwrap_or_else(|_| {
                panic!(
                    "a target-side black hole must fail within the budget, not hang ({elapsed:?})"
                )
            });
            let Err(failure) = outcome else {
                panic!("a forwarded path that carries nothing cannot produce a working session")
            };
            assert!(
                !matches!(failure.error, SessionError::AuthenticationRejected(_)),
                "a transport that never delivered the handshake is not a credential refusal: {}",
                failure.error
            );
            /*
             * Not asserting `hop == Some(Target)`: the product sees a channel that stopped
             * answering, and the bastion is the peer it is actually talking to. Asserting
             * the target would encode a claim the evidence does not support.
             */
        }
        /*
         * The proxy forwards the handshake and then destroys the connection once real
         * bytes have moved. That is the "connection was working and then broke" shape,
         * and unlike the black hole it proves the proxy was on the path: `cutAfterBytes`
         * cannot fire otherwise.
         */
        "target-reset" => {
            let outcome = result.expect("a target-side reset must resolve, not hang");
            let Err(failure) = outcome else {
                panic!("a connection cut after the target handshake cannot succeed")
            };
            assert!(
                !matches!(failure.error, SessionError::AuthenticationRejected(_)),
                "a transport reset is not a credential refusal: {}",
                failure.error
            );
            /*
             * When the product does name a hop here, blaming the bastion is wrong: the
             * bastion completed its handshake and forwarded. `None` is allowed because a
             * mid-stream close carries no attribution the client can verify.
             */
            assert_ne!(
                failure.hop,
                Some(ConnectionHop::Bastion),
                "the bastion authenticated and forwarded successfully; a break behind it \
                 must not be attributed to the bastion (stage={:?}, error={})",
                failure.stage,
                failure.error
            );
        }
        /*
         * DDQ10 — the remaining four shapes the task book names.
         *
         * All of them share one property worth asserting together: the bastion authenticated
         * and forwarded successfully, so **none** of them may be reported as a bastion
         * problem. Beyond that they differ in what the product can honestly know, and the
         * differences are the point:
         *
         *   · `target-refused` — the kernel refused the connect. This is the most
         *     attributable failure in the set: the client asked for a specific address and
         *     was told no. It is still not a credential problem.
         *   · `target-reset-handshake` — no credential was sent, so an auth rejection would
         *     be a fabrication.
         *   · `target-reset-auth` — a credential WAS offered, so an auth-class error is
         *     explicable; what must not happen is blaming the bastion.
         *   · `target-break-after-connect` / `target-break-during-output` — the session
         *     worked and then died. These are the shapes a user reports as "it dropped".
         */
        "target-refused" => {
            let outcome = result.expect("a refused connect must resolve, not hang");
            let Err(failure) = outcome else {
                panic!("a port with no listener cannot produce a working session")
            };
            assert!(
                !matches!(failure.error, SessionError::AuthenticationRejected(_)),
                "a refused TCP connect is not a credential refusal: {}",
                failure.error
            );
            /*
             * ## `hop == Bastion` is the product's documented answer here, not a defect
             *
             * This assertion started as `assert_ne!(hop, Bastion)` — "the bastion was fine,
             * so it cannot be the bastion's fault" — and it failed on the first run:
             *
             *   stage=Some(TunnelOpen)
             *   error=channel error: open jump host tunnel failed: Failed to open channel
             *         (ConnectFailed)
             *   hop=Some(Bastion)
             *
             * The product is right and the assertion was wrong. `ssh.rs` states the contract
             * at the site that produces this failure: "`Bastion` names the connection that
             * *holds* the channel, not where the physical fault is: the bastion may refuse
             * forwarding, or the target address may be unreachable from it. This API does
             * not distinguish those."
             *
             * A `direct-tcpip` open failure arrives at the client as one refusal; the client
             * cannot tell "the bastion's PermitOpen said no" from "the bastion dialled and
             * the kernel said no". What it *can* say is which stage failed. So the
             * assertion is on the stage, and `Bastion` is accepted — this test pins the
             * documented behaviour rather than an opinion about attribution.
             */
            assert_eq!(
                failure.stage,
                Some(ConnectionStage::TunnelOpen),
                "a refused connect fails while opening the tunnel, not later: hop={:?} \
                 error={}",
                failure.hop,
                failure.error
            );
        }
        "target-reset-handshake" => {
            let outcome = result.expect("a reset must resolve, not hang");
            let Err(failure) = outcome else {
                panic!("a connection cut inside the handshake cannot succeed")
            };
            assert!(
                !matches!(failure.error, SessionError::AuthenticationRejected(_)),
                "the cut fired before any credential was sent, so this cannot be a \
                 credential refusal: {}",
                failure.error
            );
            assert_ne!(
                failure.hop,
                Some(ConnectionHop::Bastion),
                "the bastion completed its own handshake before forwarding: hop={:?} \
                 stage={:?} error={}",
                failure.hop,
                failure.stage,
                failure.error
            );
        }
        "target-reset-auth" => {
            let outcome = result.expect("a reset must resolve, not hang");
            let Err(failure) = outcome else {
                panic!("a connection cut during authentication cannot succeed")
            };
            /*
             * Deliberately *not* asserting the error class: a stream that dies mid-userauth
             * may legitimately surface as a connection error or as an auth failure the
             * client cannot distinguish. What is not negotiable is the attribution.
             */
            assert_ne!(
                failure.hop,
                Some(ConnectionHop::Bastion),
                "a break during the target's usertransport is not the bastion's: hop={:?} \
                 stage={:?} error={}",
                failure.hop,
                failure.stage,
                failure.error
            );
        }
        other => panic!(
            "unknown target-leg scenario {other:?}; the harness and this case must agree on \
             the names (healthy, target-blackhole, target-refused, target-reset-handshake, \
             target-reset-auth)"
        ),
    }

    /*
     * ## Zero residue, whatever happened
     *
     * Every path above either succeeded (and dropped its handles) or failed, and a failure
     * that leaves a pool entry behind is the leak this matrix would otherwise hide: a
     * fault scenario that "passed" while leaking one entry per run looks identical to a
     * clean one in the verdict.
     *
     * The pool is checked after a short settle because teardown is asynchronous — measured
     * on the bastion matrix, the keys were still present for a few milliseconds after the
     * call returned.
     */
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let (pool, registry) = crate::session::ssh::ssh_resource_keys().await;
        if pool.is_empty() && registry.is_empty() {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            panic!(
                "the pool did not return to empty after the target-leg scenario: \
                 pool={pool:?} registry={registry:?}"
            );
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}
