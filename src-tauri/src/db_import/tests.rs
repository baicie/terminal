//! Fault-injection tests for the transactional import.
//!
//! Every test runs against a real temporary SQLite database file: no statement
//! order is mocked, because the defect this code fixes was invisible to mocks.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use sqlx::Row;

use super::payload::{ImportPayload, PayloadError, MAX_RECORDS};
use super::writer::{fault_injection, run_import, ImportError};

/// Columns of every imported table, in schema order.
const TABLES: &[(&str, &[&str])] = &[
    (
        "hosts",
        &[
            "id",
            "name",
            "hostname",
            "port",
            "username",
            "auth_type",
            "password",
            "private_key",
            "certificate",
            "group_id",
            "is_favorite",
            "color",
            "tags",
            "port_forwards",
            "startup_command",
            "environment",
            "jump_host_id",
            "jump_host_auth_type",
            "agent_forwarding",
            "shell_integration",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "groups",
        &[
            "id",
            "name",
            "parent_id",
            "color",
            "inherit_settings",
            "settings",
            "order",
        ],
    ),
    (
        "snippets",
        &[
            "id",
            "name",
            "description",
            "script",
            "package_id",
            "tags",
            "variables",
        ],
    ),
    ("snippet_packages", &["id", "name", "description"]),
    (
        "ssh_keys",
        &[
            "id",
            "name",
            "key_type",
            "private_key",
            "public_key",
            "certificate",
            "passphrase",
            "is_encrypted",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "known_hosts",
        &[
            "id",
            "hostname",
            "port",
            "fingerprint",
            "key_type",
            "added_at",
        ],
    ),
    (
        "workspaces",
        &[
            "id",
            "name",
            "description",
            "icon",
            "color",
            "order",
            "is_active",
            "created_at",
            "updated_at",
        ],
    ),
    ("workspace_layouts", &["workspace_id", "layout_data"]),
    ("settings", &["key", "value"]),
];

/// The application schema, plus a deferred foreign key on workspace_layouts so
/// a real COMMIT can fail after every statement succeeded.
const SCHEMA: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS hosts (id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL, port INTEGER DEFAULT 22, username TEXT NOT NULL, auth_type TEXT DEFAULT 'password', password TEXT, private_key TEXT, certificate TEXT, group_id TEXT, is_favorite INTEGER DEFAULT 0, color TEXT, tags TEXT, port_forwards TEXT, startup_command TEXT, environment TEXT, jump_host_id TEXT, jump_host_auth_type TEXT, agent_forwarding INTEGER DEFAULT 0, shell_integration TEXT DEFAULT 'off', created_at INTEGER, updated_at INTEGER)",
    "CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, color TEXT, inherit_settings INTEGER DEFAULT 1, settings TEXT, \"order\" INTEGER DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS snippets (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, script TEXT NOT NULL, package_id TEXT, tags TEXT, variables TEXT)",
    "CREATE TABLE IF NOT EXISTS snippet_packages (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT)",
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)",
    "CREATE TABLE IF NOT EXISTS known_hosts (id TEXT PRIMARY KEY, hostname TEXT NOT NULL, port INTEGER DEFAULT 22, fingerprint TEXT NOT NULL, key_type TEXT, added_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS ssh_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL, key_type TEXT, private_key TEXT, public_key TEXT, certificate TEXT, passphrase TEXT, is_encrypted INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)",
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT, color TEXT, \"order\" INTEGER DEFAULT 0, is_active INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)",
    "CREATE TABLE IF NOT EXISTS workspace_layouts (workspace_id TEXT PRIMARY KEY, layout_data TEXT, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED)",
];

const BUDGET: Duration = Duration::from_secs(20);

async fn test_pool(busy_timeout: Duration) -> (tempfile::TempDir, SqlitePool) {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = dir.path().join("import-test.db");
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(busy_timeout);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .expect("open the test database");
    for statement in SCHEMA {
        sqlx::query(statement)
            .execute(&pool)
            .await
            .expect("create the test schema");
    }
    (dir, pool)
}

