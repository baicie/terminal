import type { SSHOutput } from '@/service/ssh'
import type { Host } from '@/types'
import { isTauri } from '@tauri-apps/api/core'
import Database from '@tauri-apps/plugin-sql'

// Re-export types for convenience
export type { Host, SSHOutput }

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

async function configureSqlite() {
  const database = db!
  // Enable WAL mode for better concurrent access
  await database.execute('PRAGMA journal_mode=WAL')
  // Set busy timeout to wait for locks (30 seconds for Tauri dev mode)
  await database.execute('PRAGMA busy_timeout=30000')
  // Optimize for performance
  await database.execute('PRAGMA synchronous=NORMAL')
  await database.execute('PRAGMA cache_size=10000')
}

async function initSchema() {
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

  // SSH Keys table for Keychain
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

  // Connection logs table
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
      FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE SET NULL
    )
  `)

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_connection_logs_started_at ON connection_logs(started_at DESC)
  `)

  // Scripts table for advanced scripting
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

  // Script executions table
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

  // Team collaboration tables
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

  await database.execute(
    `CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id)`,
  )
  await database.execute(
    `CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id)`,
  )
  await database.execute(
    `CREATE INDEX IF NOT EXISTS idx_team_shared_hosts_team_id ON team_shared_hosts(team_id)`,
  )
  await database.execute(
    `CREATE INDEX IF NOT EXISTS idx_team_shared_snippets_team_id ON team_shared_snippets(team_id)`,
  )
  await database.execute(
    `CREATE INDEX IF NOT EXISTS idx_team_invites_team_id ON team_invites(team_id)`,
  )
  await database.execute(
    `CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)`,
  )
}

export async function executeQuery(sql: string, params: unknown[] = []) {
  const database = await getDb()
  return database.execute(sql, params)
}

export async function select<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const database = await getDb()
  return database.select(sql, params)
}

// Host Operations
export async function getHosts(): Promise<Host[]> {
  const database = await getDb()
  return database.select<Host[]>('SELECT * FROM hosts ORDER BY name')
}

// Command History Operations
export interface CommandHistoryRecord {
  id?: number
  host_id: string
  command: string
  executed_at: number
  session_id?: string
}

export async function addCommandHistory(
  record: Omit<CommandHistoryRecord, 'id'>,
) {
  const database = await getDb()
  await database.execute(
    'INSERT INTO command_history (host_id, command, executed_at, session_id) VALUES (?, ?, ?, ?)',
    [
      record.host_id,
      record.command,
      record.executed_at,
      record.session_id || null,
    ],
  )
}

export async function getCommandHistory(
  hostId?: string,
  limit = 100,
): Promise<CommandHistoryRecord[]> {
  const database = await getDb()
  if (hostId) {
    return database.select(
      'SELECT * FROM command_history WHERE host_id = ? ORDER BY executed_at DESC LIMIT ?',
      [hostId, limit],
    )
  }
  return database.select(
    'SELECT * FROM command_history ORDER BY executed_at DESC LIMIT ?',
    [limit],
  )
}

export async function searchCommandHistory(
  query: string,
  limit = 20,
): Promise<CommandHistoryRecord[]> {
  const database = await getDb()
  return database.select(
    'SELECT * FROM command_history WHERE command LIKE ? ORDER BY executed_at DESC LIMIT ?',
    [`%${query}%`, limit],
  )
}

export async function clearCommandHistory(hostId?: string) {
  const database = await getDb()
  if (hostId) {
    await database.execute('DELETE FROM command_history WHERE host_id = ?', [
      hostId,
    ])
  } else {
    await database.execute('DELETE FROM command_history')
  }
}

// Known Hosts Operations
export interface KnownHostRecord {
  id: string
  hostname: string
  port: number
  fingerprint: string
  key_type: string | null
  added_at: number
}

export async function addKnownHost(
  host: Omit<KnownHostRecord, 'id'>,
): Promise<string> {
  const database = await getDb()
  const id = crypto.randomUUID()
  await database.execute(
    `INSERT INTO known_hosts (id, hostname, port, fingerprint, key_type, added_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      host.hostname,
      host.port,
      host.fingerprint,
      host.key_type,
      host.added_at,
    ],
  )
  return id
}

export async function addKnownHosts(
  hosts: Omit<KnownHostRecord, 'id'>[],
): Promise<void> {
  const database = await getDb()
  for (const host of hosts) {
    // Check if already exists
    const existing = await database.select<KnownHostRecord[]>(
      'SELECT * FROM known_hosts WHERE hostname = ? AND port = ?',
      [host.hostname, host.port],
    )
    if (existing.length === 0) {
      const id = crypto.randomUUID()
      await database.execute(
        `INSERT INTO known_hosts (id, hostname, port, fingerprint, key_type, added_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          host.hostname,
          host.port,
          host.fingerprint,
          host.key_type,
          host.added_at,
        ],
      )
    }
  }
}

