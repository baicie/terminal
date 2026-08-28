use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use russh::keys::PublicKey;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;

use crate::session::get_session_manager;
use crate::session::ssh::ssh_resource_keys;
use crate::session::terminal_output::session_output_control_keys;

const ENABLE_ENV: &str = "TERMINAL_SMOKE";
const RESULT_PATH_ENV: &str = "TERMINAL_SMOKE_RESULT_PATH";
const SSH_CONFIG_PATH_ENV: &str = "TERMINAL_SMOKE_SSH_CONFIG_PATH";
const RECONNECT_CONTROL_PATH_ENV: &str = "TERMINAL_SMOKE_RECONNECT_CONTROL_PATH";
const LOAD_BYTES: usize = 8 * 1024 * 1024;
const ROUNDS: usize = 10;
const MAX_SSH_CONFIG_BYTES: u64 = 64 * 1024;
const INITIAL_COLS: u16 = 80;
const INITIAL_ROWS: u16 = 24;
const TARGET_COLS: u16 = 97;
const TARGET_ROWS: u16 = 31;
const CONNECTION_DEADLINE: Duration = Duration::from_secs(10);
const TIMEOUT: Duration = Duration::from_secs(180);
const ACTIVE_SESSION_RETRY_DELAY: Duration = Duration::from_millis(10);
const ACTIVE_SESSION_RETRIES: usize = 5;
const STALE_OUTPUT_MARKER: &str = "TERMINAL_SMOKE_STALE_OUTPUT_CANARY";
const ACTIVE_OUTPUT_BARRIER: &str = "TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TerminalSmokeAuthMode {
    Key,
    Password,
    Agent,
    Cert,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TerminalSmokeJumpConfig {
    host: String,
    port: u16,
    username: String,
    private_key: String,
    expected_host_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TerminalSmokeSshConfig {
    host: String,
    port: u16,
    username: String,
    expected_host_key: String,
    auth_mode: TerminalSmokeAuthMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    private_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    certificate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    jump: Option<TerminalSmokeJumpConfig>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalSmokeConfig {
    load_bytes: usize,
    initial_cols: u16,
    initial_rows: u16,
    target_cols: u16,
    target_rows: u16,
    timeout_ms: u64,
    rounds: usize,
    reconnect_required: bool,
    ssh: TerminalSmokeSshConfig,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalSmokeResult {
    ok: bool,
    stage: String,
    error: Option<String>,
    load_bytes: usize,
    rounds_completed: usize,
    unique_session_count: usize,
    resources_recovered: bool,
    duration_ms: u64,
    terminal_cols: u16,
    terminal_rows: u16,
    load_end_visible: bool,
    after_load_visible: bool,
    resized_size_visible: bool,
    reconnect_observed: bool,
    stale_output_rejected: bool,
    first_connection_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalSmokeStaleOutputProbe {
    stale_marker: &'static str,
    barrier_marker: &'static str,
}

#[derive(Debug, Serialize)]
struct TerminalSmokeOutput {
    session_id: String,
    data: String,
    is_stderr: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalResourceSnapshot {
    manager_sessions: Vec<String>,
    metadata: Vec<String>,
    channels: Vec<String>,
    ssh_pool: Vec<String>,
    ssh_registry: Vec<String>,
    output_controls: Vec<String>,
}

impl TerminalResourceSnapshot {
    fn new(
        mut manager_sessions: Vec<String>,
        mut metadata: Vec<String>,
        mut channels: Vec<String>,
        mut ssh_pool: Vec<String>,
        mut ssh_registry: Vec<String>,
        mut output_controls: Vec<String>,
    ) -> Self {
        manager_sessions.sort();
        metadata.sort();
        channels.sort();
        ssh_pool.sort();
        ssh_registry.sort();
        output_controls.sort();
        Self {
            manager_sessions,
            metadata,
            channels,
            ssh_pool,
            ssh_registry,
            output_controls,
        }
    }
}

pub(crate) struct TerminalSmokeRun {
    result_path: PathBuf,
    reconnect_control_path: Option<PathBuf>,
    config: TerminalSmokeConfig,
    started_at: Instant,
    claimed: AtomicBool,
    reconnect_requested: AtomicBool,
    stale_probe_emitted: AtomicBool,
}

impl TerminalSmokeRun {
    fn new(
        result_path: PathBuf,
        reconnect_control_path: Option<PathBuf>,
        config: TerminalSmokeConfig,
        started_at: Instant,
    ) -> Self {
        Self {
            result_path,
            reconnect_control_path,
            config,
            started_at,
            claimed: AtomicBool::new(false),
            reconnect_requested: AtomicBool::new(false),
            stale_probe_emitted: AtomicBool::new(false),
        }
    }

    fn claim(&self) -> bool {
        self.claimed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    fn elapsed(&self) -> Duration {
        self.started_at.elapsed()
    }

    fn request_reconnect(&self) -> Result<(), String> {
        if !self.config.reconnect_required {
            return Err("terminal smoke reconnect is not enabled".to_string());
        }
        if self.reconnect_requested.load(Ordering::Acquire) {
            return Ok(());
        }
        let path = self
            .reconnect_control_path
            .as_ref()
            .ok_or_else(|| "terminal smoke reconnect control path is missing".to_string())?;
        std::fs::write(path, b"reconnect-requested\n")
            .map_err(|error| format!("failed to publish reconnect checkpoint: {error}"))?;
        self.reconnect_requested.store(true, Ordering::Release);
        Ok(())
    }
}

enum TerminalSmokeMode {
    Disabled,
    Invalid(String),
    Enabled(Arc<TerminalSmokeRun>),
}

pub(crate) struct TerminalSmokeState {
    mode: TerminalSmokeMode,
}

impl TerminalSmokeState {
    pub(crate) fn from_env() -> Self {
        let mode = if !is_enabled() {
            TerminalSmokeMode::Disabled
        } else {
            match load_smoke_configuration(
                std::env::var_os(RESULT_PATH_ENV),
                std::env::var_os(SSH_CONFIG_PATH_ENV),
                std::env::var_os(RECONNECT_CONTROL_PATH_ENV),
            ) {
                Ok((result_path, reconnect_control_path, config)) => {
                    TerminalSmokeMode::Enabled(Arc::new(TerminalSmokeRun::new(
                        result_path,
                        reconnect_control_path,
                        config,
                        Instant::now(),
                    )))
                }
                Err(error) => TerminalSmokeMode::Invalid(error),
            }
        };
        Self { mode }
    }

    fn run(&self) -> Option<Arc<TerminalSmokeRun>> {
        match &self.mode {
            TerminalSmokeMode::Enabled(run) => Some(Arc::clone(run)),
            TerminalSmokeMode::Disabled | TerminalSmokeMode::Invalid(_) => None,
        }
    }
}

fn enabled_value(value: Option<&str>) -> bool {
    value == Some("1")
}

fn is_enabled() -> bool {
    enabled_value(std::env::var(ENABLE_ENV).ok().as_deref())
}

fn result_path(value: Option<OsString>) -> Result<PathBuf, String> {
    let path = value
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| format!("{RESULT_PATH_ENV} is required in terminal smoke mode"))?;
    if !path.is_absolute() {
        return Err(format!("{RESULT_PATH_ENV} must be an absolute path"));
    }
    Ok(path)
}

fn ssh_config_path(value: Option<OsString>) -> Result<PathBuf, String> {
    let path = value
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| format!("{SSH_CONFIG_PATH_ENV} is required in terminal smoke mode"))?;
    if !path.is_absolute() {
        return Err(format!("{SSH_CONFIG_PATH_ENV} must be an absolute path"));
    }
    Ok(path)
}

fn reconnect_control_path(value: Option<OsString>) -> Result<Option<PathBuf>, String> {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!(
            "{RECONNECT_CONTROL_PATH_ENV} must be an absolute path"
        ));
    }
    Ok(Some(path))
}

fn is_loopback_host(host: &str) -> bool {
    host == "127.0.0.1"
}

fn is_open_ssh_private_key(value: &str) -> bool {
    value.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----\n")
        && value.ends_with("-----END OPENSSH PRIVATE KEY-----\n")
}

fn is_open_ssh_certificate(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("ssh-") else {
        return false;
    };
    let Some((kind, body)) = rest.split_once(' ') else {
        return false;
    };
    kind.ends_with("-cert-v01@openssh.com")
        && !body.is_empty()
        && body
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
}

fn has_control_characters(value: &str) -> bool {
    value.bytes().any(|byte| byte <= 0x1f || byte == 0x7f)
}

fn validate_smoke_target(
    host: &str,
    port: u16,
    username: &str,
    expected_host_key: &str,
    label: &str,
) -> Result<(), String> {
    if !is_loopback_host(host) {
        return Err(format!("terminal smoke {label} host must be 127.0.0.1"));
    }
    if port == 0 {
        return Err(format!("terminal smoke {label} port must be non-zero"));
    }
    if username.is_empty()
        || username.len() > 255
        || username.starts_with('-')
        || !username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(format!("terminal smoke {label} username is invalid"));
    }
    PublicKey::from_openssh(expected_host_key)
        .map_err(|error| format!("terminal smoke {label} host key is invalid: {error}"))?;
    Ok(())
}

fn validate_smoke_private_key(value: &str, label: &str) -> Result<(), String> {
    if !is_open_ssh_private_key(value) {
        return Err(format!("terminal smoke {label} private key is malformed"));
    }
    russh::keys::decode_secret_key(value, None)
        .map_err(|error| format!("terminal smoke {label} private key is invalid: {error}"))?;
    Ok(())
}

fn validate_ssh_config(config: &TerminalSmokeSshConfig) -> Result<(), String> {
    validate_smoke_target(
        &config.host,
        config.port,
        &config.username,
        &config.expected_host_key,
        "SSH",
    )?;
    match config.auth_mode {
        TerminalSmokeAuthMode::Key => {
            let private_key = config
                .private_key
                .as_deref()
                .ok_or_else(|| "terminal smoke key mode requires a private key".to_string())?;
            validate_smoke_private_key(private_key, "SSH")?;
            if config.password.is_some() || config.certificate.is_some() {
                return Err("terminal smoke key mode rejects password and certificate".to_string());
            }
        }
        TerminalSmokeAuthMode::Password => {
            let password = config
                .password
                .as_deref()
                .ok_or_else(|| "terminal smoke password mode requires a password".to_string())?;
            if password.is_empty() || password.len() > 256 || has_control_characters(password) {
                return Err("terminal smoke password is invalid".to_string());
            }
            if config.private_key.is_some() || config.certificate.is_some() || config.jump.is_some()
            {
                return Err(
                    "terminal smoke password mode rejects keys, certificates and jump hosts"
                        .to_string(),
                );
            }
        }
        TerminalSmokeAuthMode::Agent => {
            if config.private_key.is_some()
                || config.password.is_some()
                || config.certificate.is_some()
                || config.jump.is_some()
            {
                return Err("terminal smoke agent mode rejects all local credentials".to_string());
            }
        }
        TerminalSmokeAuthMode::Cert => {
            let private_key = config
                .private_key
                .as_deref()
                .ok_or_else(|| "terminal smoke cert mode requires a private key".to_string())?;
            validate_smoke_private_key(private_key, "SSH")?;
            let certificate = config
                .certificate
                .as_deref()
                .ok_or_else(|| "terminal smoke cert mode requires a certificate".to_string())?;
            if !is_open_ssh_certificate(certificate) {
                return Err("terminal smoke certificate is invalid".to_string());
            }
            if let Some(passphrase) = config.password.as_deref() {
                if passphrase.is_empty()
                    || passphrase.len() > 256
                    || has_control_characters(passphrase)
                {
                    return Err("terminal smoke certificate passphrase is invalid".to_string());
                }
            }
            if config.jump.is_some() {
                return Err("terminal smoke cert mode rejects jump hosts".to_string());
            }
        }
    }
    if let Some(jump) = config.jump.as_ref() {
        if config.auth_mode != TerminalSmokeAuthMode::Key {
            return Err("terminal smoke jump hosts require key mode".to_string());
        }
        validate_smoke_target(
            &jump.host,
            jump.port,
            &jump.username,
            &jump.expected_host_key,
            "jump host",
        )?;
        validate_smoke_private_key(&jump.private_key, "jump host")?;
    }
    Ok(())
}

fn parse_ssh_config(serialized: &[u8]) -> Result<TerminalSmokeSshConfig, String> {
    let config: TerminalSmokeSshConfig = serde_json::from_slice(serialized)
        .map_err(|error| format!("invalid terminal smoke SSH config: {error}"))?;
    validate_ssh_config(&config)?;
    Ok(config)
}

fn read_ssh_config(path: &Path) -> Result<TerminalSmokeSshConfig, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("failed to inspect terminal smoke SSH config: {error}"))?;
    if metadata.len() == 0 || metadata.len() > MAX_SSH_CONFIG_BYTES {
        return Err(format!(
            "terminal smoke SSH config must be within 1..={MAX_SSH_CONFIG_BYTES} bytes"
        ));
    }
    let serialized = std::fs::read(path)
        .map_err(|error| format!("failed to read terminal smoke SSH config: {error}"))?;
    parse_ssh_config(&serialized)
}

