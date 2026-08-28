//! SSH host-key preflight and trust-on-first-use commands.

use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::Duration;

#[cfg(test)]
use std::path::Path;

use anyhow::anyhow;
use russh::client::{self, Handler};
use russh::keys::{HashAlg, PublicKey};
use serde::Serialize;
use thiserror::Error;

use crate::session::ssh::{
    connect_authenticated_jump_host_with_shutdown, connect_stream_with_timeout,
    connect_tcp_with_shutdown, disconnect_and_wait_with_shutdown,
    disconnect_jump_connections_with_shutdown, open_jump_host_tunnel,
};
use crate::session::{JumpHostConfig, SessionError};

const SSH_HOST_KEY_PROBE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SshHostKeyStatus {
    Trusted,
    Unknown,
    Changed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SshHostKeyProbeResult {
    pub status: SshHostKeyStatus,
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub public_key: String,
}

#[derive(Debug, PartialEq, Eq, Error, Serialize)]
#[serde(tag = "type", content = "message", rename_all = "snake_case")]
pub enum SshHostKeyError {
    #[error("invalid SSH host-key input: {0}")]
    InvalidInput(String),
    #[error("SSH host-key connection failed: {0}")]
    ConnectionFailed(String),
    #[error("SSH jump-host authentication failed: {0}")]
    AuthenticationFailed(String),
    #[error("SSH host-key parse failed: {0}")]
    KeyParseFailed(String),
    #[error("known_hosts operation failed: {0}")]
    KnownHostsFailed(String),
    #[error("SSH host key changed: {0}")]
    HostKeyChanged(String),
}

fn classify_known_host(
    result: Result<bool, russh::keys::Error>,
) -> Result<SshHostKeyStatus, SshHostKeyError> {
    match result {
        Ok(true) => Ok(SshHostKeyStatus::Trusted),
        Ok(false) => Ok(SshHostKeyStatus::Unknown),
        Err(russh::keys::Error::KeyChanged { .. }) => Ok(SshHostKeyStatus::Changed),
        Err(error) => Err(SshHostKeyError::KnownHostsFailed(error.to_string())),
    }
}

fn ensure_key_may_be_learned(
    status: SshHostKeyStatus,
    host: &str,
    port: u16,
) -> Result<bool, SshHostKeyError> {
    match status {
        SshHostKeyStatus::Trusted => Ok(false),
        SshHostKeyStatus::Unknown => Ok(true),
        SshHostKeyStatus::Changed => Err(SshHostKeyError::HostKeyChanged(format!(
            "refusing to replace the existing key for {host}:{port}"
        ))),
    }
}

fn probe_result(
    host: &str,
    port: u16,
    status: SshHostKeyStatus,
    public_key: &PublicKey,
) -> Result<SshHostKeyProbeResult, SshHostKeyError> {
    let mut normalized_key = public_key.clone();
    normalized_key.set_comment("");
    let public_key_text = normalized_key
        .to_openssh()
        .map_err(|error| SshHostKeyError::KeyParseFailed(error.to_string()))?;

    Ok(SshHostKeyProbeResult {
        status,
        host: host.to_string(),
        port,
        algorithm: normalized_key.algorithm().to_string(),
        fingerprint: normalized_key.fingerprint(HashAlg::Sha256).to_string(),
        public_key: public_key_text,
    })
}

fn validate_host(host: &str, port: u16) -> Result<String, SshHostKeyError> {
    let host = host.trim();
    if host.is_empty() {
        return Err(SshHostKeyError::InvalidInput(
            "host cannot be empty".to_string(),
        ));
    }
    let contains_pattern_character = host
        .chars()
        .any(|character| matches!(character, ',' | '|' | '*' | '?' | '!' | '[' | ']' | '\\'));
    if host.chars().any(char::is_whitespace)
        || host.chars().any(char::is_control)
        || contains_pattern_character
    {
        return Err(SshHostKeyError::InvalidInput(
            "host contains characters that are unsafe in known_hosts".to_string(),
        ));
    }
    if port == 0 {
        return Err(SshHostKeyError::InvalidInput(
            "port must be between 1 and 65535".to_string(),
        ));
    }
    Ok(host.to_string())
}

fn parse_public_key(value: &str) -> Result<PublicKey, SshHostKeyError> {
    let mut public_key = PublicKey::from_openssh(value.trim())
        .map_err(|error| SshHostKeyError::KeyParseFailed(error.to_string()))?;
    public_key.set_comment("");
    Ok(public_key)
}

fn known_hosts_write_lock() -> &'static StdMutex<()> {
    static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| StdMutex::new(()))
}

