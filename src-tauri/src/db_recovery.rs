//! Product-side database recovery state machine (Phase 9.6).
//!
//! The upgrade harness already proves that a verified pre-migration snapshot can be
//! restored after a crash. This module moves the same protocol into the product
//! startup path:
//!
//! * the pre-migration snapshot writes a pending marker **before** `VACUUM INTO`;
//! * startup inspects the marker, the live schema and the snapshot;
//! * a partial migration with a verified snapshot is restored automatically;
//! * a partial migration without a usable snapshot stops at a manual state and
//!   never overwrites the database;
//! * every transition is observable through a redacted status command.
//!
//! The restore sequence is the same eight stages the harness verifies:
//! PREPARE/QUIESCE/VERIFY_BACKUP/STAGE/VERIFY_STAGED/COMMIT/VERIFY/COMPLETE.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{Connection, Row};
use tauri::{AppHandle, Manager, Runtime};

pub const MARKER_FILE: &str = "migration.pending.json";
pub const TARGET_COLUMNS: [&str; 2] = ["agent_forwarding", "shell_integration"];
const TEMP_FILE: &str = "terminal.restore.tmp";

/// States are strings on the wire so the UI can render them without a schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecoveryState {
    Healthy,
    RecoveryRequired,
    BackupValidating,
    Restoring,
    RestoreInterrupted,
    Recovered,
    ManualInterventionRequired,
}

/// Redacted recovery report: no password, key or vault content ever enters it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
    pub state: RecoveryState,
    pub reason: String,
    pub restored_from: Option<String>,
    pub stages: Vec<String>,
    pub marker_cleared: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct MigrationMarker {
    snapshot_path: String,
    created_at_ms: u64,
    target_columns: Vec<String>,
}

fn status(state: RecoveryState, reason: impl Into<String>) -> RecoveryStatus {
    RecoveryStatus {
        state,
        reason: reason.into(),
        restored_from: None,
        stages: Vec::new(),
        marker_cleared: false,
    }
}

/// Application database and marker live in the app config directory, next to the
/// snapshot directory the backup command already owns.
pub fn database_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("the application config directory is unknown: {error}"))?;
    Ok(base.join("terminal.db"))
}

pub fn marker_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    database_path(app).map(|db| db.with_file_name(MARKER_FILE))
}

pub fn backups_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    database_path(app).map(|db| db.with_file_name("backups"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

fn fsync_dir(directory: &Path) -> Result<(), String> {
    let file = File::open(directory)
        .map_err(|error| format!("could not open {} for fsync: {error}", directory.display()))?;
    file.sync_all()
        .map_err(|error| format!("could not fsync {}: {error}", directory.display()))
}

fn fsync_file(file: &Path) -> Result<(), String> {
    let handle = File::options()
        .read(true)
        .write(true)
        .open(file)
        .map_err(|error| format!("could not open {} for fsync: {error}", file.display()))?;
    handle
        .sync_all()
        .map_err(|error| format!("could not fsync {}: {error}", file.display()))
}

/// Write the marker before the snapshot: a crash between the marker and the
/// migration is then visible on the next start instead of silently leaving a
/// half-migrated database.
pub fn write_marker(directory: &Path, snapshot: &Path) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("could not create {}: {error}", directory.display()))?;
    let marker = MigrationMarker {
        snapshot_path: snapshot.display().to_string(),
        created_at_ms: now_ms(),
        target_columns: TARGET_COLUMNS
            .iter()
            .map(|column| column.to_string())
            .collect(),
    };
    let temporary = directory.join(MARKER_FILE.to_string() + ".tmp");
    let payload = serde_json::to_vec(&marker)
        .map_err(|error| format!("could not serialise the migration marker: {error}"))?;
    let mut file = File::create(&temporary)
        .map_err(|error| format!("could not create {}: {error}", temporary.display()))?;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, directory.join(MARKER_FILE))
        .map_err(|error| format!("could not publish the migration marker: {error}"))?;
    fsync_dir(directory)
}

pub fn clear_marker(directory: &Path) -> Result<bool, String> {
    let path = directory.join(MARKER_FILE);
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(&path)
        .map_err(|error| format!("could not remove {}: {error}", path.display()))?;
    fsync_dir(directory)?;
    Ok(true)
}

