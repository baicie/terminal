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
    snapshot_before_migration(&pool, &destination)
        .await
        .map_err(|error| error.to_string())
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
}
