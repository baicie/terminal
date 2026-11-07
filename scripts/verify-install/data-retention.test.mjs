import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const run = promisify(execFile)
const harness = path.resolve(import.meta.dirname, 'data-retention.mjs')
const sqlite3 = process.env.SQLITE3 || 'sqlite3'

const nodeFlag = (() => {
  try {
    execFileSync(process.execPath, ['-e', 'require("node:sqlite")'], {
      stdio: 'ignore',
    })
    return []
  } catch {
    return ['--experimental-sqlite']
  }
})()

async function dr(args) {
  return run(process.execPath, [...nodeFlag, harness, ...args])
}

function sql(dbPath, statements) {
  execFileSync(sqlite3, [dbPath], { input: statements })
}

const OLD_SCHEMA = `
CREATE TABLE hosts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL,
  port INTEGER DEFAULT 22, username TEXT NOT NULL, auth_type TEXT DEFAULT 'password',
  password TEXT, private_key TEXT, certificate TEXT, group_id TEXT,
  is_favorite INTEGER DEFAULT 0, color TEXT, tags TEXT, port_forwards TEXT,
  startup_command TEXT, environment TEXT, jump_host_id TEXT, jump_host_auth_type TEXT,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT, color TEXT,
  "order" INTEGER DEFAULT 0, is_active INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE workspace_layouts (
  workspace_id TEXT PRIMARY KEY, layout_data TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE teams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL,
  mode TEXT DEFAULT 'local', endpoint TEXT, api_token TEXT, auto_sync INTEGER DEFAULT 0,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE team_members (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT,
  user_email TEXT, role TEXT DEFAULT 'member', joined_at INTEGER,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE, UNIQUE(team_id, user_id)
);
CREATE TABLE team_shared_hosts (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, host_data TEXT NOT NULL,
  shared_by TEXT NOT NULL, permission TEXT DEFAULT 'readonly', created_at INTEGER,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);
CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, team_id TEXT NOT NULL, type TEXT NOT NULL,
  resource TEXT NOT NULL, resource_id TEXT NOT NULL, data TEXT, status TEXT DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0, error TEXT, created_at INTEGER, synced_at INTEGER
);
CREATE TABLE user_profile (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER, updated_at INTEGER
);
`

async function withUpgradeFixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'upgrade-retention-'))
  const db = path.join(root, 'terminal.db')
  const vault = path.join(root, 'config', 'terminal', 'vault.json')
  const before = path.join(root, 'before.json')
  const backups = path.join(root, 'backups')
  try {
    sql(db, OLD_SCHEMA)
    await mkdir(backups, { recursive: true })
    await callback({ root, db, vault, before, backups })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('seeds an older schema without the new hosts columns', async () => {
  await withUpgradeFixture(async ({ db, vault }) => {
    const result = await dr([
      'seed', '--db', db, '--token', 'upgrade-token', '--vault', vault, '--compatible',
    ])
    assert.match(result.stdout, /seeded hosts row/)
    assert.match(result.stdout, /seeded team sync rows: teams, team_members, team_shared_hosts, sync_queue, user_profile/)
    const teamCount = execFileSync(sqlite3, [
      db, "SELECT COUNT(*) FROM teams WHERE id = 'phase95-team-upgrade-token'",
    ], { encoding: 'utf8' }).trim()
    assert.equal(teamCount, '1')
    const columns = execFileSync(sqlite3, [
      db,
      "SELECT name FROM pragma_table_info('hosts') WHERE name IN ('agent_forwarding','shell_integration')",
    ], { encoding: 'utf8' }).trim()
    assert.equal(columns, '')
    const host = execFileSync(sqlite3, [
      db,
      "SELECT COUNT(*) FROM hosts WHERE id = 'phase89-host-upgrade-token'",
    ], { encoding: 'utf8' }).trim()
    assert.equal(host, '1')
  })
})

test('verifies an upgraded schema while preserving every old column', async () => {
  await withUpgradeFixture(async ({ db, vault, before }) => {
    await dr([
      'seed', '--db', db, '--token', 'upgrade-token', '--vault', vault, '--compatible',
    ])
    await dr([
      'snapshot', '--db', db, '--token', 'upgrade-token', '--vault', vault, '--out', before,
    ])
    sql(
      db,
      "ALTER TABLE hosts ADD COLUMN agent_forwarding INTEGER DEFAULT 0; ALTER TABLE hosts ADD COLUMN shell_integration TEXT DEFAULT 'off';",
    )
    const result = await dr([
      'verify', '--db', db,
      '--before', before,
      '--token', 'upgrade-token',
      '--vault', vault,
      '--expected-new-host-columns', 'agent_forwarding,shell_integration',
      '--allow-settings-migration',
    ])
    assert.match(result.stdout, /new hosts column "agent_forwarding" was added/)
    assert.match(result.stdout, /hosts\.shell_integration after upgrade = "off"/)
  })
})

test('fails when an old seeded row is dropped during the upgrade', async () => {
  await withUpgradeFixture(async ({ db, vault, before }) => {
    await dr([
      'seed', '--db', db, '--token', 'upgrade-token', '--vault', vault, '--compatible',
    ])
    await dr([
      'snapshot', '--db', db, '--token', 'upgrade-token', '--vault', vault, '--out', before,
    ])
    sql(db, "DELETE FROM hosts WHERE id = 'phase89-host-upgrade-token'")
    await assert.rejects(
      dr([
        'verify', '--db', db, '--before', before, '--token', 'upgrade-token',
        '--vault', vault, '--allow-settings-migration',
      ]),
    )
  })
})

test('waits for the expected migration columns and integrity', async () => {
  await withUpgradeFixture(async ({ db }) => {
    await assert.rejects(
      dr([
        'wait', '--db', db, '--mode', 'migration-columns',
        '--expect-columns', 'hosts:agent_forwarding,shell_integration',
        '--timeout', '1',
      ]),
    )
    sql(
      db,
      "ALTER TABLE hosts ADD COLUMN agent_forwarding INTEGER DEFAULT 0; ALTER TABLE hosts ADD COLUMN shell_integration TEXT DEFAULT 'off';",
    )
    const result = await dr([
      'wait', '--db', db, '--mode', 'migration-columns',
      '--expect-columns', 'hosts:agent_forwarding,shell_integration',
      '--timeout', '2',
    ])
    assert.match(result.stdout, /B migrated the schema/)
  })
})

test('verifies the pre-migration backup is readable', async () => {
  await withUpgradeFixture(async ({ db, vault, backups }) => {
    await dr([
      'seed', '--db', db, '--token', 'upgrade-token', '--vault', vault, '--compatible',
    ])
    const snapshot = path.join(backups, 'pre-migration-1750000000000.db')
    await copyFile(db, snapshot)
    const out = path.join(backups, 'verification.json')
    const result = await dr([
      'backup-verify', '--dir', backups, '--token', 'upgrade-token', '--out', out,
    ])
    assert.match(result.stdout, /backup integrity_check => ok/)
    const report = JSON.parse(await readFile(out, 'utf8'))
    assert.equal(report.newest, 'pre-migration-1750000000000.db')
    assert.equal(report.hostReadable, true)
    assert.equal(report.workspaceReadable, true)
  })
})