fn learn_host_key(host: &str, port: u16, public_key: &PublicKey) -> Result<(), SshHostKeyError> {
    let _guard = known_hosts_write_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let status = classify_known_host(russh::keys::check_known_hosts(host, port, public_key))?;
    if ensure_key_may_be_learned(status, host, port)? {
        russh::keys::known_hosts::learn_known_hosts(host, port, public_key)
            .map_err(|error| SshHostKeyError::KnownHostsFailed(error.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
fn learn_host_key_at_path(
    host: &str,
    port: u16,
    public_key: &PublicKey,
    path: &Path,
) -> Result<(), SshHostKeyError> {
    let _guard = known_hosts_write_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let status = classify_known_host(russh::keys::check_known_hosts_path(
        host, port, public_key, path,
    ))?;
    if ensure_key_may_be_learned(status, host, port)? {
        russh::keys::known_hosts::learn_known_hosts_path(host, port, public_key, path)
            .map_err(|error| SshHostKeyError::KnownHostsFailed(error.to_string()))?;
    }
    Ok(())
}

#[derive(Clone)]
struct HostKeyProbeHandler {
    public_key: Arc<StdMutex<Option<PublicKey>>>,
}

impl HostKeyProbeHandler {
    fn new(public_key: Arc<StdMutex<Option<PublicKey>>>) -> Self {
        Self { public_key }
    }
}

impl Handler for HostKeyProbeHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let mut key = self
            .public_key
            .lock()
            .map_err(|_| anyhow!("SSH host-key probe state is unavailable"))?;
        *key = Some(server_public_key.clone());
        Ok(true)
    }
}

fn map_session_error(error: SessionError) -> SshHostKeyError {
    match error {
        SessionError::InvalidInput(message) => SshHostKeyError::InvalidInput(message),
        SessionError::AuthenticationFailed(message) => {
            SshHostKeyError::AuthenticationFailed(message)
        }
        SessionError::KeyParseFailed(message) | SessionError::CertificateParseFailed(message) => {
            SshHostKeyError::KeyParseFailed(message)
        }
        other => SshHostKeyError::ConnectionFailed(other.to_string()),
    }
}

async fn check_known_host(
    host: String,
    port: u16,
    public_key: PublicKey,
) -> Result<SshHostKeyStatus, SshHostKeyError> {
    tokio::task::spawn_blocking(move || {
        classify_known_host(russh::keys::check_known_hosts(&host, port, &public_key))
    })
    .await
    .map_err(|error| SshHostKeyError::KnownHostsFailed(error.to_string()))?
}

#[tauri::command]
pub async fn ssh_host_key_probe(
    host: String,
    port: u16,
) -> Result<SshHostKeyProbeResult, SshHostKeyError> {
    let host = validate_host(&host, port)?;
    let captured_key = Arc::new(StdMutex::new(None));
    let handler = HostKeyProbeHandler::new(Arc::clone(&captured_key));
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(SSH_HOST_KEY_PROBE_TIMEOUT),
        nodelay: true,
        ..Default::default()
    });

    let (handle, shutdown_guard) = connect_tcp_with_shutdown(
        config,
        (host.as_str(), port),
        handler,
        SSH_HOST_KEY_PROBE_TIMEOUT,
        "connect host-key probe",
    )
    .await
    .map_err(map_session_error)?;

    let public_key = captured_key
        .lock()
        .map_err(|_| {
            SshHostKeyError::ConnectionFailed("SSH host-key probe state is unavailable".to_string())
        })?
        .clone()
        .ok_or_else(|| {
            SshHostKeyError::ConnectionFailed(format!(
                "server {host}:{port} did not present a host key"
            ))
        });

    disconnect_and_wait_with_shutdown(handle, shutdown_guard, "host-key probe complete").await;

    let public_key = public_key?;
    let status = check_known_host(host.clone(), port, public_key.clone()).await?;
    probe_result(&host, port, status, &public_key)
}

