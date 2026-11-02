//! Startup stage tracing.
//!
//! The frontend owns the database bootstrap, but this build has no log plugin
//! and no error bridge, so a failure there is invisible to anything reading the
//! process output - which is exactly what made #59 take several rounds to
//! locate. This command lets the frontend emit one line per bootstrap stage into
//! the Rust log, on every platform, without adding a logging dependency.
//!
//! # The staged timeline (#65)
//!
//! A readiness deadline that expires says nothing about *where* the time went:
//! "terminal readiness did not complete within 10000 ms" was printed for a run
//! whose SSH connection had not even been attempted, because a stalled WebView
//! and a slow handshake both reported as "terminalReady: false". Every stage
//! below therefore carries a monotonic timestamp, and
//! TERMINAL_STARTUP_STAGES_PATH makes the sequence readable from outside the
//! process instead of only from a terminal.
//!
//! Nothing is written unless that variable names a file, so a normal session
//! pays one OnceLock read per stage. Every timestamp is taken against one
//! Instant origin, so the difference between two lines is a real duration even
//! when the wall clock jumps.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

/// File the staged timeline is appended to. Absent means the sink is disabled.
pub(crate) const STAGES_ENV: &str = "TERMINAL_STARTUP_STAGES_PATH";

/// One origin per process: every stage is measured against it, so the numbers
/// are comparable with each other and never with the wall clock.
fn origin() -> Instant {
    static ORIGIN: OnceLock<Instant> = OnceLock::new();
    *ORIGIN.get_or_init(Instant::now)
}

fn sink() -> Option<&'static PathBuf> {
    static SINK: OnceLock<Option<PathBuf>> = OnceLock::new();
    SINK.get_or_init(|| std::env::var_os(STAGES_ENV).map(PathBuf::from))
        .as_ref()
}

/// Serialises appends so two threads cannot interleave halves of one line.
fn append_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Milliseconds since this process' stage origin.
pub(crate) fn elapsed_ms() -> u64 {
    origin().elapsed().as_millis() as u64
}

/// Minimal JSON escaping. Stage details carry shell commands and backend error
/// messages, which do contain quotes and newlines, and a malformed line would
/// cost a line-by-line reader the whole timeline.
fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            control if (control as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", control as u32))
            }
            other => out.push(other),
        }
    }
    out
}

/// Append one stage line. Split out of stage() so tests can drive it without
/// touching the process-wide environment.
fn record(path: &Path, stage: &str, detail: &str, at_ms: u64) -> std::io::Result<()> {
    let line = format!(
        "{{\"at_ms\":{at_ms},\"stage\":\"{}\",\"detail\":\"{}\"}}\n",
        escape(stage),
        escape(detail)
    );
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(line.as_bytes())?;
    file.flush()
}

fn write_stage(name: &str, detail: &str) {
    if let Some(path) = sink() {
        let at_ms = elapsed_ms();
        // A poisoned lock must never abort startup: the timeline is evidence,
        // not control flow.
        let _guard = append_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = record(path, name, detail, at_ms);
    }
}

/// Record one stage on the monotonic timeline.
///
/// Always logged, so TERMINAL_DEBUG_SSH_PROFILE=1 alone shows the sequence;
/// also written to the sink file when one was configured.
pub fn stage(name: &str, detail: &str) {
    tracing::info!(target: "startup", stage = %name, at_ms = elapsed_ms(), detail = %detail, "startup stage");
    write_stage(name, detail);
}

/// Record one database-bootstrap stage.
///
/// The identifier is short and stable (see the frontend connection.ts), the
/// detail is free text. Both are logged as fields so a later grep can
/// reconstruct the order even when lines interleave.
#[tauri::command]
pub fn startup_stage(stage: String, detail: String) {
    tracing::info!(target: "startup", stage = %stage, detail = %detail, "db bootstrap");
    write_stage(&stage, &detail);
}

/// Record a database-bootstrap failure with the stage it happened in.
///
/// Separate from startup_stage so a failure is never mistaken for progress: the
/// level is ERROR, the message says "db bootstrap failed", and the timeline
/// names the stage as <stage>-failed.
#[tauri::command]
pub fn startup_stage_failed(stage: String, error: String) {
    tracing::error!(target: "startup", stage = %stage, error = %error, "db bootstrap failed");
    write_stage(&format!("{stage}-failed"), &error);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn temp_path(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "terminal-startup-trace-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("temp directory");
        directory.join("stages.jsonl")
    }

    fn read(path: &Path) -> String {
        let mut text = String::new();
        std::fs::File::open(path)
            .expect("stages file")
            .read_to_string(&mut text)
            .expect("stages readable");
        text
    }

    #[test]
    fn appends_one_line_per_stage_in_call_order() {
        let path = temp_path("order");
        record(&path, "frontend-boot", "webview loaded", 0).expect("first stage");
        record(&path, "ssh-tcp-connected", "127.0.0.1:22", 1234).expect("second stage");
        let text = read(&path);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2, "{text}");
        assert_eq!(
            lines[0],
            "{\"at_ms\":0,\"stage\":\"frontend-boot\",\"detail\":\"webview loaded\"}"
        );
        assert_eq!(
            lines[1],
            "{\"at_ms\":1234,\"stage\":\"ssh-tcp-connected\",\"detail\":\"127.0.0.1:22\"}"
        );
    }

    #[test]
    fn escapes_quotes_backslashes_and_newlines() {
        let path = temp_path("escape");
        record(&path, "ssh-startup-write", "printf \"a\"\\nb", 7).expect("stage");
        let text = read(&path);
        assert_eq!(
            text.lines().count(),
            1,
            "a raw newline must not end the line: {text}"
        );
        assert!(text.contains("\\\"a\\\""), "{text}");
        assert!(text.contains("\\\\n"), "{text}");
    }

    #[test]
    fn elapsed_ms_only_grows() {
        let first = elapsed_ms();
        std::thread::sleep(std::time::Duration::from_millis(2));
        assert!(elapsed_ms() >= first);
    }

    #[test]
    fn stage_without_a_sink_records_nothing_and_does_not_panic() {
        assert!(sink().is_none(), "tests must not configure the sink file");
        stage("frontend-boot", "no sink configured");
    }
}
