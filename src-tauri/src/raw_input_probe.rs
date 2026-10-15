use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::io::AsyncWriteExt;

const ENABLE_ENV: &str = "TERMINAL_RAW_INPUT_PROBE";
const RESULT_PATH_ENV: &str = "TERMINAL_RAW_INPUT_PROBE_RESULT_PATH";
const CASE_ENV: &str = "TERMINAL_RAW_INPUT_PROBE_CASE";
const DEFAULT_CASE: &str = "sgr-mouse";
const MAX_RESULT_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawInputProbeConfig {
    result_path: String,
    case_name: String,
    expected_hex: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RawInputProbeResult {
    ok: bool,
    case_name: String,
    expected_hex: String,
    received_hex: String,
    duration_ms: u64,
    error: Option<String>,
}

struct RawInputProbeRun {
    result_path: PathBuf,
    case_name: String,
    expected_hex: String,
    started_at: Instant,
}

enum RawInputProbeMode {
    Disabled,
    Invalid(String),
    Enabled(Arc<RawInputProbeRun>),
}

pub(crate) struct RawInputProbeState {
    mode: RawInputProbeMode,
}

fn is_enabled() -> bool {
    std::env::var(ENABLE_ENV).ok().as_deref() == Some("1")
}

fn absolute_path(value: Option<OsString>) -> Result<PathBuf, String> {
    let path = value
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| format!("{RESULT_PATH_ENV} is required in raw input probe mode"))?;
    if !path.is_absolute() {
        return Err(format!("{RESULT_PATH_ENV} must be an absolute path"));
    }
    Ok(path)
}

fn expected_hex(case_name: &str) -> Option<&'static str> {
    match case_name {
        "sgr-mouse" => Some("1b5b3c303b333b344d"),
        "bracketed-paste" => Some("1b5b3230307e66697273740d7365636f6e641b5b3230317e"),
        "raw-x10" => Some("1b5b4d20813f"),
        _ => None,
    }
}

fn configured_case() -> Result<(String, String), String> {
    let case_name = std::env::var(CASE_ENV)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_CASE.to_string());
    let expected = expected_hex(&case_name)
        .ok_or_else(|| format!("{CASE_ENV} has an unsupported raw input probe case"))?;
    Ok((case_name, expected.to_string()))
}

impl RawInputProbeState {
    pub(crate) fn from_env() -> Self {
        let mode = if !is_enabled() {
            RawInputProbeMode::Disabled
        } else {
            match (|| {
                let (case_name, expected_hex) = configured_case()?;
                Ok(RawInputProbeRun {
                    result_path: absolute_path(std::env::var_os(RESULT_PATH_ENV))?,
                    case_name,
                    expected_hex,
                    started_at: Instant::now(),
                })
            })() {
                Ok(run) => RawInputProbeMode::Enabled(Arc::new(run)),
                Err(error) => RawInputProbeMode::Invalid(error),
            }
        };
        Self { mode }
    }

    fn run(&self) -> Result<Arc<RawInputProbeRun>, String> {
        match &self.mode {
            RawInputProbeMode::Enabled(run) => Ok(Arc::clone(run)),
            RawInputProbeMode::Disabled => Err("raw input probe mode is not enabled".to_string()),
            RawInputProbeMode::Invalid(error) => Err(error.clone()),
        }
    }
}

fn valid_hex(value: &str) -> bool {
    !value.is_empty()
        && value.len().is_multiple_of(2)
        && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_result(run: &RawInputProbeRun, result: &RawInputProbeResult) -> Result<(), String> {
    if result.case_name != run.case_name || result.expected_hex != run.expected_hex {
        return Err("raw input probe result does not match its configured case".to_string());
    }
    if !valid_hex(&result.received_hex) {
        return Err("raw input probe received hex is invalid".to_string());
    }
    if result.duration_ms == 0
        || result.duration_ms > run.started_at.elapsed().as_millis() as u64 + 60_000
    {
        return Err("raw input probe result duration is invalid".to_string());
    }
    if result.ok {
        if result.received_hex != run.expected_hex || result.error.is_some() {
            return Err("successful raw input probe result is inconsistent".to_string());
        }
    } else if result.error.as_deref().unwrap_or("").trim().is_empty() {
        return Err("failed raw input probe result must carry an error".to_string());
    }
    Ok(())
}

async fn write_json(path: &Path, value: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "raw input probe result path has no parent".to_string())?;
    let temporary = parent.join(format!(".raw-input-probe-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .await
        .map_err(|error| format!("failed to create raw input probe result: {error}"))?;
    file.write_all(value)
        .await
        .map_err(|error| format!("failed to write raw input probe result: {error}"))?;
    file.sync_all()
        .await
        .map_err(|error| format!("failed to sync raw input probe result: {error}"))?;
    drop(file);
    let _ = tokio::fs::remove_file(path).await;
    let result = tokio::fs::hard_link(&temporary, path)
        .await
        .map_err(|error| format!("failed to publish raw input probe result: {error}"));
    let _ = tokio::fs::remove_file(&temporary).await;
    result
}

#[tauri::command]
pub(crate) fn raw_input_probe_config(
    state: State<'_, RawInputProbeState>,
) -> Result<Option<RawInputProbeConfig>, String> {
    let run = match &state.mode {
        RawInputProbeMode::Disabled => return Ok(None),
        RawInputProbeMode::Invalid(error) => return Err(error.clone()),
        RawInputProbeMode::Enabled(run) => Arc::clone(run),
    };
    Ok(Some(RawInputProbeConfig {
        result_path: run.result_path.to_string_lossy().into_owned(),
        case_name: run.case_name.clone(),
        expected_hex: run.expected_hex.clone(),
    }))
}

#[tauri::command]
pub(crate) async fn raw_input_probe_result(
    state: State<'_, RawInputProbeState>,
    result: RawInputProbeResult,
) -> Result<(), String> {
    let run = state.run()?;
    validate_result(&run, &result)?;
    let serialized = serde_json::to_vec(&result)
        .map_err(|error| format!("failed to serialize raw input probe result: {error}"))?;
    if serialized.len() > MAX_RESULT_BYTES {
        return Err(format!(
            "raw input probe result exceeds {MAX_RESULT_BYTES} bytes"
        ));
    }
    write_json(&run.result_path, &serialized).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run() -> RawInputProbeRun {
        RawInputProbeRun {
            result_path: PathBuf::from("/tmp/raw-input-probe-result.json"),
            case_name: "raw-x10".to_string(),
            expected_hex: "1b5b4d20813f".to_string(),
            started_at: Instant::now(),
        }
    }

    #[test]
    fn cases_have_stable_expected_bytes() {
        assert_eq!(expected_hex("sgr-mouse"), Some("1b5b3c303b333b344d"));
        assert_eq!(
            expected_hex("bracketed-paste"),
            Some("1b5b3230307e66697273740d7365636f6e641b5b3230317e")
        );
        assert_eq!(expected_hex("raw-x10"), Some("1b5b4d20813f"));
        assert_eq!(expected_hex("unknown"), None);
    }

    #[test]
    fn result_validation_rejects_a_mismatched_case_or_payload() {
        let run = run();
        let result = RawInputProbeResult {
            ok: true,
            case_name: "raw-x10".to_string(),
            expected_hex: run.expected_hex.clone(),
            received_hex: run.expected_hex.clone(),
            duration_ms: 1,
            error: None,
        };
        assert!(validate_result(&run, &result).is_ok());
        let mut mismatch = result;
        mismatch.received_hex = "ff".to_string();
        assert!(validate_result(&run, &mismatch).is_err());
    }
}