export async function deleteKnownHost(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM known_hosts WHERE id = ?', [id])
}

export async function clearAllKnownHosts(): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM known_hosts')
}

export async function getKnownHosts(): Promise<KnownHostRecord[]> {
  const database = await getDb()
  return database.select('SELECT * FROM known_hosts ORDER BY added_at DESC')
}

export async function searchKnownHosts(
  query: string,
): Promise<KnownHostRecord[]> {
  const database = await getDb()
  return database.select(
    'SELECT * FROM known_hosts WHERE hostname LIKE ? ORDER BY added_at DESC LIMIT 50',
    [`%${query}%`],
  )
}

// Snippet Operations
export interface SnippetRecord {
  id: string
  name: string
  description?: string
  script: string
  package_id?: string
  tags?: string
  variables?: string
}

export interface SnippetPackageRecord {
  id: string
  name: string
  description?: string
}

export async function createSnippet(snippet: SnippetRecord) {
  const database = await getDb()
  await database.execute(
    'INSERT INTO snippets (id, name, description, script, package_id, tags, variables) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      snippet.id,
      snippet.name,
      snippet.description || null,
      snippet.script,
      snippet.package_id || null,
      snippet.tags || null,
      snippet.variables || null,
    ],
  )
}

export async function updateSnippet(snippet: SnippetRecord) {
  const database = await getDb()
  await database.execute(
    'UPDATE snippets SET name = ?, description = ?, script = ?, package_id = ?, tags = ?, variables = ? WHERE id = ?',
    [
      snippet.name,
      snippet.description || null,
      snippet.script,
      snippet.package_id || null,
      snippet.tags || null,
      snippet.variables || null,
      snippet.id,
    ],
  )
}

export async function deleteSnippet(id: string) {
  const database = await getDb()
  await database.execute('DELETE FROM snippets WHERE id = ?', [id])
}

export async function getSnippets(
  packageId?: string,
): Promise<SnippetRecord[]> {
  const database = await getDb()
  if (packageId) {
    return database.select(
      'SELECT * FROM snippets WHERE package_id = ? ORDER BY name',
      [packageId],
    )
  }
  return database.select('SELECT * FROM snippets ORDER BY name')
}

export async function getSnippetById(
  id: string,
): Promise<SnippetRecord | null> {
  const database = await getDb()
  const results = await database.select<SnippetRecord[]>(
    'SELECT * FROM snippets WHERE id = ?',
    [id],
  )
  return results[0] || null
}

export async function searchSnippets(query: string): Promise<SnippetRecord[]> {
  const database = await getDb()
  return database.select(
    'SELECT * FROM snippets WHERE name LIKE ? OR description LIKE ? OR script LIKE ? ORDER BY name LIMIT 50',
    [`%${query}%`, `%${query}%`, `%${query}%`],
  )
}

// Snippet Package Operations
export async function createSnippetPackage(pkg: SnippetPackageRecord) {
  const database = await getDb()
  await database.execute(
    'INSERT INTO snippet_packages (id, name, description) VALUES (?, ?, ?)',
    [pkg.id, pkg.name, pkg.description || null],
  )
}

export async function deleteSnippetPackage(id: string) {
  const database = await getDb()
  await database.execute('DELETE FROM snippet_packages WHERE id = ?', [id])
}

export async function getSnippetPackages(): Promise<SnippetPackageRecord[]> {
  const database = await getDb()
  return database.select('SELECT * FROM snippet_packages ORDER BY name')
}

// SSH Keys (Keychain) Operations
export interface SSHKeyRecord {
  id: string
  name: string
  key_type: string | null
  private_key: string | null
  public_key: string | null
  certificate: string | null
  passphrase: string | null
  is_encrypted: number
  created_at: number
  updated_at: number
}

