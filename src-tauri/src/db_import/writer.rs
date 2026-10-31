//! The single-transaction writer behind `import_backup_data`.
//!
//! One pooled connection is acquired once, `BEGIN IMMEDIATE` runs on it, every
//! statement runs on that same connection, and `COMMIT` closes the batch. The
//! statements never travel over IPC: the SQL below is the whole surface, values
//! are bound as parameters, and the frontend cannot name a table or a column.

use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use sqlx::sqlite::{SqliteArguments, SqliteConnection};
use sqlx::{query::Query, Pool, Sqlite};
use tokio::sync::Mutex;

use super::payload::{ImportPayload, PayloadError};

/// Serializes imports across windows and entry points inside this process.
static IMPORT_LOCK: Mutex<()> = Mutex::const_new(());

/// Rows imported per table, matching `ImportStats` on the frontend.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub groups: u64,
    pub hosts: u64,
    pub snippet_packages: u64,
    pub snippets: u64,
    pub ssh_keys: u64,
    pub known_hosts: u64,
    pub workspaces: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error(transparent)]
    Payload(#[from] PayloadError),
    #[error("import could not acquire a database connection: {0}")]
    Acquire(String),
    #[error("import could not start a transaction: {0}")]
    Begin(String),
    #[error("import was rolled back after {0}")]
    RolledBack(#[from] sqlx::Error),
    #[error("import commit failed after every statement succeeded: {0}")]
    Commit(String),
    #[error("import exceeded the {0:?} budget and was rolled back")]
    Timeout(Duration),
}

// Statement text. Table and column names live here and nowhere else.
const BEGIN_IMMEDIATE: &str = "BEGIN IMMEDIATE";
const COMMIT: &str = "COMMIT";
const ROLLBACK: &str = "ROLLBACK";

const GROUP_EXISTS: &str = "SELECT id FROM groups WHERE id = ?";
const GROUP_INSERT: &str = "INSERT INTO groups (id, name, parent_id, color, inherit_settings, settings, \"order\") VALUES (?, ?, ?, ?, ?, ?, ?)";
const GROUP_UPDATE: &str = "UPDATE groups SET name = ?, parent_id = ?, color = ?, inherit_settings = ?, settings = ?, \"order\" = ? WHERE id = ?";

const HOST_EXISTS: &str = "SELECT id FROM hosts WHERE id = ?";
const HOST_INSERT: &str = "INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, certificate, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, jump_host_id, jump_host_auth_type, agent_forwarding, shell_integration, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
const HOST_UPDATE: &str = "UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = ?, private_key = ?, certificate = ?, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, agent_forwarding = ?, shell_integration = ?, updated_at = ? WHERE id = ?";

const SNIPPET_PACKAGE_EXISTS: &str = "SELECT id FROM snippet_packages WHERE id = ?";
const SNIPPET_PACKAGE_INSERT: &str =
    "INSERT INTO snippet_packages (id, name, description) VALUES (?, ?, ?)";
const SNIPPET_PACKAGE_UPDATE: &str =
    "UPDATE snippet_packages SET name = ?, description = ? WHERE id = ?";

const SNIPPET_EXISTS: &str = "SELECT id FROM snippets WHERE id = ?";
const SNIPPET_INSERT: &str = "INSERT INTO snippets (id, name, description, script, package_id, tags, variables) VALUES (?, ?, ?, ?, ?, ?, ?)";
const SNIPPET_UPDATE: &str =
    "UPDATE snippets SET name = ?, description = ?, script = ?, package_id = ?, tags = ?, variables = ? WHERE id = ?";

const SSH_KEY_EXISTS: &str = "SELECT id FROM ssh_keys WHERE id = ?";
const SSH_KEY_INSERT: &str = "INSERT INTO ssh_keys (id, name, key_type, private_key, public_key, certificate, passphrase, is_encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
const SSH_KEY_UPDATE: &str = "UPDATE ssh_keys SET name = ?, key_type = ?, private_key = ?, public_key = ?, certificate = ?, passphrase = ?, is_encrypted = ?, updated_at = ? WHERE id = ?";

const KNOWN_HOST_EXISTS: &str = "SELECT id FROM known_hosts WHERE hostname = ? AND port = ?";
const KNOWN_HOST_INSERT: &str =
    "INSERT INTO known_hosts (id, hostname, port, fingerprint, key_type, added_at) VALUES (?, ?, ?, ?, ?, ?)";
const KNOWN_HOST_UPDATE: &str = "UPDATE known_hosts SET fingerprint = ?, key_type = ?, added_at = ? WHERE hostname = ? AND port = ?";

const WORKSPACE_EXISTS: &str = "SELECT id FROM workspaces WHERE id = ?";
const WORKSPACE_INSERT: &str = "INSERT INTO workspaces (id, name, description, icon, color, \"order\", is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
const WORKSPACE_UPDATE: &str = "UPDATE workspaces SET name = ?, description = ?, icon = ?, color = ?, \"order\" = ?, is_active = ?, updated_at = ? WHERE id = ?";

const WORKSPACE_LAYOUT_UPSERT: &str =
    "INSERT OR REPLACE INTO workspace_layouts (workspace_id, layout_data) VALUES (?, ?)";

const SETTING_EXISTS: &str = "SELECT key AS id FROM settings WHERE key = ?";
const SETTING_UPSERT: &str = "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)";

/// One bound parameter.
#[derive(Debug, Clone)]
enum SqlArg {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
}

/// JSON value to SQLite parameter. Arrays and objects become JSON text, which
/// is what the SQL plugin did with the same value.
fn arg(value: Option<&Value>) -> SqlArg {
    match value {
        None | Some(Value::Null) => SqlArg::Null,
        Some(Value::Bool(flag)) => SqlArg::Int(i64::from(*flag)),
        Some(Value::Number(number)) => match number.as_i64() {
            Some(integer) => SqlArg::Int(integer),
            None => SqlArg::Real(number.as_f64().unwrap_or_default()),
        },
        Some(Value::String(text)) => SqlArg::Text(text.clone()),
        Some(nested) => SqlArg::Text(nested.to_string()),
    }
}

/// `agent_forwarding`: only a true boolean or the number one enables it.
fn agent_forwarding(value: Option<&Value>) -> SqlArg {
    match value {
        Some(Value::Bool(true)) => SqlArg::Int(1),
        Some(Value::Number(number)) if number.as_f64() == Some(1.0) => SqlArg::Int(1),
        _ => SqlArg::Int(0),
    }
}

/// `shell_integration`: only an explicit bash/zsh keeps its value.
fn shell_integration(value: Option<&Value>) -> SqlArg {
    match value {
        Some(Value::String(name)) if name == "bash" || name == "zsh" => SqlArg::Text(name.clone()),
        _ => SqlArg::Text("off".to_string()),
    }
}

/// `settings.value`: strings verbatim, everything else re-serialised.
fn setting_value(value: &Value) -> SqlArg {
    match value {
        Value::String(text) => SqlArg::Text(text.clone()),
        other => SqlArg::Text(other.to_string()),
    }
}

fn bind<'q>(
    mut query: Query<'q, Sqlite, SqliteArguments<'q>>,
    args: &[SqlArg],
) -> Query<'q, Sqlite, SqliteArguments<'q>> {
    for argument in args {
        query = match argument {
            SqlArg::Null => query.bind(None::<String>),
            SqlArg::Int(value) => query.bind(*value),
            SqlArg::Real(value) => query.bind(*value),
            SqlArg::Text(text) => query.bind(text.clone()),
        };
    }
    query
}

