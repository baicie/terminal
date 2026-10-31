//! Startup stage tracing.
//!
//! The frontend owns the database bootstrap, but this build has no log plugin
//! and no error bridge, so a failure there is invisible to anything reading the
//! process output - which is exactly what made #59 take several rounds to
//! locate. This command lets the frontend emit one line per bootstrap stage into
//! the Rust log, on every platform, without adding a logging dependency.

/// Record one database-bootstrap stage.
///
/// `stage` is a short stable identifier (see the constants in the frontend
/// `connection.ts`), `detail` is free text. Both are logged as fields so a
/// later grep can reconstruct the order even when lines interleave.
#[tauri::command]
pub fn startup_stage(stage: String, detail: String) {
    tracing::info!(target: "startup", stage = %stage, detail = %detail, "db bootstrap");
}

/// Record a database-bootstrap failure with the stage it happened in.
///
/// Separate from `startup_stage` so a failure is never mistaken for progress:
/// the level is ERROR and the message says `db bootstrap failed`.
#[tauri::command]
pub fn startup_stage_failed(stage: String, error: String) {
    tracing::error!(target: "startup", stage = %stage, error = %error, "db bootstrap failed");
}
