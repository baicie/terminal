use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use serde_json::json;

use super::*;

fn passing_result() -> TerminalSmokeResult {
    TerminalSmokeResult {
        ok: true,
        stage: "complete".to_string(),
        error: None,
        load_bytes: LOAD_BYTES,
        rounds_completed: ROUNDS,
        unique_session_count: ROUNDS,
        resources_recovered: true,
        duration_ms: 1234,
        terminal_cols: TARGET_COLS,
        terminal_rows: TARGET_ROWS,
        load_end_visible: true,
        after_load_visible: true,
        resized_size_visible: true,
        reconnect_observed: false,
        stale_output_rejected: false,
    }
}

fn ssh_config() -> TerminalSmokeSshConfig {
    use ssh_key::rand_core::OsRng;

    let private_key = ssh_key::PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519)
        .expect("fixture private key should generate")
        .to_openssh(ssh_key::LineEnding::LF)
        .expect("fixture private key should serialize");
    TerminalSmokeSshConfig {
        host: "127.0.0.1".to_string(),
        port: 42_222,
        username: "terminal-smoke".to_string(),
        private_key: private_key.to_string(),
        expected_host_key:
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti"
                .to_string(),
    }
}

fn unique_result_path() -> PathBuf {
    std::env::temp_dir()
        .join(format!("terminal-smoke-{}", uuid::Uuid::new_v4()))
        .join("result.json")
}

#[test]
fn smoke_mode_requires_an_explicit_one() {
    assert!(enabled_value(Some("1")));
    assert!(!enabled_value(Some("true")));
    assert!(!enabled_value(None));
}

#[test]
fn result_path_rejects_relative_paths() {
    let error = result_path(Some(OsString::from("result.json")))
        .expect_err("a relative result path must be rejected");
    assert!(error.contains("absolute path"), "unexpected error: {error}");
}

#[test]
fn smoke_config_has_the_exact_public_contract_without_a_path() {
    let config = smoke_config(ssh_config());
    let private_key = config.ssh.private_key.clone();
    let value = serde_json::to_value(&config).expect("config should serialize");

    assert_eq!(
        value,
        json!({
            "loadBytes": 8_388_608,
            "initialCols": 80,
            "initialRows": 24,
            "targetCols": 97,
            "targetRows": 31,
            "timeoutMs": 180_000,
            "rounds": 10,
            "reconnectRequired": false,
            "ssh": {
                "host": "127.0.0.1",
                "port": 42_222,
                "username": "terminal-smoke",
                "privateKey": private_key,
                "expectedHostKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti",
            },
        })
    );
}

#[test]
fn ssh_config_parser_accepts_the_isolated_loopback_fixture() {
    let serialized = serde_json::to_vec(&ssh_config()).expect("fixture should serialize");

    let parsed = parse_ssh_config(&serialized).expect("fixture should parse");

    assert_eq!(parsed.port, 42_222);
}

#[test]
fn ssh_config_parser_rejects_non_loopback_hosts() {
    let mut value = serde_json::to_value(ssh_config()).expect("fixture should serialize");
    value["host"] = json!("localhost");

    let error =
        parse_ssh_config(&serde_json::to_vec(&value).expect("modified fixture should serialize"))
            .expect_err("smoke SSH must be bound to the numeric loopback address");

    assert!(error.contains("127.0.0.1"), "unexpected error: {error}");
}

#[test]
fn ssh_config_parser_rejects_unknown_fields() {
    let mut value = serde_json::to_value(ssh_config()).expect("fixture should serialize");
    value["password"] = json!("not-allowed");

    assert!(parse_ssh_config(
        &serde_json::to_vec(&value).expect("modified fixture should serialize")
    )
    .is_err());
}

#[test]
fn connection_deadline_accepts_9999_milliseconds() {
    assert!(validate_connection_deadline(Duration::from_millis(9_999)).is_ok());
}

#[test]
fn connection_deadline_rejects_10000_milliseconds() {
    let error = validate_connection_deadline(Duration::from_millis(10_000))
        .expect_err("the application connection deadline must be strict");

    assert!(error.contains("10000 ms"), "unexpected error: {error}");
}

#[test]
fn success_validation_accepts_the_exact_contract_before_deadline() {
    assert!(validate_success(&passing_result(), Duration::from_secs(2), false).is_ok());
}

#[test]
fn reconnect_success_requires_all_eleven_created_sessions_and_stale_output_rejection() {
    let mut result = passing_result();
    result.unique_session_count = ROUNDS + 1;
    result.reconnect_observed = true;
    result.stale_output_rejected = true;

    assert!(validate_success(&result, Duration::from_secs(2), true).is_ok());
}

