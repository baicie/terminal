use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::io::AsyncWriteExt;

/// Explicitly gated physical keyboard input probe.
///
/// The probe mounts a local PTY terminal, starts a shell read that reports the
/// exact bytes it receives, and publishes checkpoints plus a final result.
/// A driver script types overlapping keys into the real macOS key pipeline;
/// enabling this mode requires the explicit `TERMINAL_INPUT_PROBE=1`
/// environment variable and absolute output paths.
const ENABLE_ENV: &str = "TERMINAL_INPUT_PROBE";
const READY_PATH_ENV: &str = "TERMINAL_INPUT_PROBE_READY_PATH";
const RESULT_PATH_ENV: &str = "TERMINAL_INPUT_PROBE_RESULT_PATH";
const ROUNDS_ENV: &str = "TERMINAL_INPUT_PROBE_ROUNDS";
const EXPECTED_ENV: &str = "TERMINAL_INPUT_PROBE_EXPECTED";
const DEFAULT_ROUNDS: u32 = 30;
const DEFAULT_EXPECTED: &str = "asd";
const MAX_ROUNDS: u32 = 100;
const MAX_EXPECTED_BYTES: usize = 32;
const MAX_RESULT_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InputProbeConfig {
    ready_path: String,
    result_path: String,
    rounds: u32,
    expected_text: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InputProbeRoundResult {
    round: u32,
    expected_hex: String,
    received_hex: String,
    ok: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InputProbeResult {
    ok: bool,
    rounds: u32,
    expected_text: String,
    expected_hex: String,
    duration_ms: u64,
    results: Vec<InputProbeRoundResult>,
    error: Option<String>,
}

pub(crate) struct InputProbeRun {
    ready_path: PathBuf,
    result_path: PathBuf,
    rounds: u32,
    expected_text: String,
    started_at: Instant,
    published_ready: AtomicBool,
}

impl InputProbeRun {
    fn elapsed(&self) -> Duration {
        self.started_at.elapsed()
    }
}

enum InputProbeMode {
    Disabled,
    Invalid(String),
    Enabled(Arc<InputProbeRun>),
}

pub(crate) struct InputProbeState {
    mode: InputProbeMode,
}

fn enabled_value(value: Option<&str>) -> bool {
    value == Some("1")
}

fn is_enabled() -> bool {
    enabled_value(std::env::var(ENABLE_ENV).ok().as_deref())
}

fn absolute_env_path(value: Option<OsString>, label: &str) -> Result<PathBuf, String> {
    let path = value
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| format!("{label} is required in terminal input probe mode"))?;
    if !path.is_absolute() {
        return Err(format!("{label} must be an absolute path"));
    }
    Ok(path)
}

fn rounds_from_env() -> Result<u32, String> {
    let Some(raw) = std::env::var(ROUNDS_ENV)
        .ok()
        .filter(|value| !value.is_empty())
    else {
        return Ok(DEFAULT_ROUNDS);
    };
    let rounds: u32 = raw
        .parse()
        .map_err(|_| format!("{ROUNDS_ENV} must be an integer"))?;
    if rounds == 0 || rounds > MAX_ROUNDS {
        return Err(format!("{ROUNDS_ENV} must be within 1..={MAX_ROUNDS}"));
    }
    Ok(rounds)
}

fn expected_from_env() -> Result<String, String> {
    let Some(raw) = std::env::var(EXPECTED_ENV)
        .ok()
        .filter(|value| !value.is_empty())
    else {
        return Ok(DEFAULT_EXPECTED.to_string());
    };
    if raw.len() > MAX_EXPECTED_BYTES || has_control_characters(&raw) {
        return Err(format!(
            "{EXPECTED_ENV} must be at most {MAX_EXPECTED_BYTES} bytes without control characters"
        ));
    }
    Ok(raw)
}

fn has_control_characters(value: &str) -> bool {
    value.bytes().any(|byte| byte <= 0x1f || byte == 0x7f)
}

impl InputProbeState {
    pub(crate) fn from_env() -> Self {
        let mode = if !is_enabled() {
            InputProbeMode::Disabled
        } else {
            match (|| {
                Ok(InputProbeRun {
                    ready_path: absolute_env_path(
                        std::env::var_os(READY_PATH_ENV),
                        READY_PATH_ENV,
                    )?,
                    result_path: absolute_env_path(
                        std::env::var_os(RESULT_PATH_ENV),
                        RESULT_PATH_ENV,
                    )?,
                    rounds: rounds_from_env()?,
                    expected_text: expected_from_env()?,
                    started_at: Instant::now(),
                    published_ready: AtomicBool::new(false),
                })
            })() {
                Ok(run) => InputProbeMode::Enabled(Arc::new(run)),
                Err(error) => InputProbeMode::Invalid(error),
            }
        };
        Self { mode }
    }

    fn run(&self) -> Result<Arc<InputProbeRun>, String> {
        match &self.mode {
            InputProbeMode::Enabled(run) => Ok(Arc::clone(run)),
            InputProbeMode::Disabled => Err("terminal input probe mode is not enabled".to_string()),
            InputProbeMode::Invalid(error) => Err(error.clone()),
        }
    }
}

fn validate_ready_round(run: &InputProbeRun, round: u32) -> Result<(), String> {
    if round == 0 || round > run.rounds {
        return Err(format!(
            "input probe ready round must be within 1..={}",
            run.rounds
        ));
    }
    Ok(())
}

fn validate_result(run: &InputProbeRun, result: &InputProbeResult) -> Result<(), String> {
    if result.rounds != run.rounds {
        return Err("input probe result rounds must match the configured rounds".to_string());
    }
    if result.expected_text != run.expected_text {
        return Err("input probe result expected text must match the configuration".to_string());
    }
    let expected_hex: String = result
        .expected_text
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if result.expected_hex != expected_hex {
        return Err("input probe result expected hex does not match the configuration".to_string());
    }
    if result.results.len() != run.rounds as usize {
        return Err(format!(
            "input probe result must contain exactly {} rounds",
            run.rounds
        ));
    }
    for (index, round) in result.results.iter().enumerate() {
        let expected_index = index as u32 + 1;
        if round.round != expected_index {
            return Err(format!(
                "input probe round {expected_index} is out of order"
            ));
        }
        if round.expected_hex != expected_hex {
            return Err(format!(
                "input probe round {expected_index} has the wrong expected hex"
            ));
        }
        if round.received_hex.len() % 2 != 0
            || !round
                .received_hex
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(format!(
                "input probe round {expected_index} received invalid hex"
            ));
        }
        if round.ok != (round.received_hex == expected_hex) {
            return Err(format!(
                "input probe round {expected_index} ok flag is inconsistent"
            ));
        }
    }
    if !result.ok {
        if result.error.as_deref().unwrap_or("").trim().is_empty() {
            return Err("a failed input probe result must carry an error".to_string());
        }
        return Ok(());
    }
    if result.error.is_some() || result.results.iter().any(|round| !round.ok) {
        return Err("a successful input probe result must not carry failures".to_string());
    }
    if result.duration_ms == 0 || result.duration_ms > run.elapsed().as_millis() as u64 + 60_000 {
        return Err("input probe result duration is invalid".to_string());
    }
    Ok(())
}

