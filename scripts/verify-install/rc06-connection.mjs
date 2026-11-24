/**
 * RC06 — the `connection` module, backed by a SQLite file that outlives the process.
 *
 * Signature-compatible with `service/database/connection.ts`: same four exports, same
 * return shapes. The database path comes from `RC06_DIR`, so a crash leaves a real file
 * behind for the inspector to read.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import path from 'node:path'

const dir = process.env.RC06_DIR
if (!dir) throw new Error('RC06_DIR is not set')

let db = null
function open() {
  if (db) return db
  const file = path.join(dir, 'terminal.db')
  db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, hostname TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22, username TEXT NOT NULL, auth_type TEXT NOT NULL,
      password TEXT, private_key TEXT, certificate TEXT, credential_ref TEXT,
      group_id TEXT, is_favorite INTEGER NOT NULL DEFAULT 0, color TEXT, tags TEXT,
      port_forwards TEXT NOT NULL DEFAULT '[]', startup_command TEXT, environment TEXT,
      jump_host_id, jump_host_auth_type, agent_forwarding INTEGER NOT NULL DEFAULT 0,
      shell_integration TEXT NOT NULL DEFAULT 'off', identity_file_path TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )
  `)
  return db
}

export async function executeQuery(sql, params = []) {
  const info = open().prepare(sql).run(...params)
  return { rowsAffected: Number(info.changes) }
}

export async function select(sql, params = []) {
  return open().prepare(sql).all(...params)
}

export async function selectStrict(sql, params = []) {
  return open().prepare(sql).all(...params)
}

export function __rc06Close() {
  if (db) { db.close(); db = null }
}

export { existsSync }
