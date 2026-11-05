import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { delay, launchProcess, stopProcess } from './process-lifecycle.mjs'
import { requireQuiescent, snapshotDescendants } from './quiescence.mjs'

const windows = process.platform === 'win32'

function logPath(dir, name) {
  return path.join(dir, name)
}

test('Windows process tree detects a child that outlives its parent', { skip: !windows }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiescence-win-'))
  const ready = path.join(dir, 'child.pid')
  const parent = launchProcess(process.execPath, ['-e', `
    const { spawn } = require('node:child_process')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    require('fs').writeFileSync(${JSON.stringify(ready)}, String(child.pid))
    setInterval(() => {}, 1000)
  `], { logPath: logPath(dir, 'parent.log') })
  const deadline = Date.now() + 15_000
  while (!existsSync(ready) && Date.now() < deadline) await delay(50)
  assert.equal(existsSync(ready), true, 'child pid was not published')
  const childPid = Number(readFileSync(ready, 'utf8'))
  const snapshot = snapshotDescendants(parent.pid)
  assert.equal(snapshot.supported, true, snapshot.reason)
  assert.ok(snapshot.pids.includes(childPid), `snapshot ${snapshot.pids} should include ${childPid}`)
  try {
    const stopped = await stopProcess(parent, { waitMs: 10_000 })
    await assert.rejects(
      requireQuiescent({ ...stopped, ownedChildren: snapshot }, [], { childrenTimeoutMs: 500 }),
      /OWNED_CHILDREN_SETTLED/,
    )
  } finally {
    try { process.kill(childPid, 'SIGTERM') } catch { /* already gone */ }
  }
})

test('Windows process tree reports a clean parent as settled', { skip: !windows }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quiescence-win-'))
  const parent = launchProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    logPath: logPath(dir, 'parent.log'),
  })
  await delay(300)
  const snapshot = snapshotDescendants(parent.pid)
  assert.equal(snapshot.supported, true, snapshot.reason)
  const stopped = await stopProcess(parent, { waitMs: 10_000 })
  const result = await requireQuiescent({ ...stopped, ownedChildren: snapshot }, [], {
    childrenTimeoutMs: 500,
  })
  assert.equal(result.facts.OWNED_CHILDREN_SETTLED, 'PASS')
})
