//! Pre-migration snapshot of the application database (Phase 8.9, P8.9-T4).
//!
//! The frontend applies the schema with `ALTER TABLE ... ADD COLUMN` statements that
//! cannot be undone. Before this module existed, an upgrade went straight from "open
//! the file" to "rewrite its schema", so a migration that hit a full disk, a lock or a
//! bug left a half-migrated database with no way back. The rule this module exists to
//! enforce is that **the snapshot is a precondition of the migration**: the caller
//! runs it first and stops when it fails, so a database is never rewritten without a
//! snapshot that was read back and verified first.
//!
//! `VACUUM INTO` is the snapshot primitive: it writes a consistent copy of the
//! database (schema, data, no WAL, no journals) into a new file in one operation on
//! SQLite's own side, without a second SQLite writer having to coordinate page copies.
//! The copy is then reopened read-only and checked against the source: integrity,
//! every table's column list, and every table's row count.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{Connection, Pool, Sqlite};
use tauri::{AppHandle, Manager, Runtime};

/// Budget for one snapshot, from `VACUUM INTO` through the read-back verification.
pub const BACKUP_BUDGET: Duration = Duration::from_secs(60);

/// How many name collisions a destination may resolve before the caller is told.
const MAX_DESTINATION_ATTEMPTS: u32 = 50;

/// How many pre-migration snapshots the backups directory keeps (#62).
///
/// A migration that keeps failing writes one full copy of the database per launch
/// and nothing ever removed the previous ones, so the directory grew without
/// bound. The copy that matters when recovering is the newest one — it was taken
/// immediately before the migration that broke — and the four behind it cover a
/// second and third broken attempt, a restart in between, and one older version to
/// compare against. Anything older is redundant with the database file itself plus
/// the user's own export, and each entry costs a whole database, so this cap is what
/// bounds the directory's disk cost at N × database size.
pub const MAX_SNAPSHOT_COPIES: usize = 5;

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("the pre-migration snapshot could not be prepared in {path}: {reason}")]
    Destination { path: String, reason: String },
    #[error("the pre-migration snapshot could not be written to {path}: {reason}")]
    Vacuum { path: String, reason: String },
    #[error("the pre-migration snapshot at {path} could not be read back: {reason}")]
    Unreadable { path: String, reason: String },
    #[error(
        "the pre-migration snapshot at {path} does not match the database it copies: {reason}"
    )]
    Mismatch { path: String, reason: String },
    #[error("the pre-migration snapshot did not finish inside the {0:?} budget")]
    Timeout(Duration),
}

/// What a completed snapshot holds, for the caller's log line.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    /// Absolute path of the snapshot file.
    pub path: String,
    /// Tables verified against the source.
    pub tables: u64,
    /// Rows the snapshot carries, summed over those tables.
    pub rows: i64,
}

/// Tauri command: snapshot the application database before the schema is migrated.
///
/// The frontend calls this only when it has proven that a column migration is
/// pending, and it aborts the migration when this returns an error. Errors are
/// therefore always propagated, never downgraded to a warning.
#[tauri::command]
pub async fn backup_database_before_migration<R: Runtime>(
    app: AppHandle<R>,
) -> Result<BackupReport, String> {
    let pool = super::sqlite_pool(&app).await?;
    let directory = backup_directory(&app)?;
    let destination = unique_destination(&directory)?;
    let report = snapshot_before_migration(&pool, &destination)
        .await
        .map_err(|error| error.to_string())?;
    // After the new snapshot is verified, never before: pruning first would drop a
    // good older copy before this call proved it has a replacement.
    prune_old_snapshots(&directory, MAX_SNAPSHOT_COPIES);
    Ok(report)
}