/// One-connection pool that counts every connection handed back to it.
///
/// `after_release` is the pool's own release seam, so "the connection was
/// returned" is observed directly instead of inferred from internal counters.
async fn probed_pool() -> (tempfile::TempDir, SqlitePool, Arc<AtomicUsize>) {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = dir.path().join("import-probe.db");
    let released = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&released);
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .after_release(move |_conn, _meta| {
            let counter = Arc::clone(&counter);
            Box::pin(async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Ok::<bool, sqlx::Error>(true)
            })
        })
        .connect_with(options)
        .await
        .expect("open the probed test database");
    for statement in SCHEMA {
        sqlx::query(statement)
            .execute(&pool)
            .await
            .expect("create the test schema");
    }
    (dir, pool, released)
}

/// Give the pool's release task the chance to run on a current-thread runtime.
async fn settle() {
    for _ in 0..100 {
        tokio::task::yield_now().await;
    }
}

/// `after_release` fires before the connection becomes visible as idle, so a
/// single `num_idle()` read races the pool's release task: it passed locally
/// and failed on CI once the scheduler differed. Polling closes that window
/// without weakening the assertion - it still fails if the connection never
/// comes back.
async fn wait_for_idle(pool: &SqlitePool, expected: usize) -> usize {
    for _ in 0..400 {
        if pool.num_idle() == expected {
            return expected;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    pool.num_idle()
}

fn projection(columns: &[&str]) -> String {
    columns
        .iter()
        .map(|column| format!("quote(\"{column}\")"))
        .collect::<Vec<_>>()
        .join(" || '|' || ")
}

/// Full-database snapshot: every row of every imported table as one string.
async fn snapshot(pool: &SqlitePool) -> Vec<(String, Vec<String>)> {
    let mut out = Vec::new();
    for (table, columns) in TABLES {
        let sql = format!(
            "SELECT {} AS line FROM \"{table}\" ORDER BY line",
            projection(columns)
        );
        let rows: Vec<Option<String>> = sqlx::query_scalar(&sql)
            .fetch_all(pool)
            .await
            .expect("snapshot a table");
        out.push((
            (*table).to_string(),
            rows.into_iter()
                .map(|line| line.unwrap_or_default())
                .collect(),
        ));
    }
    out
}

/// One row rendered the same way the snapshot renders it.
async fn row_dump(pool: &SqlitePool, table: &str, key_column: &str, key: &str) -> String {
    let (name, columns) = TABLES
        .iter()
        .find(|(name, _)| *name == table)
        .expect("known table");
    let sql = format!(
        "SELECT {} FROM \"{name}\" WHERE \"{key_column}\" = ?",
        projection(columns)
    );
    sqlx::query_scalar::<_, Option<String>>(&sql)
        .bind(key)
        .fetch_one(pool)
        .await
        .expect("dump a row")
        .unwrap_or_default()
}

async fn count(pool: &SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM \"{table}\""))
        .fetch_one(pool)
        .await
        .expect("count rows")
}

fn payload(value: serde_json::Value) -> ImportPayload {
    serde_json::from_value(value).expect("payload deserializes")
}

