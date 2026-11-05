import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { delay, launchProcess, requireStopped, stopProcess } from './process-lifecycle.mjs'

function logPath() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'process-lifecycle-'))
  return path.join(dir, 'child.log')
}

function script(code) {
  return launchProcess(process.execPath, ['-e', code], { logPath: logPath() })
}

function scriptWithReady(code) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'process-lifecycle-'))
  const ready = path.join(dir, 'ready')
  const child = launchProcess(process.execPath, ['-e',
    `require('fs').writeFileSync(${JSON.stringify(ready)}, '1');${code}`,
  ], { logPath: path.join(dir, 'child.log') })
  return { child, ready }
}

async function waitReady(ready) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !existsSync(ready)) await delay(20)
  assert.equal(existsSync(ready), true, 'child did not publish its readiness marker')
}

test('waits for a graceful SIGTERM exit and flushes stdout/stderr before close', async () => {
  const child = script(`
    process.on('SIGTERM', () => { console.log('stdout-line'); console.error('stderr-line'); process.exit(0) })
    setInterval(() => {}, 1000)
  `)
  await delay(400)
  const result = await stopProcess(child, { waitMs: 5000 })
  assert.equal(result.outcome, 'graceful')
  assert.equal(result.termination, 'clean-exit')
  assert.equal(result.exitObserved, true)
  assert.equal(result.closeObserved, true)
  const log = readFileSync(child.lifecycle.logPath, 'utf8')
  assert.match(log, /stdout-line/)
  assert.match(log, /stderr-line/)
  assert.match(log, /exit code=0/)
})

test('reports a delayed graceful exit with real elapsed time', async () => {
  const { child, ready } = scriptWithReady(`
    process.on('SIGTERM', () => setTimeout(() => process.exit(0), 200))
    setInterval(() => {}, 1000)
  `)
  await waitReady(ready)
  const result = await stopProcess(child, { waitMs: 5000 })
  assert.equal(result.outcome, 'graceful')
  assert.ok(result.elapsedMs >= 150, `elapsed ${result.elapsedMs}`)
})

test('escalates to SIGKILL when the child ignores SIGTERM', async () => {
  const { child, ready } = scriptWithReady(`
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1000)
  `)
  await waitReady(ready)
  const result = await stopProcess(child, { waitMs: 150, killWaitMs: 3000 })
  assert.equal(result.outcome, 'forced')
  assert.equal(result.escalationUsed, true)
  assert.equal(result.exitObserved, true)
})

test('returns already-exited for a child that finished before stop', async () => {
  const child = script(`console.log('done')`)
  await Promise.race([child.lifecycle.closePromise, delay(1000)])
  const result = await stopProcess(child)
  assert.equal(result.outcome, 'already-exited')
  assert.equal(result.exitObserved, true)
  assert.equal(result.closeObserved, true)
})

test('concurrent stop calls share one decision and do not double-signal', async () => {
  const { child, ready } = scriptWithReady(`
    process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100))
    setInterval(() => {}, 1000)
  `)
  await waitReady(ready)
  const [first, second] = await Promise.all([stopProcess(child), stopProcess(child)])
  assert.equal(first.outcome, 'graceful')
  assert.equal(second.outcome, 'graceful')
  assert.equal(first.elapsedMs, second.elapsedMs)
})

test('reports a spawn error without claiming a graceful stop', async () => {
  const child = launchProcess('/definitely-not-a-real-command-952', [], { logPath: logPath() })
  await delay(200)
  const result = await stopProcess(child, { waitMs: 100 })
  assert.equal(result.outcome, 'spawn-error')
  assert.equal(result.exitObserved, false)
  assert.throws(() => requireStopped(result), /spawn-error/)
})

test('does not signal an unrelated process', async () => {
  const sentinelReady = scriptWithReady(`setInterval(() => {}, 1000)`)
  const targetReady = scriptWithReady(`
    process.on('SIGTERM', () => process.exit(0))
    setInterval(() => {}, 1000)
  `)
  const sentinel = sentinelReady.child
  const target = targetReady.child
  await waitReady(sentinelReady.ready)
  await waitReady(targetReady.ready)
  await stopProcess(target, { waitMs: 3000 })
  assert.equal(sentinel.lifecycle.exitObserved, false)
  await stopProcess(sentinel, { waitMs: 3000 })
})


test('requireStopped rejects missing close and forced escalation', async () => {
  assert.throws(
    () => requireStopped({ outcome: 'graceful', termination: 'terminated-by-sigterm', exitObserved: true, closeObserved: false }),
    /closeObserved=false/,
  )
  assert.throws(
    () => requireStopped({ outcome: 'forced', termination: 'forced-sigkill', exitObserved: true, closeObserved: true }),
    /forced-sigkill/,
  )
  assert.doesNotThrow(() => requireStopped({
    outcome: 'graceful', termination: 'terminated-by-sigterm',
    exitObserved: true, closeObserved: true,
  }))
})

test('a log write failure is diagnostic and does not hang close', async () => {
  const child = script(`console.log('output')`)
  child.lifecycle.logPath = path.join(path.dirname(child.lifecycle.logPath), 'missing-dir', 'child.log')
  await Promise.race([child.lifecycle.closePromise, delay(2000)])
  const result = await stopProcess(child)
  assert.match(result.logError, /ENOENT|no such file/i)
  assert.equal(result.closeObserved, true)
  assert.throws(() => requireStopped(result), /logError/)
})


test('reports terminated-by-sigterm when the child does not handle SIGTERM', async () => {
  const { child, ready } = scriptWithReady(`setInterval(() => {}, 1000)`)
  await waitReady(ready)
  const result = await stopProcess(child, { waitMs: 5000 })
  assert.equal(result.outcome, 'graceful')
  assert.equal(result.termination, 'terminated-by-sigterm')
  assert.doesNotThrow(() => requireStopped(result))
})
