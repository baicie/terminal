import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createSmallVolume, freeBytes } from './enospc-volume.mjs'
import { sha256File, sqliteNodeFlags } from './restore-crash-matrix.mjs'

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'restore-worker.mjs')

test('restore fails closed on ENOSPC and a retry converges after space is freed', async t => {
  const volume = createSmallVolume(64)
  if (volume.unavailable) return t.skip(volume.unavailable)
  try {
    const flags = sqliteNodeFlags()
    const worker = args => spawnSync(process.execPath, [...flags, WORKER, ...args], {
      encoding: 'utf8',
      timeout: 60_000,
    })
    const caseDir = path.join(volume.mountDir, 'case')
    const dataDir = path.join(caseDir, 'data')
    mkdirSync(dataDir, { recursive: true })
    const live = path.join(caseDir, 'live.db')
    const backup = path.join(caseDir, 'backup.db')

    // DELETE journal on both sides: reading either file must not need to
    // create a WAL/SHM sidecar on a full volume.
    const liveCreated = worker(['create', '--db', live, '--value', 'live', '--journal-mode', 'delete'])
    assert.equal(liveCreated.status, 0, liveCreated.stderr)
    const backupCreated = worker([
      'create', '--db', backup, '--value', 'backup', '--journal-mode', 'delete',
      '--bulk-bytes', String(8 * 1024 * 1024),
    ])
    assert.equal(backupCreated.status, 0, backupCreated.stderr)
    const backupSha = sha256File(backup)
    const backupSize = statSync(backup).size

    const db = path.join(dataDir, 'terminal.db')
    cpSync(live, db)
    const liveSha = sha256File(db)

    const fillerDir = path.join(caseDir, 'filler')
    mkdirSync(fillerDir)
    const chunk = Buffer.alloc(1024 * 1024, 0x61)
    let fillerCount = 0
    // Leave roughly 3-4 MB so the 8 MB staging copy fails midway.
    while (freeBytes(volume.mountDir) > 4 * 1024 * 1024) {
      writeFileSync(path.join(fillerDir, 'filler-' + fillerCount), chunk)
      fillerCount += 1
    }

    const stageLog = path.join(caseDir, 'stages.jsonl')
    const failed = worker([
      'restore', '--db', db, '--backup', backup, '--data-dir', dataDir,
      '--stage-log', stageLog, '--expect-value', 'backup',
    ])
    assert.notEqual(failed.status, 0, 'restore must not succeed on a full volume')
    assert.match(failed.stderr, /ENOSPC|no space left/i)

    // Fail closed: the live DB is still exactly the live DB, and no rename ran.
    assert.equal(sha256File(db), liveSha, 'main DB changed after ENOSPC')
    const temp = path.join(dataDir, 'terminal.restore.tmp')
    // Node's cpSync may unlink a failed destination on this platform; either
    // way the file must never be published as the main DB.
    const leftover = existsSync(temp) ? statSync(temp).size : 0
    assert.ok(leftover < backupSize, `leftover staging ${leftover} must not equal the backup ${backupSize}`)
    const stillLive = worker(['inspect', '--db', db, '--expect-value', 'live'])
    assert.equal(stillLive.status, 0, stillLive.stderr)

    rmSync(fillerDir, { recursive: true, force: true })
    // A stale staging file from an older attempt must never be trusted.
    writeFileSync(temp, 'stale-partial')
    const retried = worker([
      'retry', '--db', db, '--backup', backup, '--data-dir', dataDir,
      '--stage-log', stageLog, '--expect-value', 'backup',
    ])
    assert.equal(retried.status, 0, retried.stderr)
    const outcome = JSON.parse(retried.stdout.trim().split('\n').pop())
    assert.equal(outcome.outcome, 'restored')
    assert.equal(sha256File(db), backupSha)
    assert.equal(existsSync(temp), false)
    const restored = worker(['inspect', '--db', db, '--expect-value', 'backup'])
    assert.equal(restored.status, 0, restored.stderr)
  } finally {
    volume.cleanup()
  }
})
