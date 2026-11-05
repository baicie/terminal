#!/usr/bin/env node
/**
 * Independent restore worker for the real crash-point matrix.
 *
 * Everything here runs in a child process. `--crash-at` terminates that process
 * with SIGKILL after the named stage has completed, so the parent observes a
 * real signal exit instead of a same-process exception. The stage log records
 * the worker pid, which the parent compares with the pid it spawned.
 *
 * Usage:
 *   restore-worker.mjs create  --db <path> --value <text>
 *   restore-worker.mjs inspect --db <path>
 *   restore-worker.mjs restore --db <path> --backup <path> --data-dir <dir>
 *                              --stage-log <path> [--crash-at <stage>]
 *                              [--expect-value <text>]
 *   restore-worker.mjs retry   --db <path> --backup <path> --data-dir <dir>
 *                              --stage-log <path> [--expect-value <text>]
 *
 * Prints one JSON object on stdout for create/inspect/restore/retry.
 */
import {
  appendFileSync, closeSync, cpSync, existsSync, fsyncSync, mkdirSync,
  openSync, readSync, renameSync, rmSync, statSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'
import { assertStageOrder } from './recovery-state-machine.mjs'

const TEMP_NAME = 'terminal.restore.tmp'
const DATA_RETENTION = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data-retention.mjs')
const SIDECARS = ['-wal', '-shm', '-journal']

export function sha256File(file) {
  const hash = createHash('sha256')
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(1 << 20)
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null)
      if (read === 0) break
      hash.update(buffer.subarray(0, read))
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

function fsyncFile(file) {
  const fd = openSync(file, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function fsyncDirectory(directory) {
  const fd = openSync(directory, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function checkpointDatabase(dbPath) {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
    const busy = Number(row.busy)
    const log = Number(row.log)
    const checkpointed = Number(row.checkpointed)
    if (busy !== 0) {
      throw new Error(`checkpoint busy=${busy} log=${log} checkpointed=${checkpointed}`)
    }
    if (log !== checkpointed) {
      throw new Error(`checkpoint incomplete log=${log} checkpointed=${checkpointed}`)
    }
  } finally {
    db.close()
  }
  const wal = dbPath + '-wal'
  if (existsSync(wal) && statSync(wal).size > 0) {
    throw new Error('WAL file is still non-empty after checkpoint: ' + wal)
  }
}

export function inspectDatabase(dbPath, expectValue) {
  const db = new DatabaseSync(dbPath)
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get()
    const value = Object.values(integrity)[0]
    if (String(value).toLowerCase() !== 'ok') {
      throw new Error('integrity_check failed: ' + String(value))
    }
    if (expectValue !== undefined) {
      const row = db.prepare('SELECT value FROM matrix_fixture WHERE key = ?').get('state')
      if (!row) throw new Error('fixture row missing from ' + dbPath)
      if (row.value !== expectValue) {
        throw new Error(`fixture value ${row.value} != expected ${expectValue} in ${dbPath}`)
      }
    }
    return { integrity: 'ok', value: expectValue === undefined ? null : expectValue }
  } finally {
    db.close()
  }
}

export function createFixture(dbPath, value) {
  rmSync(dbPath, { force: true })
  for (const suffix of SIDECARS) rmSync(dbPath + suffix, { force: true })
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('CREATE TABLE matrix_fixture (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.prepare('INSERT INTO matrix_fixture (key, value) VALUES (?, ?)').run('state', value)
    // Leave no WAL behind so the pre-crash file set is deterministic.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
  return { db: dbPath, value, sha256: sha256File(dbPath) }
}

function verifyWithProductHarness(file, { before, token }) {
  const result = spawnSync(process.execPath, [
    ...process.execArgv,
    DATA_RETENTION, 'verify',
    '--db', file,
    '--before', before,
    '--token', token,
    '--forbid-columns', 'agent_forwarding,shell_integration',
    '--allow-settings-migration',
  ], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`product verification failed for ${file} (exit ${result.status}): ` +
      (result.stderr || result.stdout))
  }
}

export function restore({ db, backup, dataDir, stageLog, crashAt, expectValue, before, token }) {
  const stages = []
  const verify = file => {
    if (before && token) verifyWithProductHarness(file, { before, token })
    else inspectDatabase(file, expectValue)
  }
  const mark = stage => {
    stages.push(stage)
    appendFileSync(stageLog, JSON.stringify({ stage, pid: process.pid, at: Date.now() }) + '\n')
    if (crashAt && stage === crashAt) {
      // Real termination of this worker. SIGKILL cannot be caught, so no
      // finally block or exit handler runs after this point.
      process.kill(process.pid, process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL')
    }
  }
  mark('PREPARE')
  checkpointDatabase(db)
  mark('QUIESCE')
  verify(backup)
  mark('VERIFY_BACKUP')
  const temporary = path.join(dataDir, TEMP_NAME)
  cpSync(backup, temporary)
  fsyncFile(temporary)
  mark('STAGE')
  verify(temporary)
  mark('VERIFY_STAGED')
  for (const suffix of SIDECARS) rmSync(db + suffix, { force: true })
  fsyncDirectory(dataDir)
  mark('COMMIT')
  renameSync(temporary, db)
  fsyncDirectory(dataDir)
  mark('VERIFY')
  mark('COMPLETE')
  assertStageOrder(stages)
  return stages
}

export function retry({ db, backup, dataDir, stageLog, expectValue, before, token }) {
  const temporary = path.join(dataDir, TEMP_NAME)
  const alreadyRestored = existsSync(db) && sha256File(db) === sha256File(backup)
  if (alreadyRestored) {
    // The previous worker crashed after publishing the backup. Never redo a
    // completed restore; only drop a stale staging file.
    rmSync(temporary, { force: true })
    if (before && token) verifyWithProductHarness(db, { before, token })
    else inspectDatabase(db, expectValue)
    return { outcome: 'already-restored', stages: [] }
  }
  // A leftover staging file is never trusted: drop it and redo the whole
  // staged restore so the final main DB is published by rename only.
  rmSync(temporary, { force: true })
  const stages = restore({ db, backup, dataDir, stageLog, crashAt: null, expectValue, before, token })
  if (before && token) verifyWithProductHarness(db, { before, token })
  else inspectDatabase(db, expectValue)
  return { outcome: 'restored', stages }
}

function main() {
  const [mode] = process.argv.slice(2)
  const parsed = parseArgs({
    allowPositionals: true,
    args: process.argv.slice(3),
    options: {
      db: { type: 'string' },
      backup: { type: 'string' },
      'data-dir': { type: 'string' },
      'stage-log': { type: 'string' },
      'crash-at': { type: 'string' },
      'expect-value': { type: 'string' },
      before: { type: 'string' },
      token: { type: 'string' },
      value: { type: 'string' },
    },
  })
  const options = parsed.values
  if (mode === 'create') {
    process.stdout.write(JSON.stringify(createFixture(options.db, options.value ?? 'live')) + '\n')
    return
  }
  if (mode === 'inspect') {
    const result = inspectDatabase(options.db, options['expect-value'])
    process.stdout.write(JSON.stringify({ ...result, sha256: sha256File(options.db) }) + '\n')
    return
  }
  if (mode === 'restore' || mode === 'retry') {
    if (Boolean(options.before) !== Boolean(options.token)) {
      throw new Error('--before and --token must be provided together')
    }
    const dataDir = options['data-dir'] ?? path.dirname(options.db)
    mkdirSync(dataDir, { recursive: true })
    const common = {
      db: options.db,
      backup: options.backup,
      dataDir,
      stageLog: options['stage-log'],
      expectValue: options['expect-value'],
      before: options.before,
      token: options.token,
    }
    const result = mode === 'retry'
      ? retry(common)
      : { outcome: 'completed', stages: restore({ ...common, crashAt: options['crash-at'] ?? null }) }
    process.stdout.write(JSON.stringify(result) + '\n')
    return
  }
  throw new Error('unknown mode: ' + String(mode))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    process.stderr.write('[restore-worker] ' + (error?.stack || error) + '\n')
    process.exit(1)
  }
}
