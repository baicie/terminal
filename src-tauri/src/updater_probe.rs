//! Test-only updater runtime, compiled only with `--features smoke-updater`.
//!
//! The production app only *checks* for updates. This module adds the missing
//! runtime half — check, download, verify the minisign signature, install, and
//! restart — so the acceptance harness can exercise it against a loopback
//! server with a throwaway key. It never runs unless both the feature is on and
//! the harness set `TERMINAL_UPDATER_PROBE_ACTION`; the production binary has
//! neither.
//!
//! Reports are written as JSON so the harness can distinguish "the updater said
//! no update" from "the download failed" from "the signature was rejected"
//! without parsing human-readable logs.

use serde_json::json;
use std::io::Write as _;
use tauri_plugin_updater::UpdaterExt;

/// Append the version this process booted as to the path baked in at build time.
///
/// A macOS restart goes through LaunchServices, which does not inherit the
/// harness environment: the relaunched process cannot be told where to write a
/// report. A compile-time path is the only channel that survives that, and it
/// exists only in a `smoke-updater` build.
pub fn record_boot(app: &tauri::AppHandle) {
    let Some(path) = option_env!("TERMINAL_UPDATER_PROBE_BOOT_PATH") else {
        return;
    };
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let line = format!(
        "{}\t{}\t{millis}\n",
        std::process::id(),
        app.package_info().version
    );
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

struct Outcome {
    status: &'static str,
    available: Option<String>,
}

/// Called from `setup`. Returns immediately unless the feature is compiled in
/// and the harness asked for a probe.
pub fn maybe_start(app: &tauri::AppHandle) {
    let Ok(action) = std::env::var("TERMINAL_UPDATER_PROBE_ACTION") else {
        return;
    };
    let Ok(result_path) = std::env::var("TERMINAL_UPDATER_PROBE_RESULT") else {
        return;
    };

    // A restart after an install re-enters this function with the same
    // environment. The report on disk is what tells the two runs apart: the
    // second one records the version the app came back as instead of probing
    // again (which would be an endless install loop).
    if std::fs::read_to_string(&result_path)
        .is_ok_and(|report| report.contains("\"status\":\"installed\""))
    {
        // Exiting directly inside setup would tear the app down before the
        // event loop exists; let setup return and record the relaunch from a
        // task instead.
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let relaunch = json!({
                "status": "relaunched",
                "currentVersion": app.package_info().version.to_string(),
            });
            let _ = std::fs::write(format!("{result_path}.relaunch"), relaunch.to_string());
            app.exit(0);
        });
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut report = json!({
            "action": action,
            "currentVersion": app.package_info().version.to_string(),
            "status": "running",
        });
        match run(&app, &action).await {
            Ok(outcome) => {
                report["status"] = json!(outcome.status);
                if let Some(version) = outcome.available {
                    report["availableVersion"] = json!(version);
                }
            }
            Err(error) => {
                report["status"] = json!("error");
                report["error"] = json!(error);
            }
        }
        let _ = std::fs::write(&result_path, report.to_string());

        if report["status"] == "installed" {
            if std::env::var("TERMINAL_UPDATER_PROBE_RESTART").as_deref() == Ok("1") {
                app.restart();
            }
            return;
        }
        if std::env::var("TERMINAL_UPDATER_PROBE_EXIT").as_deref() == Ok("1") {
            app.exit(0);
        }
    });
}

/// Each stage is prefixed so a failed case names where it stopped; the prefix is
/// part of the report, not a substitute for the plugin's own message.
async fn run(app: &tauri::AppHandle, action: &str) -> Result<Outcome, String> {
    let updater = app.updater().map_err(|error| format!("config: {error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("check: {error}"))?;
    let Some(update) = update else {
        return Ok(Outcome {
            status: "up_to_date",
            available: None,
        });
    };
    let available = update.version.clone();
    if action == "check" {
        return Ok(Outcome {
            status: "available",
            available: Some(available),
        });
    }
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("install: {error}"))?;
    Ok(Outcome {
        status: "installed",
        available: Some(available),
    })
}
