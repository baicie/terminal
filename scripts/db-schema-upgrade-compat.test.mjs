/**
 * Phase 8.8 Task E2 - database upgrade compatibility.
 *
 * The migration layer lives on the frontend (`connection-schema-core.ts` /
 * `connection-schema-team.ts`) and is purely additive: `CREATE TABLE IF NOT
 * EXISTS` plus `ALTER TABLE ... ADD COLUMN` statements that fail harmlessly on
 * databases that already carry the column. These tests drive that real code
 * against real SQLite files (`node:sqlite`, no mocks, no in-memory fakes) so the
 * upgrade paths that ship in the app are the ones under test.
 *
 * The "legacy" shape used below is the current schema minus the columns the
 * migrations add incrementally - that ALTER list is the only record this repo
 * keeps of an older on-disk layout.
 *
 * Requires Node >= 22.18 (TypeScript type stripping, for importing the `.ts`
 * migration source) and `node:sqlite`. CI pins .node-version 24.x, so no flags
 * are needed there.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

// `node:sqlite` needs a flag before Node 22.18 and the migration sources are
// TypeScript, which needs type stripping. Both are present on the pinned
// .node-version (24.16) and absent on an older local runtime. Probe once and
// skip loudly instead of failing a gate on a Node the repo does not support -
// a hard red here would teach people to ignore the gate. The skip reason names
// the exact runtime, so a green run on an unsupported Node is never silent.
let DatabaseSync
let initializeCoreSchema
let initializeTeamSchema
let unsupported = false
try {
  ;({ DatabaseSync } = await import('node:sqlite'))
  ;({ initializeCoreSchema } = await import(
    '../packages/frontend/src/service/database/connection-schema-core.ts'
  ))
  ;({ initializeTeamSchema } = await import(
    '../packages/frontend/src/service/database/connection-schema-team.ts'
  ))
} catch (error) {
  const code = (error && typeof error === 'object' && 'code' in error ? error.code : null) ?? 'unknown'
  unsupported =
    'needs node:sqlite and TypeScript type stripping (pinned .node-version is 24.16); ' +
    'this runtime is ' + process.version + ' and failed with ' + String(code)
}

const workDir = mkdtempSync(join(tmpdir(), 'terminal-db-compat-'))
after(() => rmSync(workDir, { recursive: true, force: true }))

let fileSeq = 0
function dbFile(label) {
  fileSeq += 1
  return join(workDir, `${fileSeq}-${label}.db`)
}

/** Wraps a real SQLite handle in the shape the migration code consumes. */
function openDatabase(file) {
  const db = new DatabaseSync(file)
  const connection = {
    execute: async (sql, params = []) => {
      if (params.length > 0) db.prepare(sql).run(...params)
      else db.exec(sql)
    },
  }
  return { db, connection }
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c
}

function integrityCheck(db) {
  return db.prepare('PRAGMA integrity_check').get().integrity_check
}

const LEGACY_HOSTS = `CREATE TABLE hosts (id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL, port INTEGER DEFAULT 22, username TEXT NOT NULL, auth_type TEXT DEFAULT 'password', password TEXT, private_key TEXT, group_id TEXT, is_favorite INTEGER DEFAULT 0, color TEXT, tags TEXT, port_forwards TEXT, startup_command TEXT, environment TEXT, created_at INTEGER, updated_at INTEGER)`
const LEGACY_CONNECTION_LOGS = `CREATE TABLE connection_logs (id TEXT PRIMARY KEY, host_id TEXT, host_name TEXT NOT NULL, host_address TEXT NOT NULL, username TEXT, connection_type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, duration_seconds INTEGER, is_saved INTEGER DEFAULT 0, notes TEXT)`

/** Builds a database the way an older release left it, with rows in it. */
function seedLegacyDatabase(file) {
  const { db, connection } = openDatabase(file)
  db.exec(LEGACY_HOSTS)
  db.exec(LEGACY_CONNECTION_LOGS)
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)')
  db.exec(
    "INSERT INTO hosts (id, name, hostname, port, username, password, created_at, updated_at) VALUES ('h-legacy-1', 'prod', '10.0.0.5', 22, 'deploy', 'secret-1', 1700000000, 1700000001)",
  )
  db.exec(
    "INSERT INTO hosts (id, name, hostname, port, username, private_key, created_at, updated_at) VALUES ('h-legacy-2', 'staging', '10.0.0.6', 2222, 'deploy', 'key-material', 1700000002, 1700000003)",
  )
  db.exec(
    "INSERT INTO connection_logs (id, host_id, host_name, host_address, connection_type, started_at) VALUES ('log-legacy-1', 'h-legacy-1', 'prod', '10.0.0.5', 'ssh', 1700000010)",
  )
  db.exec("INSERT INTO settings (key, value) VALUES ('theme', 'dark')")
  return { db, connection }
}