/// A backup carrying one row per table and every aligned column set.
fn full_backup(merge_mode: &str) -> ImportPayload {
    payload(json!({
        "mergeMode": merge_mode,
        "now": 9_000,
        "groups": [{
            "id": "g1", "name": "Group", "parent_id": null, "color": "#000",
            "inherit_settings": 1, "settings": "{}", "order": 3
        }],
        "hosts": [{
            "id": "h1", "name": "Target", "hostname": "target.example", "port": 22,
            "username": "root", "auth_type": "key", "password": "secret",
            "private_key": "private-key", "certificate": "cert", "group_id": "g1",
            "is_favorite": 1, "color": "#fff", "tags": "[\"prod\"]", "port_forwards": "[]",
            "startup_command": "uptime", "environment": "{}", "jump_host_id": "j1",
            "jump_host_auth_type": "agent", "agent_forwarding": true,
            "shell_integration": "zsh", "created_at": 100, "updated_at": 200
        }],
        "snippetPackages": [{ "id": "p1", "name": "Package", "description": "pd" }],
        "snippets": [{
            "id": "s1", "name": "Snippet", "description": "d", "script": "echo hi",
            "package_id": "p1", "tags": "[]", "variables": "{}"
        }],
        "sshKeys": [{
            "id": "k1", "name": "Key", "key_type": "ed25519", "private_key": "pk",
            "public_key": "pub", "certificate": "kc", "passphrase": "pp",
            "is_encrypted": 1, "created_at": 11, "updated_at": 12
        }],
        "knownHosts": [{
            "id": "kh1", "hostname": "target.example", "port": 22,
            "fingerprint": "SHA256:f", "key_type": "ssh-ed25519", "added_at": 7
        }],
        "workspaces": [{
            "id": "w1", "name": "Workspace", "description": "wd", "icon": "icon",
            "color": "#111", "order": 2, "is_active": 1, "created_at": 21, "updated_at": 22
        }],
        "workspaceLayouts": [
            { "workspaceId": "w1", "layoutData": { "tabs": [1, 2] } },
            { "workspaceId": "w1", "layoutData": null }
        ],
        "settings": { "app_settings": "{\"theme\":\"dark\"}", "numeric_setting": 42 }
    }))
}

fn merge_hosts(hosts: serde_json::Value) -> ImportPayload {
    payload(json!({ "mergeMode": "merge", "hosts": hosts }))
}

// (a) A statement failure halfway through must leave no trace.
#[tokio::test]
async fn mid_import_failure_leaves_the_database_untouched() {
    let (_dir, pool) = test_pool(Duration::from_secs(1)).await;
    let before = snapshot(&pool).await;

    let failing = payload(json!({
        "mergeMode": "merge",
        "groups": [{ "id": "g1", "name": "Group" }],
        "hosts": [
            { "id": "h1", "name": "First", "hostname": "a.example", "username": "root" },
            // hosts.name is NOT NULL: binding a missing name fails this statement.
            { "id": "h2", "hostname": "b.example", "username": "root" }
        ],
        "workspaces": [{ "id": "w1", "name": "Workspace" }],
        "settings": { "app_settings": "{}" }
    }));

    let error = run_import(&pool, &failing, BUDGET)
        .await
        .expect_err("a NOT NULL violation must fail the import");
    assert!(
        matches!(error, ImportError::RolledBack(_)),
        "unexpected error: {error}"
    );
    assert!(
        error.to_string().to_lowercase().contains("not null"),
        "unexpected message: {error}"
    );

    assert_eq!(
        snapshot(&pool).await,
        before,
        "a partially restored database survived the rollback"
    );
}

// (b) A unique constraint conflict must roll back every table in the batch.
#[tokio::test]
async fn unique_constraint_conflict_rolls_back_every_table() {
    let (_dir, pool) = test_pool(Duration::from_secs(1)).await;
    let before = snapshot(&pool).await;

    let conflicting = payload(json!({
        "mergeMode": "merge",
        "workspaces": [{ "id": "w1", "name": "Workspace" }],
        "snippets": [{ "id": "s1", "name": "Snippet", "script": "echo" }],
        "knownHosts": [
            { "id": "dup-id", "hostname": "a.example", "port": 22, "fingerprint": "SHA256:a", "key_type": "ssh-ed25519", "added_at": 1 },
            // Same primary key under a different hostname/port pair: the
            // existence probe passes, the INSERT hits the primary key.
            { "id": "dup-id", "hostname": "b.example", "port": 22, "fingerprint": "SHA256:b", "key_type": "ssh-ed25519", "added_at": 2 }
        ]
    }));

    let error = run_import(&pool, &conflicting, BUDGET)
        .await
        .expect_err("a primary key conflict must fail the import");
    assert!(
        matches!(error, ImportError::RolledBack(_)),
        "unexpected error: {error}"
    );
    assert!(
        error.to_string().contains("UNIQUE"),
        "unexpected message: {error}"
    );
    assert_eq!(snapshot(&pool).await, before, "conflicting batch left rows");
}