#[test]
fn reconnect_success_is_rejected_when_rust_did_not_emit_the_stale_output_probe() {
    let mut result = passing_result();
    result.unique_session_count = ROUNDS + 1;
    result.reconnect_observed = true;
    result.stale_output_rejected = true;

    let normalized = normalize_completion_for_mode(result, Duration::from_secs(2), true, false);

    assert!(!normalized.ok);
    assert_eq!(normalized.stage, "rust-validation");
    assert!(normalized
        .error
        .is_some_and(|error| error.contains("stale-output probe")));
}

#[test]
fn stale_output_probe_rejects_a_session_that_was_not_retired() {
    let error = validate_stale_output_probe(
        true,
        true,
        "ssh-00000000-0000-4000-8000-000000000001",
        "ssh-00000000-0000-4000-8000-000000000002",
        true,
        true,
    )
    .expect_err("the old session must be absent from the Rust manager");

    assert!(error.contains("retired"), "unexpected error: {error}");
}

#[test]
fn stale_output_probe_requires_a_live_distinct_active_session_after_reconnect() {
    let error = validate_stale_output_probe(
        true,
        true,
        "ssh-00000000-0000-4000-8000-000000000001",
        "ssh-00000000-0000-4000-8000-000000000001",
        false,
        false,
    )
    .expect_err("the replacement session must be distinct and live");

    assert!(error.contains("different"), "unexpected error: {error}");
}

#[test]
fn reconnect_checkpoint_write_failure_does_not_mark_the_request_as_published() {
    let mut config = smoke_config(ssh_config());
    config.reconnect_required = true;
    let run = TerminalSmokeRun::new(
        unique_result_path(),
        Some(
            std::env::temp_dir()
                .join(uuid::Uuid::new_v4().to_string())
                .join("missing/reconnect.ready"),
        ),
        config,
        Instant::now(),
    );

    run.request_reconnect()
        .expect_err("a missing checkpoint parent must fail");

    assert!(!run.reconnect_requested.load(Ordering::Acquire));
}

#[test]
fn stale_output_events_use_the_real_ssh_channel_without_an_ack_byte_field() {
    let mut events = Vec::new();

    let markers = emit_stale_output_events(
        "ssh-00000000-0000-4000-8000-000000000001",
        "ssh-00000000-0000-4000-8000-000000000002",
        |event, payload| {
            events.push((
                event,
                serde_json::to_value(payload).expect("payload should serialize"),
            ));
            Ok(())
        },
    )
    .expect("both smoke events should emit");

    assert_eq!(
        serde_json::to_value(markers).expect("markers should serialize"),
        json!({
            "staleMarker": "TERMINAL_SMOKE_STALE_OUTPUT_CANARY",
            "barrierMarker": "TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER",
        })
    );
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].0, "ssh-data");
    assert_eq!(events[1].0, "ssh-data");
    assert_eq!(
        events[0].1["session_id"],
        "ssh-00000000-0000-4000-8000-000000000001"
    );
    assert_eq!(
        events[1].1["session_id"],
        "ssh-00000000-0000-4000-8000-000000000002"
    );
    assert!(events
        .iter()
        .all(|(_, payload)| payload.get("bytes").is_none()));
}

#[test]
fn stale_output_events_do_not_emit_the_barrier_after_the_canary_fails() {
    let mut calls = 0;

    let error = emit_stale_output_events("retired", "active", |_event, _payload| {
        calls += 1;
        Err("webview unavailable".to_string())
    })
    .expect_err("the first emit failure must stop the causal sequence");

    assert_eq!(calls, 1);
    assert!(error.contains("canary"), "unexpected error: {error}");
}

#[test]
fn success_validation_rejects_a_non_complete_stage() {
    let mut result = passing_result();
    result.stage = "resize".to_string();

    assert!(validate_success(&result, Duration::from_secs(2), false).is_err());
}

#[test]
fn success_validation_rejects_an_error_payload() {
    let mut result = passing_result();
    result.error = Some("frontend failure".to_string());

    assert!(validate_success(&result, Duration::from_secs(2), false).is_err());
}

#[test]
fn success_validation_rejects_the_wrong_load_size() {
    let mut result = passing_result();
    result.load_bytes -= 1;

    assert!(validate_success(&result, Duration::from_secs(2), false).is_err());
}

#[test]
fn success_validation_rejects_the_wrong_terminal_size() {
    let mut result = passing_result();
    result.terminal_cols -= 1;

    assert!(validate_success(&result, Duration::from_secs(2), false).is_err());
}

#[test]
fn success_validation_rejects_missing_visible_markers() {
    let mut result = passing_result();
    result.after_load_visible = false;

    assert!(validate_success(&result, Duration::from_secs(2), false).is_err());
}

#[test]
fn success_validation_rejects_a_zero_frontend_duration() {
    let mut result = passing_result();
    result.duration_ms = 0;

    assert!(validate_success(&result, Duration::from_secs(2), false).is_err());
}