fn load_smoke_configuration(
    result_value: Option<OsString>,
    ssh_config_value: Option<OsString>,
    reconnect_value: Option<OsString>,
) -> Result<(PathBuf, Option<PathBuf>, TerminalSmokeConfig), String> {
    let result_path = result_path(result_value)?;
    let ssh_path = ssh_config_path(ssh_config_value)?;
    let reconnect_path = reconnect_control_path(reconnect_value)?;
    let mut config = smoke_config(read_ssh_config(&ssh_path)?);
    config.reconnect_required = reconnect_path.is_some();
    Ok((result_path, reconnect_path, config))
}

fn smoke_config(ssh: TerminalSmokeSshConfig) -> TerminalSmokeConfig {
    TerminalSmokeConfig {
        load_bytes: LOAD_BYTES,
        initial_cols: INITIAL_COLS,
        initial_rows: INITIAL_ROWS,
        target_cols: TARGET_COLS,
        target_rows: TARGET_ROWS,
        timeout_ms: TIMEOUT.as_millis() as u64,
        rounds: ROUNDS,
        reconnect_required: false,
        ssh,
    }
}

async fn collect_terminal_resource_snapshot(
    state: &TerminalSmokeState,
) -> Result<TerminalResourceSnapshot, String> {
    state
        .run()
        .ok_or_else(|| "terminal smoke mode is not enabled".to_string())?;
    let manager = get_session_manager();
    let (manager_sessions, metadata, channels) = manager.resource_keys().await;
    let (ssh_pool, ssh_registry) = ssh_resource_keys().await;
    let output_controls = session_output_control_keys();
    Ok(TerminalResourceSnapshot::new(
        manager_sessions,
        metadata,
        channels,
        ssh_pool,
        ssh_registry,
        output_controls,
    ))
}

