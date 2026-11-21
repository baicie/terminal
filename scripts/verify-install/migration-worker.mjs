#!/usr/bin/env node
/**
 * Independent migration worker for the real crash-recovery matrix.
 *
 * ## Why a separate process
 *
 * The credential migration is frontend TypeScript (`credential-migration.ts`), not a
 * Rust command, so there is no binary to spawn. What *can* run in its own process is
 * the migration itself: it takes an injectable vault and store
 * (`runCredentialMigration(plan, values, vault, store)`) and only imports one type, so
 * `tsx` can execute it with no Tauri runtime at all.
 *
 * That is what this worker does — a real SQLite file, a real on-disk vault directory,
 * and `--crash-at <stage>` sends itself SIGKILL after the named stage. The parent then
 * observes a signal exit and inspects the files on disk. The distinction that matters:
 * a same-process exception unwinds and can be caught; SIGKILL cannot, so whatever is on
 * disk afterwards is exactly what a user's machine would have.
 *
 * Usage:
 *   migration-worker.mjs seed   --db <path> --vault <dir> --rows <n>
 *   migration-worker.mjs run    --db <path> --vault <dir> --stage-log <path>
 *                               [--crash-at <stage>]
 *   migration-worker.mjs inspect --db <path> --vault <dir>
 *
 * Prints one JSON object on stdout.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { DatabaseSync } from 'node:sqlite'

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: 'string' },
    vault: { type: 'string' },
    'stage-log': { type: 'string' },
    'crash-at': { type: 'string' },
    rows: { type: 'string' },
  },
})

const command = positionals[0]
const dbPath = args.db
const vaultDir = args.vault
if (!dbPath || !vaultDir) {
  console.error('--db and --vault are required')
  process.exit(2)
}

/*
 * ## The on-disk vault
 *
 * One file per (resource, version, kind). That is deliberately simple: the point of
 * this harness is what survives a SIGKILL, and a file that was written is a file that
 * exists. A real vault encrypts; encryption does not change whether the bytes landed.
 */
function entryPath(resource, version, kind) {
  return path.join(vaultDir, `${resource.type}-${resource.id}-v${version}-${kind}`)
}

const vault = {
  isAvailable: async () => true,
  async write(resource, version, kind, value) {
    mkdirSync(vaultDir, { recursive: true })
    writeFileSync(entryPath(resource, version, kind), value, { mode: 0o600 })
  },
  async read(resource, version, kind) {
    const file = entryPath(resource, version, kind)
    if (!existsSync(file)) return undefined
    return readFileSync(file, 'utf8')
  },
  async remove(resource, version, kind) {
    const file = entryPath(resource, version, kind)
    if (existsSync(file)) writeFileSync(file, '', { mode: 0o600 }) // first make it unreadable
    if (existsSync(file)) {
      const { unlinkSync } = await import('node:fs')
      unlinkSync(file)
    }
  },
}

/** Abort the whole process at a stage boundary, the way a kill -9 would. */
function crashPoint(stage) {
  if (args['stage-log']) appendFileSync(args['stage-log'], `${stage} pid=${process.pid}\n`)
  if (args['crash-at'] === stage) process.kill(process.pid, 'SIGKILL')
}

function openDb() {
  return new DatabaseSync(dbPath)
}

/** Create the schema and the rows the migration is meant to move. */
function seed(count) {
  const db = openDb()
  db.exec(`
    CREATE TABLE hosts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT, private_key TEXT,
      credential_ref TEXT
    );
    CREATE TABLE ssh_keys (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, private_key TEXT, passphrase TEXT,
      credential_ref TEXT
    );
  `)
  const host = db.prepare('INSERT INTO hosts (id,name,password,private_key,credential_ref) VALUES (?,?,?,?,NULL)')
  for (let i = 0; i < count; i += 1) host.run(`h${i}`, `host-${i}`, `pw-${i}`, null)
  const key = db.prepare('INSERT INTO ssh_keys (id,name,private_key,passphrase,credential_ref) VALUES (?,?,?,?,NULL)')
  for (let i = 0; i < count; i += 1) key.run(`k${i}`, `key-${i}`, `mat-${i}`, `pp-${i}`)
  db.close()
}