fn read_marker(directory: &Path) -> Result<Option<MigrationMarker>, String> {
    let path = directory.join(MARKER_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let raw =
        fs::read(&path).map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let marker = serde_json::from_slice(&raw)
        .map_err(|error| format!("could not parse {}: {error}", path.display()))?;
    Ok(Some(marker))
}

async fn open_read_only(path: &Path) -> Result<SqliteConnection, String> {
    SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(path).read_only(true))
        .await
        .map_err(|error| format!("could not open {}: {error}", path.display()))
}

async fn integrity(path: &Path) -> Result<(), String> {
    let mut connection = open_read_only(path).await?;
    let result = async {
        let value: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&mut connection)
            .await
            .map_err(|error| format!("integrity_check failed: {error}"))?;
        if value != "ok" {
            return Err(format!("integrity_check reported {value}"));
        }
        Ok(())
    }
    .await;
    let _ = connection.close().await;
    result
}

async fn host_columns(path: &Path) -> Result<Vec<String>, String> {
    let mut connection = open_read_only(path).await?;
    let rows = sqlx::query("SELECT name FROM pragma_table_info('hosts')")
        .fetch_all(&mut connection)
        .await;
    let _ = connection.close().await;
    rows.map(|rows| {
        rows.iter()
            .map(|row| row.get::<String, _>("name"))
            .collect()
    })
    .map_err(|error| format!("could not read the hosts schema: {error}"))
}

fn has_targets(columns: &[String]) -> bool {
    TARGET_COLUMNS
        .iter()
        .all(|target| columns.iter().any(|column| column == target))
}

fn has_any_target(columns: &[String]) -> bool {
    TARGET_COLUMNS
        .iter()
        .any(|target| columns.iter().any(|column| column == target))
}

/// A snapshot is only trusted when it is a different file inside the app's own
/// backups directory, opens read-only, passes integrity, still has the A-era
/// hosts schema, and carries the hosts table.
async fn validate_snapshot(snapshot: &Path, db: &Path, backups: &Path) -> Result<(), String> {
    if snapshot == db {
        return Err("the marker points at the live database".to_string());
    }
    let parent = snapshot.parent().unwrap_or_else(|| Path::new(""));
    if parent != backups {
        return Err(format!(
            "the snapshot is outside the backups directory: {}",
            snapshot.display()
        ));
    }
    if !snapshot.exists() {
        return Err(format!(
            "the snapshot does not exist: {}",
            snapshot.display()
        ));
    }
    integrity(snapshot).await?;
    let columns = host_columns(snapshot).await?;
    if columns.is_empty() {
        return Err("the snapshot has no hosts table".to_string());
    }
    if has_any_target(&columns) {
        return Err("the snapshot already contains a migrated schema".to_string());
    }
    Ok(())
}

/// Checkpoint the live database before any file is replaced. A busy WAL is a
/// hard stop: restoring over a database with uncheckpointed frames could lose
/// committed rows if the migration had written new ones.
async fn checkpoint(path: &Path) -> Result<(), String> {
    let mut connection =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(path))
            .await
            .map_err(|error| {
                format!("could not open {} for checkpoint: {error}", path.display())
            })?;
    let result = async {
        let row = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .fetch_one(&mut connection)
            .await
            .map_err(|error| format!("checkpoint failed: {error}"))?;
        let busy: i64 = row.try_get("busy").unwrap_or(0);
        let log: i64 = row.try_get("log").unwrap_or(-1);
        let checkpointed: i64 = row.try_get("checkpointed").unwrap_or(-1);
        if busy != 0 {
            return Err(format!(
                "checkpoint busy={busy} log={log} checkpointed={checkpointed}"
            ));
        }
        if log != checkpointed {
            return Err(format!(
                "checkpoint incomplete log={log} checkpointed={checkpointed}"
            ));
        }
        Ok(())
    }
    .await;
    let _ = connection.close().await;
    result
}