fn validate_connection_deadline(elapsed: Duration) -> Result<u64, String> {
    let deadline_ms = CONNECTION_DEADLINE.as_millis() as u64;
    if elapsed >= CONNECTION_DEADLINE {
        return Err(format!(
            "terminal did not connect within {deadline_ms} ms of application start"
        ));
    }
    elapsed
        .as_millis()
        .try_into()
        .map_err(|_| "terminal smoke connection duration overflowed".to_string())
}

fn validate_success(
    result: &TerminalSmokeResult,
    elapsed: Duration,
    reconnect_required: bool,
) -> Result<(), String> {
    if result.stage != "complete" {
        return Err("successful smoke result must use the complete stage".to_string());
    }
    if result.error.is_some() {
        return Err("successful smoke result must not contain an error".to_string());
    }
    if result.load_bytes != LOAD_BYTES {
        return Err(format!("expected {LOAD_BYTES} load bytes"));
    }
    let expected_session_count = ROUNDS + usize::from(reconnect_required);
    if result.rounds_completed != ROUNDS
        || result.unique_session_count != expected_session_count
        || !result.resources_recovered
    {
        return Err(format!(
            "expected {expected_session_count} isolated sessions with recovered resources"
        ));
    }
    if result.reconnect_observed != reconnect_required {
        return Err(if reconnect_required {
            "terminal smoke reconnect was not observed".to_string()
        } else {
            "terminal smoke reported an unexpected reconnect".to_string()
        });
    }
    if result.stale_output_rejected != reconnect_required {
        return Err(if reconnect_required {
            "retired session output was not rejected".to_string()
        } else {
            "terminal smoke reported an unexpected stale-output probe".to_string()
        });
    }
    if result.terminal_cols != TARGET_COLS || result.terminal_rows != TARGET_ROWS {
        return Err(format!(
            "expected terminal size {TARGET_COLS}x{TARGET_ROWS}"
        ));
    }
    if !result.load_end_visible || !result.after_load_visible || !result.resized_size_visible {
        return Err("all terminal smoke markers must be visible".to_string());
    }
    let timeout_ms = TIMEOUT.as_millis() as u64;
    if result.duration_ms == 0 || result.duration_ms > timeout_ms {
        return Err(format!("duration must be within 1..={timeout_ms} ms"));
    }
    let connection_deadline_ms = CONNECTION_DEADLINE.as_millis() as u64;
    if result.first_connection_ms == 0 || result.first_connection_ms >= connection_deadline_ms {
        return Err(format!(
            "first connection must complete within the {connection_deadline_ms} ms budget"
        ));
    }
    if elapsed > TIMEOUT {
        return Err("Rust terminal smoke deadline elapsed".to_string());
    }
    Ok(())
}

