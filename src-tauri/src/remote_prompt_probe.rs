use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::State;

const PATH_ENV: &str = "TERMINAL_REMOTE_PROMPT_PROBE_PATH";
const MARKER_ENV: &str = "TERMINAL_REMOTE_PROMPT_PROBE_MARKER";
const COMMAND_ENV: &str = "TERMINAL_REMOTE_PROMPT_PROBE_COMMAND";
const EXPECTED_CWD_ENV: &str = "TERMINAL_REMOTE_PROMPT_PROBE_EXPECTED_CWD";
const EXPECTED_EXIT_CODE_ENV: &str = "TERMINAL_REMOTE_PROMPT_PROBE_EXPECTED_EXIT_CODE";
const MAX_PATH_LENGTH: usize = 4_096;
const MAX_MARKER_LENGTH: usize = 512;
const MAX_COMMAND_LENGTH: usize = 4_096;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemotePromptProbeConfig {
    marker: String,
    command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_exit_code: Option<i32>,
}

pub(crate) struct RemotePromptProbeState {
    path: Option<PathBuf>,
    config: Option<RemotePromptProbeConfig>,
    observed: AtomicBool,
}

impl RemotePromptProbeState {
    pub(crate) fn from_env() -> Self {
        let path = std::env::var_os(PATH_ENV)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .filter(|path| path.is_absolute() && path.to_string_lossy().len() <= MAX_PATH_LENGTH);
        let marker = std::env::var(MARKER_ENV).ok();
        let command = std::env::var(COMMAND_ENV).ok();
        let expected_cwd = std::env::var(EXPECTED_CWD_ENV)
            .ok()
            .filter(|value| valid_path(value));
        let expected_exit_code = std::env::var(EXPECTED_EXIT_CODE_ENV)
            .ok()
            .and_then(|value| value.parse::<i32>().ok())
            .filter(|value| (0..=255).contains(value));
        let config = match (path.as_ref(), marker, command) {
            (Some(_), Some(marker), Some(command))
                if valid_text(&marker, MAX_MARKER_LENGTH)
                    && valid_text(&command, MAX_COMMAND_LENGTH) =>
            {
                Some(RemotePromptProbeConfig {
                    marker,
                    command,
                    expected_cwd,
                    expected_exit_code,
                })
            }
            (None, None, None) => None,
            _ => None,
        };
        Self {
            path,
            config,
            observed: AtomicBool::new(false),
        }
    }

    fn config(&self) -> Option<RemotePromptProbeConfig> {
        self.config.clone()
    }

    fn record_observed(&self) -> Result<(), String> {
        let Some(path) = self.path.as_ref() else {
            return Err("remote prompt probe is not enabled".to_string());
        };
        let Some(config) = self.config.as_ref() else {
            return Err("remote prompt probe configuration is invalid".to_string());
        };
        if self.observed.load(Ordering::Acquire) {
            return Ok(());
        }
        std::fs::write(path, config.marker.as_bytes())
            .map_err(|error| format!("failed to persist remote prompt probe: {error}"))?;
        self.observed.store(true, Ordering::Release);
        Ok(())
    }
}

fn valid_text(value: &str, max_length: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_length
        && !value.bytes().any(|byte| byte <= 0x1f || byte == 0x7f)
}

fn valid_path(value: &str) -> bool {
    value.starts_with('/') && valid_text(value, MAX_PATH_LENGTH)
}

#[tauri::command]
pub(crate) fn remote_prompt_probe_config(
    state: State<'_, RemotePromptProbeState>,
) -> Option<RemotePromptProbeConfig> {
    state.config()
}

#[tauri::command]
pub(crate) fn remote_prompt_probe_observed(
    state: State<'_, RemotePromptProbeState>,
) -> Result<(), String> {
    state.record_observed()
}

#[cfg(test)]
mod tests {
    use super::valid_text;

    #[test]
    fn valid_text_accepts_non_empty_printable_values_within_limit() {
        assert!(valid_text("REMOTE_PROMPT_MARKER", 512));
        assert!(valid_text("printf '%s\\n' marker", 4_096));
    }

    #[test]
    fn valid_text_rejects_empty_control_character_and_overlong_values() {
        assert!(!valid_text("", 512));
        assert!(!valid_text("marker\n", 512));
        assert!(!valid_text("marker\u{007f}", 512));
        assert!(!valid_text("12345", 4));
    }
}
