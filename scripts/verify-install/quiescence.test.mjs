import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { delay, launchProcess, stopProcess } from './process-lifecycle.mjs'
import {
  assessProcessQuiescence,
  probeDatabaseHandles,
  requireQuiescent,
} from './quiescence.mjs'

const lsofAvailable = (() => {
  try {
    execFileSync('lsof', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('marks process/stream facts and leaves process-tree evidence NOT_RUN', () => {
  const report = assessProcessQuiescence({
    exitObserved: true, closeObserved: true, stdoutClosed: true, stderrClosed: true,
  }, { dbHandles: [] })
  assert.equal(report.overall, 'PASS')
  assert.equal(report.facts.OWNED_CHILDREN_SETTLED, 'NOT_RUN')
  assert.equal(report.facts.DB_HANDLES_RELEASED, 'PASS')
})

test('fails when the process did not exit or a stream stayed open', () => {
  const report = assessProcessQuiescence({
    exitObserved: false, closeObserved: true, stdoutClosed: true, stderrClosed: true,
  }, { dbHandles: [] })
  assert.equal(report.overall, 'FAIL')
  assert.deepEqual(report.failed, ['PROCESS_EXITED'])
  const stream = assessProcessQuiescence({
    exitObserved: true, closeObserved: true, stdoutClosed: false, stderrClosed: true,
  }, { dbHandles: [] })
  assert.equal(stream.overall, 'FAIL')
})

test('probeDatabaseHandles finds an open file held by a separate child', { skip: !lsofAvailable }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiescence-'))
  const db = path.join(dir, 'terminal.db')
  writeFileSync(db, 'SQLite format 3\0')
  const fd = openSync(db, 'r')
  const holder = spawn(process.execPath, ['-e', `
    const fs = require('node:fs')
    const fd = fs.openSync(${JSON.stringify(db)}, 'r')
    fs.writeFileSync(${JSON.stringify(path.join(dir, 'ready'))}, '1')
    setInterval(() => {}, 1000)
  `], { stdio: 'ignore', env: { ...process.env, HOLDER_FD: String(fd) } })
  try {
    for (let index = 0; index < 100 && !existsSync(path.join(dir, 'ready')); index += 1) {
      await delay(20)
    }
    const probe = probeDatabaseHandles([db])
    assert.equal(probe.supported, true)
    assert.ok(probe.pids.length > 0)
    assert.throws(() => requireQuiescent({
      exitObserved: true, closeObserved: true, stdoutClosed: true, stderrClosed: true,
    }, [db]), /DB_HANDLES_RELEASED/)
  } finally {
    holder.kill('SIGKILL')
    await new Promise(resolve => holder.once('close', resolve))
    closeSync(fd)
  }
})
