/**
 * 数据库连接和初始化
 * 包含 getDb、executeQuery、select、initSchema、configureSqlite
 */
import Database from '@tauri-apps/plugin-sql'
import { isTauri } from '@tauri-apps/api/core'

let db: Database | null = null
let initPromise: Promise<Database> | null = null

export async function getDb(): Promise<Database> {
  if (db) return db

  // If initialization is in progress, wait for it
  if (initPromise) return initPromise

  if (!isTauri()) {
    throw new Error('Database only available in Tauri context')
  }

  // Start initialization
  initPromise = (async () => {
    db = await Database.load('sqlite:terminal.db')
    await initSchema()
    await configureSqlite()
    return db
  })()

  return initPromise
}

export async function configureSqlite() {
  const database = db!
  // Enable WAL mode for better concurrent access
  await database.execute('PRAGMA journal_mode=WAL')
  // Set busy timeout to wait for locks (30 seconds for Tauri dev mode)
  await database.execute('PRAGMA busy_timeout=30000')
  // Optimize for performance
  await database.execute('PRAGMA synchronous=NORMAL')
  await database.execute('PRAGMA cache_size=10000')
}

export async function initSchema() {
  const database = db!

  await database.execute(`
    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hostname TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT DEFAULT 'password',
      password TEXT,
      private_key TEXT,
      group_id TEXT,
      is_favorite INTEGER DEFAULT 0,
      color TEXT,
      tags TEXT,
      port_forwards TEXT,
      startup_command TEXT,
      environment TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      color TEXT,
      inherit_settings INTEGER DEFAULT 1,
      settings TEXT,
      "order" INTEGER DEFAULT 0
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      script TEXT NOT NULL,
      package_id TEXT,
      tags TEXT,
      variables TEXT
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS snippet_packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS known_hosts (
      id TEXT PRIMARY KEY,
      hostname TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      fingerprint TEXT NOT NULL,
      key_type TEXT,
      added_at INTEGER NOT NULL
    )
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_known_hosts_hostname ON known_hosts(hostname)
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS ssh_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_type TEXT,
      private_key TEXT,
      public_key TEXT,
      certificate TEXT,
      passphrase TEXT,
      is_encrypted INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_ssh_keys_name ON ssh_keys(name)
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS command_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id TEXT,
      command TEXT NOT NULL,
      executed_at INTEGER NOT NULL,
      session_id TEXT
    )
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_command_history_host_id ON command_history(host_id)
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_command_history_executed_at ON command_history(executed_at DESC)
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      color TEXT,
      "order" INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS workspace_layouts (
      workspace_id TEXT PRIMARY KEY,
      layout_data TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS connection_logs (
      id TEXT PRIMARY KEY,
      host_id TEXT,
      host_name TEXT NOT NULL,
      host_address TEXT NOT NULL,
      username TEXT,
      connection_type TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_seconds INTEGER,
      is_saved INTEGER DEFAULT 0,
      notes TEXT,
      error_message TEXT,
      error_raw TEXT,
      FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE SET NULL
    )
  `)

  // Migration: add error fields if they don't exist (for existing databases)
  try {
    await database.execute(
      "ALTER TABLE connection_logs ADD COLUMN error_message TEXT",
    )
  } catch {
    // Column may already exist, ignore
  }
  try {
    await database.execute(
      "ALTER TABLE connection_logs ADD COLUMN error_raw TEXT",
    )
  } catch {
    // Column may already exist, ignore
  }

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_connection_logs_started_at ON connection_logs(started_at DESC)
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      script TEXT NOT NULL,
      host_ids TEXT,
      schedule_type TEXT DEFAULT 'manual',
      schedule_value TEXT,
      enabled INTEGER DEFAULT 1,
      timeout_seconds INTEGER DEFAULT 60,
      retry_count INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_scripts_enabled ON scripts(enabled)
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS script_executions (
      id TEXT PRIMARY KEY,
      script_id TEXT,
      script_name TEXT NOT NULL,
      host_id TEXT,
      host_name TEXT,
      host_address TEXT,
      status TEXT NOT NULL,
      output TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_ms INTEGER,
      FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE SET NULL
    )
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_script_executions_started_at ON script_executions(started_at DESC)
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      mode TEXT DEFAULT 'local',
      endpoint TEXT,
      api_token TEXT,
      auto_sync INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      user_email TEXT,
      role TEXT DEFAULT 'member',
      joined_at INTEGER,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      UNIQUE(team_id, user_id)
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS team_shared_hosts (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      host_data TEXT NOT NULL,
      shared_by TEXT NOT NULL,
      permission TEXT DEFAULT 'readonly',
      created_at INTEGER,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS team_shared_snippets (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      snippet_data TEXT NOT NULL,
      shared_by TEXT NOT NULL,
      permission TEXT DEFAULT 'readonly',
      created_at INTEGER,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS team_invites (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      type TEXT NOT NULL,
      code TEXT UNIQUE,
      link_token TEXT UNIQUE,
      email TEXT,
      role TEXT DEFAULT 'member',
      created_by TEXT NOT NULL,
      expires_at INTEGER,
      used_at INTEGER,
      created_at INTEGER,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS team_audit_logs (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      host_name TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at INTEGER,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      type TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      data TEXT,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      error TEXT,
      created_at INTEGER,
      synced_at INTEGER
    )
  `)

  await database.execute(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER
    )
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id)
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id)
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_team_shared_hosts_team_id ON team_shared_hosts(team_id)
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_team_shared_snippets_team_id ON team_shared_snippets(team_id)
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_team_invites_team_id ON team_invites(team_id)
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)
  `)
}

export async function executeQuery(sql: string, params: unknown[] = []) {
  try {
    const database = await getDb()
    return await database.execute(sql, params)
  } catch (error) {
    console.error('[Database] Query error:', {
      sql: sql.substring(0, 200),
      params,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      `Database query failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export async function select<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const database = await getDb()
    const result = await database.select<T>(sql, params)
    return Array.isArray(result) ? result : [result as T]
  } catch (error) {
    // Check if it's a "not in Tauri context" error
    if (
      error instanceof Error &&
      error.message === 'Database only available in Tauri context'
    ) {
      // Re-throw this specific error so callers can handle it
      throw error
    }
    // For other errors, log and return empty array (legacy behavior for backwards compat)
    console.error('[Database] Select error:', {
      sql: sql.substring(0, 200),
      params,
      error: error instanceof Error ? error.message : String(error),
    })
    return [] as T[]
  }
}