/** Read what is on disk now — the parent uses this after a crash. */
function inspect() {
  const db = openDb()
  const hosts = db.prepare('SELECT id,password,credential_ref FROM hosts ORDER BY id').all()
  const keys = db.prepare('SELECT id,private_key,credential_ref FROM ssh_keys ORDER BY id').all()
  db.close()
  const vaultFiles = existsSync(vaultDir) ? readdirSync(vaultDir).sort() : []
  const out = {
    hosts: hosts.map(row => ({
      id: row.id,
      hasPlaintext: row.password !== null,
      hasRef: row.credential_ref !== null,
      ref: row.credential_ref,
    })),
    keys: keys.map(row => ({
      id: row.id,
      hasPlaintext: row.private_key !== null,
      hasRef: row.credential_ref !== null,
    })),
    vault: vaultFiles,
    /*
     * ## The invariant this harness exists to check
     *
     * Every row is in exactly one of three states, and only these:
     *
     *   plaintext, no ref     — not migrated yet (a retry can take it)
     *   no plaintext, ref     — migrated (the secret is in the vault at that version)
     *   plaintext AND ref     — a torn row: two copies, and the ref may point at a
     *                           version that was never verified
     *
     * A row with neither is the loss case — the plaintext was cleared and no reference
     * was written. That is unrecoverable, and no crash point may produce it.
     */
    torn: hosts.filter(row => row.password !== null && row.credential_ref !== null).map(r => r.id),
    lost: hosts.filter(row => row.password === null && row.credential_ref === null).map(r => r.id),
    keysTorn: keys.filter(row => row.private_key !== null && row.credential_ref !== null).map(r => r.id),
    keysLost: keys.filter(row => row.private_key === null && row.credential_ref === null).map(r => r.id),
  }
  process.stdout.write(`${JSON.stringify(out)}\n`)
}

/**
 * Run the real migration against a real SQLite file.
 *
 * The store commits with a real `UPDATE`, in the same order the production adapter
 * uses (`credential-migration-run.ts`): write the reference and clear the plaintext in
 * one statement, so a crash cannot leave the reference without the clear or the
 * reverse for that single row.
 */
async function run() {
  const { runCredentialMigration, planCredentialMigration } = await import(
    '../../packages/frontend/src/service/credential-migration.ts'
  )

  const db = openDb()
  const hostRows = db.prepare('SELECT * FROM hosts ORDER BY id').all()
  const keyRows = db.prepare('SELECT * FROM ssh_keys ORDER BY id').all()
  db.close()

  crashPoint('read-plaintext')

  /*
   * The planner reads the *row's own* plaintext columns to decide what to move — the
   * `credentialRef` is only the version to write under. Passing a pre-built
   * `{ kinds: [] }` reference made every row look already-migrated and the plan came
   * out empty (`migratedHosts: 0` on a database full of plaintext).
   */
  const plan = planCredentialMigration(
    hostRows.map(row => ({
      id: row.id,
      name: row.name,
      password: row.password,
      privateKey: row.private_key,
      credentialRef: row.credential_ref ? JSON.parse(row.credential_ref) : null,
    })),
    keyRows.map(row => ({
      id: row.id,
      name: row.name,
      privateKey: row.private_key,
      passphrase: row.passphrase,
      credentialRef: row.credential_ref ? JSON.parse(row.credential_ref) : null,
    })),
  )

  crashPoint('plan')

  const values = {
    hosts: hostRows.map(row => ({ id: row.id, password: row.password, privateKey: row.private_key })),
    keys: keyRows.map(row => ({ id: row.id, privateKey: row.private_key, passphrase: row.passphrase })),
  }

  let stage = 'execute'
  const store = {
    async commitHost(id, ref) {
      crashPoint(`${stage}:before-commit:${id}`)
      const handle = openDb()
      handle
        .prepare('UPDATE hosts SET credential_ref = ?, password = NULL, private_key = NULL WHERE id = ?')
        .run(JSON.stringify(ref), id)
      handle.close()
      crashPoint(`${stage}:after-commit:${id}`)
    },
    async commitKey(id, ref) {
      crashPoint(`${stage}:before-commit:${id}`)
      const handle = openDb()
      handle
        .prepare('UPDATE ssh_keys SET credential_ref = ?, private_key = NULL, passphrase = NULL WHERE id = ?')
        .run(JSON.stringify(ref), id)
      handle.close()
      crashPoint(`${stage}:after-commit:${id}`)
    },
  }

  const result = await runCredentialMigration(plan, values, vault, store)
  stage = 'done'
  crashPoint('done')
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (command === 'seed') {
  seed(Number(args.rows ?? 3))
  process.stdout.write(`${JSON.stringify({ seeded: Number(args.rows ?? 3) })}\n`)
} else if (command === 'run') {
  await run()
} else if (command === 'inspect') {
  inspect()
} else {
  console.error(`unknown command ${command}; expected seed|run|inspect`)
  process.exit(2)
}
