use super::*;
use crate::session::local::tests::{fake_local_session, simulate_natural_eof};
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
