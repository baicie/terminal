import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { delay, launchProcess, stopProcess } from './process-lifecycle.mjs'
import {
  assessProcessQuiescence,
  probeDatabaseHandles,
  requireQuiescent,
  snapshotDescendants,
} from './quiescence.mjs'

const lsofAvailable = (() => {
  try {
    execFileSync('lsof', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('marks process/stream/child/DB facts when all are observed', () => {
  const report = assessProcessQuiescence({
    exitObserved: true, closeObserved: true, stdoutClosed: true, stderrClosed: true,
  }, { dbHandles: [], aliveChildren: [] })
  assert.equal(report.overall, 'PASS')
  assert.equal(report.facts.OWNED_CHILDREN_SETTLED, 'PASS')
  assert.equal(report.facts.DB_HANDLES_RELEASED, 'PASS')
})

test('leaves process-tree evidence NOT_RUN when it was not observed', () => {
  const report = assessProcessQuiescence({
    exitObserved: true, closeObserved: true, stdoutClosed: true, stderrClosed: true,
  }, { dbHandles: [] })
  assert.equal(report.overall, 'PARTIAL')
  assert.equal(report.facts.OWNED_CHILDREN_SETTLED, 'NOT_RUN')
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

test('detects a child that outlives its parent and settles a clean one', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiescence-tree-'))
  const ready = path.join(dir, 'child.pid')
  const parent = launchProcess(process.execPath, ['-e', `
    const { spawn } = require('node:child_process')
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    require('fs').writeFileSync(${JSON.stringify(ready)}, String(child.pid))
    setInterval(() => {}, 1000)
  `], { logPath: path.join(dir, 'parent.log') })
  const deadline = Date.now() + 5000
  while (!existsSync(ready) && Date.now() < deadline) await delay(20)
  assert.equal(existsSync(ready), true, 'child pid was not published')
  const childPid = Number(readFileSync(ready, 'utf8'))
  const snapshot = snapshotDescendants(parent.pid)
  assert.equal(snapshot.supported, true)
  assert.ok(snapshot.pids.includes(childPid), `snapshot ${snapshot.pids} should include ${childPid}`)
  try {
    const stopped = await stopProcess(parent, { waitMs: 5000 })
    const stopResult = { ...stopped, ownedChildren: snapshot }
    await assert.rejects(
      requireQuiescent(stopResult, [], { childrenTimeoutMs: 250 }),
      /OWNED_CHILDREN_SETTLED/,
    )
    // A parent with no children observes an empty, settled tree.
    const clean = launchProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      logPath: path.join(dir, 'clean.log'),
    })
    await delay(100)
    const cleanSnapshot = snapshotDescendants(clean.pid)
    const cleanStop = await stopProcess(clean, { waitMs: 5000 })
    const cleanResult = await requireQuiescent({ ...cleanStop, ownedChildren: cleanSnapshot }, [])
    assert.equal(cleanResult.facts.OWNED_CHILDREN_SETTLED, 'PASS')
  } finally {
    try { process.kill(childPid, 'SIGKILL') } catch { /* already gone */ }
  }
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
    await assert.rejects(requireQuiescent({
      exitObserved: true, closeObserved: true, stdoutClosed: true, stderrClosed: true,
    }, [db]), /DB_HANDLES_RELEASED/)
  } finally {
    holder.kill('SIGKILL')
    await new Promise(resolve => holder.once('close', resolve))
    closeSync(fd)
  }
})
