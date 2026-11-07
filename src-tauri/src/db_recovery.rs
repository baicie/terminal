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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{Connection, Row};
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

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

/// Cross-process exclusive lock plus in-process serialization.
///
/// The file lock stops a second process; the async mutex stops two Tauri
/// commands inside this process from running a backup and a restore at the same
/// time. They are different failure modes and neither substitutes for the
/// other: two handles in one process both "own" the file lock, and a mutex never
/// covers another process.
#[derive(Default)]
pub struct RecoveryLock {
    file: StdMutex<Option<File>>,
    operation: Arc<AsyncMutex<()>>,
    migration_active: AtomicBool,
}

const RECOVERY_LOCK_FILE: &str = "recovery.lock";

/// Identifies this process, and this launch of it, as the owner of a pending
/// migration. A pid alone is not enough: the OS reuses pids, so a marker left
/// by a dead process must never be treated as ours.
fn process_token() -> &'static str {
    static TOKEN: OnceLock<String> = OnceLock::new();
    TOKEN.get_or_init(|| format!("{}-{}", std::process::id(), now_ms()))
}

pub fn try_acquire_lock(directory: &Path) -> Result<File, String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("could not create {}: {error}", directory.display()))?;
    let path = directory.join(RECOVERY_LOCK_FILE);
    let file = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(&path)
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(std::fs::TryLockError::WouldBlock) => {
            Err("another Terminal instance is migrating or recovering this database".to_string())
        }
        Err(std::fs::TryLockError::Error(error)) => {
            Err(format!("could not lock {}: {error}", path.display()))
        }
    }
}

impl RecoveryLock {
    /// Acquire the cross-process lock unless this process already holds it.
    pub fn ensure(&self, directory: &Path) -> Result<(), String> {
        let mut guard = self
            .file
            .lock()
            .map_err(|_| "the recovery lock state is poisoned".to_string())?;
        if guard.is_some() {
            return Ok(());
        }
        *guard = Some(try_acquire_lock(directory)?);
        Ok(())
    }

    pub fn release(&self) {
        if let Ok(mut guard) = self.file.lock() {
            *guard = None;
        }
    }

    /// Serialize one in-process backup or restore operation. The guard is held
    /// for the whole operation, including every `await`; a second command gets
    /// an error instead of racing the first one.
    pub async fn lock_operation(&self) -> Result<OwnedMutexGuard<()>, String> {
        self.operation.clone().try_lock_owned().map_err(|_| {
            "another backup or recovery is already running in this Terminal process".to_string()
        })
    }

    pub fn note_migration_started(&self) {
        self.migration_active.store(true, Ordering::SeqCst);
    }

    pub fn note_migration_finished(&self) {
        self.migration_active.store(false, Ordering::SeqCst);
    }

    pub fn migration_in_progress(&self) -> bool {
        self.migration_active.load(Ordering::SeqCst)
    }
}

pub fn ensure_lock(lock: &RecoveryLock, directory: &Path) -> Result<(), String> {
    lock.ensure(directory)
}

pub fn release_lock(lock: &RecoveryLock) {
    lock.release();
}

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
    /// The transaction this marker belongs to. Completion and rollback must
    /// name it; a command that cannot prove it owns the transaction may not
    /// clear it.
    #[serde(default)]
    migration_id: String,
    /// v3: the process (and launch) that opened the transaction.
    #[serde(default)]
    owner_pid: u32,
    #[serde(default)]
    owner_token: String,
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
/// every filesystem, so `ERROR_INVALID_FUNCTION` means "this volume has no
/// directory flush". `ERROR_ACCESS_DENIED` is ambiguous: NTFS also reports it
/// for a flush it does not support, but it is also what a real permission
/// problem looks like. The directory is probed for writability so a genuine
/// permission failure is never downgraded to "flush unsupported".
#[cfg(windows)]
fn fsync_dir(directory: &Path) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const ERROR_INVALID_FUNCTION: i32 = 1;
    const ERROR_ACCESS_DENIED: i32 = 5;
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
        Err(error)
            if error.raw_os_error() == Some(ERROR_ACCESS_DENIED)
                && directory_is_writable(directory) =>
        {
            tracing::warn!(
                target: "startup",
                directory = %directory.display(),
                "directory flush is denied on this Windows volume but the directory is writable"
            );
            Ok(())
        }
        Err(error) => Err(format!("could not fsync {}: {error}", directory.display())),
    }
}