#[cfg(test)]
fn normalize_completion(result: TerminalSmokeResult, elapsed: Duration) -> TerminalSmokeResult {
    normalize_completion_for_mode(result, elapsed, false, false)
}

fn normalize_completion_for_mode(
    mut result: TerminalSmokeResult,
    elapsed: Duration,
    reconnect_required: bool,
    stale_probe_emitted: bool,
) -> TerminalSmokeResult {
    if !result.ok {
        return result;
    }
    if let Err(error) = validate_success(&result, elapsed, reconnect_required) {
        result.ok = false;
        result.stage = "rust-validation".to_string();
        result.error = Some(error);
    } else if reconnect_required && !stale_probe_emitted {
        result.ok = false;
        result.stage = "rust-validation".to_string();
        result.error = Some("Rust stale-output probe was not emitted".to_string());
    }
    result
}

fn failure_result(stage: &str, error: String, elapsed: Duration) -> TerminalSmokeResult {
    TerminalSmokeResult {
        ok: false,
        stage: stage.to_string(),
        error: Some(error),
        load_bytes: 0,
        rounds_completed: 0,
        unique_session_count: 0,
        resources_recovered: false,
        duration_ms: elapsed.as_millis().try_into().unwrap_or(u64::MAX),
        terminal_cols: INITIAL_COLS,
        terminal_rows: INITIAL_ROWS,
        load_end_visible: false,
        after_load_visible: false,
        resized_size_visible: false,
        reconnect_observed: false,
        stale_output_rejected: false,
        first_connection_ms: 0,
    }
}