/// The eight-stage restore used by the product. File operations are synchronous
/// and small; the only awaited work is SQLite verification.
pub async fn restore_from_snapshot(
    db: &Path,
    snapshot: &Path,
    marker_dir: &Path,
    backups: &Path,
) -> RecoveryStatus {
    let mut stages: Vec<String> = Vec::new();
    fn interrupted(stages: &[String], stage: &str, reason: String) -> RecoveryStatus {
        let mut status = status(RecoveryState::RestoreInterrupted, reason);
        status.stages = stages.to_vec();
        status.stages.push(stage.to_string());
        status
    }

    stages.push("PREPARE".into());
    if let Err(error) = checkpoint(db).await {
        return interrupted(&stages, "QUIESCE", error);
    }
    stages.push("QUIESCE".into());

    if let Err(error) = validate_snapshot(snapshot, db, backups).await {
        return interrupted(&stages, "VERIFY_BACKUP", error);
    }
    stages.push("VERIFY_BACKUP".into());

    let Some(directory) = db.parent() else {
        return interrupted(
            &stages,
            "STAGE",
            "the database has no parent directory".to_string(),
        );
    };
    let temporary = directory.join(TEMP_FILE);
    let staged = async {
        fs::copy(snapshot, &temporary)
            .map_err(|error| format!("could not stage the snapshot: {error}"))?;
        fsync_file(&temporary)?;
        // The staged copy is verified with the same rules, but it lives next to
        // the live database rather than in backups/.
        integrity(&temporary).await?;
        let columns = host_columns(&temporary).await?;
        if columns.is_empty() || has_any_target(&columns) {
            return Err("the staged snapshot has an unexpected schema".to_string());
        }
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = staged {
        let _ = fs::remove_file(&temporary);
        return interrupted(&stages, "STAGE", error);
    }
    stages.push("STAGE".into());
    stages.push("VERIFY_STAGED".into());

    for suffix in ["-wal", "-shm", "-journal"] {
        let sidecar = PathBuf::from(format!("{}{}", db.display(), suffix));
        if let Err(error) = fs::remove_file(&sidecar) {
            if error.kind() != std::io::ErrorKind::NotFound {
                return interrupted(
                    &stages,
                    "COMMIT",
                    format!("could not remove {}: {error}", sidecar.display()),
                );
            }
        }
    }
    if let Err(error) = fsync_dir(directory) {
        return interrupted(&stages, "COMMIT", error);
    }
    stages.push("COMMIT".into());

    if let Err(error) = fs::rename(&temporary, db) {
        return interrupted(
            &stages,
            "VERIFY",
            format!("could not publish the restored database: {error}"),
        );
    }
    if let Err(error) = fsync_dir(directory) {
        return interrupted(&stages, "VERIFY", error);
    }
    stages.push("VERIFY".into());

    if let Err(error) = integrity(db).await {
        return interrupted(&stages, "COMPLETE", error);
    }
    let cleared = clear_marker(marker_dir).unwrap_or(false);
    stages.push("COMPLETE".into());

    RecoveryStatus {
        state: RecoveryState::Recovered,
        reason: "a partial migration was restored from the verified pre-migration snapshot"
            .to_string(),
        restored_from: Some(snapshot.display().to_string()),
        stages,
        marker_cleared: cleared,
    }
}

/// Read-only decision. A partial migration with a verified snapshot returns
/// RecoveryRequired; nothing is written here.
pub async fn diagnose(db: &Path, marker_dir: &Path, backups: &Path) -> RecoveryStatus {
    if !db.exists() {
        return status(RecoveryState::Healthy, "the database does not exist yet");
    }
    let marker = match read_marker(marker_dir) {
        Ok(marker) => marker,
        Err(error) => return status(RecoveryState::ManualInterventionRequired, error),
    };
    let Some(marker) = marker else {
        return match integrity(db).await {
            Ok(()) => status(RecoveryState::Healthy, "no pending migration marker"),
            Err(error) => status(
                RecoveryState::ManualInterventionRequired,
                format!("the database failed integrity_check: {error}"),
            ),
        };
    };

    let columns = match host_columns(db).await {
        Ok(columns) => columns,
        Err(error) => {
            return status(
                RecoveryState::ManualInterventionRequired,
                format!("the database schema cannot be read: {error}"),
            )
        }
    };
    if has_targets(&columns) {
        let cleared = clear_marker(marker_dir).unwrap_or(false);
        let mut status = status(
            RecoveryState::Recovered,
            "the migration already completed; the stale marker was cleared",
        );
        status.marker_cleared = cleared;
        return status;
    }
    if !has_any_target(&columns) {
        // Nothing was applied: the crash happened before the first ALTER, so the
        // database is still the pre-migration database. Keep it and clear the
        // marker; no restore is needed and no file is overwritten.
        let cleared = clear_marker(marker_dir).unwrap_or(false);
        let mut status = status(
            RecoveryState::Healthy,
            "the database still has the pre-migration schema; marker cleared",
        );
        status.marker_cleared = cleared;
        return status;
    }

    let snapshot = PathBuf::from(&marker.snapshot_path);
    let mut validating = status(
        RecoveryState::BackupValidating,
        "a partial migration was detected; validating the pre-migration snapshot",
    );
    validating.stages.push("VERIFY_BACKUP".into());
    if let Err(error) = validate_snapshot(&snapshot, db, backups).await {
        return status(
            RecoveryState::ManualInterventionRequired,
            format!("the pre-migration snapshot is not usable: {error}"),
        );
    }
    let mut required = status(
        RecoveryState::RecoveryRequired,
        "a partial migration was detected and the pre-migration snapshot is verified",
    );
    required.restored_from = Some(snapshot.display().to_string());
    required.stages.push("VERIFY_BACKUP".into());
    required
}

/// Startup decision: diagnose, then restore automatically only when the
/// snapshot is verified and the live schema is partially migrated.
pub async fn startup_recovery(db: &Path, marker_dir: &Path, backups: &Path) -> RecoveryStatus {
    let diagnosis = diagnose(db, marker_dir, backups).await;
    if diagnosis.state != RecoveryState::RecoveryRequired {
        return diagnosis;
    }
    let Some(snapshot) = diagnosis.restored_from.as_deref().map(PathBuf::from) else {
        return status(
            RecoveryState::ManualInterventionRequired,
            "recovery was required but no snapshot path was reported",
        );
    };
    let mut restoring = status(
        RecoveryState::Restoring,
        "restoring the verified pre-migration snapshot",
    );
    restoring.stages = diagnosis.stages.clone();
    tracing::info!(
        target: "startup",
        stage = "database-recovery-restoring",
        snapshot = %snapshot.display(),
        "db recovery"
    );
    restore_from_snapshot(db, &snapshot, marker_dir, backups).await
}

/// Resolve the app paths and run the startup decision before the frontend opens
/// the database. Failures are reported, never turned into a silent overwrite.
fn record_state(state: RecoveryState, reason: &str) {
    let Ok(path) = std::env::var("TERMINAL_RECOVERY_STAGES_PATH") else {
        return;
    };
    let line = serde_json::json!({
        "state": format!("{state:?}"),
        "reason": reason,
    });
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{line}");
    }
}