async fn execute(
    conn: &mut SqliteConnection,
    sql: &'static str,
    args: &[SqlArg],
) -> Result<u64, sqlx::Error> {
    let query = bind(sqlx::query(sql), args);
    query
        .execute(&mut *conn)
        .await
        .map(|done| done.rows_affected())
}

async fn exists(
    conn: &mut SqliteConnection,
    sql: &'static str,
    args: &[SqlArg],
) -> Result<bool, sqlx::Error> {
    let query = bind(sqlx::query(sql), args);
    query
        .fetch_optional(&mut *conn)
        .await
        .map(|row| row.is_some())
}

/// The three statements one table needs for merge/replace handling.
struct Upsert {
    exists_sql: &'static str,
    exists_args: Vec<SqlArg>,
    insert_sql: &'static str,
    insert_args: Vec<SqlArg>,
    update_sql: &'static str,
    update_args: Vec<SqlArg>,
}

/// Inserts a missing row, updates an existing one in replace mode and counts
/// both; an existing row in merge mode is left alone and not counted.
async fn upsert(
    conn: &mut SqliteConnection,
    counter: &mut u64,
    replace: bool,
    plan: Upsert,
) -> Result<(), ImportError> {
    if exists(conn, plan.exists_sql, &plan.exists_args).await? {
        if replace {
            execute(conn, plan.update_sql, &plan.update_args).await?;
            *counter += 1;
        }
    } else {
        execute(conn, plan.insert_sql, &plan.insert_args).await?;
        *counter += 1;
    }
    Ok(())
}