#[test]
fn success_validation_rejects_a_frontend_duration_past_deadline() {
    let mut result = passing_result();
    result.duration_ms = TIMEOUT.as_millis() as u64 + 1;

    assert!(validate_success(&result, Duration::from_secs(2), false).is_err());
}

#[test]
fn success_validation_rejects_when_the_rust_deadline_has_elapsed() {
    assert!(
        validate_success(&passing_result(), TIMEOUT + Duration::from_millis(1), false,).is_err()
    );
}

#[test]
fn invalid_success_is_normalized_to_a_rust_validation_failure() {
    let mut result = passing_result();
    result.load_end_visible = false;

    let normalized = normalize_completion(result, Duration::from_secs(2));

    assert_eq!(normalized.stage, "rust-validation");
    assert!(!normalized.ok);
    assert!(normalized.error.is_some());
}

#[test]
fn an_explicit_frontend_failure_is_never_upgraded() {
    let mut result = passing_result();
    result.ok = false;
    result.stage = "load".to_string();
    result.error = Some("load marker timed out".to_string());

    let stage = result.stage.clone();
    let normalized = normalize_completion(result, Duration::from_secs(2));

    assert_eq!(normalized.stage, stage);
    assert!(!normalized.ok);
}

#[test]
fn terminal_smoke_run_allows_exactly_one_finalizer() {
    let run = Arc::new(TerminalSmokeRun::new(
        unique_result_path(),
        None,
        smoke_config(ssh_config()),
        Instant::now(),
    ));
    let barrier = Arc::new(Barrier::new(17));
    let winners = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();

    for _ in 0..16 {
        let run = Arc::clone(&run);
        let barrier = Arc::clone(&barrier);
        let winners = Arc::clone(&winners);
        handles.push(std::thread::spawn(move || {
            barrier.wait();
            if run.claim() {
                winners.fetch_add(1, Ordering::AcqRel);
            }
        }));
    }
    barrier.wait();
    for handle in handles {
        handle.join().expect("claim worker should join");
    }

    assert_eq!(winners.load(Ordering::Acquire), 1);
}

#[tokio::test]
async fn write_result_persists_the_camel_case_contract_atomically() {
    let path = unique_result_path();
    tokio::fs::create_dir_all(path.parent().expect("result parent"))
        .await
        .expect("result directory should be created");

    write_result(&path, &passing_result())
        .await
        .expect("smoke result should be written");
    let value: serde_json::Value = serde_json::from_slice(
        &tokio::fs::read(&path)
            .await
            .expect("smoke result should be readable"),
    )
    .expect("smoke result should be valid JSON");
    let _ = tokio::fs::remove_dir_all(path.parent().expect("result parent")).await;

    assert_eq!(value["loadEndVisible"], true);
}

#[tokio::test]
async fn write_result_refuses_to_overwrite_an_existing_result() {
    let path = unique_result_path();
    tokio::fs::create_dir_all(path.parent().expect("result parent"))
        .await
        .expect("result directory should be created");
    tokio::fs::write(&path, b"existing")
        .await
        .expect("existing result should be created");

    let error = write_result(&path, &passing_result())
        .await
        .expect_err("an existing result must not be overwritten");
    let contents = tokio::fs::read(&path)
        .await
        .expect("existing result should remain readable");
    let _ = tokio::fs::remove_dir_all(path.parent().expect("result parent")).await;

    assert!(
        error.contains("already exists"),
        "unexpected error: {error}"
    );
    assert_eq!(contents, b"existing");
}

#[test]
fn terminal_resource_snapshot_serializes_six_sorted_registry_key_sets() {
    let snapshot = TerminalResourceSnapshot::new(
        vec!["manager-z".to_string(), "manager-a".to_string()],
        vec!["metadata-z".to_string(), "metadata-a".to_string()],
        vec!["channel-z".to_string(), "channel-a".to_string()],
        vec!["pool-z".to_string(), "pool-a".to_string()],
        vec!["registry-z".to_string(), "registry-a".to_string()],
        vec!["output-z".to_string(), "output-a".to_string()],
    );

    assert_eq!(
        serde_json::to_value(snapshot).expect("terminal resource snapshot should serialize"),
        json!({
            "managerSessions": ["manager-a", "manager-z"],
            "metadata": ["metadata-a", "metadata-z"],
            "channels": ["channel-a", "channel-z"],
            "sshPool": ["pool-a", "pool-z"],
            "sshRegistry": ["registry-a", "registry-z"],
            "outputControls": ["output-a", "output-z"],
        })
    );
}

#[tokio::test]
async fn terminal_resource_snapshot_state_boundary_rejects_non_smoke_mode() {
    let state = TerminalSmokeState {
        mode: TerminalSmokeMode::Disabled,
    };

    let error = collect_terminal_resource_snapshot(&state)
        .await
        .expect_err("resource diagnostics must not be available outside terminal smoke mode");

    assert_eq!(error, "terminal smoke mode is not enabled");
}