export async function createSSHKey(
  key: Omit<SSHKeyRecord, 'created_at' | 'updated_at'>,
): Promise<string> {
  const database = await getDb()
  const now = Date.now()
  await database.execute(
    `INSERT INTO ssh_keys (id, name, key_type, private_key, public_key, certificate, passphrase, is_encrypted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      key.id,
      key.name,
      key.key_type,
      key.private_key,
      key.public_key,
      key.certificate,
      key.passphrase,
      key.is_encrypted,
      now,
      now,
    ],
  )
  return key.id
}

export async function updateSSHKey(
  id: string,
  updates: Partial<SSHKeyRecord>,
): Promise<void> {
  const database = await getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.key_type !== undefined) {
    fields.push('key_type = ?')
    values.push(updates.key_type)
  }
  if (updates.private_key !== undefined) {
    fields.push('private_key = ?')
    values.push(updates.private_key)
  }
  if (updates.public_key !== undefined) {
    fields.push('public_key = ?')
    values.push(updates.public_key)
  }
  if (updates.certificate !== undefined) {
    fields.push('certificate = ?')
    values.push(updates.certificate)
  }
  if (updates.passphrase !== undefined) {
    fields.push('passphrase = ?')
    values.push(updates.passphrase)
  }
  if (updates.is_encrypted !== undefined) {
    fields.push('is_encrypted = ?')
    values.push(updates.is_encrypted)
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)
    await database.execute(
      `UPDATE ssh_keys SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

export async function deleteSSHKey(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM ssh_keys WHERE id = ?', [id])
}

export async function getSSHKeys(): Promise<SSHKeyRecord[]> {
  const database = await getDb()
  return database.select('SELECT * FROM ssh_keys ORDER BY name')
}

export async function getSSHKeyById(id: string): Promise<SSHKeyRecord | null> {
  const database = await getDb()
  const results = await database.select<SSHKeyRecord[]>(
    'SELECT * FROM ssh_keys WHERE id = ?',
    [id],
  )
  return results[0] || null
}

export async function searchSSHKeys(query: string): Promise<SSHKeyRecord[]> {
  const database = await getDb()
  return database.select(
    'SELECT * FROM ssh_keys WHERE name LIKE ? ORDER BY name LIMIT 50',
    [`%${query}%`],
  )
}

// Settings Operations
export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  language: string
  fontSize: number
  fontFamily: string
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
  copyOnSelect: boolean
  pasteOnMiddleClick: boolean
  allowProposedApi: boolean
  dataStorageMode: 'local' | 'service'
  syncServiceType: 'webdav' | 's3' | 'custom'
  syncServiceEndpoint: string
  syncServiceUsername: string
  syncServiceToken: string
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  language: 'en',
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  copyOnSelect: false,
  pasteOnMiddleClick: true,
  allowProposedApi: true,
  dataStorageMode: 'local',
  syncServiceType: 'webdav',
  syncServiceEndpoint: '',
  syncServiceUsername: '',
  syncServiceToken: '',
}

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const database = await getDb()
  const results = await database.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  )
  if (results.length === 0) {
    return defaultValue
  }
  try {
    return JSON.parse(results[0].value) as T
  } catch {
    return defaultValue
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const database = await getDb()
  const jsonValue = JSON.stringify(value)
  await database.execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, jsonValue],
  )
}

export async function getAppSettings(): Promise<AppSettings> {
  const settings = await getSetting('app_settings', defaultSettings)
  return { ...defaultSettings, ...settings }
}

export async function saveAppSettings(
  settings: Partial<AppSettings>,
): Promise<void> {
  const current = await getAppSettings()
  const merged = { ...current, ...settings }
  await setSetting('app_settings', merged)
}

// Workspace Operations
export interface WorkspaceRecord {
  id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  order: number
  is_active: number
  created_at: number
  updated_at: number
}

export async function createWorkspace(
  workspace: WorkspaceRecord,
): Promise<void> {
  const database = await getDb()
  await database.execute(
    'INSERT INTO workspaces (id, name, description, icon, color, "order", is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      workspace.id,
      workspace.name,
      workspace.description,
      workspace.icon,
      workspace.color,
      workspace.order,
      workspace.is_active,
      workspace.created_at,
      workspace.updated_at,
    ],
  )
}