/// Write a verified snapshot of `pool` to `destination`, which must not exist.
///
/// A failure never leaves a file that could be mistaken for a good snapshot, and it
/// never touches the source database: the snapshot is a read of the source and a write
/// of a new file, so an unwritable destination fails the backup instead of damaging
/// the database the backup exists to protect.
pub async fn snapshot_before_migration(
    pool: &Pool<Sqlite>,
    destination: &Path,
) -> Result<BackupReport, BackupError> {
    prepare_destination(destination)?;

    // Stage lines, not just a final error: when a bootstrap stalls, "the
    // snapshot never finished" and "the snapshot was never attempted" are
    // different problems and used to look identical from the outside (#59).
    tracing::info!(target: "startup", stage = "vacuum-into-started", path = %destination.display(), "db bootstrap");
    let written = tokio::time::timeout(BACKUP_BUDGET, async {
        vacuum_into(pool, destination).await?;
        tracing::info!(target: "startup", stage = "vacuum-into-finished", "db bootstrap");
        let report = verify_snapshot(pool, destination).await?;
        tracing::info!(
            target: "startup",
            stage = "snapshot-verification-finished",
            tables = report.tables,
            rows = report.rows,
            "db bootstrap"
        );
        Ok::<_, BackupError>(report)
    })
    .await;

    match written {
        Ok(Ok(report)) => Ok(report),
        Ok(Err(error)) => {
            // The destination did not exist before this call and only ever held a
            // partial copy of it, so removing it cannot destroy a snapshot.
            discard(destination);
            Err(error)
        }
        Err(_elapsed) => {
            discard(destination);
            Err(BackupError::Timeout(BACKUP_BUDGET))
        }
    }
}

/// Refuse a destination that already exists: `VACUUM INTO` would fail on it, and a
/// path that is already taken is not a name this call may overwrite.
fn prepare_destination(destination: &Path) -> Result<(), BackupError> {
    if destination.exists() {
        return Err(BackupError::Destination {
            path: destination.display().to_string(),
            reason: "a file already occupies the snapshot path".to_string(),
        });
    }

    let Some(directory) = destination.parent() else {
        return Err(BackupError::Destination {
            path: destination.display().to_string(),
            reason: "the snapshot path has no parent directory".to_string(),
        });
    };

    std::fs::create_dir_all(directory).map_err(|error| BackupError::Destination {
        path: directory.display().to_string(),
        reason: error.to_string(),
    })
}

/// One `VACUUM INTO`: SQLite writes a consistent copy of the whole database.
async fn vacuum_into(pool: &Pool<Sqlite>, destination: &Path) -> Result<(), BackupError> {
    let target = destination.display().to_string();
    // The filename is a bound parameter, not spliced into the statement: a path with
    // a quote in it stays a path.
    sqlx::query("VACUUM INTO ?")
        .bind(&target)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|error| BackupError::Vacuum {
            path: target.clone(),
            reason: error.to_string(),
        })
}

/// Reopen the snapshot read-only and check it against the database it copies.
///
/// Three independent facts have to hold for the copy to be usable: SQLite's own
/// integrity check passes, every table the source has appears in the snapshot with the
/// same column list, and every table carries exactly the same number of rows. A
/// snapshot that only "opened fine" would prove nothing about the rows inside it.
async fn verify_snapshot(
    pool: &Pool<Sqlite>,
    snapshot: &Path,
) -> Result<BackupReport, BackupError> {
    let path = snapshot.display().to_string();
    let options = SqliteConnectOptions::new()
        .filename(snapshot)
        .read_only(true);
    let mut copy = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| BackupError::Unreadable {
            path: path.clone(),
            reason: error.to_string(),
        })?;

    let verified = async {
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&mut copy)
            .await
            .map_err(|error| BackupError::Unreadable {
                path: path.clone(),
                reason: error.to_string(),
            })?;
        if integrity != "ok" {
            return Err(BackupError::Mismatch {
                path: path.clone(),
                reason: format!("integrity_check reported {integrity}"),
            });
        }

        let tables = table_names(pool).await?;
        let mut rows = 0i64;
        for table in &tables {
            let source_columns = column_names(pool, table).await?;
            let copy_columns = column_names_in(&mut copy, table).await.map_err(|error| {
                BackupError::Mismatch {
                    path: path.clone(),
                    reason: format!("`{table}` is missing from the snapshot: {error}"),
                }
            })?;
            if source_columns != copy_columns {
                return Err(BackupError::Mismatch {
                    path: path.clone(),
                    reason: format!(
                        "`{table}` columns differ: source {:?}, snapshot {:?}",
                        source_columns, copy_columns
                    ),
                });
            }

            let source_rows = row_count(pool, table).await?;
            let copy_rows = row_count_in(&mut copy, table)
                .await
                .map_err(|error| BackupError::Mismatch {
                    path: path.clone(),
                    reason: format!("`{table}` cannot be read back: {error}"),
                })?;
            if source_rows != copy_rows {
                return Err(BackupError::Mismatch {
                    path: path.clone(),
                    reason: format!(
                        "`{table}` holds {copy_rows} rows in the snapshot but {source_rows} in the database"
                    ),
                });
            }
            rows += copy_rows;
        }

        Ok(BackupReport {
            path: path.clone(),
            tables: tables.len() as u64,
            rows,
        })
    }
    .await;

    let _ = copy.close().await;
    verified
}

