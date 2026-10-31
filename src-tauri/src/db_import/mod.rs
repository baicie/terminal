//! Single-transaction backup import (Phase 8, P8.2).
//!
//! `tauri-plugin-sql` registers no transaction command, and every statement the
//! frontend sends through `execute` acquires its own pooled connection, so a
//! `BEGIN` sent from JavaScript never brackets the statements that follow it.
//! This command reuses the very pool the plugin registered and runs the whole
//! import on one acquired connection inside one `BEGIN IMMEDIATE` transaction.
//!
//! It also owns the pre-migration snapshot (`backup.rs`): the frontend asks for a
//! verified `VACUUM INTO` copy through this module before it rewrites the schema, and
//! stops when that copy cannot be produced.

mod backup;
mod payload;
#[cfg(test)]
mod tests;
mod writer;

pub use backup::backup_database_before_migration;
pub use payload::ImportPayload;
pub use writer::ImportReport;

use std::time::Duration;

use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_sql::{DbInstances, DbPool};

/// Key the plugin stores the application database under.
pub const DB_KEY: &str = "sqlite:terminal.db";

/// Budget for one import, from `BEGIN` through `COMMIT`.
pub const IMPORT_BUDGET: Duration = Duration::from_secs(30);

/// Imports a backup inside one transaction on the plugin's own pool.
#[tauri::command]
pub async fn import_backup_data<R: Runtime>(
    app: AppHandle<R>,
    payload: ImportPayload,
) -> Result<ImportReport, String> {
    let pool = sqlite_pool(&app).await?;
    writer::run_import(&pool, &payload, IMPORT_BUDGET)
        .await
        .map_err(|error| error.to_string())
}

/// Reuse the plugin's loaded pool instead of opening a second one: the import
/// must serialize against the same connections the rest of the app writes on.
async fn sqlite_pool<R: Runtime>(app: &AppHandle<R>) -> Result<Pool<Sqlite>, String> {
    let instances = app.state::<DbInstances>();
    let guard = instances.0.read().await;
    let entry = guard
        .get(DB_KEY)
        .ok_or_else(|| format!("database `{DB_KEY}` is not loaded by the sql plugin"))?;
    sqlite_pool_of(entry)
        .cloned()
        .ok_or_else(|| format!("database `{DB_KEY}` is not a sqlite pool"))
}

/// `DbPool` only carries the sqlite variant in this build, so the catch-all arm
/// is unreachable here; it stays for the non-sqlite feature combinations.
#[allow(unreachable_patterns)]
fn sqlite_pool_of(entry: &DbPool) -> Option<&Pool<Sqlite>> {
    match entry {
        DbPool::Sqlite(pool) => Some(pool),
        _ => None,
    }
}