// (c) Another writer holding the lock must produce an error, never silence.
#[tokio::test]
async fn a_concurrent_writer_lock_surfaces_as_an_error() {
    let (_dir, pool) = test_pool(Duration::from_millis(150)).await;
    let mut blocker = pool.acquire().await.expect("second connection");
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *blocker)
        .await
        .expect("hold the write lock");

    let error = run_import(
        &pool,
        &merge_hosts(json!([{ "id": "h1", "name": "N", "hostname": "a", "username": "u" }])),
        Duration::from_secs(10),
    )
    .await
    .expect_err("a locked database must not report success");
    assert!(
        matches!(error, ImportError::Begin(_)),
        "unexpected error: {error}"
    );
    assert!(
        error.to_string().to_lowercase().contains("locked"),
        "unexpected message: {error}"
    );

    sqlx::query("ROLLBACK").execute(&mut *blocker).await.ok();
    drop(blocker);
    assert_eq!(count(&pool, "hosts").await, 0);
}

// (d) A COMMIT failure must be reported, not smoothed over.
#[tokio::test]
async fn a_commit_failure_is_reported_as_a_failure() {
    let (_dir, pool) = test_pool(Duration::from_secs(1)).await;
    let before = snapshot(&pool).await;

    let orphan_layout = payload(json!({
        "mergeMode": "merge",
        "workspaceLayouts": [{ "workspaceId": "missing", "layoutData": { "tabs": [] } }]
    }));

    let error = run_import(&pool, &orphan_layout, BUDGET)
        .await
        .expect_err("a deferred foreign key must fail the commit");
    match &error {
        ImportError::Commit(message) => assert!(
            message.to_lowercase().contains("foreign key"),
            "unexpected commit message: {message}"
        ),
        other => panic!("unexpected error: {other}"),
    }
    assert_eq!(
        snapshot(&pool).await,
        before,
        "a failed commit left the layout behind"
    );
}

// (e) Two imports racing must not interleave and must not duplicate rows.
#[tokio::test]
async fn concurrent_imports_serialize_without_cross_contamination() {
    let (_dir, pool) = test_pool(Duration::from_secs(2)).await;
    let build = || {
        merge_hosts(json!([
            { "id": "h1", "name": "One", "hostname": "one.example", "username": "root" },
            { "id": "h2", "name": "Two", "hostname": "two.example", "username": "root" }
        ]))
    };
    let first = build();
    let second = build();

    let (left, right) = tokio::join!(
        run_import(&pool, &first, BUDGET),
        run_import(&pool, &second, BUDGET)
    );
    let left = left.expect("first import");
    let right = right.expect("second import");

    assert!(left.hosts == 0 || right.hosts == 0, "both batches inserted");
    assert_eq!(
        left.hosts + right.hosts,
        2,
        "one batch must apply exactly once"
    );
    assert_eq!(count(&pool, "hosts").await, 2, "rows were duplicated");
    let hosts = snapshot(&pool)
        .await
        .into_iter()
        .find(|(table, _)| table == "hosts")
        .expect("hosts snapshot")
        .1;
    assert_eq!(hosts.len(), 2);
    assert!(hosts
        .iter()
        .all(|line| line.starts_with("'h1'") || line.starts_with("'h2'")));
}

// (f) A reader on another connection never sees a half-written import.
#[tokio::test]
async fn concurrent_reads_never_observe_a_partial_import() {
    let (_dir, pool) = test_pool(Duration::from_secs(2)).await;
    let rows = (0..2_000)
        .map(|index| {
            json!({
                "id": format!("h{index}"), "name": "Host", "hostname": "h.example", "username": "root"
            })
        })
        .collect::<Vec<_>>();
    let big = merge_hosts(json!(rows));

    let reader = pool.clone();
    let worker = tokio::spawn(async move { run_import(&pool, &big, BUDGET).await });

    let mut observed = Vec::new();
    while !worker.is_finished() {
        observed.push(count(&reader, "hosts").await);
        tokio::task::yield_now().await;
    }
    let report = worker
        .await
        .expect("join the import task")
        .expect("import with 2000 hosts");

    assert_eq!(report.hosts, 2_000);
    assert!(
        observed.iter().all(|seen| *seen == 0 || *seen == 2_000),
        "a reader observed a partial import: {observed:?}"
    );
    assert_eq!(count(&reader, "hosts").await, 2_000);
}