/// Remove a snapshot this call created and could not verify.
fn discard(destination: &Path) {
    if let Err(error) = std::fs::remove_file(destination) {
        if error.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!(
                path = %destination.display(),
                error = %error,
                "could not remove an unverified pre-migration snapshot"
            );
        }
    }
}

/// The epoch-millisecond stamp a snapshot file name carries, if it is one of ours.
///
/// `pre-migration-<epoch-ms>.db`, plus `pre-migration-<epoch-ms>-<attempt>.db` when two
/// launches collide inside one millisecond. Anything else in the directory — another
/// tool's file, a hand-renamed copy, a subdirectory — returns `None` and is never a deletion
/// candidate.
fn snapshot_stamp(name: &str) -> Option<u128> {
    let stem = name.strip_prefix("pre-migration-")?.strip_suffix(".db")?;
    let digits = stem.split('-').next()?;
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let rest = &stem[digits.len()..];
    if !rest.is_empty() && !rest.starts_with('-') {
        return None;
    }
    digits.parse().ok()
}

/// Delete all but the `keep` newest snapshots in `directory`, and report how many files
/// were removed.
///
/// Deliberately infallible: a snapshot that could not be deleted is a warning in the
/// log, never an error the caller sees, because the only caller runs right after a
/// verified snapshot and the migration it guards must not be blocked by a leftover
/// file. The scan does not recurse, and only regular files whose name
/// `snapshot_stamp` recognises are candidates, so nothing else in the directory can be
/// touched.
fn prune_old_snapshots(directory: &Path, keep: usize) -> usize {
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => {
            tracing::warn!(
                path = %directory.display(),
                error = %error,
                "could not list the pre-migration snapshots for pruning"
            );
            return 0;
        }
    };

    let mut snapshots: Vec<(u128, String)> = Vec::new();
    for entry in entries.flatten() {
        // `file_type` describes the entry itself: a symlink or a directory that
        // happens to carry a snapshot name is not one of our snapshots.
        let is_file = entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false);
        if !is_file {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(stamp) = snapshot_stamp(&name) {
            snapshots.push((stamp, name));
        }
    }
    if snapshots.len() <= keep {
        return 0;
    }

    snapshots.sort();
    let mut removed = 0;
    for (_, name) in snapshots.iter().take(snapshots.len() - keep) {
        match std::fs::remove_file(directory.join(name)) {
            Ok(()) => {
                removed += 1;
                tracing::info!(name = %name, "removed an old pre-migration snapshot");
            }
            Err(error) => tracing::warn!(
                name = %name,
                error = %error,
                "could not remove an old pre-migration snapshot"
            ),
        }
    }
    removed
}