async function seedCurrentDatabase(file) {
  const { db, connection } = openDatabase(file)
  db.exec('PRAGMA journal_mode=WAL')
  await initializeCoreSchema(connection)
  await initializeTeamSchema(connection)
  db.exec(
    "INSERT INTO hosts (id, name, hostname, port, username, created_at, updated_at) VALUES ('h-new-1', 'web', '192.0.2.10', 22, 'root', 1700000100, 1700000101)",
  )
  db.exec(
    "INSERT INTO connection_logs (id, host_id, host_name, host_address, connection_type, started_at) VALUES ('log-new-1', 'h-new-1', 'web', '192.0.2.10', 'ssh', 1700000110)",
  )
  db.exec("INSERT INTO settings (key, value) VALUES ('theme', 'system')")
  db.exec("INSERT INTO teams (id, name, owner_id) VALUES ('t-1', 'local', 'u-1')")
  return { db, connection }
}

describe('Phase 8.8 E2 - database upgrade compatibility (real SQLite files)', { skip: unsupported }, () => {
  it('upgrade snapshot: VACUUM INTO backup reopens with identical row counts', async () => {
    const file = dbFile('snapshot-live')
    const backupFile = dbFile('snapshot-backup')
    const { db } = await seedCurrentDatabase(file)

    db.exec(`VACUUM INTO '${backupFile}'`)

    assert.ok(statSync(backupFile).size > 0, 'backup file must not be empty')

    const backup = new DatabaseSync(backupFile)
    try {
      assert.equal(integrityCheck(backup), 'ok')
      for (const table of ['hosts', 'connection_logs', 'settings', 'teams']) {
        assert.equal(
          countRows(backup, table),
          countRows(db, table),
          `${table} row count must survive the snapshot`,
        )
      }
      assert.equal(
        backup.prepare("SELECT hostname FROM hosts WHERE id = 'h-new-1'").get()
          .hostname,
        '192.0.2.10',
      )
    } finally {
      backup.close()
      db.close()
    }
  })

  it('legacy database: current migrations keep every row and backfill defaults', async () => {
    const file = dbFile('legacy-upgrade')
    const seeded = seedLegacyDatabase(file)
    const hostsBefore = [
      seeded.db.prepare('SELECT id, name, hostname, password FROM hosts ORDER BY id').all(),
    ]
    seeded.db.close()

    const { db, connection } = openDatabase(file)
    try {
      await initializeCoreSchema(connection)
      // Idempotent: a second start must not fail on the columns it just added.
      await initializeCoreSchema(connection)

      assert.equal(integrityCheck(db), 'ok')
      assert.equal(countRows(db, 'hosts'), 2)
      assert.equal(countRows(db, 'connection_logs'), 1)
      assert.equal(
        db.prepare("SELECT value FROM settings WHERE key = 'theme'").get().value,
        'dark',
      )
      assert.deepEqual(
        db.prepare('SELECT id, name, hostname, password FROM hosts ORDER BY id').all(),
        hostsBefore[0],
        'pre-upgrade rows must be byte-identical',
      )

      const upgraded = db
        .prepare(
          "SELECT certificate, jump_host_id, jump_host_auth_type, agent_forwarding, shell_integration FROM hosts WHERE id = 'h-legacy-1'",
        )
        .get()
      assert.equal(upgraded.certificate, null)
      assert.equal(upgraded.jump_host_id, null)
      assert.equal(upgraded.jump_host_auth_type, null)
      assert.equal(upgraded.agent_forwarding, 0)
      assert.equal(upgraded.shell_integration, 'off')

      const upgradedLog = db
        .prepare("SELECT error_message, error_raw FROM connection_logs WHERE id = 'log-legacy-1'")
        .get()
      assert.equal(upgradedLog.error_message, null)
      assert.equal(upgradedLog.error_raw, null)

      // Tables the upgrade creates from scratch must exist and be usable.
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map(row => row.name),
      )
      for (const table of ['scripts', 'script_executions', 'workspaces', 'workspace_layouts', 'ssh_keys']) {
        assert.ok(tables.has(table), `missing table after upgrade: ${table}`)
      }

      // An old client's INSERT keeps working on the upgraded database.
      db.exec(
        "INSERT INTO hosts (id, name, hostname, port, username, created_at, updated_at) VALUES ('h-legacy-3', 'after-upgrade', '10.0.0.7', 22, 'deploy', 1700000200, 1700000201)",
      )
      assert.equal(countRows(db, 'hosts'), 3)
    } finally {
      db.close()
    }
  })

  it('old client on the new schema: legacy SELECT/INSERT stay valid and do not corrupt', async () => {
    const file = dbFile('old-client')
    const { db, connection } = await seedCurrentDatabase(file)
    try {
      // Statement set a release without the newer columns would issue.
      db.prepare(
        'SELECT id, name, hostname, port, username, auth_type, password, private_key, group_id, is_favorite FROM hosts WHERE id = ?',
      ).all('h-new-1')
      db.prepare('SELECT * FROM connection_logs WHERE host_id = ?').all('h-new-1')
      db.prepare('SELECT key, value FROM settings').all()
      db.prepare(
        "INSERT INTO hosts (id, name, hostname, port, username, created_at, updated_at) VALUES ('h-old-client', 'from-old-client', '192.0.2.20', 22, 'root', 1700000300, 1700000301)",
      ).run()
      db.prepare("UPDATE hosts SET name = 'renamed-by-old-client' WHERE id = 'h-old-client'").run()
      db.prepare(
        "INSERT INTO connection_logs (id, host_id, host_name, host_address, connection_type, started_at) VALUES ('log-old-client', 'h-old-client', 'from-old-client', '192.0.2.20', 'ssh', 1700000310)",
      ).run()

      const written = db
        .prepare(
          "SELECT name, agent_forwarding, shell_integration, certificate FROM hosts WHERE id = 'h-old-client'",
        )
        .get()
      assert.equal(written.name, 'renamed-by-old-client')
      assert.equal(written.agent_forwarding, 0)
      assert.equal(written.shell_integration, 'off')
      assert.equal(written.certificate, null)

      assert.equal(integrityCheck(db), 'ok')
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])

      // A new client starting again must accept the old client's writes.
      await initializeCoreSchema(connection)
      await initializeTeamSchema(connection)
      assert.equal(countRows(db, 'hosts'), 2)
      assert.equal(countRows(db, 'connection_logs'), 2)
      assert.equal(integrityCheck(db), 'ok')
    } finally {
      db.close()
    }
  })

  it('failure recovery: an aborted migration leaves the original database readable', async () => {
    const file = dbFile('aborted-migration')
    const seeded = seedLegacyDatabase(file)
    seeded.db.close()

    const { db, connection } = openDatabase(file)
    const failing = {
      execute: async (sql, params = []) => {
        // This statement runs outside the migration's duplicate-column catch, so
        // a failure here aborts the upgrade part-way through.
        if (sql.includes('idx_connection_logs_started_at'))
          throw new Error('injected migration failure (disk full simulation)')
        return connection.execute(sql, params)
      },
    }
    let aborted = false
    try {
      await initializeCoreSchema(failing)
    } catch (error) {
      aborted = true
      assert.match(String(error.message), /injected migration failure/)
    } finally {
      db.close()
    }
    assert.ok(aborted, 'the injected failure must abort the migration')

    const recovered = new DatabaseSync(file)
    try {
      assert.equal(integrityCheck(recovered), 'ok')
      assert.equal(countRows(recovered, 'hosts'), 2)
      assert.equal(
        recovered.prepare("SELECT name FROM hosts WHERE id = 'h-legacy-2'").get().name,
        'staging',
      )
      assert.equal(
        recovered.prepare("SELECT value FROM settings WHERE key = 'theme'").get().value,
        'dark',
      )
    } finally {
      recovered.close()
    }

    // Retrying the upgrade on the half-migrated file must converge.
    const retry = openDatabase(file)
    try {
      await initializeCoreSchema(retry.connection)
      assert.equal(integrityCheck(retry.db), 'ok')
      assert.equal(countRows(retry.db, 'hosts'), 2)
      assert.equal(
        retry.db.prepare("SELECT agent_forwarding FROM hosts WHERE id = 'h-legacy-1'").get()
          .agent_forwarding,
        0,
      )
    } finally {
      retry.db.close()
    }
  })
})
