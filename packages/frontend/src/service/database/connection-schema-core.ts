export interface SqliteConnection {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS hosts (id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL, port INTEGER DEFAULT 22, username TEXT NOT NULL, auth_type TEXT DEFAULT 'password', password TEXT, private_key TEXT, certificate TEXT, group_id TEXT, is_favorite INTEGER DEFAULT 0, color TEXT, tags TEXT, port_forwards TEXT, startup_command TEXT, environment TEXT, jump_host_id TEXT, jump_host_auth_type TEXT, agent_forwarding INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)`,
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

export async function initializeCoreSchema(
  database: SqliteConnection,
): Promise<void> {
  for (const statement of schemaStatements.slice(0, 15))
    await database.execute(statement)
  for (const statement of [
    'ALTER TABLE connection_logs ADD COLUMN error_message TEXT',
    'ALTER TABLE connection_logs ADD COLUMN error_raw TEXT',
    'ALTER TABLE hosts ADD COLUMN certificate TEXT',
    'ALTER TABLE hosts ADD COLUMN jump_host_id TEXT',
    'ALTER TABLE hosts ADD COLUMN jump_host_auth_type TEXT',
    'ALTER TABLE hosts ADD COLUMN agent_forwarding INTEGER DEFAULT 0',
  ]) {
    try {
      await database.execute(statement)
    } catch {
      /* Existing databases already have the column. */
    }
  }
  for (const statement of schemaStatements.slice(15))
    await database.execute(statement)
}