export async function updateWorkspace(
  id: string,
  updates: Partial<WorkspaceRecord>,
): Promise<void> {
  const database = await getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.description !== undefined) {
    fields.push('description = ?')
    values.push(updates.description)
  }
  if (updates.icon !== undefined) {
    fields.push('icon = ?')
    values.push(updates.icon)
  }
  if (updates.color !== undefined) {
    fields.push('color = ?')
    values.push(updates.color)
  }
  if (updates.order !== undefined) {
    fields.push('"order" = ?')
    values.push(updates.order)
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?')
    values.push(updates.is_active)
  }
  if (updates.updated_at !== undefined) {
    fields.push('updated_at = ?')
    values.push(updates.updated_at)
  }

  if (fields.length > 0) {
    values.push(id)
    await database.execute(
      `UPDATE workspaces SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

export async function deleteWorkspace(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM workspaces WHERE id = ?', [id])
}

export async function getWorkspaces(): Promise<WorkspaceRecord[]> {
  const database = await getDb()
  return database.select('SELECT * FROM workspaces ORDER BY "order"')
}

export async function getActiveWorkspace(): Promise<WorkspaceRecord | null> {
  const database = await getDb()
  const results = await database.select<WorkspaceRecord[]>(
    'SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1',
  )
  return results[0] || null
}

export async function setActiveWorkspace(id: string): Promise<void> {
  const database = await getDb()
  // Deactivate all workspaces first
  await database.execute('UPDATE workspaces SET is_active = 0')
  // Activate the selected one
  await database.execute('UPDATE workspaces SET is_active = 1 WHERE id = ?', [
    id,
  ])
}

// Workspace Layout Operations
export interface WorkspaceLayoutRecord {
  workspace_id: string
  layout_data: string // JSON string of layout
}

export async function saveWorkspaceLayout(
  workspaceId: string,
  layoutData: unknown,
): Promise<void> {
  const database = await getDb()
  const jsonData = JSON.stringify(layoutData)
  await database.execute(
    'INSERT OR REPLACE INTO workspace_layouts (workspace_id, layout_data) VALUES (?, ?)',
    [workspaceId, jsonData],
  )
}

export async function getWorkspaceLayout(
  workspaceId: string,
): Promise<WorkspaceLayoutRecord | null> {
  const database = await getDb()
  const results = await database.select<WorkspaceLayoutRecord[]>(
    'SELECT * FROM workspace_layouts WHERE workspace_id = ?',
    [workspaceId],
  )
  return results[0] || null
}

// Connection Log Operations
export interface ConnectionLogRecord {
  id: string
  host_id: string | null
  host_name: string
  host_address: string
  username: string | null
  connection_type: 'ssh' | 'local' | 'serial'
  started_at: number
  ended_at: number | null
  duration_seconds: number | null
  is_saved: number
  notes: string | null
}

export async function addConnectionLog(
  log: Omit<ConnectionLogRecord, 'id'>,
): Promise<string> {
  const database = await getDb()
  const id = crypto.randomUUID()
  await database.execute(
    `INSERT INTO connection_logs (id, host_id, host_name, host_address, username, connection_type, started_at, ended_at, duration_seconds, is_saved, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      log.host_id,
      log.host_name,
      log.host_address,
      log.username,
      log.connection_type,
      log.started_at,
      log.ended_at,
      log.duration_seconds,
      log.is_saved,
      log.notes,
    ],
  )
  return id
}