fn group_plan(row: &super::payload::GroupRow) -> Upsert {
    let mut update_args = vec![
        arg(row.name.as_ref()),
        arg(row.parent_id.as_ref()),
        arg(row.color.as_ref()),
        arg(row.inherit_settings.as_ref()),
        arg(row.settings.as_ref()),
        arg(row.order.as_ref()),
    ];
    update_args.push(arg(row.id.as_ref()));
    Upsert {
        exists_sql: GROUP_EXISTS,
        exists_args: vec![arg(row.id.as_ref())],
        insert_sql: GROUP_INSERT,
        insert_args: vec![
            arg(row.id.as_ref()),
            arg(row.name.as_ref()),
            arg(row.parent_id.as_ref()),
            arg(row.color.as_ref()),
            arg(row.inherit_settings.as_ref()),
            arg(row.settings.as_ref()),
            arg(row.order.as_ref()),
        ],
        update_sql: GROUP_UPDATE,
        update_args,
    }
}

fn host_plan(row: &super::payload::HostRow, now: i64) -> Upsert {
    let shared = || {
        vec![
            arg(row.name.as_ref()),
            arg(row.hostname.as_ref()),
            arg(row.port.as_ref()),
            arg(row.username.as_ref()),
            arg(row.auth_type.as_ref()),
            arg(row.password.as_ref()),
            arg(row.private_key.as_ref()),
            arg(row.certificate.as_ref()),
            arg(row.group_id.as_ref()),
            arg(row.is_favorite.as_ref()),
            arg(row.color.as_ref()),
            arg(row.tags.as_ref()),
            arg(row.port_forwards.as_ref()),
            arg(row.startup_command.as_ref()),
            arg(row.environment.as_ref()),
            arg(row.jump_host_id.as_ref()),
            arg(row.jump_host_auth_type.as_ref()),
            agent_forwarding(row.agent_forwarding.as_ref()),
            shell_integration(row.shell_integration.as_ref()),
        ]
    };
    let mut insert_args = vec![arg(row.id.as_ref())];
    insert_args.extend(shared());
    insert_args.push(arg(row.created_at.as_ref()));
    insert_args.push(arg(row.updated_at.as_ref()));
    let mut update_args = shared();
    update_args.push(SqlArg::Int(now));
    update_args.push(arg(row.id.as_ref()));
    Upsert {
        exists_sql: HOST_EXISTS,
        exists_args: vec![arg(row.id.as_ref())],
        insert_sql: HOST_INSERT,
        insert_args,
        update_sql: HOST_UPDATE,
        update_args,
    }
}

fn snippet_package_plan(row: &super::payload::SnippetPackageRow) -> Upsert {
    Upsert {
        exists_sql: SNIPPET_PACKAGE_EXISTS,
        exists_args: vec![arg(row.id.as_ref())],
        insert_sql: SNIPPET_PACKAGE_INSERT,
        insert_args: vec![
            arg(row.id.as_ref()),
            arg(row.name.as_ref()),
            arg(row.description.as_ref()),
        ],
        update_sql: SNIPPET_PACKAGE_UPDATE,
        update_args: vec![
            arg(row.name.as_ref()),
            arg(row.description.as_ref()),
            arg(row.id.as_ref()),
        ],
    }
}

