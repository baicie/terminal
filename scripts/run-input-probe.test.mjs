import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { runInputProbe } from './run-input-probe.mjs'

const PROJECT_ROOT = '/workspace/terminal'
const TEMP_ROOT = '/private/tmp'
const RUN_DIRECTORY = '/private/tmp/terminal-input-probe-fixture'
const TARGET_DIRECTORY = '/workspace/terminal-target'
const READY_PATH = path.join(RUN_DIRECTORY, 'ready.json')
const RESULT_PATH = path.join(RUN_DIRECTORY, 'result.json')

const passingResult = {
  ok: true,
  rounds: 30,
  expectedText: 'asd',
  expectedHex: '617364',
  durationMs: 5_678,
  results: Array.from({ length: 30 }, (_, index) => ({
    round: index + 1,
    expectedHex: '617364',
    receivedHex: '617364',
    ok: true,
  })),
  error: null,
}

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  closed = false

  constructor(pid) {
    super()
    this.pid = pid
  }

  kill(signal) {
    if (!this.closed) {
      this.closed = true
      this.stdout.end()
      this.stderr.end()
      this.emit('close', null, signal)
    }
    return true
  }
}

function finishChild(child, { code = 0, stdout = '' } = {}) {
  queueMicrotask(() => {
    if (child.closed) return
    child.closed = true
    child.stdout.end(stdout)
    child.stderr.end()
    child.emit('close', code, null)
  })
}

function createHarness({
  accessDenied = false,
  failResult = false,
  result = passingResult,
  inject = 'swift',
} = {}) {
  const calls = {
    mkdtemp: 0,
    rm: [],
    spawn: [],
  }
  let appClosed = false
  let readyRound = 1
  let readyExists = false
  let resultExists = false
  let roundChecks = 0
  const appChild = new FakeChild(41_100)

  const dependencies = {
    access: async filePath => {
      if (filePath === READY_PATH && readyExists) return
      if (filePath === RESULT_PATH && resultExists) return
      throw new Error('pending')
    },
    clearTimeout: globalThis.clearTimeout,
    mkdtemp: async prefix => {
      calls.mkdtemp += 1
      return RUN_DIRECTORY
    },
    now: Date.now,
    platform: 'darwin',
    readFile: async (filePath, encoding) => {
      assert.equal(encoding, 'utf8')
      if (filePath === READY_PATH) {
        roundChecks += 1
        return JSON.stringify({ round: readyRound })
      }
      if (filePath === RESULT_PATH) {
        return JSON.stringify(failResult ? { ...result, ok: false, error: 'lost keystroke' } : result)
      }
      throw new Error(`unexpected read: ${filePath}`)
    },
    rm: async (...args) => calls.rm.push(args),
    setTimeout: globalThis.setTimeout,
    spawn: (command, args, options) => {
      calls.spawn.push({ command, args, options })
      if (command === 'pnpm') return new FakeChild(41_001)
      if (command === 'cargo') {
        const child = new FakeChild(41_002)
        finishChild(child, {
          stdout: JSON.stringify({ target_directory: TARGET_DIRECTORY }),
        })
        return child
      }
      if (command === 'swiftc') {
        const child = new FakeChild(41_003)
        finishChild(child)
        return child
      }
      if (command.endsWith('post-key-events')) {
        const child = new FakeChild(41_004)
        const output = args[0] === 'access'
          ? (accessDenied ? 'denied' : 'allowed')
          : ''
        finishChild(child, { stdout: output })
        return child
      }
      if (command === 'osascript') {
        const child = new FakeChild(41_005)
        finishChild(child)
        return child
      }
      return appChild
    },
    tempDirectory: TEMP_ROOT,
    writeFile: async () => {},
  }

  const publishRound = round => {
    readyRound = round
    readyExists = true
  }
  const publishResult = () => {
    resultExists = true
  }
  const closeApp = () => {
    appClosed = true
    if (!appChild.closed) finishChild(appChild)
  }
  const injectorRounds = []
  const trackInjector = round => injectorRounds.push(round)

  return {
    appChild,
    calls,
    closeApp,
    dependencies,
    injectorRounds,
    publishResult,
    publishRound,
    trackInjector,
    setAppClosed: value => (appClosed = value),
  }
}