async fn write_json_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "input probe output path has no parent".to_string())?;
    let temporary = parent.join(format!(".input-probe-{}.tmp", uuid::Uuid::new_v4()));
    let write_attempt = async {
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .await
            .map_err(|error| format!("failed to create input probe output: {error}"))?;
        file.write_all(contents)
            .await
            .map_err(|error| format!("failed to write input probe output: {error}"))?;
        file.sync_all()
            .await
            .map_err(|error| format!("failed to sync input probe output: {error}"))?;
        drop(file);
        let _ = tokio::fs::remove_file(path).await;
        tokio::fs::hard_link(&temporary, path)
            .await
            .map_err(|error| format!("failed to publish input probe output: {error}"))
    };
    let result = write_attempt.await;
    let _ = tokio::fs::remove_file(&temporary).await;
    result
}

#[tauri::command]
pub(crate) fn input_probe_config(
    state: State<'_, InputProbeState>,
) -> Result<Option<InputProbeConfig>, String> {
    tracing::info!("input_probe_config invoked");
    let run = match &state.mode {
        InputProbeMode::Disabled => return Ok(None),
        InputProbeMode::Invalid(error) => return Err(error.clone()),
        InputProbeMode::Enabled(run) => Arc::clone(run),
    };
    Ok(Some(InputProbeConfig {
        ready_path: run.ready_path.to_string_lossy().into_owned(),
        result_path: run.result_path.to_string_lossy().into_owned(),
        rounds: run.rounds,
        expected_text: run.expected_text.clone(),
    }))
}

#[tauri::command]
pub(crate) async fn input_probe_ready(
    state: State<'_, InputProbeState>,
    round: u32,
) -> Result<(), String> {
    let run = state.run()?;
    tracing::info!(round, "input_probe_ready invoked");
    validate_ready_round(&run, round)?;
    run.published_ready.store(true, Ordering::Release);
    let payload = serde_json::json!({ "round": round });
    let serialized = serde_json::to_vec(&payload)
        .map_err(|error| format!("failed to serialize input probe checkpoint: {error}"))?;
    write_json_atomically(&run.ready_path, &serialized).await
}