/// Every user table, in a stable order, so source and snapshot are compared pairwise.
async fn table_names(pool: &Pool<Sqlite>) -> Result<Vec<String>, BackupError> {
    sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| BackupError::Unreadable {
        path: "the application database".to_string(),
        reason: error.to_string(),
    })
}

async fn column_names(pool: &Pool<Sqlite>, table: &str) -> Result<Vec<String>, BackupError> {
    let sql = format!("SELECT name FROM pragma_table_info({})", quoted(table));
    sqlx::query_scalar(&sql)
        .fetch_all(pool)
        .await
        .map_err(|error| BackupError::Unreadable {
            path: "the application database".to_string(),
            reason: format!("`{table}`: {error}"),
        })
}

async fn column_names_in(
    copy: &mut SqliteConnection,
    table: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let sql = format!("SELECT name FROM pragma_table_info({})", quoted(table));
    sqlx::query_scalar(&sql).fetch_all(&mut *copy).await
}

async fn row_count(pool: &Pool<Sqlite>, table: &str) -> Result<i64, BackupError> {
    let sql = format!("SELECT COUNT(*) FROM {}", quoted(table));
    sqlx::query_scalar(&sql)
        .fetch_one(pool)
        .await
        .map_err(|error| BackupError::Unreadable {
            path: "the application database".to_string(),
            reason: format!("`{table}`: {error}"),
        })
}

async fn row_count_in(copy: &mut SqliteConnection, table: &str) -> Result<i64, sqlx::Error> {
    let sql = format!("SELECT COUNT(*) FROM {}", quoted(table));
    sqlx::query_scalar(&sql).fetch_one(&mut *copy).await
}

/// A table name from `sqlite_master` as a quoted SQL identifier.
fn quoted(table: &str) -> String {
    format!("\"{}\"", table.replace('"', "\"\""))
}

/// Directory the snapshots live in, next to the database they copy.
fn backup_directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("the application config directory is unknown: {error}"))?;
    Ok(base.join("backups"))
}

/// A snapshot path that nothing occupies yet: `pre-migration-<epoch-ms>.db`.
fn unique_destination(directory: &Path) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();

    for attempt in 1..=MAX_DESTINATION_ATTEMPTS {
        let name = if attempt == 1 {
            format!("pre-migration-{stamp}.db")
        } else {
            format!("pre-migration-{stamp}-{attempt}.db")
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "could not find a free snapshot name in {} after {MAX_DESTINATION_ATTEMPTS} attempts",
        directory.display()
    ))
}

#[cfg(test)]
mod tests {
    //! Snapshot tests against real SQLite files.
    //!
    //! Every assertion reads the bytes or the rows back from disk: "the call returned
    //! Ok" is not evidence that a backup holds the user's data.

    use super::*;
    use sqlx::sqlite::{SqliteJournalMode, SqlitePool, SqlitePoolOptions};

    const SCHEMA: &[&str] = &[
        "CREATE TABLE hosts (id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL, port INTEGER DEFAULT 22, username TEXT NOT NULL, password TEXT, tags TEXT)",
        "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)",
        "CREATE TABLE scripts (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER DEFAULT 1)",
    ];

    async fn open_pool(path: &Path) -> SqlitePool {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(options)
            .await
            .expect("open the test database")
    }