// (g) Replaying the same backup is idempotent under both modes.
#[tokio::test]
async fn reimporting_the_same_backup_does_not_duplicate_rows() {
    let (_dir, pool) = test_pool(Duration::from_secs(1)).await;

    let first = full_backup("merge");
    let report = run_import(&pool, &first, BUDGET)
        .await
        .expect("first import");
    assert_eq!(report.hosts, 1);
    assert_eq!(report.groups, 1);
    assert_eq!(report.snippets, 1);
    assert_eq!(report.snippet_packages, 1);
    assert_eq!(report.ssh_keys, 1);
    assert_eq!(report.known_hosts, 1);
    assert_eq!(report.workspaces, 1);
    let settled = snapshot(&pool).await;

    let replay = run_import(&pool, &full_backup("merge"), BUDGET)
        .await
        .expect("replayed import");
    assert_eq!(
        (
            replay.hosts,
            replay.groups,
            replay.snippets,
            replay.snippet_packages,
            replay.ssh_keys,
            replay.known_hosts,
            replay.workspaces,
        ),
        (0, 0, 0, 0, 0, 0, 0),
        "merge replay must not count unchanged rows"
    );
    assert_eq!(snapshot(&pool).await, settled, "merge replay changed rows");

    let replaced = run_import(&pool, &full_backup("replace"), BUDGET)
        .await
        .expect("replace import");
    assert_eq!(replaced.hosts, 1, "replace must rewrite the existing host");
    assert_eq!(count(&pool, "hosts").await, 1, "replace duplicated a host");
    assert_eq!(count(&pool, "known_hosts").await, 1);
    assert_eq!(count(&pool, "workspace_layouts").await, 1);
}

// (h) An older backup missing the newer columns still imports.
#[tokio::test]
async fn a_legacy_backup_missing_new_columns_imports_with_defaults() {
    let (_dir, pool) = test_pool(Duration::from_secs(1)).await;

    let legacy = payload(json!({
        "version": "1.0.0",
        "exportedAt": 1,
        "legacy_only_top_level": { "ignored": true },
        "hosts": [{
            "id": "h1", "name": "Legacy", "hostname": "legacy.example", "username": "root",
            "legacy_only_column": "ignored"
        }],
        "workspaces": [{ "id": "w1", "name": "Legacy" }],
        "sshKeys": [{ "id": "k1", "name": "Key" }],
        "snippets": [{ "id": "s1", "name": "Snippet", "script": "echo hi" }],
        "snippetPackages": [{ "id": "p1", "name": "Package" }],
        "knownHosts": [{
            "id": "kh1", "hostname": "legacy.example", "port": 22,
            "fingerprint": "SHA256:x", "added_at": 5
        }]
    }));

    let report = run_import(&pool, &legacy, BUDGET)
        .await
        .expect("a backup without the newer columns must import");
    assert_eq!(
        (
            report.hosts,
            report.workspaces,
            report.ssh_keys,
            report.snippets,
            report.snippet_packages,
            report.known_hosts,
        ),
        (1, 1, 1, 1, 1, 1),
        "every legacy row must be counted"
    );

    let row = sqlx::query(
        "SELECT agent_forwarding, shell_integration, certificate, jump_host_id, port FROM hosts WHERE id = ?",
    )
    .bind("h1")
    .fetch_one(&pool)
    .await
    .expect("legacy host row");
    assert_eq!(
        row.try_get::<Option<i64>, _>("agent_forwarding")
            .expect("agent_forwarding"),
        Some(0),
        "a missing agent_forwarding must normalize to 0, not NULL"
    );
    assert_eq!(
        row.try_get::<Option<String>, _>("shell_integration")
            .expect("shell_integration")
            .as_deref(),
        Some("off"),
        "a missing shell_integration must normalize to off"
    );
    assert_eq!(
        row.try_get::<Option<String>, _>("certificate")
            .expect("certificate"),
        None
    );
    assert_eq!(
        row.try_get::<Option<String>, _>("jump_host_id")
            .expect("jump_host_id"),
        None
    );
    assert_eq!(row.try_get::<Option<i64>, _>("port").expect("port"), None);
}