pub async fn startup_recovery_for<R: Runtime>(app: &AppHandle<R>) -> RecoveryStatus {
    match (database_path(app), marker_path(app), backups_path(app)) {
        (Ok(db), Ok(marker), Ok(backups)) => {
            let marker_dir = marker
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .to_path_buf();
            let result = startup_recovery(&db, &marker_dir, &backups).await;
            record_state(result.state, &result.reason);
            tracing::info!(
                target: "startup",
                stage = "database-recovery",
                state = ?result.state,
                reason = %result.reason,
                stages = ?result.stages,
                "db recovery"
            );
            result
        }
        (Err(error), _, _) | (_, Err(error), _) | (_, _, Err(error)) => {
            status(RecoveryState::ManualInterventionRequired, error)
        }
    }
}

#[tauri::command]
pub async fn db_recovery_status<R: Runtime>(app: AppHandle<R>) -> Result<RecoveryStatus, String> {
    match (database_path(&app), marker_path(&app), backups_path(&app)) {
        (Ok(db), Ok(marker), Ok(backups)) => {
            let marker_dir = marker
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .to_path_buf();
            Ok(diagnose(&db, &marker_dir, &backups).await)
        }
        (Err(error), _, _) | (_, Err(error), _) | (_, _, Err(error)) => Err(error),
    }
}

