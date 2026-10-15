use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::io::AsyncWriteExt;

const ENABLE_ENV: &str = "TERMINAL_SHELL_PROBE";
const RESULT_PATH_ENV: &str = "TERMINAL_SHELL_PROBE_RESULT_PATH";
const CASE_ENV: &str = "TERMINAL_SHELL_PROBE_CASE";
const SSH_CONFIG_PATH_ENV: &str = "TERMINAL_SHELL_PROBE_SSH_CONFIG_PATH";
const DIALECT_ENV: &str = "TERMINAL_SHELL_PROBE_DIALECT";
const DEFAULT_CASE: &str = "cat-eof";
const TIMEOUT_MS: u64 = 20_000;
const MAX_RESULT_BYTES: usize = 64 * 1024;
const MAX_INPUT_EVENTS: usize = 512;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellProbeConfig {
    result_path: String,
    case_name: String,
    timeout_ms: u64,
    /// The command language the probe must speak. The acceptance runner sets
    /// this from the shell it launched; the probe never infers it, because a
    /// guessed dialect would measure a different shell than the one requested
    /// and report the result under the requested shell name.
    dialect: ShellProbeDialect,
    /// Present when the probe must drive a real SSH session instead of a local
    /// PTY. The local PTY and a real sshd differ in exactly the places that
    /// break terminals in practice: PTY request, window-size propagation and
    /// signal delivery, so the same interaction cases have to run over both.
    ssh: Option<ShellProbeSshTarget>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellProbeSshTarget {
    host: String,
    port: u16,
    username: String,
    /// Same field name and vocabulary the smoke matrix config uses, so the
    /// front end reuses that parser instead of validating the same fixture
    /// shape twice.
    auth_mode: &'static str,
    expected_host_key: String,
    private_key: Option<String>,
    password: Option<String>,
    certificate: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ShellProbeInputEvent {
    kind: String,
    bytes: usize,
    data_hex: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ShellProbeResult {
    case_name: String,
    duration_ms: u64,
    error: Option<String>,
    input_events: Vec<ShellProbeInputEvent>,
    ok: bool,
    trace: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ShellProbeDialect {
    Posix,
    Powershell,
    Cmd,
}

struct ShellProbeRun {
    result_path: PathBuf,
    case_name: String,
    dialect: ShellProbeDialect,
    started_at: Instant,
    ssh: Option<crate::terminal_smoke::TerminalSmokeSshConfig>,
}

enum ShellProbeMode {
    Disabled,
    Invalid(String),
    Enabled(Arc<ShellProbeRun>),
}

pub(crate) struct ShellProbeState {
    mode: ShellProbeMode,
}

fn is_enabled() -> bool {
    std::env::var(ENABLE_ENV).ok().as_deref() == Some("1")
}

/// Reads the optional SSH fixture config. The same reader the smoke gate uses
/// is reused on purpose: if this probe parsed the fixture more loosely it could
/// be pointed at a target the smoke matrix refuses to touch.
fn ssh_target() -> Result<Option<crate::terminal_smoke::TerminalSmokeSshConfig>, String> {
    let Some(value) = std::env::var_os(SSH_CONFIG_PATH_ENV) else {
        return Ok(None);
    };
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!("{SSH_CONFIG_PATH_ENV} must be an absolute path"));
    }
    crate::terminal_smoke::read_ssh_config(&path).map(Some)
}

fn absolute_path(value: Option<OsString>) -> Result<PathBuf, String> {
    let path = value
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| format!("{RESULT_PATH_ENV} is required in shell probe mode"))?;
    if !path.is_absolute() {
        return Err(format!("{RESULT_PATH_ENV} must be an absolute path"));
    }
    Ok(path)
}

fn expected_trace(case_name: &str) -> Option<&'static [&'static str]> {
    match case_name {
        "cat-eof" => Some(&["ready", "pass"]),
        "readline-history" | "readline-tab" | "vim-edit" | "nano-edit" | "pty-resize"
        | "ctrl-c-interrupt" => Some(&["ready", "step", "pass"]),
        _ => None,
    }
}

/// Reads the requested dialect. It defaults to POSIX so a runner that predates
/// the Windows dialects keeps working unchanged.
fn configured_dialect() -> Result<ShellProbeDialect, String> {
    match std::env::var(DIALECT_ENV).ok().as_deref() {
        None | Some("") | Some("posix") => Ok(ShellProbeDialect::Posix),
        Some("powershell") => Ok(ShellProbeDialect::Powershell),
        Some("cmd") => Ok(ShellProbeDialect::Cmd),
        Some(other) => Err(format!("{DIALECT_ENV} has an unsupported value: {other}")),
    }
}