#[tauri::command]
pub async fn ssh_host_key_probe_via_jump(
    target_host: String,
    target_port: u16,
    mut jump_host: JumpHostConfig,
) -> Result<SshHostKeyProbeResult, SshHostKeyError> {
    let target_host = validate_host(&target_host, target_port)?;
    jump_host.host = validate_host(&jump_host.host, jump_host.port)?;
    let captured_key = Arc::new(StdMutex::new(None));
    let handler = HostKeyProbeHandler::new(Arc::clone(&captured_key));
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(SSH_HOST_KEY_PROBE_TIMEOUT),
        nodelay: true,
        ..Default::default()
    });

    // The jump handshake verifies known_hosts (or its exact trust-once pin)
    // before credentials are sent. Only then may the tunnel reveal the target.
    let (jump_handle, jump_shutdown) =
        connect_authenticated_jump_host_with_shutdown(config.clone(), &jump_host)
            .await
            .map_err(map_session_error)?;
    let target_channel =
        match open_jump_host_tunnel(&jump_handle, &jump_host, target_host.clone(), target_port)
            .await
        {
            Ok(channel) => channel,
            Err(error) => {
                disconnect_and_wait_with_shutdown(
                    jump_handle,
                    jump_shutdown,
                    "open host-key probe tunnel failed",
                )
                .await;
                return Err(SshHostKeyError::ConnectionFailed(format!(
                    "could not open a tunnel to {target_host}:{target_port}: {error}"
                )));
            }
        };

    let target_handle = match connect_stream_with_timeout(
        config,
        target_channel.into_stream(),
        handler,
        SSH_HOST_KEY_PROBE_TIMEOUT,
        "inspect host key through jump host",
        Some(&jump_shutdown),
    )
    .await
    {
        Ok(handle) => handle,
        Err(error) => {
            disconnect_and_wait_with_shutdown(
                jump_handle,
                jump_shutdown,
                "host-key probe target handshake failed",
            )
            .await;
            return Err(SshHostKeyError::ConnectionFailed(format!(
                "could not inspect {target_host}:{target_port} through the jump host: {error}"
            )));
        }
    };

    let public_key = captured_key
        .lock()
        .map_err(|_| {
            SshHostKeyError::ConnectionFailed("SSH host-key probe state is unavailable".to_string())
        })?
        .clone()
        .ok_or_else(|| {
            SshHostKeyError::ConnectionFailed(format!(
                "server {target_host}:{target_port} did not present a host key"
            ))
        });

    disconnect_jump_connections_with_shutdown(
        target_handle,
        jump_handle,
        jump_shutdown,
        "host-key probe complete",
    )
    .await;
    let public_key = public_key?;
    let status = check_known_host(target_host.clone(), target_port, public_key.clone()).await?;
    probe_result(&target_host, target_port, status, &public_key)
}

#[tauri::command]
pub async fn ssh_host_key_learn(
    host: String,
    port: u16,
    public_key: String,
) -> Result<SshHostKeyProbeResult, SshHostKeyError> {
    let host = validate_host(&host, port)?;
    let public_key = parse_public_key(&public_key)?;
    let blocking_host = host.clone();
    let blocking_key = public_key.clone();
    tokio::task::spawn_blocking(move || learn_host_key(&blocking_host, port, &blocking_key))
        .await
        .map_err(|error| SshHostKeyError::KnownHostsFailed(error.to_string()))??;

    probe_result(&host, port, SshHostKeyStatus::Trusted, &public_key)
}

#[cfg(test)]
#[path = "ssh_host_key_tests.rs"]
mod tests;
