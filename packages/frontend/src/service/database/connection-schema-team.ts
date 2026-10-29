import type { SqliteConnection } from './connection-schema-core'

const teamSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, mode TEXT DEFAULT 'local', endpoint TEXT, api_token TEXT, auto_sync INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS team_members (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT, user_email TEXT, role TEXT DEFAULT 'member', joined_at INTEGER, FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE, UNIQUE(team_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS team_shared_hosts (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, host_data TEXT NOT NULL, shared_by TEXT NOT NULL, permission TEXT DEFAULT 'readonly', created_at INTEGER, FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS team_shared_snippets (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, snippet_data TEXT NOT NULL, shared_by TEXT NOT NULL, permission TEXT DEFAULT 'readonly', created_at INTEGER, FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE)`,
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

export async function initializeTeamSchema(
  database: SqliteConnection,
): Promise<void> {
  for (const statement of teamSchemaStatements)
    await database.execute(statement)
}