fn configured_case() -> Result<String, String> {
    let case_name = std::env::var(CASE_ENV)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_CASE.to_string());
    if expected_trace(&case_name).is_none() {
        return Err(format!("{CASE_ENV} has an unsupported shell probe case"));
    }
    Ok(case_name)
}

impl ShellProbeState {
    pub(crate) fn from_env() -> Self {
        let mode = if !is_enabled() {
            ShellProbeMode::Disabled
        } else {
            match (|| {
                let case_name = configured_case()?;
                Ok(ShellProbeRun {
                    result_path: absolute_path(std::env::var_os(RESULT_PATH_ENV))?,
                    dialect: configured_dialect()?,
                    case_name,
                    started_at: Instant::now(),
                    ssh: ssh_target()?,
                })
            })() {
                Ok(run) => ShellProbeMode::Enabled(Arc::new(run)),
                Err(error) => ShellProbeMode::Invalid(error),
            }
        };
        Self { mode }
    }

    fn run(&self) -> Result<Arc<ShellProbeRun>, String> {
        match &self.mode {
            ShellProbeMode::Enabled(run) => Ok(Arc::clone(run)),
            ShellProbeMode::Disabled => Err("terminal shell probe mode is not enabled".to_string()),
            ShellProbeMode::Invalid(error) => Err(error.clone()),
        }
    }
}

fn valid_hex(value: &str) -> bool {
    !value.is_empty()
        && value.len().is_multiple_of(2)
        && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_result(run: &ShellProbeRun, result: &ShellProbeResult) -> Result<(), String> {
    let expected = expected_trace(&run.case_name)
        .ok_or_else(|| "shell probe case is unsupported".to_string())?;
    if result.case_name != run.case_name {
        return Err("shell probe result does not match its configured case".to_string());
    }
    if result.duration_ms == 0
        || result.duration_ms > run.started_at.elapsed().as_millis() as u64 + 60_000
    {
        return Err("shell probe result duration is invalid".to_string());
    }
    if result.trace.iter().map(String::as_str).collect::<Vec<_>>() != expected {
        return Err("shell probe result trace is invalid".to_string());
    }
    if (result.ok && result.input_events.is_empty()) || result.input_events.len() > MAX_INPUT_EVENTS
    {
        return Err("shell probe input event count is invalid".to_string());
    }
    for event in &result.input_events {
        if event.kind != "text"
            || event.bytes == 0
            || event.data_hex.len() != event.bytes.saturating_mul(2)
            || !valid_hex(&event.data_hex)
        {
            return Err("shell probe input event is invalid".to_string());
        }
    }
    if result.ok {
        if let Some(required) = required_input_hex(&run.case_name) {
            if !result
                .input_events
                .iter()
                .any(|event| event.data_hex.eq_ignore_ascii_case(required))
            {
                // Without this the probe could report success while never
                // having sent the byte the case exists to exercise.
                return Err(format!(
                    "shell probe result is missing required input {required}"
                ));
            }
        }
        if result.error.is_some() {
            return Err("successful shell probe result must not carry an error".to_string());
        }
    } else if result.error.as_deref().unwrap_or("").trim().is_empty() {
        return Err("failed shell probe result must carry an error".to_string());
    }
    Ok(())
}

/// Bytes a passing case must have actually written into the PTY, so the
/// backend never accepts a verdict for an interaction that never happened.
fn required_input_hex(case_name: &str) -> Option<&'static str> {
    match case_name {
        "ctrl-c-interrupt" => Some("03"),
        _ => None,
    }
}

async fn write_json(path: &Path, value: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "shell probe result path has no parent".to_string())?;
    let temporary = parent.join(format!(
        ".terminal-shell-probe-{}.tmp",
        uuid::Uuid::new_v4()
    ));
    let mut file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .await
        .map_err(|error| format!("failed to create shell probe result: {error}"))?;
    file.write_all(value)
        .await
        .map_err(|error| format!("failed to write shell probe result: {error}"))?;
    file.sync_all()
        .await
        .map_err(|error| format!("failed to sync shell probe result: {error}"))?;
    drop(file);
    let _ = tokio::fs::remove_file(path).await;
    let result = tokio::fs::hard_link(&temporary, path)
        .await
        .map_err(|error| format!("failed to publish shell probe result: {error}"));
    let _ = tokio::fs::remove_file(&temporary).await;
    result
}