fn snippet_plan(row: &super::payload::SnippetRow) -> Upsert {
    let shared = || {
        vec![
            arg(row.name.as_ref()),
            arg(row.description.as_ref()),
            arg(row.script.as_ref()),
            arg(row.package_id.as_ref()),
            arg(row.tags.as_ref()),
            arg(row.variables.as_ref()),
        ]
    };
    let mut insert_args = vec![arg(row.id.as_ref())];
    insert_args.extend(shared());
    let mut update_args = shared();
    update_args.push(arg(row.id.as_ref()));
    Upsert {
        exists_sql: SNIPPET_EXISTS,
        exists_args: vec![arg(row.id.as_ref())],
        insert_sql: SNIPPET_INSERT,
        insert_args,
        update_sql: SNIPPET_UPDATE,
        update_args,
    }
}

fn ssh_key_plan(row: &super::payload::SshKeyRow, now: i64) -> Upsert {
    let shared = || {
        vec![
            arg(row.name.as_ref()),
            arg(row.key_type.as_ref()),
            arg(row.private_key.as_ref()),
            arg(row.public_key.as_ref()),
            arg(row.certificate.as_ref()),
            arg(row.passphrase.as_ref()),
            arg(row.is_encrypted.as_ref()),
        ]
    };
    let mut insert_args = vec![arg(row.id.as_ref())];
    insert_args.extend(shared());
    insert_args.push(arg(row.created_at.as_ref()));
    insert_args.push(arg(row.updated_at.as_ref()));
    let mut update_args = shared();
    update_args.push(SqlArg::Int(now));
    update_args.push(arg(row.id.as_ref()));
    Upsert {
        exists_sql: SSH_KEY_EXISTS,
        exists_args: vec![arg(row.id.as_ref())],
        insert_sql: SSH_KEY_INSERT,
        insert_args,
        update_sql: SSH_KEY_UPDATE,
        update_args,
    }
}

fn known_host_plan(row: &super::payload::KnownHostRow) -> Upsert {
    Upsert {
        exists_sql: KNOWN_HOST_EXISTS,
        exists_args: vec![arg(row.hostname.as_ref()), arg(row.port.as_ref())],
        insert_sql: KNOWN_HOST_INSERT,
        insert_args: vec![
            arg(row.id.as_ref()),
            arg(row.hostname.as_ref()),
            arg(row.port.as_ref()),
            arg(row.fingerprint.as_ref()),
            arg(row.key_type.as_ref()),
            arg(row.added_at.as_ref()),
        ],
        update_sql: KNOWN_HOST_UPDATE,
        update_args: vec![
            arg(row.fingerprint.as_ref()),
            arg(row.key_type.as_ref()),
            arg(row.added_at.as_ref()),
            arg(row.hostname.as_ref()),
            arg(row.port.as_ref()),
        ],
    }
}

fn workspace_plan(row: &super::payload::WorkspaceRow, now: i64) -> Upsert {
    let shared = || {
        vec![
            arg(row.name.as_ref()),
            arg(row.description.as_ref()),
            arg(row.icon.as_ref()),
            arg(row.color.as_ref()),
            arg(row.order.as_ref()),
            arg(row.is_active.as_ref()),
        ]
    };
    let mut insert_args = vec![arg(row.id.as_ref())];
    insert_args.extend(shared());
    insert_args.push(arg(row.created_at.as_ref()));
    insert_args.push(arg(row.updated_at.as_ref()));
    let mut update_args = shared();
    update_args.push(SqlArg::Int(now));
    update_args.push(arg(row.id.as_ref()));
    Upsert {
        exists_sql: WORKSPACE_EXISTS,
        exists_args: vec![arg(row.id.as_ref())],
        insert_sql: WORKSPACE_INSERT,
        insert_args,
        update_sql: WORKSPACE_UPDATE,
        update_args,
    }
}