/// Can this process create a file in `directory`? Used to tell "this volume has
/// no directory flush" (writable) from "this directory is not writable"
/// (a real permission failure that must stay fatal).
#[cfg(windows)]
fn directory_is_writable(directory: &Path) -> bool {
    let probe = directory.join(".terminal-fsync-probe");
    match File::create(&probe) {
        Ok(file) => {
            let _ = file.sync_all();
            drop(file);
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
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

fn merge_targets(merged: &mut Vec<MigrationTarget>, targets: Vec<MigrationTarget>) {
    for target in targets {
        match merged.iter_mut().find(|item| item.table == target.table) {
            Some(item) => {
                for column in target.columns {
                    if !item.columns.contains(&column) {
                        item.columns.push(column);
                    }
                }
            }
            None => merged.push(target),
        }
    }
}

fn publish_marker_bytes(directory: &Path, payload: &[u8]) -> Result<(), String> {
    let temporary = directory.join(MARKER_FILE.to_string() + ".tmp");
    let mut file = File::create(&temporary)
        .map_err(|error| format!("could not create {}: {error}", temporary.display()))?;
    file.write_all(payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, directory.join(MARKER_FILE))
        .map_err(|error| format!("could not publish the migration marker: {error}"))?;
    fsync_dir(directory)
}

fn publish_marker(directory: &Path, marker: &MigrationMarker) -> Result<(), String> {
    let payload = serde_json::to_vec(marker)
        .map_err(|error| format!("could not serialise the migration marker: {error}"))?;
    publish_marker_bytes(directory, &payload)
}

/// The transaction a backup call opened.
///
/// `previous` holds the exact marker bytes this call replaced (or `None` when it
/// created the marker), so a failed snapshot restores the earlier transaction
/// byte for byte instead of merely "not clearing" a marker whose contents were
/// already rewritten.
#[derive(Debug)]
pub struct MarkerTransaction {
    pub transaction_id: String,
    previous: Option<Vec<u8>>,
    created: bool,
}

impl MarkerTransaction {
    #[cfg(test)]
    pub fn created(&self) -> bool {
        self.created
    }
}

/// Open the migration transaction this backup belongs to.
///
/// A marker that already exists is only extended when this same process opened
/// it and the existing snapshot is provably compatible with the new targets.
/// Anything else is a hard stop: an unfinished transaction from another launch
/// must be recovered first, never merged into.
pub async fn begin_transaction(
    directory: &Path,
    snapshot: &Path,
    migration_id: &str,
    targets: Vec<MigrationTarget>,
) -> Result<MarkerTransaction, String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("could not create {}: {error}", directory.display()))?;
    let existing = read_marker(directory)?;
    let (marker, previous, created) = match existing {
        Some(existing) => {
            if existing.owner_token.is_empty() {
                return Err(
                    "a pending migration from an older Terminal build owns this database; \
                     restart Terminal so it can be recovered before starting a new migration"
                        .to_string(),
                );
            }
            if existing.owner_token != process_token() {
                return Err(format!(
                    "transaction {} is owned by another Terminal process; \
                     restart Terminal so it can be recovered before starting a new migration",
                    existing.migration_id
                ));
            }
            let mut merged = existing.normalized_targets();
            merge_targets(&mut merged, targets.clone());
            verify_snapshot_extension(&existing, &targets).await?;
            let raw = fs::read(directory.join(MARKER_FILE))
                .map_err(|error| format!("could not read the migration marker: {error}"))?;
            let marker = MigrationMarker {
                version: 3,
                snapshot_path: existing.snapshot_path.clone(),
                created_at_ms: existing.created_at_ms,
                target_columns: Vec::new(),
                targets: merged,
                migration_id: existing.migration_id.clone(),
                owner_pid: std::process::id(),
                owner_token: process_token().to_string(),
            };
            (marker, Some(raw), false)
        }
        None => {
            let mut merged = Vec::new();
            merge_targets(&mut merged, targets);
            let marker = MigrationMarker {
                version: 3,
                snapshot_path: snapshot.display().to_string(),
                created_at_ms: now_ms(),
                target_columns: Vec::new(),
                targets: merged,
                migration_id: migration_id.to_string(),
                owner_pid: std::process::id(),
                owner_token: process_token().to_string(),
            };
            (marker, None, true)
        }
    };
    publish_marker(directory, &marker)?;
    Ok(MarkerTransaction {
        transaction_id: marker.migration_id.clone(),
        previous,
        created,
    })
}

/// A transaction may only grow targets the existing pre-migration snapshot does
/// not already carry. Otherwise restoring that snapshot after a later failure
/// would roll back a column the marker claims is part of the transaction.
async fn verify_snapshot_extension(
    marker: &MigrationMarker,
    new_targets: &[MigrationTarget],
) -> Result<(), String> {
    let snapshot = Path::new(&marker.snapshot_path);
    if !snapshot.is_file() {
        return Err(format!(
            "the pending transaction's snapshot is missing: {}",
            snapshot.display()
        ));
    }
    for target in new_targets {
        let columns = table_columns(snapshot, &target.table).await?;
        if columns.is_empty() {
            return Err(format!(
                "the pending transaction's snapshot has no {} table, so it cannot cover {}",
                target.table,
                target.columns.join(", ")
            ));
        }
        if let Some(present) = target
            .columns
            .iter()
            .find(|column| columns.iter().any(|name| name == *column))
        {
            return Err(format!(
                "the pending transaction's snapshot already contains {}.{present}; \
                 refusing to reuse it for a new migration",
                target.table
            ));
        }
    }
    Ok(())
}

/// Restore the marker this transaction replaced. Called only after the snapshot
/// step failed; the transaction id check makes it impossible to roll back a
/// marker that meanwhile belongs to someone else.
pub fn rollback_transaction(
    directory: &Path,
    transaction: &MarkerTransaction,
) -> Result<(), String> {
    match read_marker(directory)? {
        None => {
            if transaction.created {
                Ok(())
            } else {
                Err("the migration marker disappeared before it could be rolled back".to_string())
            }
        }
        Some(marker) => {
            if marker.migration_id != transaction.transaction_id {
                return Err(format!(
                    "refusing to roll back transaction {}: the marker belongs to {}",
                    transaction.transaction_id, marker.migration_id
                ));
            }
            match &transaction.previous {
                Some(payload) => publish_marker_bytes(directory, payload),
                None => {
                    fs::remove_file(directory.join(MARKER_FILE)).map_err(|error| {
                        format!("could not remove the migration marker: {error}")
                    })?;
                    fsync_dir(directory)
                }
            }
        }
    }
}

/// The snapshot a live marker points at, if any. A corrupt marker is an error:
/// the caller must not prune anything it cannot prove unreferenced.
pub fn active_snapshot(directory: &Path) -> Result<Option<PathBuf>, String> {
    Ok(read_marker(directory)?.map(|marker| PathBuf::from(marker.snapshot_path)))
}

/// Remove the marker only when it still belongs to `expected_id` (or when no id
/// is demanded by a legacy caller). Returns whether a marker was removed.
pub fn clear_transaction(directory: &Path, expected_id: Option<&str>) -> Result<bool, String> {
    let Some(marker) = read_marker(directory)? else {
        return Ok(false);
    };
    if let Some(expected) = expected_id {
        if !expected.is_empty() && marker.migration_id != expected {
            return Err(format!(
                "refusing to clear the marker for transaction {}: expected {}",
                marker.migration_id, expected
            ));
        }
    }
    fs::remove_file(directory.join(MARKER_FILE))
        .map_err(|error| format!("could not remove the migration marker: {error}"))?;
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
    let marker: MigrationMarker = serde_json::from_slice(&raw)
        .map_err(|error| format!("could not parse {}: {error}", path.display()))?;
    validate_marker(&marker, &path)?;
    Ok(Some(marker))
}

/// Reject a marker this build does not understand. A corrupt or future marker
/// must stop the caller, never degrade to "no marker" and start a new
/// transaction on top of an unknown one.
fn validate_marker(marker: &MigrationMarker, path: &Path) -> Result<(), String> {
    if marker.snapshot_path.is_empty() {
        return Err(format!("{} has no snapshot path", path.display()));
    }
    if marker.version > 3 {
        return Err(format!(
            "{} declares unsupported marker version {}",
            path.display(),
            marker.version
        ));
    }
    if marker.version >= 2 && marker.targets.is_empty() {
        return Err(format!("{} v2 marker has no targets", path.display()));
    }
    if marker.version < 2 && marker.target_columns.is_empty() {
        return Err(format!(
            "{} v1 marker has no target columns",
            path.display()
        ));
    }
    if marker.version >= 2 && marker.migration_id.is_empty() {
        return Err(format!("{} v2 marker has no migration id", path.display()));
    }
    if marker.version >= 3 && marker.owner_token.is_empty() {
        return Err(format!(
            "{} v3 marker has no transaction owner",
            path.display()
        ));
    }
    Ok(())
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
    // Canonicalize before trusting the path: a symlink inside backups/ must not
    // let a marker point at an arbitrary file elsewhere on disk.
    let canonical_backups = fs::canonicalize(backups)
        .map_err(|error| format!("the backups directory is unusable: {error}"))?;
    let canonical_db = fs::canonicalize(db)
        .map_err(|error| format!("the live database is unreadable: {error}"))?;
    let canonical_snapshot = fs::canonicalize(snapshot).map_err(|error| {
        format!(
            "the snapshot does not exist or cannot be resolved: {} ({error})",
            snapshot.display()
        )
    })?;
    if canonical_snapshot == canonical_db {
        return Err("the marker points at the live database".to_string());
    }
    if canonical_snapshot.parent() != Some(canonical_backups.as_path()) {
        return Err(format!(
            "the snapshot is outside the backups directory: {}",
            snapshot.display()
        ));
    }
    if !canonical_snapshot.is_file() {
        return Err("the snapshot is not a regular file".to_string());
    }
    integrity(&canonical_snapshot).await?;
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
    transaction_id: &str,
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
    // A restore that cannot clear its own marker is not "complete": the next
    // launch would still see a pending transaction. Report the interruption and
    // keep both the marker and the verified snapshot as recovery evidence.
    let cleared = match clear_transaction(marker_dir, Some(transaction_id)) {
        Ok(cleared) => cleared,
        Err(error) => {
            return interrupted(
                &stages,
                "COMPLETE",
                format!(
                "the database was restored but the pending marker could not be cleared: {error}"
            ),
            )
        }
    };
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
        let cleared = match clear_transaction(marker_dir, Some(&marker.migration_id)) {
            Ok(cleared) => cleared,
            Err(error) => {
                return status(
                    RecoveryState::ManualInterventionRequired,
                    format!(
                    "all target columns exist but the stale marker could not be cleared: {error}"
                ),
                )
            }
        };
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
        let cleared = match clear_transaction(marker_dir, Some(&marker.migration_id)) {
            Ok(cleared) => cleared,
            Err(error) => {
                return status(
                    RecoveryState::ManualInterventionRequired,
                    format!(
                        "no migration was applied but the marker could not be cleared: {error}"
                    ),
                )
            }
        };
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
    let marker = match read_marker(marker_dir) {
        Ok(Some(marker)) => marker,
        Ok(None) => {
            return status(
                RecoveryState::ManualInterventionRequired,
                "recovery was required but the marker disappeared before it could be read",
            )
        }
        Err(error) => return status(RecoveryState::ManualInterventionRequired, error),
    };
    let targets = marker.normalized_targets();
    let transaction_id = marker.migration_id.clone();
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
    restore_from_snapshot(
        db,
        &snapshot,
        marker_dir,
        backups,
        &targets,
        &transaction_id,
    )
    .await
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

/// Run the startup decision while holding the cross-process lock.
///
/// The lock is probed on **every** start, not only when a marker is visible: a
/// second instance that starts while another process is mid-migration must fail
/// closed instead of opening the database next to a writer. When no transaction
/// remains afterwards the lock is released, so ordinary concurrent instances
/// are not serialized.
pub async fn startup_recovery_guarded(
    db: &Path,
    marker_dir: &Path,
    backups: &Path,
    lock: &RecoveryLock,
) -> RecoveryStatus {
    if let Err(error) = lock.ensure(marker_dir) {
        return status(RecoveryState::ManualInterventionRequired, error);
    }
    let result = startup_recovery(db, marker_dir, backups).await;
    if !marker_dir.join(MARKER_FILE).exists() {
        lock.release();
    }
    result
}

/// Startup entry: hold the cross-process lock when a transaction is pending so
/// a second instance cannot recover or migrate the same database concurrently.
pub async fn startup_recovery_locked<R: Runtime>(app: &AppHandle<R>) -> RecoveryStatus {
    let (Ok(db), Ok(marker), Ok(backups)) =
        (database_path(app), marker_path(app), backups_path(app))
    else {
        let error = database_path(app)
            .err()
            .or_else(|| marker_path(app).err())
            .or_else(|| backups_path(app).err())
            .unwrap_or_else(|| "the application database paths are unknown".to_string());
        return status(RecoveryState::ManualInterventionRequired, error);
    };
    let directory = marker
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .to_path_buf();
    let lock = app.state::<RecoveryLock>();
    let result = startup_recovery_guarded(&db, &directory, &backups, &lock).await;
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

/// The retry path, independent of Tauri state so the blocked verdicts can be
/// tested with a real second process holding the lock.
pub async fn retry_recovery(
    db: &Path,
    marker_dir: &Path,
    backups: &Path,
    lock: &RecoveryLock,
) -> RecoveryStatus {
    // Serialize against a backup/restore already running in this process, and
    // refuse while a migration transaction is still open.
    let operation = match lock.lock_operation().await {
        Ok(guard) => guard,
        Err(error) => return status(RecoveryState::ManualInterventionRequired, error),
    };
    if lock.migration_in_progress() {
        return status(
            RecoveryState::ManualInterventionRequired,
            "a migration transaction is still open in this Terminal process",
        );
    }
    if marker_dir.join(MARKER_FILE).exists() {
        if let Err(error) = lock.ensure(marker_dir) {
            return status(RecoveryState::ManualInterventionRequired, error);
        }
    }
    let result = startup_recovery(db, marker_dir, backups).await;
    record_state(result.state, &result.reason);
    if result.state != RecoveryState::Recovered || marker_dir.join(MARKER_FILE).exists() {
        lock.release();
    }
    drop(operation);
    result
}

/// Explicit user retry: re-runs the same startup decision and replaces the
/// stored verdict with the result of that run. Blocked paths also replace it.
#[tauri::command]
pub async fn db_recovery_retry<R: Runtime>(
    app: AppHandle<R>,
    verdict: State<'_, RecoveryVerdict>,
) -> Result<RecoveryStatus, String> {
    let (db, marker, backups) = match (database_path(&app), marker_path(&app), backups_path(&app)) {
        (Ok(db), Ok(marker), Ok(backups)) => (db, marker, backups),
        (Err(error), _, _) | (_, Err(error), _) | (_, _, Err(error)) => {
            let blocked = status(RecoveryState::ManualInterventionRequired, error);
            *verdict
                .0
                .lock()
                .map_err(|_| "the recovery verdict lock is poisoned".to_string())? =
                blocked.clone();
            return Ok(blocked);
        }
    };
    let directory = marker
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .to_path_buf();
    let lock = app.state::<RecoveryLock>();
    let result = retry_recovery(&db, &directory, &backups, &lock).await;
    *verdict
        .0
        .lock()
        .map_err(|_| "the recovery verdict lock is poisoned".to_string())? = result.clone();
    Ok(result)
}

/// The backend decides whether a migration may be marked complete: every
/// target column in the marker must exist and the database must pass
/// integrity_check. A frontend callback alone is never trusted.
pub async fn verify_completion(
    db: &Path,
    marker_dir: &Path,
    expected_transaction: Option<&str>,
) -> Result<bool, String> {
    let Some(marker) = read_marker(marker_dir)? else {
        // Nothing is pending: the transaction is complete (idempotent repeat).
        return Ok(true);
    };
    if let Some(expected) = expected_transaction {
        if !expected.is_empty() && marker.migration_id != expected {
            return Err(format!(
                "migration completion rejected: the marker belongs to transaction {}, not {}",
                marker.migration_id, expected
            ));
        }
    }
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
    clear_transaction(marker_dir, Some(&marker.migration_id))?;
    Ok(true)
}

/// Called by the frontend only after every schema statement has succeeded; the
/// command verifies the marker's targets and transaction id before clearing it.
#[tauri::command]
pub async fn database_migration_completed<R: Runtime>(
    app: AppHandle<R>,
    transaction_id: Option<String>,
) -> Result<bool, String> {
    let db = database_path(&app)?;
    let marker = marker_path(&app)?;
    let directory = marker.parent().unwrap_or_else(|| Path::new(""));
    let completed = verify_completion(&db, directory, transaction_id.as_deref()).await?;
    if completed {
        let lock = app.state::<RecoveryLock>();
        lock.note_migration_finished();
        release_lock(&lock);
    }
    Ok(completed)
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
        begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("marker");
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
        begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("marker");
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
        begin_transaction(
            dir.path(),
            &backups.join("pre-migration-1.db"),
            "core",
            core_targets(),
        )
        .await
        .expect("marker");
        let result = startup_recovery(&db, dir.path(), &backups).await;
        assert_eq!(result.state, RecoveryState::Recovered);
        assert!(!dir.path().join(MARKER_FILE).exists());
    }
    #[tokio::test]
    async fn completion_guard_rejects_a_partial_target_set_and_keeps_the_marker() {
        let (dir, db, _backups, snapshot) = temp_paths();
        create_database(&db, "partial").await;
        let transaction = begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("marker");
        let error = verify_completion(&db, dir.path(), Some(&transaction.transaction_id))
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
        assert!(
            verify_completion(&db, dir.path(), Some(&transaction.transaction_id))
                .await
                .expect("verify")
        );
        assert!(!dir.path().join(MARKER_FILE).exists());
    }

    #[tokio::test]
    async fn a_corrupt_marker_is_never_overwritten_and_a_merge_keeps_the_first_snapshot() {
        let (dir, _db, backups, snapshot) = temp_paths();
        create_database(&snapshot, "a").await;
        std::fs::write(dir.path().join(MARKER_FILE), b"not json").expect("corrupt marker");
        let error = begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect_err("a corrupt marker must stop a new transaction");
        assert!(error.contains("could not parse"), "{error}");
        assert_eq!(
            std::fs::read(dir.path().join(MARKER_FILE)).expect("marker"),
            b"not json"
        );

        std::fs::remove_file(dir.path().join(MARKER_FILE)).expect("remove corrupt marker");
        let first = begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("first");
        assert!(first.created());
        let second = backups.join("pre-migration-2.db");
        let extension = begin_transaction(
            dir.path(),
            &second,
            "team",
            vec![MigrationTarget {
                table: "hosts".to_string(),
                columns: vec!["certificate".to_string()],
            }],
        )
        .await
        .expect("second");
        assert!(!extension.created());
        let marker = read_marker(dir.path()).expect("read").expect("marker");
        assert_eq!(marker.snapshot_path, snapshot.display().to_string());
        assert_eq!(marker.version, 3);
        assert!(!marker.owner_token.is_empty());
        assert_eq!(marker.migration_id, "core");
        let columns: Vec<String> = marker
            .normalized_targets()
            .into_iter()
            .flat_map(|target| target.columns)
            .collect();
        assert!(columns.contains(&"certificate".to_string()));
    }

    #[tokio::test]
    async fn a_foreign_transaction_is_never_merged() {
        let (dir, _db, _backups, snapshot) = temp_paths();
        create_database(&snapshot, "a").await;
        begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("transaction");
        // Simulate a marker left by another launch: same file, different owner.
        let raw = std::fs::read(dir.path().join(MARKER_FILE)).expect("marker");
        let mut marker: MigrationMarker = serde_json::from_slice(&raw).expect("parse");
        marker.owner_token = "another-process-1".to_string();
        std::fs::write(
            dir.path().join(MARKER_FILE),
            serde_json::to_vec(&marker).expect("serialise"),
        )
        .expect("write marker");
        let error = begin_transaction(dir.path(), &snapshot, "team", core_targets())
            .await
            .expect_err("a foreign transaction must not be merged");
        assert!(
            error.contains("owned by another Terminal process"),
            "{error}"
        );
        let after = read_marker(dir.path()).expect("read").expect("marker");
        assert_eq!(after.migration_id, "core");
    }

    #[tokio::test]
    async fn an_extension_requires_a_snapshot_that_cannot_already_contain_the_target() {
        let (dir, _db, _backups, snapshot) = temp_paths();
        create_database(&snapshot, "migrated").await;
        begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("transaction");
        let error = begin_transaction(dir.path(), &snapshot, "team", core_targets())
            .await
            .expect_err("the snapshot already carries the target columns");
        assert!(error.contains("already contains"), "{error}");
    }

    #[tokio::test]
    async fn a_rollback_restores_the_previous_marker_byte_for_byte() {
        let (dir, _db, _backups, snapshot) = temp_paths();
        create_database(&snapshot, "a").await;
        let first = begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("transaction A");
        let before = std::fs::read(dir.path().join(MARKER_FILE)).expect("marker A");
        let before_marker = read_marker(dir.path()).expect("read").expect("marker");

        let extension = begin_transaction(
            dir.path(),
            &snapshot,
            "team",
            vec![MigrationTarget {
                table: "hosts".to_string(),
                columns: vec!["certificate".to_string()],
            }],
        )
        .await
        .expect("transaction B");
        let merged = std::fs::read(dir.path().join(MARKER_FILE)).expect("merged marker");
        assert_ne!(
            before, merged,
            "the merge must be visible before the rollback"
        );

        rollback_transaction(dir.path(), &extension).expect("rollback");
        assert_eq!(
            std::fs::read(dir.path().join(MARKER_FILE)).expect("restored marker"),
            before
        );
        let restored = read_marker(dir.path()).expect("read").expect("marker");
        assert_eq!(restored.migration_id, before_marker.migration_id);
        assert_eq!(
            restored.normalized_targets(),
            before_marker.normalized_targets()
        );
        assert_eq!(first.transaction_id, restored.migration_id);
    }

    #[tokio::test]
    async fn clear_transaction_refuses_a_marker_from_a_different_transaction() {
        let (dir, _db, _backups, snapshot) = temp_paths();
        create_database(&snapshot, "a").await;
        begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("transaction");
        let error = clear_transaction(dir.path(), Some("another-transaction"))
            .expect_err("a foreign completion must not clear the marker");
        assert!(error.contains("refusing to clear"), "{error}");
        assert!(dir.path().join(MARKER_FILE).exists());
    }

    #[tokio::test]
    async fn completion_without_a_pending_marker_is_idempotent() {
        let (dir, db, _backups, _snapshot) = temp_paths();
        create_database(&db, "migrated").await;
        assert!(verify_completion(&db, dir.path(), Some("whatever"))
            .await
            .expect("idempotent completion"));
    }

    #[tokio::test]
    async fn a_restore_that_cannot_clear_its_marker_is_not_reported_complete() {
        let (dir, db, backups, snapshot) = temp_paths();
        create_database(&snapshot, "a").await;
        create_database(&db, "partial").await;
        begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("transaction");
        let result = restore_from_snapshot(
            &db,
            &snapshot,
            dir.path(),
            &backups,
            &core_targets(),
            "not-this-transaction",
        )
        .await;
        assert_eq!(
            result.state,
            RecoveryState::RestoreInterrupted,
            "{result:?}"
        );
        assert!(
            result.reason.contains("could not be cleared"),
            "{}",
            result.reason
        );
        assert!(
            dir.path().join(MARKER_FILE).exists(),
            "recovery evidence must be kept"
        );
    }

    #[tokio::test]
    async fn in_process_operations_are_serialized() {
        let lock = RecoveryLock::default();
        let first = lock.lock_operation().await.expect("first operation");
        let error = lock
            .lock_operation()
            .await
            .expect_err("a second operation must not run concurrently");
        assert!(error.contains("already running"), "{error}");
        drop(first);
        let second = lock.lock_operation().await.expect("after the first");
        drop(second);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_failed_vacuum_restores_transaction_a_and_the_next_startup_recovers_it() {
        use crate::db_import::snapshot_before_migration;
        use std::os::unix::fs::PermissionsExt;

        let (dir, db, backups, snapshot) = temp_paths();
        create_database(&snapshot, "a").await;
        create_database(&db, "partial").await;
        let pool: SqlitePool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(&db))
            .await
            .expect("pool");

        let transaction_a = begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("transaction A");
        let before = std::fs::read(dir.path().join(MARKER_FILE)).expect("marker A");

        // A second migration in the same launch extends the open transaction,
        // then its real `VACUUM INTO` fails because the destination directory
        // cannot be written.
        let unwritable = dir.path().join("unwritable");
        std::fs::create_dir_all(&unwritable).expect("directory");
        std::fs::set_permissions(&unwritable, std::fs::Permissions::from_mode(0o500))
            .expect("read-only directory");
        let destination = unwritable.join("pre-migration-2.db");
        let transaction_b = begin_transaction(
            dir.path(),
            &destination,
            "team",
            vec![MigrationTarget {
                table: "hosts".to_string(),
                columns: vec!["certificate".to_string()],
            }],
        )
        .await
        .expect("transaction B");
        assert_ne!(
            before,
            std::fs::read(dir.path().join(MARKER_FILE)).expect("merged"),
            "the merge must happen before VACUUM"
        );
        let vacuum = snapshot_before_migration(&pool, &destination).await;
        assert!(
            vacuum.is_err(),
            "VACUUM INTO must fail on a read-only directory"
        );
        rollback_transaction(dir.path(), &transaction_b).expect("rollback");
        std::fs::set_permissions(&unwritable, std::fs::Permissions::from_mode(0o755))
            .expect("restore permissions");
        let _ = pool.close().await;

        assert_eq!(
            std::fs::read(dir.path().join(MARKER_FILE)).expect("restored"),
            before,
            "transaction A's marker must be restored byte for byte"
        );
        let summary = read_marker(dir.path()).expect("read").expect("marker");
        assert_eq!(summary.migration_id, transaction_a.transaction_id);

        let result = startup_recovery(&db, dir.path(), &backups).await;
        assert_eq!(result.state, RecoveryState::Recovered, "{result:?}");
        assert!(!dir.path().join(MARKER_FILE).exists());
        let columns = host_columns(&db).await.expect("columns");
        assert!(!columns.iter().any(|column| column == "agent_forwarding"));
    }

    #[test]
    fn a_second_handle_cannot_take_the_recovery_lock() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let first = try_acquire_lock(dir.path()).expect("first lock");
        let second = try_acquire_lock(dir.path());
        assert!(second.is_err(), "a second handle must not own the lock");
        drop(first);
        assert!(
            try_acquire_lock(dir.path()).is_ok(),
            "drop releases the lock"
        );
    }

    #[cfg(unix)]
    /// Child half of the two-process tests. It only does work when the parent
    /// sets `TERMINAL_LOCK_PROBE_DIR`; in a normal test run it returns at once.
    /// Every scenario runs in a **separate OS process** started from this test
    /// binary, not in a second handle inside the test process.
    #[test]
    fn lock_probe_child() {
        let Ok(directory) = std::env::var("TERMINAL_LOCK_PROBE_DIR") else {
            return;
        };
        let directory = PathBuf::from(directory);
        let mode = std::env::var("TERMINAL_LOCK_PROBE_MODE").unwrap_or_default();
        let result_file = std::env::var("TERMINAL_LOCK_PROBE_RESULT").ok();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("child runtime");
        match mode.as_str() {
            "hold" => {
                let file = try_acquire_lock(&directory).expect("child lock");
                std::fs::write(directory.join("child.locked"), b"1").expect("locked marker");
                wait_for_child_file(&directory.join("child.release"), 20_000);
                drop(file);
            }
            "migrate-partial" => {
                let _file = try_acquire_lock(&directory).expect("child lock");
                runtime.block_on(async {
                    let mut connection = SqliteConnection::connect_with(
                        &SqliteConnectOptions::new().filename(directory.join("terminal.db")),
                    )
                    .await
                    .expect("child database");
                    sqlx::query("ALTER TABLE hosts ADD COLUMN agent_forwarding INTEGER DEFAULT 0")
                        .execute(&mut connection)
                        .await
                        .expect("child ALTER");
                    let _ = connection.close().await;
                });
                std::fs::write(directory.join("child.migrated"), b"1").expect("migrated marker");
                wait_for_child_file(&directory.join("child.release"), 20_000);
            }
            "startup" => {
                let db = directory.join("terminal.db");
                let backups = directory.join("backups");
                let lock = RecoveryLock::default();
                let result =
                    runtime.block_on(startup_recovery_guarded(&db, &directory, &backups, &lock));
                if let Some(path) = result_file {
                    let payload = serde_json::json!({
                        "state": format!("{:?}", result.state),
                        "reason": result.reason,
                        "stages": result.stages,
                    });
                    std::fs::write(path, serde_json::to_vec(&payload).expect("json"))
                        .expect("child result");
                }
            }
            other => panic!("unknown probe mode {other}"),
        }
    }

    #[cfg(unix)]
    fn wait_for_child_file(path: &Path, timeout_ms: u64) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
        while std::time::Instant::now() < deadline {
            if path.exists() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("child timed out waiting for {}", path.display());
    }

    #[cfg(unix)]
    fn spawn_child(directory: &Path, mode: &str, result: Option<&Path>) -> std::process::Child {
        let exe = std::env::current_exe().expect("test binary");
        let mut command = std::process::Command::new(exe);
        command
            .args([
                "--exact",
                "db_recovery::tests::lock_probe_child",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("TERMINAL_LOCK_PROBE_DIR", directory)
            .env("TERMINAL_LOCK_PROBE_MODE", mode);
        if let Some(path) = result {
            command.env("TERMINAL_LOCK_PROBE_RESULT", path);
        }
        command
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("child process")
    }

    #[cfg(unix)]
    fn wait_for_child_exit(
        mut child: std::process::Child,
        timeout_ms: u64,
    ) -> std::process::ExitStatus {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
        while std::time::Instant::now() < deadline {
            if let Some(status) = child.try_wait().expect("child status") {
                return status;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let _ = child.kill();
        panic!("child did not exit in {timeout_ms} ms");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_second_process_is_refused_and_a_killed_owner_releases_the_lock() {
        let (dir, db, backups, snapshot) = temp_paths();
        create_database(&snapshot, "a").await;
        create_database(&db, "partial").await;
        begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("marker");
        let marker_before = std::fs::read(dir.path().join(MARKER_FILE)).expect("marker");
        let snapshot_before = std::fs::read(&snapshot).expect("snapshot");

        let mut child = spawn_child(dir.path(), "hold", None);
        wait_for_child_file(&dir.path().join("child.locked"), 15_000);

        let lock = RecoveryLock::default();
        let blocked = startup_recovery_guarded(&db, dir.path(), &backups, &lock).await;
        assert_eq!(
            blocked.state,
            RecoveryState::ManualInterventionRequired,
            "{blocked:?}"
        );
        assert!(
            blocked.reason.contains("another Terminal instance"),
            "{}",
            blocked.reason
        );
        assert_eq!(
            std::fs::read(dir.path().join(MARKER_FILE)).expect("marker"),
            marker_before,
            "a refused second process must not touch the marker"
        );

        child.kill().expect("kill lock owner");
        let status = wait_for_child_exit(child, 10_000);
        assert!(status.code().is_none(), "the owner must die by signal");
        assert!(
            dir.path().join("recovery.lock").exists(),
            "the stale lock file stays behind; ownership is the OS lock, not the path"
        );

        let recovered = startup_recovery_guarded(&db, dir.path(), &backups, &lock).await;
        assert_eq!(recovered.state, RecoveryState::Recovered, "{recovered:?}");
        assert!(!dir.path().join(MARKER_FILE).exists());
        assert_eq!(
            std::fs::read(&snapshot).expect("snapshot"),
            snapshot_before,
            "the verified snapshot must survive the recovery"
        );
        let columns = host_columns(&db).await.expect("columns");
        assert!(!columns.iter().any(|column| column == "agent_forwarding"));
        assert!(!dir.path().join(TEMP_FILE).exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_migration_owner_killed_during_alter_is_recovered_by_the_next_process() {
        let (dir, db, backups, snapshot) = temp_paths();
        create_database(&snapshot, "a").await;
        create_database(&db, "a").await;
        begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("marker");

        let mut child = spawn_child(dir.path(), "migrate-partial", None);
        wait_for_child_file(&dir.path().join("child.migrated"), 20_000);
        let columns = host_columns(&db).await.expect("columns");
        assert!(
            columns.iter().any(|column| column == "agent_forwarding"),
            "the child must have committed the first ALTER before being killed"
        );
        child.kill().expect("kill owner mid-ALTER");
        let _ = wait_for_child_exit(child, 10_000);

        let lock = RecoveryLock::default();
        let recovered = startup_recovery_guarded(&db, dir.path(), &backups, &lock).await;
        assert_eq!(recovered.state, RecoveryState::Recovered, "{recovered:?}");
        let columns = host_columns(&db).await.expect("columns");
        assert!(!columns.iter().any(|column| column == "agent_forwarding"));
        assert!(!dir.path().join(MARKER_FILE).exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn two_processes_racing_startup_recover_exactly_once() {
        let (dir, db, _backups, snapshot) = temp_paths();
        create_database(&snapshot, "a").await;
        create_database(&db, "partial").await;
        begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("marker");

        let first_result = dir.path().join("child-result-1.json");
        let second_result = dir.path().join("child-result-2.json");
        let first = spawn_child(dir.path(), "startup", Some(&first_result));
        let second = spawn_child(dir.path(), "startup", Some(&second_result));
        assert!(wait_for_child_exit(first, 30_000).success());
        assert!(wait_for_child_exit(second, 30_000).success());

        let read = |path: &Path| -> serde_json::Value {
            serde_json::from_slice(&std::fs::read(path).expect("result")).expect("json")
        };
        let states = [
            read(&first_result)["state"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            read(&second_result)["state"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        ];
        let recovered = states.iter().filter(|state| *state == "Recovered").count();
        let blocked = states
            .iter()
            .filter(|state| *state == "ManualInterventionRequired")
            .count();
        assert_eq!(
            (recovered, blocked),
            (1, 1),
            "exactly one process may recover; got {states:?}"
        );
        assert!(!dir.path().join(MARKER_FILE).exists());
        assert!(!dir.path().join(TEMP_FILE).exists());
        let columns = host_columns(&db).await.expect("columns");
        assert!(!columns.iter().any(|column| column == "agent_forwarding"));
    }

    #[tokio::test]
    async fn retry_is_blocked_while_a_migration_is_open() {
        let (dir, db, backups, _snapshot) = temp_paths();
        create_database(&db, "a").await;
        let lock = RecoveryLock::default();
        lock.note_migration_started();
        let result = retry_recovery(&db, dir.path(), &backups, &lock).await;
        assert_eq!(
            result.state,
            RecoveryState::ManualInterventionRequired,
            "{result:?}"
        );
        assert!(result.reason.contains("still open"), "{}", result.reason);
        lock.note_migration_finished();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn retry_reports_the_blocked_verdict_when_another_process_holds_the_lock() {
        let (dir, db, backups, snapshot) = temp_paths();
        create_database(&snapshot, "a").await;
        create_database(&db, "partial").await;
        begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("marker");
        let mut child = spawn_child(dir.path(), "hold", None);
        wait_for_child_file(&dir.path().join("child.locked"), 15_000);
        let lock = RecoveryLock::default();
        let result = retry_recovery(&db, dir.path(), &backups, &lock).await;
        assert_eq!(
            result.state,
            RecoveryState::ManualInterventionRequired,
            "{result:?}"
        );
        assert!(
            result.reason.contains("another Terminal instance"),
            "{}",
            result.reason
        );
        child.kill().expect("kill lock owner");
        let _ = wait_for_child_exit(child, 10_000);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_symlinked_snapshot_outside_the_backups_directory_is_rejected() {
        let (dir, db, backups, snapshot) = temp_paths();
        create_database(&db, "a").await;
        let outside = dir.path().join("outside.db");
        create_database(&outside, "a").await;
        std::os::unix::fs::symlink(&outside, &snapshot).expect("symlink");
        let error = validate_snapshot(&snapshot, &db, &backups, &core_targets())
            .await
            .expect_err("a symlink outside backups must be rejected");
        assert!(error.contains("outside the backups directory"), "{error}");
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

        begin_transaction(
            dir.path(),
            &snapshot,
            "team",
            vec![MigrationTarget {
                table: "team_shared_hosts".to_string(),
                columns: vec!["version".to_string(), "dirty".to_string()],
            }],
        )
        .await
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
    #[tokio::test]
    async fn marker_roundtrip_and_directory_flush_on_windows() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let snapshot = dir.path().join("backups").join("pre-migration-1.db");
        std::fs::create_dir_all(snapshot.parent().expect("backups parent"))
            .expect("backups directory");
        std::fs::write(&snapshot, b"SQLite format 3\0").expect("snapshot file");
        begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("write marker");
        assert!(dir.path().join(MARKER_FILE).exists());
        clear_transaction(dir.path(), None).expect("clear marker");
        assert!(!dir.path().join(MARKER_FILE).exists());
        fsync_dir(dir.path()).expect("flush directory");
    }

    #[test]
    fn the_directory_write_probe_distinguishes_capability_from_permission() {
        let dir = tempfile::tempdir().expect("temporary directory");
        assert!(
            directory_is_writable(dir.path()),
            "a plain temporary directory must accept the probe file"
        );
        std::fs::create_dir(dir.path().join(".terminal-fsync-probe"))
            .expect("block the probe path");
        assert!(
            !directory_is_writable(dir.path()),
            "a directory the probe cannot write must not be read as 'flush unsupported'"
        );
    }

    async fn create_windows_database(path: &Path, partial: bool) {
        let mut connection = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true),
        )
        .await
        .expect("database");
        sqlx::query("CREATE TABLE hosts (id TEXT PRIMARY KEY, name TEXT)")
            .execute(&mut connection)
            .await
            .expect("hosts table");
        if partial {
            sqlx::query("ALTER TABLE hosts ADD COLUMN agent_forwarding INTEGER DEFAULT 0")
                .execute(&mut connection)
                .await
                .expect("partial column");
        }
        sqlx::query("INSERT INTO hosts (id, name) VALUES ('h1', 'kept')")
            .execute(&mut connection)
            .await
            .expect("seed");
        let _ = connection.close().await;
    }

    /// NTFS refuses to replace a database another handle still has open (SQLite
    /// does not open with FILE_SHARE_DELETE). Whether the OS refuses the rename
    /// or allows it, the one unacceptable outcome is a half-replaced file: the
    /// database must stay readable and the marker must stay when the restore
    /// did not complete.
    #[tokio::test]
    async fn an_open_database_is_never_half_replaced_by_a_restore() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let backups = dir.path().join("backups");
        std::fs::create_dir_all(&backups).expect("backups");
        let db = dir.path().join("terminal.db");
        let snapshot = backups.join("pre-migration-1.db");
        create_windows_database(&snapshot, false).await;
        create_windows_database(&db, true).await;
        let transaction = begin_transaction(dir.path(), &snapshot, "core", core_targets())
            .await
            .expect("marker");
        let held = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db))
            .await
            .expect("held connection");
        let result = restore_from_snapshot(
            &db,
            &snapshot,
            dir.path(),
            &backups,
            &core_targets(),
            &transaction.transaction_id,
        )
        .await;
        assert!(
            matches!(
                result.state,
                RecoveryState::Recovered | RecoveryState::RestoreInterrupted
            ),
            "{result:?}"
        );
        integrity(&db)
            .await
            .expect("the database must stay readable");
        if result.state == RecoveryState::RestoreInterrupted {
            assert!(
                dir.path().join(MARKER_FILE).exists(),
                "an interrupted restore must keep its recovery evidence"
            );
        }
        let _ = held.close().await;

        if result.state == RecoveryState::RestoreInterrupted {
            let retry = restore_from_snapshot(
                &db,
                &snapshot,
                dir.path(),
                &backups,
                &core_targets(),
                &transaction.transaction_id,
            )
            .await;
            assert_eq!(retry.state, RecoveryState::Recovered, "{retry:?}");
            assert!(!dir.path().join(TEMP_FILE).exists());
        }
    }
}