// Every column of every table lands in its own column.
#[tokio::test]
async fn every_column_round_trips_into_its_own_column() {
    let (_dir, pool) = test_pool(Duration::from_secs(1)).await;
    run_import(&pool, &full_backup("merge"), BUDGET)
        .await
        .expect("import a fully populated backup");

    assert_eq!(
        row_dump(&pool, "hosts", "id", "h1").await,
        "'h1'|'Target'|'target.example'|22|'root'|'key'|'secret'|'private-key'|'cert'|'g1'|1|'#fff'|'[\"prod\"]'|'[]'|'uptime'|'{}'|'j1'|'agent'|1|'zsh'|100|200"
    );
    assert_eq!(
        row_dump(&pool, "groups", "id", "g1").await,
        "'g1'|'Group'|NULL|'#000'|1|'{}'|3"
    );
    assert_eq!(
        row_dump(&pool, "snippets", "id", "s1").await,
        "'s1'|'Snippet'|'d'|'echo hi'|'p1'|'[]'|'{}'"
    );
    assert_eq!(
        row_dump(&pool, "snippet_packages", "id", "p1").await,
        "'p1'|'Package'|'pd'"
    );
    assert_eq!(
        row_dump(&pool, "ssh_keys", "id", "k1").await,
        "'k1'|'Key'|'ed25519'|'pk'|'pub'|'kc'|'pp'|1|11|12"
    );
    assert_eq!(
        row_dump(&pool, "known_hosts", "id", "kh1").await,
        "'kh1'|'target.example'|22|'SHA256:f'|'ssh-ed25519'|7"
    );
    assert_eq!(
        row_dump(&pool, "workspaces", "id", "w1").await,
        "'w1'|'Workspace'|'wd'|'icon'|'#111'|2|1|21|22"
    );
    assert_eq!(
        row_dump(&pool, "workspace_layouts", "workspace_id", "w1").await,
        "'w1'|'{\"tabs\":[1,2]}'"
    );
    assert_eq!(
        row_dump(&pool, "settings", "key", "app_settings").await,
        "'app_settings'|'{\"theme\":\"dark\"}'"
    );
    assert_eq!(
        row_dump(&pool, "settings", "key", "numeric_setting").await,
        "'numeric_setting'|'42'"
    );
}

// Quota: too many records is refused before a connection is used.
#[tokio::test]
async fn an_oversized_record_count_is_refused() {
    let (_dir, pool) = test_pool(Duration::from_secs(1)).await;
    let oversized = ImportPayload {
        hosts: (0..=MAX_RECORDS).map(|_| Default::default()).collect(),
        ..Default::default()
    };

    let error = run_import(&pool, &oversized, BUDGET)
        .await
        .expect_err("an oversized import must be refused");
    match error {
        ImportError::Payload(PayloadError::TooManyRecords { records, limit }) => {
            assert_eq!(records, MAX_RECORDS + 1);
            assert_eq!(limit, MAX_RECORDS);
        }
        other => panic!("unexpected error: {other}"),
    }
    assert_eq!(count(&pool, "hosts").await, 0);
}

// Quota: an oversized payload is refused before it can be executed.
#[tokio::test]
async fn an_oversized_payload_is_refused() {
    let (_dir, pool) = test_pool(Duration::from_secs(1)).await;
    let huge = "x".repeat(33 * 1024 * 1024);
    let oversized =
        merge_hosts(json!([{ "id": "h1", "name": huge, "hostname": "a", "username": "u" }]));

    let error = run_import(&pool, &oversized, BUDGET)
        .await
        .expect_err("an oversized payload must be refused");
    assert!(
        matches!(error, ImportError::Payload(PayloadError::TooLarge { .. })),
        "unexpected error: {error}"
    );
    assert_eq!(count(&pool, "hosts").await, 0);
}