/// Called by the frontend only after every schema statement has succeeded.
#[tauri::command]
pub async fn database_migration_completed<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let marker = marker_path(&app)?;
    let directory = marker.parent().unwrap_or_else(|| Path::new(""));
    clear_marker(directory)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::SqlitePool;

    async fn create_database(path: &Path, mode: &str) {
        let pool: SqlitePool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(path)
                    .create_if_missing(true),
            )
            .await
            .expect("database");
        sqlx::query("CREATE TABLE hosts (id TEXT PRIMARY KEY, name TEXT)")
            .execute(&pool)
            .await
            .expect("hosts table");
        if mode != "a" {
            sqlx::query("ALTER TABLE hosts ADD COLUMN agent_forwarding INTEGER DEFAULT 0")
                .execute(&pool)
                .await
                .expect("partial column");
        }
        if mode == "migrated" {
            sqlx::query("ALTER TABLE hosts ADD COLUMN shell_integration TEXT DEFAULT 'off'")
                .execute(&pool)
                .await
                .expect("migrated column");
        }
        sqlx::query("INSERT INTO hosts (id, name) VALUES ('h1', 'kept')")
            .execute(&pool)
            .await
            .expect("seed");
        pool.close().await;
    }

    fn temp_paths() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = dir.path().join("terminal.db");
        let backups = dir.path().join("backups");
        std::fs::create_dir_all(&backups).expect("backups");
        let snapshot = backups.join("pre-migration-1.db");
        (dir, db, backups, snapshot)
    }

    #[tokio::test]
    async fn fresh_install_is_healthy() {
        let (dir, db, _, backups) = temp_paths();
        let result = startup_recovery(&db, dir.path(), &backups).await;
        assert_eq!(result.state, RecoveryState::Healthy);
    }

    #[tokio::test]
    async fn a_partial_migration_is_restored_from_the_verified_snapshot() {
        let (dir, db, backups, snapshot) = temp_paths();
        create_database(&snapshot, "a").await;
        create_database(&db, "partial").await;
        // Simulate the first ALTER having been applied: agent_forwarding exists,
        // shell_integration does not. The snapshot is A-era and verified.
        write_marker(dir.path(), &snapshot).expect("marker");
        let result = startup_recovery(&db, dir.path(), &backups).await;
        assert_eq!(result.state, RecoveryState::Recovered, "{:?}", result);
        assert!(result.stages.contains(&"COMPLETE".to_string()));
        assert!(!dir.path().join(MARKER_FILE).exists());
        let columns = host_columns(&db).await.expect("columns");
        assert!(!columns.iter().any(|column| column == "shell_integration"));
        assert!(!columns.iter().any(|column| column == "agent_forwarding"));
        let mut connection = open_read_only(&db).await.expect("open");
        let name: String = sqlx::query_scalar("SELECT name FROM hosts WHERE id = 'h1'")
            .fetch_one(&mut connection)
            .await
            .expect("row");
        assert_eq!(name, "kept");
    }

    #[tokio::test]
    async fn a_missing_snapshot_never_overwrites_the_database() {
        let (dir, db, backups, snapshot) = temp_paths();
        create_database(&db, "a").await;
        write_marker(dir.path(), &snapshot).expect("marker");
        // The marker exists but the snapshot was never written; the live schema
        // has no target columns, so the safe action is to keep it and clear the
        // marker rather than claim a recovery.
        let result = startup_recovery(&db, dir.path(), &backups).await;
        assert_eq!(result.state, RecoveryState::Healthy);
        assert!(db.exists());
    }

    #[tokio::test]
    async fn a_completed_migration_with_a_stale_marker_is_recovered() {
        let (dir, db, backups, _snapshot) = temp_paths();
        create_database(&db, "migrated").await;
        write_marker(dir.path(), &backups.join("pre-migration-1.db")).expect("marker");
        let result = startup_recovery(&db, dir.path(), &backups).await;
        assert_eq!(result.state, RecoveryState::Recovered);
        assert!(!dir.path().join(MARKER_FILE).exists());
    }
}
