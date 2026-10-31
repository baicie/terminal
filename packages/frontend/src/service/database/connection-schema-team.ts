import type { SqliteConnection } from './connection-schema-core'
import {
  ensurePreMigrationSnapshot,
  isDuplicateColumnError,
} from './connection-schema-core'

const teamSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, mode TEXT DEFAULT 'local', endpoint TEXT, api_token TEXT, auto_sync INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS team_members (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT, user_email TEXT, role TEXT DEFAULT 'member', joined_at INTEGER, FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE, UNIQUE(team_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS team_shared_hosts (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, host_data TEXT NOT NULL, shared_by TEXT NOT NULL, permission TEXT DEFAULT 'readonly', created_at INTEGER, version INTEGER, updated_at INTEGER, dirty INTEGER DEFAULT 0, FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS team_shared_snippets (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, snippet_data TEXT NOT NULL, shared_by TEXT NOT NULL, permission TEXT DEFAULT 'readonly', created_at INTEGER, version INTEGER, updated_at INTEGER, dirty INTEGER DEFAULT 0, FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS team_invites (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, type TEXT NOT NULL, code TEXT UNIQUE, link_token TEXT UNIQUE, email TEXT, role TEXT DEFAULT 'member', created_by TEXT NOT NULL, expires_at INTEGER, used_at INTEGER, created_at INTEGER, FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS team_audit_logs (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT, host_name TEXT, action TEXT NOT NULL, details TEXT, created_at INTEGER, FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS sync_queue (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, team_id TEXT NOT NULL, type TEXT NOT NULL, resource TEXT NOT NULL, resource_id TEXT NOT NULL, data TEXT, status TEXT DEFAULT 'pending', retry_count INTEGER DEFAULT 0, error TEXT, created_at INTEGER, synced_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS user_profile (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_team_shared_hosts_team_id ON team_shared_hosts(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_team_shared_snippets_team_id ON team_shared_snippets(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_team_invites_team_id ON team_invites(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)`,
  `CREATE TABLE IF NOT EXISTS port_forward_rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'local', local_host TEXT NOT NULL DEFAULT '127.0.0.1', local_port INTEGER NOT NULL, remote_host TEXT NOT NULL, remote_port INTEGER NOT NULL, host_id TEXT, enabled INTEGER DEFAULT 1, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_port_forward_rules_host_id ON port_forward_rules(host_id)`,
]

interface TeamColumnMigration {
  table: string
  column: string
  sql: string
}

function sharedColumns(table: string): TeamColumnMigration[] {
  return [
    {
      table,
      column: 'version',
      sql: `ALTER TABLE ${table} ADD COLUMN version INTEGER`,
    },
    {
      table,
      column: 'updated_at',
      sql: `ALTER TABLE ${table} ADD COLUMN updated_at INTEGER`,
    },
    {
      table,
      column: 'dirty',
      sql: `ALTER TABLE ${table} ADD COLUMN dirty INTEGER DEFAULT 0`,
    },
  ]
}

/**
 * Columns an upgrade adds to a share table an older release already created. A
 * database without them cannot prove which server version a share is based on,
 * so every push from it would be an unversioned write: the upgrade is what makes
 * the version contract usable, not a cosmetic schema change.
 */
const teamColumnMigrations: TeamColumnMigration[] = [
  ...sharedColumns('team_shared_hosts'),
  ...sharedColumns('team_shared_snippets'),
]

/** Quote a SQL identifier for inlining; see the core schema module. */
function quoteSqlIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('refusing to inline an unsafe SQL identifier: ' + name)
  }
  return '"' + name + '"'
}

async function pendingTeamColumnMigrations(
  database: SqliteConnection,
): Promise<TeamColumnMigration[]> {
  if (!database.select) return []
  // Same two traps the core schema had (#59): the plugin's select is a class
  // method that reads this.path, so it must stay bound to its instance, and a
  // pragma table-valued function resolves its argument at prepare time so the
  // table name has to be inlined rather than bound. Fixing only the core module
  // left initialisation failing here, one stage later.
  const select = database.select.bind(database)
  const pending: TeamColumnMigration[] = []
  for (const table of new Set(teamColumnMigrations.map(item => item.table))) {
    const existing = await select(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    )
    if (!Array.isArray(existing) || existing.length === 0) continue
    const columns = await select(
      'SELECT name FROM pragma_table_info(' + quoteSqlIdentifier(table) + ')',
    )
    const present = new Set(
      (Array.isArray(columns) ? (columns as { name: string }[]) : []).map(
        column => column.name,
      ),
    )
    pending.push(
      ...teamColumnMigrations.filter(
        migration => migration.table === table && !present.has(migration.column),
      ),
    )
  }
  return pending
}

export async function initializeTeamSchema(
  database: SqliteConnection,
): Promise<void> {
  const pending = await pendingTeamColumnMigrations(database)
  if (pending.length > 0) await ensurePreMigrationSnapshot(pending)
  for (const statement of teamSchemaStatements)
    await database.execute(statement)
  for (const migration of teamColumnMigrations) {
    try {
      await database.execute(migration.sql)
    } catch (error) {
      if (isDuplicateColumnError(error)) continue
      throw error
    }
  }
}
