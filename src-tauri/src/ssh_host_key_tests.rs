use std::future::Future;

use super::*;
use crate::session::JumpHostConfig;

const ED25519_PUBLIC_KEY: &str =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti";

fn public_key() -> PublicKey {
    PublicKey::from_openssh(ED25519_PUBLIC_KEY).expect("test key should parse")
}

#[test]
fn known_host_check_maps_all_tofu_states() {
    let trusted = classify_known_host(Ok(true));
    let unknown = classify_known_host(Ok(false));
    let changed = classify_known_host(Err(russh::keys::Error::KeyChanged { line: 7 }));

    assert_eq!(
        (trusted, unknown, changed),
        (
            Ok(SshHostKeyStatus::Trusted),
            Ok(SshHostKeyStatus::Unknown),
            Ok(SshHostKeyStatus::Changed),
        )
    );
}

#[test]
fn changed_host_key_cannot_be_learned() {
    let result = ensure_key_may_be_learned(SshHostKeyStatus::Changed, "example.com", 22);

    assert!(matches!(
        result,
        Err(SshHostKeyError::HostKeyChanged(message)) if message.contains("example.com:22")
    ));
}

#[test]
fn unknown_host_key_may_be_learned_once() {
    let result = ensure_key_may_be_learned(SshHostKeyStatus::Unknown, "example.com", 22);

    assert!(result.expect("unknown key should be learnable"));
}

#[test]
fn trusted_host_key_does_not_need_a_duplicate_entry() {
    let result = ensure_key_may_be_learned(SshHostKeyStatus::Trusted, "example.com", 22);

    assert!(!result.expect("trusted key should be idempotent"));
}

#[test]
fn probe_result_contains_stable_frontend_contract() {
    let result = probe_result(
        "example.com",
        2222,
        SshHostKeyStatus::Unknown,
        &public_key(),
    )
    .expect("probe result should serialize the key");

    assert_eq!(
        (
            result.status,
            result.host.as_str(),
            result.port,
            result.algorithm.as_str(),
            result.fingerprint.starts_with("SHA256:"),
            result.public_key.as_str(),
        ),
        (
            SshHostKeyStatus::Unknown,
            "example.com",
            2222,
            "ssh-ed25519",
            true,
            ED25519_PUBLIC_KEY,
        )
    );
}

#[test]
fn status_serializes_as_lowercase_contract_value() {
    let json =
        serde_json::to_value(SshHostKeyStatus::Changed).expect("host-key status should serialize");

    assert_eq!(json, serde_json::json!("changed"));
}

#[test]
fn learn_appends_unknown_key_and_is_idempotent() {
    let path = std::env::temp_dir().join(format!(
        "terminal-learn-known-hosts-{}",
        uuid::Uuid::new_v4()
    ));
    let key = public_key();

    learn_host_key_at_path("example.com", 22, &key, &path)
        .expect("unknown host key should be learned");
    learn_host_key_at_path("example.com", 22, &key, &path)
        .expect("learning a trusted key should be idempotent");
    let contents = std::fs::read_to_string(&path).expect("known_hosts should be readable");

    std::fs::remove_file(path).expect("temporary known_hosts should be removable");
    assert_eq!(contents.lines().filter(|line| !line.is_empty()).count(), 1);
}

#[test]
fn learn_never_overwrites_changed_key() {
    let path = std::env::temp_dir().join(format!(
        "terminal-changed-known-hosts-{}",
        uuid::Uuid::new_v4()
    ));
    let original = format!("example.com {ED25519_PUBLIC_KEY}\n");
    std::fs::write(&path, &original).expect("temporary known_hosts should be writable");
    let changed_key = PublicKey::from(russh::keys::ssh_key::public::Ed25519PublicKey([0x42; 32]));

    let result = learn_host_key_at_path("example.com", 22, &changed_key, &path);
    let contents = std::fs::read_to_string(&path).expect("known_hosts should be readable");

    std::fs::remove_file(path).expect("temporary known_hosts should be removable");
    assert!(matches!(result, Err(SshHostKeyError::HostKeyChanged(_))));
    assert_eq!(contents, original);
}