export async function updateConnectionLog(
  id: string,
  updates: Partial<ConnectionLogRecord>,
): Promise<void> {
  const database = await getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.ended_at !== undefined) {
    fields.push('ended_at = ?')
    values.push(updates.ended_at)
  }
  if (updates.duration_seconds !== undefined) {
    fields.push('duration_seconds = ?')
    values.push(updates.duration_seconds)
  }
  if (updates.is_saved !== undefined) {
    fields.push('is_saved = ?')
    values.push(updates.is_saved)
  }
  if (updates.notes !== undefined) {
    fields.push('notes = ?')
    values.push(updates.notes)
  }

  if (fields.length > 0) {
    values.push(id)
    await database.execute(
      `UPDATE connection_logs SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

export async function deleteConnectionLog(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM connection_logs WHERE id = ?', [id])
}

export async function clearConnectionLogs(): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM connection_logs WHERE is_saved = 0')
}

export async function getConnectionLogs(
  limit = 100,
): Promise<ConnectionLogRecord[]> {
  const database = await getDb()
  return database.select(
    'SELECT * FROM connection_logs ORDER BY started_at DESC LIMIT ?',
    [limit],
  )
}

export async function getConnectionLogsByHost(
  hostId: string,
): Promise<ConnectionLogRecord[]> {
  const database = await getDb()
  return database.select(
    'SELECT * FROM connection_logs WHERE host_id = ? ORDER BY started_at DESC',
    [hostId],
  )
}

export async function searchConnectionLogs(
  query: string,
): Promise<ConnectionLogRecord[]> {
  const database = await getDb()
  return database.select(
    'SELECT * FROM connection_logs WHERE host_name LIKE ? OR host_address LIKE ? OR username LIKE ? ORDER BY started_at DESC LIMIT 50',
    [`%${query}%`, `%${query}%`, `%${query}%`],
  )
}

export async function toggleConnectionLogSaved(id: string): Promise<void> {
  const database = await getDb()
  await database.execute(
    'UPDATE connection_logs SET is_saved = CASE WHEN is_saved = 1 THEN 0 ELSE 1 END WHERE id = ?',
    [id],
  )
}

// ============================================================
// Script Operations (Advanced Scripting - Scheduling & Batch)
// ============================================================

export interface ScriptRecord {
  id: string
  name: string
  description: string | null
  script: string
  host_ids: string // JSON array of host IDs
  schedule_type: 'manual' | 'once' | 'interval' | 'cron'
  schedule_value: string | null // cron expression or interval in ms
  enabled: number
  timeout_seconds: number
  retry_count: number
  created_at: number
  updated_at: number
}

export interface ScriptExecutionRecord {
  id: string
  script_id: string
  script_name: string
  host_id: string | null
  host_name: string | null
  host_address: string | null
  status: 'running' | 'success' | 'failed' | 'timeout'
  output: string | null
  error: string | null
  started_at: number
  ended_at: number | null
  duration_ms: number | null
}

export async function createScript(script: ScriptRecord): Promise<string> {
  const database = await getDb()
  await database.execute(
    `INSERT INTO scripts (id, name, description, script, host_ids, schedule_type, schedule_value, enabled, timeout_seconds, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      script.id,
      script.name,
      script.description,
      script.script,
      script.host_ids,
      script.schedule_type,
      script.schedule_value,
      script.enabled,
      script.timeout_seconds,
      script.retry_count,
      script.created_at,
      script.updated_at,
    ],
  )
  return script.id
}

export async function updateScript(script: ScriptRecord): Promise<void> {
  const database = await getDb()
  await database.execute(
    `UPDATE scripts SET name = ?, description = ?, script = ?, host_ids = ?, schedule_type = ?, schedule_value = ?, enabled = ?, timeout_seconds = ?, retry_count = ?, updated_at = ?
     WHERE id = ?`,
    [
      script.name,
      script.description,
      script.script,
      script.host_ids,
      script.schedule_type,
      script.schedule_value,
      script.enabled,
      script.timeout_seconds,
      script.retry_count,
      script.updated_at,
      script.id,
    ],
  )
}

export async function deleteScript(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM scripts WHERE id = ?', [id])
}

export async function getScripts(): Promise<ScriptRecord[]> {
  const database = await getDb()
  return database.select('SELECT * FROM scripts ORDER BY name')
}

export async function getScriptById(id: string): Promise<ScriptRecord | null> {
  const database = await getDb()
  const results = await database.select<ScriptRecord[]>(
    'SELECT * FROM scripts WHERE id = ?',
    [id],
  )
  return results[0] || null
}

export async function getEnabledScripts(): Promise<ScriptRecord[]> {
  const database = await getDb()
  return database.select(
    'SELECT * FROM scripts WHERE enabled = 1 ORDER BY name',
  )
}

export async function searchScripts(query: string): Promise<ScriptRecord[]> {
  const database = await getDb()
  return database.select(
    'SELECT * FROM scripts WHERE name LIKE ? OR description LIKE ? ORDER BY name LIMIT 50',
    [`%${query}%`, `%${query}%`],
  )
}

export async function toggleScriptEnabled(id: string): Promise<void> {
  const database = await getDb()
  await database.execute(
    'UPDATE scripts SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?',
    [Date.now(), id],
  )
}