async fn write_result(path: &Path, result: &TerminalSmokeResult) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "terminal smoke result path has no parent".to_string())?;
    let json = serde_json::to_vec_pretty(result)
        .map_err(|error| format!("failed to serialize terminal smoke result: {error}"))?;
    let temporary = parent.join(format!(".terminal-smoke-{}.tmp", uuid::Uuid::new_v4()));
    let write_attempt = async {
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .await
            .map_err(|error| format!("failed to create terminal smoke result: {error}"))?;
        file.write_all(&json)
            .await
            .map_err(|error| format!("failed to write terminal smoke result: {error}"))?;
        file.sync_all()
            .await
            .map_err(|error| format!("failed to sync terminal smoke result: {error}"))?;
        drop(file);
        tokio::fs::hard_link(&temporary, path)
            .await
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    "terminal smoke result already exists".to_string()
                } else {
                    format!("failed to publish terminal smoke result: {error}")
                }
            })
    }
    .await;
    let _ = tokio::fs::remove_file(&temporary).await;
    write_attempt
}

async fn finalize(app: AppHandle, run: Arc<TerminalSmokeRun>, result: TerminalSmokeResult) {
    if !run.claim() {
        return;
    }
    let exit_code = if result.ok { 0 } else { 1 };
    let write_ok = match write_result(&run.result_path, &result).await {
        Ok(()) => true,
        Err(error) => {
            tracing::error!(%error, "failed to persist terminal smoke result");
            false
        }
    };
    tracing::info!(ok = result.ok && write_ok, stage = %result.stage, "terminal smoke finalized");
    app.exit(if write_ok { exit_code } else { 1 });
}