#[tokio::test]
async fn probe_handler_captures_and_accepts_the_exact_server_key() {
    let captured = Arc::new(StdMutex::new(None));
    let mut handler = HostKeyProbeHandler::new(Arc::clone(&captured));
    let key = public_key();

    let accepted = handler
        .check_server_key(&key)
        .await
        .expect("probe handler should accept the key for inspection");

    assert_eq!(
        (accepted, captured.lock().unwrap().clone()),
        (true, Some(key))
    );
}

#[tokio::test]
async fn direct_probe_kex_timeout_closes_transport_before_returning() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("stalled SSH listener should bind");
    let address = listener
        .local_addr()
        .expect("stalled SSH listener should have an address");
    let (eof_tx, mut eof_rx) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let (mut socket, _) = listener
            .accept()
            .await
            .expect("stalled SSH listener should accept");
        socket
            .write_all(b"SSH-2.0-terminal-host-key-stalled-kex\r\n")
            .await
            .expect("stalled SSH banner should be written");
        let mut buffer = [0_u8; 1024];
        loop {
            match socket.read(&mut buffer).await {
                Ok(0) => {
                    let _ = eof_tx.send(());
                    return;
                }
                Ok(_) => {}
                Err(_) => return,
            }
        }
    });

    let result = ssh_host_key_probe("127.0.0.1".to_string(), address.port()).await;

    tokio::time::timeout(std::time::Duration::from_secs(1), &mut eof_rx)
        .await
        .expect("direct host-key probe must not leave its timed-out KEX transport running")
        .expect("stalled host-key server must report transport EOF");
    assert!(matches!(
        result,
        Err(SshHostKeyError::ConnectionFailed(message))
            if message.contains("connect host-key probe") && message.contains("timed out")
    ));
}

#[test]
fn host_validation_rejects_known_hosts_injection() {
    let newline = validate_host("example.com\nattacker", 22);
    let alias = validate_host("example.com,attacker.example", 22);
    let wildcard = validate_host("*.example.com", 22);

    assert!(matches!(
        (newline, alias, wildcard),
        (
            Err(SshHostKeyError::InvalidInput(_)),
            Err(SshHostKeyError::InvalidInput(_)),
            Err(SshHostKeyError::InvalidInput(_)),
        )
    ));
}

#[test]
fn host_key_error_serializes_as_a_stable_tauri_error() {
    let json = serde_json::to_value(SshHostKeyError::HostKeyChanged(
        "refusing to replace example.com:22".to_string(),
    ))
    .expect("host-key error should serialize");

    assert_eq!(
        json,
        serde_json::json!({
            "type": "host_key_changed",
            "message": "refusing to replace example.com:22",
        })
    );
}

#[test]
fn host_key_command_futures_own_their_ipc_arguments() {
    fn assert_send_static<F>(_: F)
    where
        F: Future<Output = Result<SshHostKeyProbeResult, SshHostKeyError>> + Send + 'static,
    {
    }

    assert_send_static(ssh_host_key_probe("example.com".to_string(), 22));
    assert_send_static(ssh_host_key_learn(
        "example.com".to_string(),
        22,
        ED25519_PUBLIC_KEY.to_string(),
    ));
    assert_send_static(ssh_host_key_probe_via_jump(
        "target.example.com".to_string(),
        22,
        JumpHostConfig {
            host: "jump.example.com".to_string(),
            port: 22,
            username: "operator".to_string(),
            auth_type: "agent".to_string(),
            password: None,
            private_key: None,
            certificate: None,
            expected_host_key: Some(ED25519_PUBLIC_KEY.to_string()),
            target_auth_type: Some("password".to_string()),
        },
    ));
}