test('drives thirty overlapping key rounds and validates the exact hex contract', async () => {
  const harness = createHarness()
  const { calls, dependencies } = harness
  const rounds = 30
  const events = []
  dependencies.spawn = (command, args, options) => {
    calls.spawn.push({ command, args, options })
    if (command === 'pnpm') return new FakeChild(41_001)
    if (command === 'cargo') {
      const child = new FakeChild(41_002)
      finishChild(child, { stdout: JSON.stringify({ target_directory: TARGET_DIRECTORY }) })
      return child
    }
    if (command === 'swiftc') {
      const child = new FakeChild(41_003)
      finishChild(child)
      return child
    }
    if (command.endsWith('post-key-events')) {
      const child = new FakeChild(41_004)
      const output = args[0] === 'access' ? 'allowed' : ''
      finishChild(child, { stdout: output })
      if (args[0] === 'overlap') {
        events.push(args[1])
        const round = events.length
        harness.publishRound(Math.min(rounds, round + 1))
        if (round === rounds) harness.publishResult()
      }
      return child
    }
    if (command === 'osascript') {
      const child = new FakeChild(41_005)
      finishChild(child)
      return child
    }
    if (command.endsWith('/debug/terminal')) {
      harness.publishRound(1)
    }
    return harness.appChild
  }

  const result = await runInputProbe({
    cwd: PROJECT_ROOT,
    env: {},
    skipBuild: true,
    targetDirectory: TARGET_DIRECTORY,
    dependencies,
  })

  assert.equal(result.ok, true)
  assert.equal(result.results.length, rounds)
  assert.equal(events.length, rounds)
  assert.ok(events.every(text => text === 'asd'))
  assert.deepEqual(calls.rm, [
    [RUN_DIRECTORY, { recursive: true, force: true }],
  ])
})

test('requires Accessibility permission for explicit swift injection', async () => {
  const { dependencies } = createHarness({ accessDenied: true })

  await assert.rejects(
    runInputProbe({
      cwd: PROJECT_ROOT,
      env: {},
      inject: 'swift',
      skipBuild: true,
      targetDirectory: TARGET_DIRECTORY,
      dependencies,
    }),
    /Accessibility permission/,
  )
})

test('falls back to guided manual typing when automatic injection is unavailable', async () => {
  const harness = createHarness({ accessDenied: true })
  const { calls, dependencies } = harness
  const rounds = 2
  let manualRound = 1
  const typedRounds = []
  dependencies.spawn = (command, args, options) => {
    calls.spawn.push({ command, args, options })
    if (command === 'pnpm') return new FakeChild(41_001)
    if (command === 'cargo') {
      const child = new FakeChild(41_002)
      finishChild(child, { stdout: JSON.stringify({ target_directory: TARGET_DIRECTORY }) })
      return child
    }
    if (command === 'swiftc') {
      const child = new FakeChild(41_003)
      finishChild(child)
      return child
    }
    if (command.endsWith('post-key-events')) {
      const child = new FakeChild(41_004)
      finishChild(child, { stdout: 'denied' })
      return child
    }
    if (command.endsWith('/debug/terminal')) {
      harness.publishRound(1)
    }
    return harness.appChild
  }
  const originalConsoleLog = console.log
  dependencies.readFile = async filePath => {
    if (filePath === RESULT_PATH) {
      return JSON.stringify({
        ok: true,
        rounds,
        expectedText: 'asd',
        expectedHex: '617364',
        durationMs: 1234,
        results: Array.from({ length: rounds }, (_, index) => ({
          round: index + 1,
          expectedHex: '617364',
          receivedHex: '617364',
          ok: true,
        })),
        error: null,
      })
    }
    if (filePath === READY_PATH) return JSON.stringify({ round: manualRound })
    throw new Error(`unexpected read: ${filePath}`)
  }
  console.log = message => {
    if (typeof message === 'string' && message.includes('type')) {
      typedRounds.push(manualRound)
      harness.publishRound(Math.min(rounds, manualRound + 1))
      if (manualRound === rounds) harness.publishResult()
      manualRound += 1
    }
  }
  try {
    const result = await runInputProbe({
      cwd: PROJECT_ROOT,
      env: {},
      rounds,
      skipBuild: true,
      targetDirectory: TARGET_DIRECTORY,
      dependencies,
    })

    assert.equal(result.ok, true)
    assert.equal(result.injector, 'manual')
    assert.deepEqual(typedRounds, [1, 2])
  } finally {
    console.log = originalConsoleLog
  }
})