fn focus_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "terminal smoke main window is unavailable".to_string())?;
    window
        .unminimize()
        .map_err(|error| format!("failed to unminimize terminal smoke window: {error}"))?;
    window
        .show()
        .map_err(|error| format!("failed to show terminal smoke window: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("failed to focus terminal smoke window: {error}"))
}

pub(crate) fn setup(app: &mut tauri::App) -> bool {
    let (enabled, invalid, run) = {
        let state = app.state::<TerminalSmokeState>();
        match &state.mode {
            TerminalSmokeMode::Disabled => (false, None, None),
            TerminalSmokeMode::Invalid(error) => (true, Some(error.clone()), None),
            TerminalSmokeMode::Enabled(run) => (true, None, Some(Arc::clone(run))),
        }
    };
    if !enabled {
        return false;
    }
    if let Some(error) = invalid {
        tracing::error!(%error, "terminal smoke setup failed");
        app.handle().exit(1);
        return true;
    }
    let Some(run) = run else {
        app.handle().exit(1);
        return true;
    };

    let watchdog_app = app.handle().clone();
    let watchdog_run = Arc::clone(&run);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(TIMEOUT).await;
        let result = failure_result(
            "rust-watchdog",
            "terminal smoke timed out".to_string(),
            watchdog_run.elapsed(),
        );
        finalize(watchdog_app, watchdog_run, result).await;
    });

    if let Err(error) = focus_main_window(app.handle()) {
        let setup_app = app.handle().clone();
        let setup_run = Arc::clone(&run);
        tauri::async_runtime::spawn(async move {
            let result = failure_result("rust-setup", error, setup_run.elapsed());
            finalize(setup_app, setup_run, result).await;
        });
    }
    true
}

#[tauri::command]
pub(crate) fn terminal_smoke_config(
    state: State<'_, TerminalSmokeState>,
) -> Option<TerminalSmokeConfig> {
    state.run().map(|run| run.config.clone())
}

#[tauri::command]
pub(crate) fn terminal_smoke_connected(
    state: State<'_, TerminalSmokeState>,
) -> Result<u64, String> {
    let run = state
        .run()
        .ok_or_else(|| "terminal smoke mode is not enabled".to_string())?;
    validate_connection_deadline(run.elapsed())
}

#[tauri::command]
pub(crate) async fn terminal_smoke_resources(
    state: State<'_, TerminalSmokeState>,
) -> Result<TerminalResourceSnapshot, String> {
    collect_terminal_resource_snapshot(&state).await
}

#[tauri::command]
pub(crate) async fn terminal_smoke_complete(
    app: AppHandle,
    state: State<'_, TerminalSmokeState>,
    result: TerminalSmokeResult,
) -> Result<(), String> {
    let run = state
        .run()
        .ok_or_else(|| "terminal smoke mode is not enabled".to_string())?;
    let result = normalize_completion_for_mode(
        result,
        run.elapsed(),
        run.config.reconnect_required,
        run.stale_probe_emitted.load(Ordering::Acquire),
    );
    finalize(app, run, result).await;
    Ok(())
}

#[tauri::command]
pub(crate) fn terminal_smoke_reconnect_requested(
    state: State<'_, TerminalSmokeState>,
) -> Result<(), String> {
    let run = state
        .run()
        .ok_or_else(|| "terminal smoke mode is not enabled".to_string())?;
    run.request_reconnect()
}

fn valid_smoke_ssh_session_id(session_id: &str) -> bool {
    session_id
        .strip_prefix("ssh-")
        .and_then(|value| uuid::Uuid::parse_str(value).ok())
        .is_some()
}

