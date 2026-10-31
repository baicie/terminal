/**
 * Core schema and its additive migrations.
 *
 * Two rules this module has to keep:
 *
 * 1. An `ALTER TABLE ... ADD COLUMN` fails on a database that already has the column,
 *    and that one failure is expected. Every *other* failure - a full disk, a locked
 *    database, a permission problem, a bad statement - is a real problem and must
 *    reach the caller instead of being swallowed with the expected one.
 * 2. The migration list cannot be rolled back, so it only ever runs after a verified
 *    snapshot of the database exists. If that snapshot cannot be produced, no schema
 *    statement runs at all and the caller sees the snapshot error.
 */

import { traceStage } from './startup-trace'

export interface SqliteConnection {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>
  /** Row-returning queries. Absent on connections that only apply statements. */
  select?: (sql: string, params?: unknown[]) => Promise<unknown[]>
}

/** One column an upgrade adds to a table an older release already created. */
interface ColumnMigration {
  table: string
  column: string
  sql: string
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS hosts (id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL, port INTEGER DEFAULT 22, username TEXT NOT NULL, auth_type TEXT DEFAULT 'password', password TEXT, private_key TEXT, certificate TEXT, group_id TEXT, is_favorite INTEGER DEFAULT 0, color TEXT, tags TEXT, port_forwards TEXT, startup_command TEXT, environment TEXT, jump_host_id TEXT, jump_host_auth_type TEXT, agent_forwarding INTEGER DEFAULT 0, shell_integration TEXT DEFAULT 'off', created_at INTEGER, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, color TEXT, inherit_settings INTEGER DEFAULT 1, settings TEXT, "order" INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS snippets (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, script TEXT NOT NULL, package_id TEXT, tags TEXT, variables TEXT)`,
  `CREATE TABLE IF NOT EXISTS snippet_packages (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS known_hosts (id TEXT PRIMARY KEY, hostname TEXT NOT NULL, port INTEGER DEFAULT 22, fingerprint TEXT NOT NULL, key_type TEXT, added_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_known_hosts_hostname ON known_hosts(hostname)`,
  `CREATE TABLE IF NOT EXISTS ssh_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL, key_type TEXT, private_key TEXT, public_key TEXT, certificate TEXT, passphrase TEXT, is_encrypted INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_ssh_keys_name ON ssh_keys(name)`,
  `CREATE TABLE IF NOT EXISTS command_history (id INTEGER PRIMARY KEY AUTOINCREMENT, host_id TEXT, command TEXT NOT NULL, executed_at INTEGER NOT NULL, session_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_command_history_host_id ON command_history(host_id)`,
  `CREATE INDEX IF NOT EXISTS idx_command_history_executed_at ON command_history(executed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT, color TEXT, "order" INTEGER DEFAULT 0, is_active INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS workspace_layouts (workspace_id TEXT PRIMARY KEY, layout_data TEXT, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS connection_logs (id TEXT PRIMARY KEY, host_id TEXT, host_name TEXT NOT NULL, host_address TEXT NOT NULL, username TEXT, connection_type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, duration_seconds INTEGER, is_saved INTEGER DEFAULT 0, notes TEXT, error_message TEXT, error_raw TEXT, FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE SET NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_connection_logs_started_at ON connection_logs(started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS scripts (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, script TEXT NOT NULL, host_ids TEXT, schedule_type TEXT DEFAULT 'manual', schedule_value TEXT, enabled INTEGER DEFAULT 1, timeout_seconds INTEGER DEFAULT 60, retry_count INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_scripts_enabled ON scripts(enabled)`,
  `CREATE TABLE IF NOT EXISTS script_executions (id TEXT PRIMARY KEY, script_id TEXT, script_name TEXT NOT NULL, host_id TEXT, host_name TEXT, host_address TEXT, status TEXT NOT NULL, output TEXT, error TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, duration_ms INTEGER, FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE SET NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_script_executions_started_at ON script_executions(started_at DESC)`,
]

/**
 * The additive part of the schema, as one list so the statements and the "is this
 * upgrade still pending?" check can never disagree about what an upgrade is.
 */
const columnMigrations: ColumnMigration[] = [
  {
    table: 'connection_logs',
    column: 'error_message',
    sql: 'ALTER TABLE connection_logs ADD COLUMN error_message TEXT',
  },
  {
    table: 'connection_logs',
    column: 'error_raw',
    sql: 'ALTER TABLE connection_logs ADD COLUMN error_raw TEXT',
  },
  {
    table: 'hosts',
    column: 'certificate',
    sql: 'ALTER TABLE hosts ADD COLUMN certificate TEXT',
  },
  {
    table: 'hosts',
    column: 'jump_host_id',
    sql: 'ALTER TABLE hosts ADD COLUMN jump_host_id TEXT',
  },
  {
    table: 'hosts',
    column: 'jump_host_auth_type',
    sql: 'ALTER TABLE hosts ADD COLUMN jump_host_auth_type TEXT',
  },
  {
    table: 'hosts',
    column: 'agent_forwarding',
    sql: 'ALTER TABLE hosts ADD COLUMN agent_forwarding INTEGER DEFAULT 0',
  },
  {
    table: 'hosts',
    column: 'shell_integration',
    sql: "ALTER TABLE hosts ADD COLUMN shell_integration TEXT DEFAULT 'off'",
  },
]

/** What the backend reports about the snapshot it wrote. */
export interface MigrationSnapshot {
  /** Absolute path of the snapshot file. */
  path: string
  /** Tables the backend verified against the database. */
  tables: number
  /** Rows the snapshot carries. */
  rows: number
}

/**
 * Does this error mean "the column is already there"?
 *
 * SQLite reports it as `duplicate column name: <column>` (SQLITE_ERROR, so the code
 * alone cannot tell it apart from any other generic failure), and the plugin forwards
 * the message verbatim. Only that text is treated as expected: the error code is
 * shared with "disk I/O error", "database is locked", "attempt to write a readonly
 * database" and every syntax error, so matching on it would swallow the failures this
 * check exists to surface.
 */
export function isDuplicateColumnError(error: unknown): boolean {
  return /duplicate column name|duplicate column definition|column\b[^,;]{0,80}\balready exists/i.test(
    errorMessage(error),
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Which column migrations the database still needs.
 *
 * Returns nothing when the connection cannot answer the question (a statement-only
 * connection, for instance the real-SQLite upgrade harness), and nothing for a table
 * that does not exist yet: `CREATE TABLE` writes the current column set, so those
 * columns are not pending, they are being created.
 */
/**
 * Quote a SQL identifier for inlining.
 *
 * Only code-defined table names reach this, but the guard exists so a future
 * caller cannot turn a data-driven name into statement injection.
 */
function quoteSqlIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('refusing to inline an unsafe SQL identifier: ' + name)
  }
  return '"' + name + '"'
}

export async function pendingColumnMigrations(
  database: SqliteConnection,
): Promise<ColumnMigration[]> {
  const select = database.select
  if (!select) return []

  const pending: ColumnMigration[] = []
  for (const table of new Set(columnMigrations.map(migration => migration.table))) {
    const existing = await select(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    )
    if (!Array.isArray(existing) || existing.length === 0) continue

    // pragma table-valued functions resolve their argument while the statement
    // is prepared, so a bound parameter does not reliably reach them: the real
    // plugin rejected this call (with a non-Error value, which surfaced as
    // "error=undefined") on both macOS and Linux runners, while every unit test
    // passed because the mock connection accepts any parameters. The table names
    // are code constants, so validate and inline them instead of binding.
    const columns = await select(
      'SELECT name FROM pragma_table_info(' + quoteSqlIdentifier(table) + ')',
    )
    const present = new Set(
      (Array.isArray(columns) ? (columns as { name: string }[]) : []).map(
        column => column.name,
      ),
    )
    pending.push(
      ...columnMigrations.filter(
        migration => migration.table === table && !present.has(migration.column),
      ),
    )
  }
  return pending
}

/**
 * Snapshot the database before it is rewritten, and stop when that fails.
 *
 * The snapshot is taken by the backend (`VACUUM INTO` plus a read-back verification of
 * integrity, column lists and row counts), because only the backend can reach the
 * pooled connection SQLite owns. A rejection here is the abort signal: the caller must
 * not run a single schema statement, since the migration it is about to perform cannot
 * be undone.
 */
export async function ensurePreMigrationSnapshot(
  pending: ColumnMigration[],
): Promise<MigrationSnapshot> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    const snapshot = await invoke<MigrationSnapshot>(
      'backup_database_before_migration',
    )
    if (!snapshot || typeof snapshot.path !== 'string' || snapshot.path === '') {
      throw new Error('the backend did not report a snapshot path')
    }
    console.info(
      `[Database] pre-migration snapshot ${snapshot.path} verified (${snapshot.tables} tables, ${snapshot.rows} rows) before migrating ${pending.length} column(s)`,
    )
    return snapshot
  } catch (error) {
    throw new Error(
      `pre-migration snapshot failed, so the schema was not migrated: ${errorMessage(error)}`,
      { cause: error },
    )
  }
}

export async function initializeCoreSchema(
  database: SqliteConnection,
): Promise<void> {
  const pending = await pendingColumnMigrations(database)
  traceStage(
    'pending-migrations-detected',
    pending.length + ' column migration(s): ' + pending.map(entry => entry.column).join(','),
  )
  if (pending.length > 0) {
    traceStage('snapshot-started', pending.length + ' migration(s) pending')
    await ensurePreMigrationSnapshot(pending)
    traceStage('snapshot-finished', 'the pre-migration snapshot was verified')
  }

  for (const statement of schemaStatements.slice(0, 15))
    await database.execute(statement)
  for (const migration of columnMigrations) {
    try {
      await database.execute(migration.sql)
    } catch (error) {
      if (isDuplicateColumnError(error)) continue
      throw error
    }
  }
  for (const statement of schemaStatements.slice(15))
    await database.execute(statement)
  traceStage('core-schema-finished', schemaStatements.length + ' statement(s) applied')
}