#[tauri::command]
pub(crate) async fn input_probe_result(
    state: State<'_, InputProbeState>,
    result: InputProbeResult,
) -> Result<(), String> {
    let run = state.run()?;
    tracing::info!(ok = result.ok, "input_probe_result invoked");
    validate_result(&run, &result)?;
    let serialized = serde_json::to_vec(&result)
        .map_err(|error| format!("failed to serialize input probe result: {error}"))?;
    if serialized.len() > MAX_RESULT_BYTES {
        return Err(format!(
            "input probe result exceeds {MAX_RESULT_BYTES} bytes"
        ));
    }
    write_json_atomically(&run.result_path, &serialized).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_run() -> InputProbeRun {
        InputProbeRun {
            ready_path: PathBuf::from("/tmp/input-probe-ready.json"),
            result_path: PathBuf::from("/tmp/input-probe-result.json"),
            rounds: 30,
            expected_text: "asd".to_string(),
            started_at: Instant::now(),
            published_ready: AtomicBool::new(false),
        }
    }

    fn passing_result() -> InputProbeResult {
        InputProbeResult {
            ok: true,
            rounds: 30,
            expected_text: "asd".to_string(),
            expected_hex: "617364".to_string(),
            duration_ms: 1_234,
            results: (1..=30)
                .map(|round| InputProbeRoundResult {
                    round,
                    expected_hex: "617364".to_string(),
                    received_hex: "617364".to_string(),
                    ok: true,
                })
                .collect(),
            error: None,
        }
    }

    #[test]
    fn probe_mode_requires_an_explicit_one() {
        assert!(enabled_value(Some("1")));
        assert!(!enabled_value(Some("true")));
        assert!(!enabled_value(None));
    }

    #[test]
    fn env_paths_must_be_absolute() {
        let error = absolute_env_path(Some(OsString::from("result.json")), "RESULT")
            .expect_err("a relative result path must be rejected");
        assert!(error.contains("absolute path"), "unexpected error: {error}");
    }

    #[test]
    fn rounds_reject_zero_and_out_of_range_values() {
        std::env::set_var(ROUNDS_ENV, "0");
        assert!(rounds_from_env().is_err());
        std::env::set_var(ROUNDS_ENV, "101");
        assert!(rounds_from_env().is_err());
        std::env::set_var(ROUNDS_ENV, "30");
        assert_eq!(rounds_from_env().unwrap(), 30);
        std::env::remove_var(ROUNDS_ENV);
        assert_eq!(rounds_from_env().unwrap(), DEFAULT_ROUNDS);
    }

    #[test]
    fn expected_text_rejects_control_characters_and_overlong_values() {
        std::env::set_var(EXPECTED_ENV, "a\u{1f}b");
        assert!(expected_from_env().is_err());
        std::env::set_var(EXPECTED_ENV, "x".repeat(33));
        assert!(expected_from_env().is_err());
        std::env::set_var(EXPECTED_ENV, "asd");
        assert_eq!(expected_from_env().unwrap(), "asd");
        std::env::remove_var(EXPECTED_ENV);
        assert_eq!(expected_from_env().unwrap(), DEFAULT_EXPECTED);
    }

    #[test]
    fn ready_round_must_stay_within_the_configured_bounds() {
        let run = test_run();
        assert!(validate_ready_round(&run, 0).is_err());
        assert!(validate_ready_round(&run, 31).is_err());
        assert!(validate_ready_round(&run, 30).is_ok());
    }

    #[test]
    fn result_validation_accepts_the_exact_passing_contract() {
        assert!(validate_result(&test_run(), &passing_result()).is_ok());
    }

    #[test]
    fn result_validation_rejects_mismatched_rounds_and_hex() {
        let run = test_run();
        let mut result = passing_result();
        result.rounds = 29;
        assert!(validate_result(&run, &result).is_err());

        let mut result = passing_result();
        result.results[0].received_hex = "61".to_string();
        assert!(validate_result(&run, &result).is_err());

        let mut result = passing_result();
        result.ok = false;
        result.error = Some("lost keystroke".to_string());
        assert!(validate_result(&run, &result).is_ok());

        let mut result = passing_result();
        result.error = Some("unexpected failure detail".to_string());
        assert!(validate_result(&run, &result).is_err());
    }
}