fn validate_stale_output_probe(
    reconnect_required: bool,
    reconnect_requested: bool,
    retired_session_id: &str,
    active_session_id: &str,
    retired_session_exists: bool,
    active_session_is_live_ssh: bool,
) -> Result<(), String> {
    if !reconnect_required {
        return Err("terminal smoke reconnect is not enabled".to_string());
    }
    if !reconnect_requested {
        return Err("terminal smoke reconnect checkpoint was not published".to_string());
    }
    if !valid_smoke_ssh_session_id(retired_session_id)
        || !valid_smoke_ssh_session_id(active_session_id)
    {
        return Err("terminal smoke probe requires valid SSH session IDs".to_string());
    }
    if retired_session_id == active_session_id {
        return Err("replacement SSH session must use a different session ID".to_string());
    }
    if retired_session_exists {
        return Err("retired SSH session is still registered".to_string());
    }
    if !active_session_is_live_ssh {
        return Err("replacement SSH session is not registered and alive".to_string());
    }
    Ok(())
}

fn emit_stale_output_events<F>(
    retired_session_id: &str,
    active_session_id: &str,
    mut emit: F,
) -> Result<TerminalSmokeStaleOutputProbe, String>
where
    F: FnMut(&'static str, &TerminalSmokeOutput) -> Result<(), String>,
{
    let stale_output = TerminalSmokeOutput {
        session_id: retired_session_id.to_string(),
        data: format!("{STALE_OUTPUT_MARKER}\r\n"),
        is_stderr: false,
    };
    emit("ssh-data", &stale_output)
        .map_err(|error| format!("failed to emit stale-output canary: {error}"))?;

    let active_output = TerminalSmokeOutput {
        session_id: active_session_id.to_string(),
        data: format!("{ACTIVE_OUTPUT_BARRIER}\r\n"),
        is_stderr: false,
    };
    emit("ssh-data", &active_output)
        .map_err(|error| format!("failed to emit active-output barrier: {error}"))?;

    Ok(TerminalSmokeStaleOutputProbe {
        stale_marker: STALE_OUTPUT_MARKER,
        barrier_marker: ACTIVE_OUTPUT_BARRIER,
    })
}

async fn active_session_is_alive(
    manager: &crate::session::SessionManager,
    session_id: &str,
    initially_alive: bool,
) -> bool {
    if initially_alive {
        return true;
    }
    let Some(session) = manager.get_session(session_id).await else {
        return false;
    };
    for attempt in 0..=ACTIVE_SESSION_RETRIES {
        if session.is_alive() {
            return true;
        }
        if attempt < ACTIVE_SESSION_RETRIES {
            tokio::time::sleep(ACTIVE_SESSION_RETRY_DELAY).await;
        }
    }
    false
}

#[tauri::command]
pub(crate) async fn terminal_smoke_emit_stale_output(
    app: AppHandle,
    state: State<'_, TerminalSmokeState>,
    retired_session_id: String,
    active_session_id: String,
) -> Result<TerminalSmokeStaleOutputProbe, String> {
    let run = state
        .run()
        .ok_or_else(|| "terminal smoke mode is not enabled".to_string())?;
    if run.stale_probe_emitted.load(Ordering::Acquire) {
        return Err("terminal smoke stale-output probe was already emitted".to_string());
    }

    let manager = get_session_manager();
    let sessions = manager.list_sessions().await;
    let retired_session_exists = sessions
        .iter()
        .any(|session| session.id == retired_session_id);
    let active_session = sessions
        .iter()
        .find(|session| session.id == active_session_id);
    let active_session_is_live_ssh = match active_session {
        Some(session) if session.session_type == crate::session::SessionType::Ssh => {
            active_session_is_alive(&manager, &active_session_id, session.is_alive).await
        }
        Some(_) | None => false,
    };
    validate_stale_output_probe(
        run.config.reconnect_required,
        run.reconnect_requested.load(Ordering::Acquire),
        &retired_session_id,
        &active_session_id,
        retired_session_exists,
        active_session_is_live_ssh,
    )?;

    let markers =
        emit_stale_output_events(&retired_session_id, &active_session_id, |event, payload| {
            app.emit(event, payload).map_err(|error| error.to_string())
        })?;
    run.stale_probe_emitted.store(true, Ordering::Release);
    Ok(markers)
}

#[cfg(test)]
#[path = "terminal_smoke_tests.rs"]
mod tests;