// Budget: a budget that expires rolls the transaction back.
#[tokio::test]
async fn an_expired_budget_rolls_back() {
    let (_dir, pool) = test_pool(Duration::from_secs(1)).await;
    // 5000 rows cannot finish inside the budget, so the deadline hits while the
    // transaction is open and the rollback path is the one that has to clean up.
    let rows = (0..5_000)
        .map(|index| {
            json!({
                "id": format!("h{index}"), "name": "Host", "hostname": "h.example", "username": "root"
            })
        })
        .collect::<Vec<_>>();
    let error = run_import(&pool, &merge_hosts(json!(rows)), Duration::from_millis(5))
        .await
        .expect_err("an expired budget must not commit");
    assert!(
        matches!(error, ImportError::Timeout(_)),
        "unexpected error: {error}"
    );
    assert_eq!(count(&pool, "hosts").await, 0);
}

// (d) A ROLLBACK that fails must close the connection, never release it.
//
// A released connection keeps the open transaction and every later statement of
// an unrelated caller would run inside it. The failure is injected at the
// rollback seam and the release is observed on the pool's own hook, so the
// assertion is about the connection actually going back, not about intent.
#[tokio::test(flavor = "current_thread")]
async fn a_failed_rollback_closes_the_connection_instead_of_returning_it() {
    let (_dir, pool, released) = probed_pool().await;
    // Drain the releases left over from schema setup before counting.
    settle().await;
    let failing = payload(json!({
        "mergeMode": "merge",
        "hosts": [
            { "id": "h1", "name": "First", "hostname": "a.example", "username": "root" },
            // hosts.name is NOT NULL: binding a missing name fails this statement.
            { "id": "h2", "hostname": "b.example", "username": "root" }
        ]
    }));

    // Control: the same failure with a working rollback returns the connection,
    // which is what makes the negative assertion below meaningful.
    let before = released.load(Ordering::SeqCst);
    let rolled_back = run_import(&pool, &failing, BUDGET)
        .await
        .expect_err("a NOT NULL violation must fail the import");
    settle().await;
    assert!(
        matches!(rolled_back, ImportError::RolledBack(_)),
        "unexpected error: {rolled_back}"
    );
    assert_eq!(
        released.load(Ordering::SeqCst),
        before + 1,
        "a clean rollback must hand the connection back to the pool"
    );
    assert_eq!(
        wait_for_idle(&pool, 1).await,
        1,
        "the connection is reusable after a rollback"
    );

    // The defect: the rollback cannot run, so the transaction stays open.
    fault_injection::fail_next_rollback();
    let before = released.load(Ordering::SeqCst);
    let poisoned = run_import(&pool, &failing, BUDGET)
        .await
        .expect_err("the import still fails");
    settle().await;
    fault_injection::clear();

    assert!(
        matches!(poisoned, ImportError::RolledBack(_)),
        "unexpected error: {poisoned}"
    );
    assert_eq!(
        released.load(Ordering::SeqCst),
        before,
        "a connection whose rollback failed must not be released to the pool"
    );
    // Give a (wrongly) returning connection time to show up before asserting
    // that none did; polling for zero would pass instantly and prove nothing.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    settle().await;
    assert_eq!(
        pool.num_idle(),
        0,
        "no idle connection may survive an import that could not roll back"
    );
    assert_eq!(
        pool.size(),
        0,
        "the dirty connection must be closed, not parked in the pool"
    );

    // The pool still works, and nothing inherited the open transaction: a fresh
    // connection can open its own explicit transaction.
    let mut fresh = pool.acquire().await.expect("the pool opens a replacement");
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *fresh)
        .await
        .expect("a replacement connection is not inside a stale transaction");
    sqlx::query("ROLLBACK")
        .execute(&mut *fresh)
        .await
        .expect("rollback on the replacement");
    drop(fresh);
    assert_eq!(
        count(&pool, "hosts").await,
        0,
        "the failed import left no rows behind"
    );
}