// Script Execution Operations
export async function addScriptExecution(
  execution: Omit<ScriptExecutionRecord, 'id'>,
): Promise<string> {
  const database = await getDb()
  const id = crypto.randomUUID()
  await database.execute(
    `INSERT INTO script_executions (id, script_id, script_name, host_id, host_name, host_address, status, output, error, started_at, ended_at, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      execution.script_id,
      execution.script_name,
      execution.host_id,
      execution.host_name,
      execution.host_address,
      execution.status,
      execution.output,
      execution.error,
      execution.started_at,
      execution.ended_at,
      execution.duration_ms,
    ],
  )
  return id
}

export async function updateScriptExecution(
  id: string,
  updates: Partial<ScriptExecutionRecord>,
): Promise<void> {
  const database = await getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
  }
  if (updates.output !== undefined) {
    fields.push('output = ?')
    values.push(updates.output)
  }
  if (updates.error !== undefined) {
    fields.push('error = ?')
    values.push(updates.error)
  }
  if (updates.ended_at !== undefined) {
    fields.push('ended_at = ?')
    values.push(updates.ended_at)
  }
  if (updates.duration_ms !== undefined) {
    fields.push('duration_ms = ?')
    values.push(updates.duration_ms)
  }

  if (fields.length > 0) {
    values.push(id)
    await database.execute(
      `UPDATE script_executions SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

export async function getScriptExecutions(
  scriptId?: string,
  limit = 100,
): Promise<ScriptExecutionRecord[]> {
  const database = await getDb()
  if (scriptId) {
    return database.select(
      'SELECT * FROM script_executions WHERE script_id = ? ORDER BY started_at DESC LIMIT ?',
      [scriptId, limit],
    )
  }
  return database.select(
    'SELECT * FROM script_executions ORDER BY started_at DESC LIMIT ?',
    [limit],
  )
}

export async function getScriptExecutionById(
  id: string,
): Promise<ScriptExecutionRecord | null> {
  const database = await getDb()
  const results = await database.select<ScriptExecutionRecord[]>(
    'SELECT * FROM script_executions WHERE id = ?',
    [id],
  )
  return results[0] || null
}

export async function deleteScriptExecution(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM script_executions WHERE id = ?', [id])
}

export async function clearScriptExecutions(scriptId?: string): Promise<void> {
  const database = await getDb()
  if (scriptId) {
    await database.execute(
      'DELETE FROM script_executions WHERE script_id = ?',
      [scriptId],
    )
  } else {
    await database.execute('DELETE FROM script_executions')
  }
}

// ============================================================
// Team Collaboration Database Operations
// ============================================================

// User Profile
export interface UserProfileRecord {
  id: string
  name: string
  created_at: number
  updated_at: number
}

export async function getUserProfile(): Promise<UserProfileRecord | null> {
  const database = await getDb()
  const results = await database.select<UserProfileRecord[]>(
    'SELECT * FROM user_profile LIMIT 1',
  )
  return results[0] || null
}

export async function createUserProfile(
  profile: UserProfileRecord,
): Promise<void> {
  const database = await getDb()
  await database.execute(
    'INSERT INTO user_profile (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [profile.id, profile.name, profile.created_at, profile.updated_at],
  )
}

export async function updateUserProfile(
  id: string,
  updates: Partial<UserProfileRecord>,
): Promise<void> {
  const database = await getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.updated_at !== undefined) {
    fields.push('updated_at = ?')
    values.push(updates.updated_at)
  }

  if (fields.length > 0) {
    values.push(id)
    await database.execute(
      `UPDATE user_profile SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

// Teams
export interface TeamRecord {
  id: string
  name: string
  owner_id: string
  mode: string
  endpoint?: string
  api_token?: string
  auto_sync: number
  created_at: number
  updated_at: number
}

export async function getTeams(): Promise<TeamRecord[]> {
  const database = await getDb()
  return database.select<TeamRecord[]>('SELECT * FROM teams ORDER BY name')
}

export async function getTeamById(id: string): Promise<TeamRecord | null> {
  const database = await getDb()
  const results = await database.select<TeamRecord[]>(
    'SELECT * FROM teams WHERE id = ?',
    [id],
  )
  return results[0] || null
}

export async function createTeam(team: TeamRecord): Promise<void> {
  const database = await getDb()
  await database.execute(
    `INSERT INTO teams (id, name, owner_id, mode, endpoint, api_token, auto_sync, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      team.id,
      team.name,
      team.owner_id,
      team.mode,
      team.endpoint || null,
      team.api_token || null,
      team.auto_sync,
      team.created_at,
      team.updated_at,
    ],
  )
}

export async function updateTeam(
  id: string,
  updates: Partial<{
    name: string
    mode: string
    endpoint: string
    api_token: string
    auto_sync: number
    updated_at: number
  }>,
): Promise<void> {
  const database = await getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.mode !== undefined) {
    fields.push('mode = ?')
    values.push(updates.mode)
  }
  if (updates.endpoint !== undefined) {
    fields.push('endpoint = ?')
    values.push(updates.endpoint)
  }
  if (updates.api_token !== undefined) {
    fields.push('api_token = ?')
    values.push(updates.api_token)
  }
  if (updates.auto_sync !== undefined) {
    fields.push('auto_sync = ?')
    values.push(updates.auto_sync)
  }
  if (updates.updated_at !== undefined) {
    fields.push('updated_at = ?')
    values.push(updates.updated_at)
  }

  if (fields.length > 0) {
    values.push(id)
    await database.execute(
      `UPDATE teams SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

export async function deleteTeam(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM teams WHERE id = ?', [id])
}

// Team Members
export interface TeamMemberRecord {
  id: string
  team_id: string
  user_id: string
  user_name?: string
  user_email?: string
  role: string
  joined_at: number
}

export async function getTeamMembers(
  teamId: string,
): Promise<TeamMemberRecord[]> {
  const database = await getDb()
  return database.select<TeamMemberRecord[]>(
    'SELECT * FROM team_members WHERE team_id = ? ORDER BY joined_at',
    [teamId],
  )
}

export async function addTeamMember(member: TeamMemberRecord): Promise<void> {
  const database = await getDb()
  await database.execute(
    `INSERT INTO team_members (id, team_id, user_id, user_name, user_email, role, joined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      member.id,
      member.team_id,
      member.user_id,
      member.user_name || null,
      member.user_email || null,
      member.role,
      member.joined_at,
    ],
  )
}

export async function removeTeamMember(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM team_members WHERE id = ?', [id])
}

export async function updateTeamMember(
  id: string,
  updates: Partial<{ role: string }>,
): Promise<void> {
  const database = await getDb()
  if (updates.role) {
    await database.execute('UPDATE team_members SET role = ? WHERE id = ?', [
      updates.role,
      id,
    ])
  }
}

// Shared Hosts
export interface TeamSharedHostRecord {
  id: string
  team_id: string
  host_data: string
  shared_by: string
  permission: string
  created_at: number
}

export async function getSharedHosts(
  teamId: string,
): Promise<TeamSharedHostRecord[]> {
  const database = await getDb()
  return database.select<TeamSharedHostRecord[]>(
    'SELECT * FROM team_shared_hosts WHERE team_id = ? ORDER BY created_at DESC',
    [teamId],
  )
}

export async function addSharedHost(host: TeamSharedHostRecord): Promise<void> {
  const database = await getDb()
  await database.execute(
    `INSERT INTO team_shared_hosts (id, team_id, host_data, shared_by, permission, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      host.id,
      host.team_id,
      host.host_data,
      host.shared_by,
      host.permission,
      host.created_at,
    ],
  )
}

export async function removeSharedHost(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM team_shared_hosts WHERE id = ?', [id])
}

// Shared Snippets
export interface TeamSharedSnippetRecord {
  id: string
  team_id: string
  snippet_data: string
  shared_by: string
  permission: string
  created_at: number
}

export async function getSharedSnippets(
  teamId: string,
): Promise<TeamSharedSnippetRecord[]> {
  const database = await getDb()
  return database.select<TeamSharedSnippetRecord[]>(
    'SELECT * FROM team_shared_snippets WHERE team_id = ? ORDER BY created_at DESC',
    [teamId],
  )
}

export async function addSharedSnippet(
  snippet: TeamSharedSnippetRecord,
): Promise<void> {
  const database = await getDb()
  await database.execute(
    `INSERT INTO team_shared_snippets (id, team_id, snippet_data, shared_by, permission, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      snippet.id,
      snippet.team_id,
      snippet.snippet_data,
      snippet.shared_by,
      snippet.permission,
      snippet.created_at,
    ],
  )
}

export async function removeSharedSnippet(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM team_shared_snippets WHERE id = ?', [id])
}

// Team Invites
export interface TeamInviteRecord {
  id: string
  team_id: string
  type: string
  code?: string
  link_token?: string
  email?: string
  role: string
  created_by: string
  expires_at: number
  used_at?: number
  created_at: number
}

export async function getTeamInvites(
  teamId: string,
): Promise<TeamInviteRecord[]> {
  const database = await getDb()
  return database.select<TeamInviteRecord[]>(
    'SELECT * FROM team_invites WHERE team_id = ? ORDER BY created_at DESC',
    [teamId],
  )
}

export async function createTeamInvite(
  invite: TeamInviteRecord,
): Promise<void> {
  const database = await getDb()
  await database.execute(
    `INSERT INTO team_invites (id, team_id, type, code, link_token, email, role, created_by, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invite.id,
      invite.team_id,
      invite.type,
      invite.code || null,
      invite.link_token || null,
      invite.email || null,
      invite.role,
      invite.created_by,
      invite.expires_at,
      invite.used_at || null,
      invite.created_at,
    ],
  )
}

export async function deleteTeamInvite(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('DELETE FROM team_invites WHERE id = ?', [id])
}

export async function getTeamInviteByCode(
  code: string,
): Promise<TeamInviteRecord | null> {
  const database = await getDb()
  const results = await database.select<TeamInviteRecord[]>(
    'SELECT * FROM team_invites WHERE code = ? AND expires_at > ? AND used_at IS NULL',
    [code, Date.now()],
  )
  return results[0] || null
}

export async function getTeamInviteByToken(
  token: string,
): Promise<TeamInviteRecord | null> {
  const database = await getDb()
  const results = await database.select<TeamInviteRecord[]>(
    'SELECT * FROM team_invites WHERE link_token = ? AND expires_at > ? AND used_at IS NULL',
    [token, Date.now()],
  )
  return results[0] || null
}

export async function markInviteUsed(id: string): Promise<void> {
  const database = await getDb()
  await database.execute('UPDATE team_invites SET used_at = ? WHERE id = ?', [
    Date.now(),
    id,
  ])
}

// Team Audit Logs
export interface TeamAuditLogRecord {
  id: string
  team_id: string
  user_id: string
  user_name?: string
  host_name?: string
  action: string
  details?: string
  created_at: number
}

export async function getTeamAuditLogs(
  teamId: string,
  limit = 100,
): Promise<TeamAuditLogRecord[]> {
  const database = await getDb()
  return database.select<TeamAuditLogRecord[]>(
    'SELECT * FROM team_audit_logs WHERE team_id = ? ORDER BY created_at DESC LIMIT ?',
    [teamId, limit],
  )
}

export async function addTeamAuditLog(log: TeamAuditLogRecord): Promise<void> {
  const database = await getDb()
  await database.execute(
    `INSERT INTO team_audit_logs (id, team_id, user_id, user_name, host_name, action, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.team_id,
      log.user_id,
      log.user_name || null,
      log.host_name || null,
      log.action,
      log.details || null,
      log.created_at,
    ],
  )
}

// Sync Queue
export interface SyncQueueRecord {
  id: string
  user_id: string
  team_id: string
  type: string
  resource: string
  resource_id: string
  data?: string
  status: string
  retry_count: number
  error?: string
  created_at: number
  synced_at?: number
}

export async function getPendingSyncItems(): Promise<SyncQueueRecord[]> {
  const database = await getDb()
  return database.select<SyncQueueRecord[]>(
    "SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at",
  )
}

export async function addSyncQueueItem(item: SyncQueueRecord): Promise<void> {
  const database = await getDb()
  await database.execute(
    `INSERT INTO sync_queue (id, user_id, team_id, type, resource, resource_id, data, status, retry_count, error, created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.user_id,
      item.team_id,
      item.type,
      item.resource,
      item.resource_id,
      item.data || null,
      item.status,
      item.retry_count,
      item.error || null,
      item.created_at,
      item.synced_at || null,
    ],
  )
}

export async function updateSyncQueueItem(
  id: string,
  updates: Partial<{
    status: string
    retry_count: number
    error: string
    synced_at: number
  }>,
): Promise<void> {
  const database = await getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
  }
  if (updates.retry_count !== undefined) {
    fields.push('retry_count = ?')
    values.push(updates.retry_count)
  }
  if (updates.error !== undefined) {
    fields.push('error = ?')
    values.push(updates.error)
  }
  if (updates.synced_at !== undefined) {
    fields.push('synced_at = ?')
    values.push(updates.synced_at)
  }

  if (fields.length > 0) {
    values.push(id)
    await database.execute(
      `UPDATE sync_queue SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}