    /// A database with the shape the migration touches, holding rows worth losing.
    async fn seeded_database() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("temporary directory");
        let path = dir.path().join("terminal.db");
        let pool = open_pool(&path).await;
        for statement in SCHEMA {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create the test schema");
        }
        for (id, name, hostname, password, tags) in [
            (
                "h-1",
                "prod",
                "10.0.0.5",
                Some("secret-1"),
                Some("{\"env\":\"prod\"}"),
            ),
            ("h-2", "staging", "10.0.0.6", None, None),
        ] {
            sqlx::query(
                "INSERT INTO hosts (id, name, hostname, username, password, tags) VALUES (?, ?, ?, 'deploy', ?, ?)",
            )
            .bind(id)
            .bind(name)
            .bind(hostname)
            .bind(password)
            .bind(tags)
            .execute(&pool)
            .await
            .expect("seed a host");
        }
        sqlx::query("INSERT INTO settings (key, value) VALUES ('theme', 'dark')")
            .execute(&pool)
            .await
            .expect("seed a setting");
        sqlx::query("INSERT INTO scripts (id, name, enabled) VALUES ('s-1', 'backup', 0)")
            .execute(&pool)
            .await
            .expect("seed a script");
        pool.close().await;
        (dir, path)
    }

    #[tokio::test]
    async fn a_snapshot_carries_every_row_and_column_of_the_database() {
        let (dir, path) = seeded_database().await;
        let destination = dir.path().join("backups/pre-migration-1.db");
        let pool = open_pool(&path).await;

        let report = snapshot_before_migration(&pool, &destination)
            .await
            .expect("a writable destination must produce a snapshot");

        assert_eq!(report.path, destination.display().to_string());
        assert_eq!(
            report.tables,
            SCHEMA.len() as u64,
            "every table must be verified, not just the first one"
        );
        assert_eq!(report.rows, 4, "two hosts, one setting, one script");
        assert!(
            destination.exists(),
            "the snapshot must exist on disk after a successful call"
        );

        // Read the snapshot back through a connection of its own and compare the rows
        // value by value: a snapshot that only copies the schema proves nothing.
        let options = SqliteConnectOptions::new()
            .filename(&destination)
            .read_only(true);
        let mut copy = SqliteConnection::connect_with(&options)
            .await
            .expect("the snapshot must open");
        let snapshot_hosts: Vec<(String, String, Option<String>, Option<String>)> =
            sqlx::query_as("SELECT id, name, password, tags FROM hosts ORDER BY id")
                .fetch_all(&mut copy)
                .await
                .expect("read the snapshot");
        let source_hosts: Vec<(String, String, Option<String>, Option<String>)> =
            sqlx::query_as("SELECT id, name, password, tags FROM hosts ORDER BY id")
                .fetch_all(&pool)
                .await
                .expect("read the database");
        assert_eq!(
            snapshot_hosts, source_hosts,
            "the snapshot must hold the same hosts, column for column"
        );
        assert_eq!(snapshot_hosts[0].2.as_deref(), Some("secret-1"));
        assert_eq!(snapshot_hosts[1].2, None, "a NULL password must stay NULL");

        let snapshot_setting: (String, String) = sqlx::query_as("SELECT key, value FROM settings")
            .fetch_one(&mut copy)
            .await
            .expect("read the snapshot settings");
        assert_eq!(snapshot_setting, ("theme".to_string(), "dark".to_string()));
        let snapshot_script: (String, i64) = sqlx::query_as("SELECT name, enabled FROM scripts")
            .fetch_one(&mut copy)
            .await
            .expect("read the snapshot scripts");
        assert_eq!(snapshot_script, ("backup".to_string(), 0));

        let _ = copy.close().await;
        pool.close().await;
    }

    /// The rule 4.2 exists for: a backup that cannot be written stops the migration, and
    /// stopping must leave the database exactly as it was.
    #[tokio::test]
    async fn a_failed_snapshot_leaves_the_database_byte_identical_and_writes_nothing() {
        let (dir, path) = seeded_database().await;
        let pool = open_pool(&path).await;
        // Read the file with the pool already open, so both reads see the same
        // session state: the comparison is about the failed backup, not about what
        // opening a database does to its own file.
        let before = std::fs::read(&path).expect("read the database file");
        assert!(!before.is_empty(), "the fixture must hold a real database");

        // A regular file where the snapshot directory should be, so creating that
        // directory fails. This is the injection: no mock, one real filesystem error.
        let blocker = dir.path().join("blocked");
        std::fs::write(&blocker, b"not a directory").expect("occupy the backup directory path");
        let destination = blocker.join("pre-migration-1.db");

        let error = snapshot_before_migration(&pool, &destination)
            .await
            .expect_err("an unwritable destination must fail the snapshot");
        assert!(
            matches!(error, BackupError::Destination { .. }),
            "unexpected error: {error}"
        );

        // The database is untouched: same bytes on disk, same rows read back.
        let after = std::fs::read(&path).expect("read the database file");
        assert_eq!(
            after.len(),
            before.len(),
            "a failed snapshot must not resize the database file"
        );
        assert!(
            after == before,
            "a failed snapshot must not change one byte of the database"
        );
        assert!(
            !destination.exists(),
            "a failed snapshot must not leave a file behind"
        );

        let hosts: Vec<(String, String)> = sqlx::query_as("SELECT id, name FROM hosts ORDER BY id")
            .fetch_all(&pool)
            .await
            .expect("the database must still be readable");
        assert_eq!(hosts.len(), 2);
        assert_eq!(
            hosts[0],
            ("h-1".to_string(), "prod".to_string()),
            "the rows must survive a failed snapshot"
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn a_snapshot_into_an_occupied_path_is_refused_and_keeps_the_occupant() {
        let (dir, path) = seeded_database().await;
        let destination = dir.path().join("pre-migration-1.db");
        std::fs::write(&destination, b"an older snapshot").expect("occupy the snapshot path");

        let pool = open_pool(&path).await;
        let error = snapshot_before_migration(&pool, &destination)
            .await
            .expect_err("an occupied path must be refused");
        pool.close().await;

        assert!(
            matches!(error, BackupError::Destination { .. }),
            "unexpected error: {error}"
        );
        assert_eq!(
            std::fs::read(&destination).expect("read the occupant"),
            b"an older snapshot",
            "a refused snapshot must not delete the file that occupied the path"
        );
    }

    /// Verification is the half that makes a snapshot trustworthy: a file that is not
    /// the database must not pass it.
    #[tokio::test]
    async fn a_file_that_is_not_the_database_fails_verification() {
        let (dir, path) = seeded_database().await;
        let pool = open_pool(&path).await;

        let garbage = dir.path().join("garbage.db");
        std::fs::write(&garbage, b"this is not a sqlite database at all").expect("write garbage");
        let error = verify_snapshot(&pool, &garbage)
            .await
            .expect_err("garbage must not verify as a snapshot");
        assert!(
            matches!(
                error,
                BackupError::Unreadable { .. } | BackupError::Mismatch { .. }
            ),
            "unexpected error: {error}"
        );

        // A copy that opens but is missing a table must fail too: the check compares
        // against the source instead of only asking "does this file open?".
        let partial = dir.path().join("partial.db");
        {
            let options = SqliteConnectOptions::new()
                .filename(&partial)
                .create_if_missing(true);
            let mut conn = SqliteConnection::connect_with(&options)
                .await
                .expect("open a partial database");
            sqlx::query(SCHEMA[0])
                .execute(&mut conn)
                .await
                .expect("create one table");
            let _ = conn.close().await;
        }
        let error = verify_snapshot(&pool, &partial)
            .await
            .expect_err("a partial copy must not verify");
        assert!(
            matches!(error, BackupError::Mismatch { .. }),
            "unexpected error: {error}"
        );

        pool.close().await;
    }
    /// #62: a migration that keeps failing adds one full copy per launch. The
    /// directory must stay bounded even though every launch is allowed to write a new
    /// copy — the oldest ones are the ones nothing needs any more.
    #[test]
    fn pruning_keeps_the_newest_snapshots_and_removes_the_oldest() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let mut written = Vec::new();
        for stamp in 1..=7u128 {
            let name = format!("pre-migration-{stamp}.db");
            std::fs::write(dir.path().join(&name), b"a snapshot").expect("write a snapshot");
            written.push(name);
        }
        // The collision variant of the newest millisecond: newer than its own base
        // name only by the stamp, and therefore inside the kept set.
        let collision = "pre-migration-7-2.db".to_string();
        std::fs::write(dir.path().join(&collision), b"a snapshot").expect("write a snapshot");
        written.push(collision);

        let removed = prune_old_snapshots(dir.path(), MAX_SNAPSHOT_COPIES);

        assert_eq!(
            removed, 3,
            "eight snapshots under a cap of five must remove exactly three"
        );
        for stamp in 1..=3u128 {
            assert!(
                !dir.path()
                    .join(format!("pre-migration-{stamp}.db"))
                    .exists(),
                "the oldest snapshot (stamp {stamp}) must be the one removed"
            );
        }
        for stamp in 4..=7u128 {
            assert!(
                dir.path()
                    .join(format!("pre-migration-{stamp}.db"))
                    .exists(),
                "snapshot stamp {stamp} is inside the cap and must survive"
            );
        }
        assert!(dir.path().join("pre-migration-7-2.db").exists());
    }

    /// The guard that makes the deletion safe: only this directory's own regular
    /// files whose name is exactly a snapshot are candidates. Everything else — the
    /// database itself, a subdirectory, a hand-renamed copy, a sibling's file — stays.
    #[test]
    fn pruning_never_deletes_anything_that_is_not_a_snapshot_of_ours() {
        let dir = tempfile::tempdir().expect("temporary directory");
        for stamp in 1..=9u128 {
            std::fs::write(
                dir.path().join(format!("pre-migration-{stamp}.db")),
                b"a snapshot",
            )
            .expect("write a snapshot");
        }
        let strangers = [
            "terminal.db",
            "terminal.db-wal",
            "notes.txt",
            "pre-migration-.db",
            "pre-migration-abc.db",
            "pre-migration-1.db.bak",
            "pre-migration-1.database",
            "xpre-migration-1.db",
        ];
        for name in strangers {
            std::fs::write(dir.path().join(name), b"not a snapshot of ours")
                .expect("write a stranger");
        }
        let nested = dir
            .path()
            .join("pre-migration-1.db.d")
            .join("pre-migration-2.db");
        std::fs::create_dir_all(nested.parent().expect("parent")).expect("create a subdirectory");
        std::fs::write(&nested, b"nested").expect("write a nested file");
        let directory_named_like_a_snapshot = dir.path().join("pre-migration-99.db");
        std::fs::create_dir(&directory_named_like_a_snapshot).expect("create a directory");

        let removed = prune_old_snapshots(dir.path(), 1);

        assert_eq!(removed, 8, "only the eight real snapshots above the cap go");
        assert!(
            dir.path().join("pre-migration-9.db").exists(),
            "the newest stays"
        );
        for name in strangers {
            assert!(
                dir.path().join(name).exists(),
                "{name} is not a snapshot of ours and must survive"
            );
        }
        assert!(nested.exists(), "the scan must not recurse");
        assert!(
            directory_named_like_a_snapshot.is_dir(),
            "a directory whose name looks like a snapshot is not a snapshot"
        );
    }

    /// Retention is a convenience, the snapshot is the safety net: a deletion that
    /// fails must be logged and skipped, never propagated into the migration gate.
    #[cfg(unix)]
    #[test]
    fn a_snapshot_that_cannot_be_deleted_does_not_fail_the_prune() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("temporary directory");
        for stamp in 1..=3u128 {
            std::fs::write(
                dir.path().join(format!("pre-migration-{stamp}.db")),
                b"a snapshot",
            )
            .expect("write a snapshot");
        }
        // A read-only directory makes every remove fail with a real filesystem error.
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555))
            .expect("make the directory read-only");

        let removed = prune_old_snapshots(dir.path(), 1);

        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755))
            .expect("restore the directory");
        assert_eq!(
            removed, 0,
            "nothing could be removed, and that is not an error"
        );
        for stamp in 1..=3u128 {
            assert!(dir
                .path()
                .join(format!("pre-migration-{stamp}.db"))
                .exists());
        }
    }
}
