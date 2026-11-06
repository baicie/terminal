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
use tauri::{AppHandle, Manager, Runtime, State};

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

/// The one verdict this launch decided. The frontend may read it or ask for a
/// re-run, but it can never replace RESTORE_INTERRUPTED with a fresh diagnosis.
#[derive(Debug)]
pub struct RecoveryVerdict(pub std::sync::Mutex<RecoveryStatus>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MigrationTarget {
    pub table: String,
    pub columns: Vec<String>,
}

fn marker_version() -> u32 {
    1
}

#[derive(Debug, Serialize, Deserialize)]
struct MigrationMarker {
    #[serde(default = "marker_version")]
    version: u32,
    snapshot_path: String,
    created_at_ms: u64,
    /// v1 marker: hosts columns only.
    #[serde(default)]
    target_columns: Vec<String>,
    /// v2 marker: every table/column group this migration touches.
    #[serde(default)]
    targets: Vec<MigrationTarget>,
    #[serde(default)]
    migration_id: String,
}

impl MigrationMarker {
    /// v1 markers are rendered as one hosts target; they are never ignored.
    fn normalized_targets(&self) -> Vec<MigrationTarget> {
        if !self.targets.is_empty() {
            return self.targets.clone();
        }
        if self.target_columns.is_empty() {
            return Vec::new();
        }
        vec![MigrationTarget {
            table: "hosts".to_string(),
            columns: self.target_columns.clone(),
        }]
    }
}

pub fn core_targets() -> Vec<MigrationTarget> {
    vec![MigrationTarget {
        table: "hosts".to_string(),
        columns: TARGET_COLUMNS
            .iter()
            .map(|column| column.to_string())
            .collect(),
    }]
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

#[cfg(unix)]
fn fsync_dir(directory: &Path) -> Result<(), String> {
    let file = File::open(directory)
        .map_err(|error| format!("could not open {} for fsync: {error}", directory.display()))?;
    file.sync_all()
        .map_err(|error| format!("could not fsync {}: {error}", directory.display()))
}

/// Windows cannot open a directory with `File::open`; a backup-semantics handle
/// is required. `FlushFileBuffers` on a directory handle is not supported by
/// every filesystem, so only `ERROR_INVALID_FUNCTION` is treated as "this
/// volume has no directory flush" and recorded; every other failure is real.
#[cfg(windows)]
fn fsync_dir(directory: &Path) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const ERROR_INVALID_FUNCTION: i32 = 1;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(directory)
        .map_err(|error| format!("could not open {} for fsync: {error}", directory.display()))?;
    match file.sync_all() {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(ERROR_INVALID_FUNCTION) => {
            tracing::warn!(
                target: "startup",
                directory = %directory.display(),
                "directory flush is not supported by this Windows volume"
            );
            Ok(())
        }
        Err(error) => Err(format!("could not fsync {}: {error}", directory.display())),
    }
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
pub fn write_marker(
    directory: &Path,
    snapshot: &Path,
    migration_id: &str,
    targets: Vec<MigrationTarget>,
) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("could not create {}: {error}", directory.display()))?;
    // Never replace an open marker: the first snapshot is the pre-migration
    // state, and overwriting it would move the restore point forward. Merge the
    // new targets into the existing marker instead.
    let existing = read_marker(directory).ok().flatten();
    let (snapshot_path, created_at_ms, mut merged_targets, id) = match existing {
        Some(marker) => (
            marker.snapshot_path.clone(),
            marker.created_at_ms,
            marker.normalized_targets(),
            if marker.migration_id.is_empty() {
                migration_id.to_string()
            } else {
                format!("{},{}", marker.migration_id, migration_id)
            },
        ),
        None => (
            snapshot.display().to_string(),
            now_ms(),
            Vec::new(),
            migration_id.to_string(),
        ),
    };
    for target in targets {
        match merged_targets
            .iter_mut()
            .find(|item| item.table == target.table)
        {
            Some(item) => {
                for column in target.columns {
                    if !item.columns.contains(&column) {
                        item.columns.push(column);
                    }
                }
            }
            None => merged_targets.push(target),
        }
    }
    let marker = MigrationMarker {
        version: 2,
        snapshot_path,
        created_at_ms,
        target_columns: Vec::new(),
        targets: merged_targets,
        migration_id: id,
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

async fn table_columns(path: &Path, table: &str) -> Result<Vec<String>, String> {
    let mut connection = open_read_only(path).await?;
    let sql = format!(
        "SELECT name FROM pragma_table_info('{}')",
        table.replace('\'', "''")
    );
    let rows = sqlx::query(&sql).fetch_all(&mut connection).await;
    let _ = connection.close().await;
    rows.map(|rows| {
        rows.iter()
            .map(|row| row.get::<String, _>("name"))
            .collect()
    })
    .map_err(|error| format!("could not read the {table} schema: {error}"))
}

async fn host_columns(path: &Path) -> Result<Vec<String>, String> {
    table_columns(path, "hosts").await
}

/// Count how many of the marker's target columns exist in the live schema.
async fn target_progress(
    path: &Path,
    targets: &[MigrationTarget],
) -> Result<(usize, usize), String> {
    let mut present = 0usize;
    let mut total = 0usize;
    for target in targets {
        let columns = table_columns(path, &target.table).await?;
        for column in &target.columns {
            total += 1;
            if columns.iter().any(|name| name == column) {
                present += 1;
            }
        }
    }
    Ok((present, total))
}

/// A snapshot is only trusted when it is a different file inside the app's own
/// backups directory, opens read-only, passes integrity, still has the A-era
/// hosts schema, and carries the hosts table.
async fn validate_snapshot(
    snapshot: &Path,
    db: &Path,
    backups: &Path,
    targets: &[MigrationTarget],
) -> Result<(), String> {
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
    let host = host_columns(snapshot).await?;
    if host.is_empty() {
        return Err("the snapshot has no hosts table".to_string());
    }
    let (present, _total) = target_progress(snapshot, targets).await?;
    if present > 0 {
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
    targets: &[MigrationTarget],
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

    if let Err(error) = validate_snapshot(snapshot, db, backups, targets).await {
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
        let (present, _total) = target_progress(&temporary, targets).await?;
        if columns.is_empty() || present > 0 {
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

    let targets = marker.normalized_targets();
    if targets.is_empty() {
        return status(
            RecoveryState::ManualInterventionRequired,
            "the migration marker names no target columns; refusing to guess",
        );
    }
    let (present, total) = match target_progress(db, &targets).await {
        Ok(progress) => progress,
        Err(error) => {
            return status(
                RecoveryState::ManualInterventionRequired,
                format!("the database schema cannot be read: {error}"),
            )
        }
    };
    if present == total {
        // Columns alone are not proof: verify the file before clearing anything.
        if let Err(error) = integrity(db).await {
            return status(
                RecoveryState::ManualInterventionRequired,
                format!(
                    "all target columns exist but integrity_check failed ({error}); marker kept"
                ),
            );
        }
        let cleared = clear_marker(marker_dir).unwrap_or(false);
        let mut status = status(
            RecoveryState::Recovered,
            "all target columns exist and integrity_check passed; stale marker cleared",
        );
        status.marker_cleared = cleared;
        return status;
    }
    if present == 0 {
        // Nothing was applied: the crash happened before the first ALTER, so the
        // database is still the pre-migration database. Keep it and clear the
        // marker; no restore is needed and no file is overwritten.
        if let Err(error) = integrity(db).await {
            return status(
                RecoveryState::ManualInterventionRequired,
                format!("no migration was applied but integrity_check failed: {error}"),
            );
        }
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
    if let Err(error) = validate_snapshot(&snapshot, db, backups, &targets).await {
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
    let targets = read_marker(marker_dir)
        .ok()
        .flatten()
        .map(|marker| marker.normalized_targets())
        .unwrap_or_default();
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
    restore_from_snapshot(db, &snapshot, marker_dir, backups, &targets).await
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
pub async fn db_recovery_status(
    verdict: State<'_, RecoveryVerdict>,
) -> Result<RecoveryStatus, String> {
    verdict
        .0
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "the recovery verdict lock is poisoned".to_string())
}

/// Explicit user retry: re-runs the same startup decision and replaces the
/// stored verdict only with the result of that run.
#[tauri::command]
pub async fn db_recovery_retry<R: Runtime>(
    app: AppHandle<R>,
    verdict: State<'_, RecoveryVerdict>,
) -> Result<RecoveryStatus, String> {
    let status = startup_recovery_for(&app).await;
    *verdict
        .0
        .lock()
        .map_err(|_| "the recovery verdict lock is poisoned".to_string())? = status.clone();
    Ok(status)
}

/// The backend decides whether a migration may be marked complete: every
/// target column in the marker must exist and the database must pass
/// integrity_check. A frontend callback alone is never trusted.
pub async fn verify_completion(db: &Path, marker_dir: &Path) -> Result<bool, String> {
    let Some(marker) = read_marker(marker_dir)? else {
        return Ok(false);
    };
    let targets = marker.normalized_targets();
    if targets.is_empty() {
        return Err("the migration marker names no target columns".to_string());
    }
    integrity(db).await?;
    let (present, total) = target_progress(db, &targets).await?;
    if present != total {
        return Err(format!(
            "migration completion rejected: {present}/{total} target columns present"
        ));
    }
    clear_marker(marker_dir)
}

/// Called by the frontend only after every schema statement has succeeded; the
/// command verifies the marker's targets before clearing it.
#[tauri::command]
pub async fn database_migration_completed<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let db = database_path(&app)?;
    let marker = marker_path(&app)?;
    let directory = marker.parent().unwrap_or_else(|| Path::new(""));
    verify_completion(&db, directory).await
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
        write_marker(dir.path(), &snapshot, "core", core_targets()).expect("marker");
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
        write_marker(dir.path(), &snapshot, "core", core_targets()).expect("marker");
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
        write_marker(
            dir.path(),
            &backups.join("pre-migration-1.db"),
            "core",
            core_targets(),
        )
        .expect("marker");
        let result = startup_recovery(&db, dir.path(), &backups).await;
        assert_eq!(result.state, RecoveryState::Recovered);
        assert!(!dir.path().join(MARKER_FILE).exists());
    }
    #[tokio::test]
    async fn completion_guard_rejects_a_partial_target_set_and_keeps_the_marker() {
        let (dir, db, _backups, snapshot) = temp_paths();
        create_database(&db, "partial").await;
        write_marker(dir.path(), &snapshot, "core", core_targets()).expect("marker");
        let error = verify_completion(&db, dir.path())
            .await
            .expect_err("a partial target set must not complete");
        assert!(error.contains("completion rejected"), "{error}");
        assert!(dir.path().join(MARKER_FILE).exists());

        let mut connection =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db))
                .await
                .expect("database");
        sqlx::query("ALTER TABLE hosts ADD COLUMN shell_integration TEXT DEFAULT 'off'")
            .execute(&mut connection)
            .await
            .expect("complete the second column");
        let _ = connection.close().await;
        assert!(verify_completion(&db, dir.path()).await.expect("verify"));
        assert!(!dir.path().join(MARKER_FILE).exists());
    }

    #[tokio::test]
    async fn a_partial_team_migration_is_restored_without_losing_rows() {
        let (dir, db, backups, snapshot) = temp_paths();
        for path in [&snapshot, &db] {
            let mut connection = SqliteConnection::connect_with(
                &SqliteConnectOptions::new()
                    .filename(path)
                    .create_if_missing(true),
            )
            .await
            .expect("database");
            sqlx::query("CREATE TABLE hosts (id TEXT PRIMARY KEY)")
                .execute(&mut connection)
                .await
                .expect("hosts table");
            sqlx::query("CREATE TABLE team_shared_hosts (id TEXT PRIMARY KEY, name TEXT)")
                .execute(&mut connection)
                .await
                .expect("team table");
            sqlx::query("INSERT INTO team_shared_hosts (id, name) VALUES ('t1', 'kept')")
                .execute(&mut connection)
                .await
                .expect("team row");
            let _ = connection.close().await;
        }
        let mut connection =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db))
                .await
                .expect("database");
        sqlx::query("ALTER TABLE team_shared_hosts ADD COLUMN version INTEGER")
            .execute(&mut connection)
            .await
            .expect("partial team column");
        let _ = connection.close().await;

        write_marker(
            dir.path(),
            &snapshot,
            "team",
            vec![MigrationTarget {
                table: "team_shared_hosts".to_string(),
                columns: vec!["version".to_string(), "dirty".to_string()],
            }],
        )
        .expect("marker");

        let result = startup_recovery(&db, dir.path(), &backups).await;
        assert_eq!(result.state, RecoveryState::Recovered, "{result:?}");
        let columns = table_columns(&db, "team_shared_hosts")
            .await
            .expect("columns");
        assert_eq!(columns, vec!["id".to_string(), "name".to_string()]);
        let mut connection = open_read_only(&db).await.expect("open");
        let name: String = sqlx::query_scalar("SELECT name FROM team_shared_hosts WHERE id = 't1'")
            .fetch_one(&mut connection)
            .await
            .expect("row");
        assert_eq!(name, "kept");
    }
}

#[cfg(all(test, windows))]
mod windows_fs_tests {
    use super::*;

    /// Runs on a real Windows host (`cargo test`): marker publication, removal
    /// and directory flush must work with backup-semantics handles.
    #[test]
    fn marker_roundtrip_and_directory_flush_on_windows() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let snapshot = dir.path().join("backups").join("pre-migration-1.db");
        std::fs::create_dir_all(snapshot.parent().expect("backups parent"))
            .expect("backups directory");
        std::fs::write(&snapshot, b"SQLite format 3\0").expect("snapshot file");
        write_marker(dir.path(), &snapshot, "core", core_targets()).expect("write marker");
        assert!(dir.path().join(MARKER_FILE).exists());
        clear_marker(dir.path()).expect("clear marker");
        assert!(!dir.path().join(MARKER_FILE).exists());
        fsync_dir(dir.path()).expect("flush directory");
    }
}