/// Table order matches the previous frontend loop: parents before children.
async fn apply(
    conn: &mut SqliteConnection,
    payload: &ImportPayload,
) -> Result<ImportReport, ImportError> {
    let replace = payload.is_replace();
    let now = payload.now_ms();
    let mut report = ImportReport::default();

    for row in &payload.groups {
        upsert(conn, &mut report.groups, replace, group_plan(row)).await?;
    }
    for row in &payload.hosts {
        upsert(conn, &mut report.hosts, replace, host_plan(row, now)).await?;
    }
    for row in &payload.snippet_packages {
        upsert(
            conn,
            &mut report.snippet_packages,
            replace,
            snippet_package_plan(row),
        )
        .await?;
    }
    for row in &payload.snippets {
        upsert(conn, &mut report.snippets, replace, snippet_plan(row)).await?;
    }
    for row in &payload.ssh_keys {
        upsert(conn, &mut report.ssh_keys, replace, ssh_key_plan(row, now)).await?;
    }
    for row in &payload.known_hosts {
        upsert(conn, &mut report.known_hosts, replace, known_host_plan(row)).await?;
    }
    for row in &payload.workspaces {
        upsert(
            conn,
            &mut report.workspaces,
            replace,
            workspace_plan(row, now),
        )
        .await?;
    }
    for row in &payload.workspace_layouts {
        // A layout without data is skipped, exactly like the previous loop.
        let Some(layout) = layout_arg(row.layout_data.as_ref()) else {
            continue;
        };
        execute(
            conn,
            WORKSPACE_LAYOUT_UPSERT,
            &[arg(row.workspace_id.as_ref()), layout],
        )
        .await?;
    }
    for (key, value) in &payload.settings {
        let key_arg = SqlArg::Text(key.clone());
        if !replace && exists(conn, SETTING_EXISTS, std::slice::from_ref(&key_arg)).await? {
            continue;
        }
        execute(conn, SETTING_UPSERT, &[key_arg, setting_value(value)]).await?;
    }

    Ok(report)
}

/// `layout_data` is stored as JSON text; a missing or null value skips the row.
fn layout_arg(value: Option<&Value>) -> Option<SqlArg> {
    match value {
        None | Some(Value::Null) => None,
        Some(layout) => Some(SqlArg::Text(layout.to_string())),
    }
}

async fn rollback(conn: &mut SqliteConnection) {
    if let Err(error) = sqlx::query(ROLLBACK).execute(&mut *conn).await {
        tracing::warn!(error = %error, "import rollback reported a failure");
    }
}

/// Runs the whole import on one connection inside one transaction.
///
/// `budget` covers `BEGIN` through `COMMIT`; waiting for the process-wide
/// import lock is not part of it, so a queued import cannot time out before it
/// starts writing. A timeout or any statement error rolls back on the same
/// connection that opened the transaction.
pub async fn run_import(
    pool: &Pool<Sqlite>,
    payload: &ImportPayload,
    budget: Duration,
) -> Result<ImportReport, ImportError> {
    payload.validate()?;
    let started = Instant::now();
    let _serialized = IMPORT_LOCK.lock().await;
    let mut conn = pool
        .acquire()
        .await
        .map_err(|error| ImportError::Acquire(error.to_string()))?;

    let outcome = {
        let work = async {
            let conn: &mut SqliteConnection = &mut conn;
            execute(conn, BEGIN_IMMEDIATE, &[])
                .await
                .map_err(|error| ImportError::Begin(error.to_string()))?;
            let report = apply(conn, payload).await?;
            execute(conn, COMMIT, &[])
                .await
                .map_err(|error| ImportError::Commit(error.to_string()))?;
            Ok::<ImportReport, ImportError>(report)
        };
        tokio::time::timeout(budget, work).await
    };

    match outcome {
        Ok(Ok(report)) => {
            tracing::info!(
                groups = report.groups,
                hosts = report.hosts,
                snippets = report.snippets,
                ssh_keys = report.ssh_keys,
                known_hosts = report.known_hosts,
                workspaces = report.workspaces,
                elapsed_ms = started.elapsed().as_millis() as u64,
                "backup import committed"
            );
            Ok(report)
        }
        Ok(Err(error)) => {
            rollback(&mut conn).await;
            Err(error)
        }
        Err(_elapsed) => {
            rollback(&mut conn).await;
            Err(ImportError::Timeout(budget))
        }
    }
}