test('rejects a probe application that exits without publishing a result', async () => {
  const harness = createHarness({ accessDenied: true })
  const { dependencies } = harness
  dependencies.spawn = (command, args, options) => {
    if (command === 'pnpm') return new FakeChild(41_001)
    if (command === 'cargo') {
      const child = new FakeChild(41_002)
      finishChild(child, { stdout: JSON.stringify({ target_directory: TARGET_DIRECTORY }) })
      return child
    }
    if (command === 'swiftc') {
      const child = new FakeChild(41_003)
      finishChild(child)
      return child
    }
    if (command.endsWith('post-key-events')) {
      const child = new FakeChild(41_004)
      finishChild(child, { stdout: 'denied' })
      return child
    }
    if (command.endsWith('/debug/terminal')) {
      queueMicrotask(() => finishChild(harness.appChild))
      return harness.appChild
    }
    return harness.appChild
  }

  await assert.rejects(
    runInputProbe({
      cwd: PROJECT_ROOT,
      env: {},
      rounds: 2,
      inject: 'manual',
      skipBuild: true,
      targetDirectory: TARGET_DIRECTORY,
      dependencies,
    }),
    /closed early/,
  )
})

test('checkpoint-only mode stops after observing the first awaiting-input checkpoint', async () => {
  const harness = createHarness({ accessDenied: true })
  const { dependencies } = harness
  dependencies.spawn = (command, args, options) => {
    if (command === 'pnpm') return new FakeChild(41_001)
    if (command === 'cargo') {
      const child = new FakeChild(41_002)
      finishChild(child, { stdout: JSON.stringify({ target_directory: TARGET_DIRECTORY }) })
      return child
    }
    if (command === 'swiftc') {
      const child = new FakeChild(41_003)
      finishChild(child)
      return child
    }
    if (command.endsWith('post-key-events')) {
      const child = new FakeChild(41_004)
      finishChild(child, { stdout: 'denied' })
      return child
    }
    if (command.endsWith('/debug/terminal')) {
      harness.publishRound(1)
      return harness.appChild
    }
    return harness.appChild
  }

  const result = await runInputProbe({
    cwd: PROJECT_ROOT,
    env: {},
    checkpointOnly: true,
    skipBuild: true,
    targetDirectory: TARGET_DIRECTORY,
    dependencies,
  })

  assert.deepEqual(result, { checkpointObserved: true, injector: 'none' })
})

test('rejects invalid rounds and expected text before spawning', async () => {
  const { calls, dependencies } = createHarness({ accessDenied: true })

  await assert.rejects(
    runInputProbe({
      cwd: PROJECT_ROOT,
      dependencies,
      rounds: 0,
      skipBuild: true,
      targetDirectory: TARGET_DIRECTORY,
    }),
    /rounds/,
  )
  await assert.rejects(
    runInputProbe({
      cwd: PROJECT_ROOT,
      dependencies,
      expected: 'a\u0000b',
      skipBuild: true,
      targetDirectory: TARGET_DIRECTORY,
    }),
    /expected text/,
  )
  assert.equal(calls.spawn.length, 0)
})