#[tauri::command]
pub(crate) fn shell_probe_config(
    state: State<'_, ShellProbeState>,
) -> Result<Option<ShellProbeConfig>, String> {
    let run = match &state.mode {
        ShellProbeMode::Disabled => return Ok(None),
        ShellProbeMode::Invalid(error) => return Err(error.clone()),
        ShellProbeMode::Enabled(run) => Arc::clone(run),
    };
    Ok(Some(ShellProbeConfig {
        result_path: run.result_path.to_string_lossy().into_owned(),
        case_name: run.case_name.clone(),
        timeout_ms: TIMEOUT_MS,
        dialect: run.dialect,
        ssh: run.ssh.as_ref().map(|ssh| ShellProbeSshTarget {
            host: ssh.host.clone(),
            port: ssh.port,
            username: ssh.username.clone(),
            auth_mode: ssh.auth_mode.host_auth_type(),
            expected_host_key: ssh.expected_host_key.clone(),
            private_key: ssh.private_key.clone(),
            password: ssh.password.clone(),
            certificate: ssh.certificate.clone(),
        }),
    }))
}

#[tauri::command]
pub(crate) async fn shell_probe_result(
    state: State<'_, ShellProbeState>,
    result: ShellProbeResult,
) -> Result<(), String> {
    let run = state.run()?;
    validate_result(&run, &result)?;
    let serialized = serde_json::to_vec(&result)
        .map_err(|error| format!("failed to serialize shell probe result: {error}"))?;
    if serialized.len() > MAX_RESULT_BYTES {
        return Err(format!(
            "shell probe result exceeds {MAX_RESULT_BYTES} bytes"
        ));
    }
    write_json(&run.result_path, &serialized).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run() -> ShellProbeRun {
        ShellProbeRun {
            result_path: PathBuf::from("/tmp/shell-probe-result.json"),
            case_name: "cat-eof".to_string(),
            dialect: ShellProbeDialect::Posix,
            started_at: Instant::now(),
            ssh: None,
        }
    }

    fn result() -> ShellProbeResult {
        ShellProbeResult {
            case_name: "cat-eof".to_string(),
            duration_ms: 1,
            error: None,
            input_events: vec![ShellProbeInputEvent {
                kind: "text".to_string(),
                bytes: 1,
                data_hex: "04".to_string(),
            }],
            ok: true,
            trace: vec!["ready".to_string(), "pass".to_string()],
        }
    }

    #[test]
    fn cases_have_stable_trace_contracts() {
        assert_eq!(
            expected_trace("cat-eof"),
            Some(["ready", "pass"].as_slice())
        );
        assert_eq!(
            expected_trace("readline-history"),
            Some(["ready", "step", "pass"].as_slice())
        );
        assert_eq!(
            expected_trace("readline-tab"),
            Some(["ready", "step", "pass"].as_slice())
        );
        assert_eq!(
            expected_trace("vim-edit"),
            Some(["ready", "step", "pass"].as_slice())
        );
        assert_eq!(
            expected_trace("nano-edit"),
            Some(["ready", "step", "pass"].as_slice())
        );
        assert_eq!(
            expected_trace("pty-resize"),
            Some(["ready", "step", "pass"].as_slice())
        );
        assert_eq!(
            expected_trace("ctrl-c-interrupt"),
            Some(["ready", "step", "pass"].as_slice())
        );
        assert_eq!(expected_trace("other"), None);
    }

    #[test]
    fn result_validation_requires_text_input_and_exact_trace() {
        let run = run();
        assert!(validate_result(&run, &result()).is_ok());
        let mut invalid = result();
        invalid.input_events[0].kind = "raw".to_string();
        assert!(validate_result(&run, &invalid).is_err());
        let mut invalid_trace = result();
        invalid_trace.trace = vec!["ready".to_string()];
        assert!(validate_result(&run, &invalid_trace).is_err());
        let mut failed = result();
        failed.ok = false;
        failed.error = Some("PTY unavailable".to_string());
        failed.input_events.clear();
        assert!(validate_result(&run, &failed).is_ok());
    }

    #[test]
    fn interrupt_case_requires_the_raw_interrupt_byte() {
        let mut interrupt_run = run();
        interrupt_run.case_name = "ctrl-c-interrupt".to_string();
        let mut passing = result();
        passing.case_name = "ctrl-c-interrupt".to_string();
        passing.trace = vec!["ready".to_string(), "step".to_string(), "pass".to_string()];
        assert!(validate_result(&interrupt_run, &passing).is_err());
        passing.input_events.push(ShellProbeInputEvent {
            kind: "text".to_string(),
            bytes: 1,
            data_hex: "03".to_string(),
        });
        assert!(validate_result(&interrupt_run, &passing).is_ok());
    }

    #[test]
    fn absolute_result_path_is_required() {
        assert!(absolute_path(Some(OsString::from("relative.json"))).is_err());
        assert!(absolute_path(Some(OsString::from("/tmp/result.json"))).is_ok());
    }
}
