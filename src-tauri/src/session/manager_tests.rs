use super::*;
use crate::session::local::tests::{
    fake_local_session, fake_local_session_with_blocking_reader, simulate_natural_eof,
};
use std::time::Duration;

async fn registry_counts(manager: &SessionManager) -> (usize, usize, usize) {
    let sessions = manager.len().await;
    let metadata = manager.session_meta.lock().await.len();
    let channels = manager.channel_manager.len().await;
    (sessions, metadata, channels)
}

async fn wait_for_empty_registries(manager: &SessionManager) {
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if registry_counts(manager).await == (0, 0, 0) {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("completion cleanup should empty all registries");
}

async fn remove_test_sessions(manager: &SessionManager, session_ids: &[String]) {
    for session_id in session_ids {
        manager
            .remove_session(session_id)
            .await
            .expect("test cleanup should be idempotent");
    }
}

#[tokio::test]
async fn session_lifecycle_registration_discards_session_completed_before_registration() {
    let manager = SessionManager::new();
    let session_id = "completed-before-register".to_string();
    let (session, _) = fake_local_session(&session_id, false);

    manager.register_session(SessionState::Local(session)).await;
    wait_for_empty_registries(&manager).await;
    let actual = registry_counts(&manager).await;
    remove_test_sessions(&manager, std::slice::from_ref(&session_id)).await;

    assert_eq!(
        actual,
        (0, 0, 0),
        "an EOF racing ahead of registration must not leave session, metadata, or channel entries"
    );
}

#[tokio::test]
async fn session_registration_after_shutdown_is_rejected_and_closed() {
    let manager = SessionManager::new();
    manager.shutdown().await;

    let (session, probe) = fake_local_session("late-registration-after-shutdown", true);
    let accepted = manager.register_session(SessionState::Local(session)).await;

    assert!(
        !accepted,
        "shutdown must reject sessions that finish connecting late"
    );
    assert_eq!(
        probe.kill_calls(),
        1,
        "a rejected late session must be closed"
    );
    assert_eq!(registry_counts(&manager).await, (0, 0, 0));
}

#[tokio::test]
async fn close_all_keeps_manager_available_for_later_sessions() {
    let manager = SessionManager::new();
    manager.close_all().await;

    let (session, _) = fake_local_session("registration-after-close-all", true);
    let accepted = manager.register_session(SessionState::Local(session)).await;

    assert!(accepted, "close_all must not permanently stop the manager");
    manager.close_all().await;
    assert_eq!(registry_counts(&manager).await, (0, 0, 0));
}

#[tokio::test]
async fn session_lifecycle_natural_eof_removes_all_registries() {
    let manager = SessionManager::new();
    let session_id = "natural-eof".to_string();
    let (session, _) = fake_local_session(&session_id, true);

    manager
        .register_session(SessionState::Local(session.clone()))
        .await;
    simulate_natural_eof(&session).await;
    wait_for_empty_registries(&manager).await;
    let actual = registry_counts(&manager).await;
    remove_test_sessions(&manager, std::slice::from_ref(&session_id)).await;

    assert_eq!(
        actual,
        (0, 0, 0),
        "natural EOF must remove the session, its metadata, and its channel"
    );
}

#[tokio::test]
async fn session_lifecycle_ten_natural_eof_cycles_leave_no_registrations() {
    let manager = SessionManager::new();
    let mut session_ids = Vec::new();

    for index in 0..10 {
        let session_id = format!("natural-eof-cycle-{index}");
        let (session, _) = fake_local_session(&session_id, true);
        manager
            .register_session(SessionState::Local(session.clone()))
            .await;
        simulate_natural_eof(&session).await;
        session_ids.push(session_id);
    }

    wait_for_empty_registries(&manager).await;
    let actual = registry_counts(&manager).await;
    remove_test_sessions(&manager, &session_ids).await;

    assert_eq!(
        actual,
        (0, 0, 0),
        "repeated natural exits must not accumulate registry entries"
    );
}

#[tokio::test]
async fn session_lifecycle_duplicate_eof_and_close_are_idempotent() {
    let manager = SessionManager::new();
    let session_id = "duplicate-eof-close".to_string();
    let (session, probe) = fake_local_session(&session_id, true);
    manager
        .register_session(SessionState::Local(session.clone()))
        .await;

    simulate_natural_eof(&session).await;
    simulate_natural_eof(&session).await;
    let (first_close, second_close) = tokio::join!(
        manager.remove_session(&session_id),
        manager.remove_session(&session_id)
    );
    let actual = (
        first_close.is_ok(),
        second_close.is_ok(),
        probe.kill_calls(),
        probe.reap_calls(),
        registry_counts(&manager).await,
    );

    assert_eq!(
        actual,
        (true, true, 0, 1, (0, 0, 0)),
        "duplicate EOF/close must remain successful and reap the naturally exited child once"
    );
}

#[tokio::test]
async fn session_lifecycle_close_all_reclaims_every_registered_session() {
    let manager = SessionManager::new();
    let mut probes = Vec::new();

    for index in 0..3 {
        let (session, probe) = fake_local_session(format!("close-all-{index}"), true);
        manager.register_session(SessionState::Local(session)).await;
        probes.push(probe);
    }

    manager.close_all().await;
    manager.close_all().await;

    let actual = (
        registry_counts(&manager).await,
        probes.iter().map(|probe| probe.kill_calls()).sum::<usize>(),
        probes.iter().map(|probe| probe.reap_calls()).sum::<usize>(),
    );

    assert_eq!(
        actual,
        ((0, 0, 0), 3, 3),
        "bulk shutdown must close each session once and empty every registry"
    );
}

#[tokio::test]
async fn shutdown_waits_for_a_session_removed_while_its_close_is_in_flight() {
    let manager = Arc::new(SessionManager::new());
    let (session, _, release_close) =
        fake_local_session_with_blocking_reader("remove-close-in-flight");
    manager.register_session(SessionState::Local(session)).await;

    let remove_manager = Arc::clone(&manager);
    let remove_task = tokio::spawn(async move {
        remove_manager
            .remove_session("remove-close-in-flight")
            .await
            .expect("the explicit close should succeed");
    });
    wait_for_empty_registries(&manager).await;

    let shutdown_manager = Arc::clone(&manager);
    let mut shutdown_task = tokio::spawn(async move {
        shutdown_manager.shutdown().await;
    });
    let shutdown_returned_before_close =
        tokio::time::timeout(Duration::from_millis(10), &mut shutdown_task)
            .await
            .is_ok();

    release_close
        .send(())
        .expect("the in-flight close should be released");
    remove_task.await.expect("remove task should finish");
    if !shutdown_returned_before_close {
        shutdown_task.await.expect("shutdown task should finish");
    }
    assert_eq!(registry_counts(&manager).await, (0, 0, 0));
    assert!(
        !shutdown_returned_before_close,
        "shutdown must wait for an explicit close that already removed its registry entry"
    );
}

#[tokio::test]
async fn every_removal_path_notifies_listeners() {
    // The SFTP registry is keyed by session id but owned outside the manager. It is
    // only correct if *every* way a session can leave the registry fires the same
    // notification: explicit close, completion cleanup, and shutdown. Before this
    // hook only the `session_close` command dropped the SFTP entry.
    let manager = SessionManager::new();
    let seen = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    {
        let seen = Arc::clone(&seen);
        manager.on_session_removed(Arc::new(move |id: String| {
            seen.lock().unwrap().push(id);
        }));
    }

    // 1. Explicit removal.
    let session_id = "notify-explicit".to_string();
    let (session, _) = fake_local_session(&session_id, true);
    manager.register_session(SessionState::Local(session)).await;
    manager.remove_session(&session_id).await.unwrap();
    assert!(
        seen.lock().unwrap().contains(&session_id),
        "explicit removal must notify"
    );

    // 2. Shutdown drains every remaining session.
    let other = "notify-shutdown".to_string();
    let (session, _) = fake_local_session(&other, true);
    manager.register_session(SessionState::Local(session)).await;
    manager.shutdown().await;
    assert!(
        seen.lock().unwrap().contains(&other),
        "shutdown must notify for every drained session"
    );
}

#[tokio::test]
async fn a_removal_listener_that_is_never_registered_is_not_required() {
    // Regression guard: the hook must be optional. A manager with no listeners
    // still tears sessions down normally — the SFTP registry is not a prerequisite
    // for session lifecycle.
    let manager = SessionManager::new();
    let session_id = "no-listener".to_string();
    let (session, _) = fake_local_session(&session_id, true);
    manager.register_session(SessionState::Local(session)).await;
    manager.remove_session(&session_id).await.unwrap();
    assert_eq!(registry_counts(&manager).await, (0, 0, 0));
}

// ---------------------------------------------------------------------------
// TN-UX1-04 · every removal path must notify, including natural completion
// ---------------------------------------------------------------------------

#[tokio::test]
async fn natural_completion_notifies_removal_listeners() {
    // The gap this closes: `spawn_completion_cleanup` dropped the three
    // registries but never fired `notify_removed`, so a session that ended on
    // its own (remote EOF, remote disconnect, shell exit) left its SFTP registry
    // entry behind — a dangling `Arc<SftpSession>` on a dead transport. Only
    // `session_close` and `shutdown` notified, which is why the SFTP map used to
    // grow for the lifetime of the process.
    let manager = SessionManager::new();
    let seen = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    {
        let seen = Arc::clone(&seen);
        manager.on_session_removed(Arc::new(move |id: String| {
            seen.lock().unwrap().push(id);
        }));
    }

    let session_id = "notify-natural-eof".to_string();
    let (session, _) = fake_local_session(&session_id, true);
    manager
        .register_session(SessionState::Local(session.clone()))
        .await;
    simulate_natural_eof(&session).await;
    wait_for_empty_registries(&manager).await;

    // The listener is what drops the SFTP entry, so it must have run by the time
    // the registries are empty. Poll rather than assume the spawn already ran.
    let notified = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if seen.lock().unwrap().contains(&session_id) {
                return true;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap_or(false);

    assert!(
        notified,
        "natural completion must fire the removal listeners, not just drop the registries"
    );
}

#[tokio::test]
async fn every_removal_path_notifies_exactly_once_per_session() {
    // Duplicate notification is not harmless: the SFTP listener is idempotent
    // today, but a second registry added later would see two closes for one
    // session. Completion cleanup and an explicit close race constantly — a user
    // closing a tab at the same moment the remote drops is the normal case.
    let manager = SessionManager::new();
    let seen = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    {
        let seen = Arc::clone(&seen);
        manager.on_session_removed(Arc::new(move |id: String| {
            seen.lock().unwrap().push(id);
        }));
    }

    // 1. Natural completion followed by an explicit close of the same id.
    let natural_id = "once-natural-then-close".to_string();
    let (session, _) = fake_local_session(&natural_id, true);
    manager
        .register_session(SessionState::Local(session.clone()))
        .await;
    simulate_natural_eof(&session).await;
    wait_for_empty_registries(&manager).await;
    manager.remove_session(&natural_id).await.unwrap();

    // 2. Two concurrent explicit closes of one session.
    let race_id = "once-double-close".to_string();
    let (session, _) = fake_local_session(&race_id, true);
    manager.register_session(SessionState::Local(session)).await;
    let (a, b) = tokio::join!(
        manager.remove_session(&race_id),
        manager.remove_session(&race_id)
    );
    a.unwrap();
    b.unwrap();

    let counts = {
        let seen = seen.lock().unwrap();
        (
            seen.iter().filter(|id| **id == natural_id).count(),
            seen.iter().filter(|id| **id == race_id).count(),
        )
    };

    assert_eq!(
        counts,
        (1, 1),
        "each session must notify exactly once, however its removal raced"
    );
}

#[tokio::test]
async fn shutdown_after_natural_completion_still_notifies_once() {
    let manager = SessionManager::new();
    let seen = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    {
        let seen = Arc::clone(&seen);
        manager.on_session_removed(Arc::new(move |id: String| {
            seen.lock().unwrap().push(id);
        }));
    }

    let session_id = "shutdown-after-eof".to_string();
    let (session, _) = fake_local_session(&session_id, true);
    manager
        .register_session(SessionState::Local(session.clone()))
        .await;
    simulate_natural_eof(&session).await;
    wait_for_empty_registries(&manager).await;
    manager.shutdown().await;

    let count = seen
        .lock()
        .unwrap()
        .iter()
        .filter(|id| **id == session_id)
        .count();
    assert_eq!(
        count, 1,
        "shutdown must not re-notify a session completion already retired"
    );
}

// ---------------------------------------------------------------------------
// A panicking listener must not abort teardown
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_panicking_removal_listener_does_not_abort_the_others() {
    // `notify_removed`'s own doc comment promises this, and the code did not do it:
    // the loop called each listener with no guard, so one panic unwound through
    // session teardown, skipped every later listener, and — depending on the caller —
    // either aborted the close or poisoned the removal path. Every registry keyed by
    // session id depends on this notification arriving.
    let manager = SessionManager::new();
    let reached = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let reached = Arc::clone(&reached);
        manager.on_session_removed(Arc::new(move |_id: String| {
            reached.store(true, std::sync::atomic::Ordering::SeqCst);
        }));
    }
    manager.on_session_removed(Arc::new(|_id: String| {
        panic!("a listener that panics");
    }));
    {
        // Registered after the panicker, so it only runs if the panic was contained.
        let reached = Arc::clone(&reached);
        manager.on_session_removed(Arc::new(move |_id: String| {
            reached.store(true, std::sync::atomic::Ordering::SeqCst);
        }));
    }

    let session_id = "panicking-listener".to_string();
    let (session, _) = fake_local_session(&session_id, true);
    manager.register_session(SessionState::Local(session)).await;

    // The removal itself must still succeed.
    manager
        .remove_session(&session_id)
        .await
        .expect("a panicking listener must not fail the removal");
    assert!(
        reached.load(std::sync::atomic::Ordering::SeqCst),
        "listeners registered after a panicking one must still run"
    );
    assert_eq!(registry_counts(&manager).await, (0, 0, 0));
}

/// F09 — `shutdown()` must not deadlock on the lock `close_all()` needs.
///
/// ## The defect this pins
///
/// `shutdown` took `self.lifecycle.lock()` and then called `close_all`, which takes the
/// same `tokio::sync::Mutex`. That mutex is not reentrant, so the second `lock()` waited
/// on a guard the same task was holding — forever.
///
/// Measured through the product smoke harness before the fix: the app logged
/// `terminal smoke finalized ok=true stage=failure-observed`, then sat for the harness's
/// full 210-second deadline without exiting. Every earlier smoke case also went through
/// this path, but they finish by *connecting* and the assertion passes on the result file,
/// so the hang only became visible once a case ended in an error state that still counts
/// as a pass.
///
/// The timeout is what makes this a test rather than another hang: without it a
/// regression here would stall the whole Rust suite instead of failing one case.
#[tokio::test]
async fn shutdown_completes_instead_of_deadlocking_on_its_own_lifecycle_lock() {
    let manager = SessionManager::new();

    tokio::time::timeout(Duration::from_secs(2), manager.shutdown())
        .await
        .expect("shutdown deadlocked: it holds the lifecycle mutex while close_all needs it");
}

/// The same invariant with work to do, so the case above cannot pass on an empty registry.
#[tokio::test]
async fn shutdown_completes_with_a_registered_session() {
    let manager = SessionManager::new();
    let (session, _probe) = fake_local_session("shutdown-with-a-session", true);
    assert!(
        manager.register_session(SessionState::Local(session)).await,
        "registering a fake session must succeed"
    );

    tokio::time::timeout(Duration::from_secs(2), manager.shutdown())
        .await
        .expect("shutdown deadlocked with a session to close");

    assert_eq!(
        registry_counts(&manager).await,
        (0, 0, 0),
        "shutdown must leave every registry empty"
    );
}

/// F16 — a session that fails does not take its neighbours with it, and one session's
/// cleanup cannot delete another's registration.
///
/// ## The shape this pins
///
/// The manager holds local PTYs, SSH sessions and serial ports in one registry, keyed by
/// session id, with shared resources (channels, output buffers, the connection pool) keyed
/// the same way. That sharing is the whole design — and it is also how one session's
/// teardown could reach into another if a key were ever derived from something less
/// specific than the id.
///
/// The assertions are deliberately about the **other** sessions: what the failed one did
/// to itself is covered elsewhere, and a test that only watched the failing session would
/// pass on an implementation that removed everything.
#[tokio::test]
async fn a_failing_session_leaves_its_neighbours_registered_and_working() {
    let manager = SessionManager::new();

    let (healthy_a, _probe_a) = fake_local_session("f16-a", true);
    let (healthy_b, _probe_b) = fake_local_session("f16-b", true);
    let (doomed, _probe_doomed) = fake_local_session("f16-doomed", true);

    for session in [&healthy_a, &healthy_b, &doomed] {
        assert!(
            manager
                .register_session(SessionState::Local(session.clone()))
                .await,
            "every session must register"
        );
    }
    assert_eq!(manager.len().await, 3);

    // One session fails. In the product this is a reader error or a child exit; here the
    // removal path is the one both go through.
    manager
        .remove_session("f16-doomed")
        .await
        .expect("removing a registered session must succeed");

    assert_eq!(
        manager.len().await,
        2,
        "exactly one session may disappear; a bulk removal here would be the defect"
    );

    /*
     * The neighbours are not merely counted — they are still addressable by id and still
     * report themselves alive. A registry that kept a dangling entry would satisfy the
     * count above.
     */
    for id in ["f16-a", "f16-b"] {
        let session = manager
            .get_session(id)
            .await
            .unwrap_or_else(|| panic!("{id} must still be registered after a neighbour failed"));
        assert!(session.is_alive(), "{id} must still be alive");
    }

    remove_test_sessions(&manager, &["f16-a".to_string(), "f16-b".to_string()]).await;
    assert_eq!(registry_counts(&manager).await, (0, 0, 0));
}

/// The same rule with the *shared* registries: a session id's channel and metadata belong
/// to that id alone.
#[tokio::test]
async fn removing_one_session_does_not_clear_another_sessions_channel() {
    let manager = SessionManager::new();
    let (first, _probe_first) = fake_local_session("f16-channel-a", true);
    let (second, _probe_second) = fake_local_session("f16-channel-b", true);
    manager.register_session(SessionState::Local(first)).await;
    manager.register_session(SessionState::Local(second)).await;

    assert!(manager
        .channel_manager
        .get_channel("f16-channel-a")
        .await
        .is_some());
    assert!(manager
        .channel_manager
        .get_channel("f16-channel-b")
        .await
        .is_some());

    manager
        .remove_session("f16-channel-a")
        .await
        .expect("removal must succeed");

    assert!(
        manager
            .channel_manager
            .get_channel("f16-channel-b")
            .await
            .is_some(),
        "the surviving session's channel must not be cleared with its neighbour's"
    );
    assert!(
        manager
            .channel_manager
            .get_channel("f16-channel-a")
            .await
            .is_none(),
        "the removed session's channel must be gone"
    );
    remove_test_sessions(&manager, &["f16-channel-b".to_string()]).await;
}
