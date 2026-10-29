import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  parseRawInputProbeResult,
  runRawInputProbe,
} from './run-raw-input-probe.mjs'

const RESULT = {
  ok: true,
  caseName: 'sgr-mouse',
  expectedHex: '1b5b3c303b333b344d',
  receivedHex: '1b5b3c303b333b344d',
  durationMs: 12,
  error: null,
}

test('parses the strict single-case raw input result contract', () => {
  assert.deepEqual(
    parseRawInputProbeResult(JSON.stringify(RESULT), 'sgr-mouse'),
    RESULT,
  )
  assert.throws(
    () =>
      parseRawInputProbeResult(
        JSON.stringify({ ...RESULT, receivedHex: 'ff' }),
        'sgr-mouse',
      ),
    /contract mismatch/,
  )
})

test('raw input probe is macOS gated before spawning a binary', async () => {
  await assert.rejects(
    runRawInputProbe({
      skipBuild: true,
      dependencies: { platform: 'linux' },
    }),
    /only supported on macOS/,
  )
})

test('runner passes a dedicated case and result path to the gated binary', async () => {
  const child = new EventEmitter()
  child.kill = signal => queueMicrotask(() => child.emit('close', 0, signal))
  const calls = []
  const dependencies = {
    access: async () => {},
    clearTimeout,
    mkdtemp: async () => '/tmp/raw-input-probe-test',
    now: Date.now,
    platform: 'darwin',
    readFile: async () => JSON.stringify(RESULT),
    rm: async (...args) => calls.push(['rm', ...args]),
    setTimeout,
    spawn: (command, args, options) => {
      calls.push(['spawn', command, args, options])
      return child
    },
    tempDirectory: '/tmp',
  }
  const result = await runRawInputProbe({
    cwd: '/workspace/terminal',
    env: { KEEP_ME: 'yes' },
    skipBuild: true,
    targetDirectory: '/workspace/target',
    dependencies,
  })
  assert.deepEqual(result, { ...RESULT, caseName: 'sgr-mouse' })
  const spawnCall = calls.find(call => call[0] === 'spawn')
  assert.equal(spawnCall?.[1], '/workspace/target/debug/terminal')
  assert.equal(spawnCall?.[3].env.KEEP_ME, 'yes')
  assert.equal(spawnCall?.[3].env.TERMINAL_RAW_INPUT_PROBE, '1')
  assert.equal(spawnCall?.[3].env.TERMINAL_RAW_INPUT_PROBE_CASE, 'sgr-mouse')
  assert.equal(
    spawnCall?.[3].env.TERMINAL_RAW_INPUT_PROBE_RESULT_PATH,
    '/tmp/raw-input-probe-test/result.json',
  )
  assert.deepEqual(calls.at(-1), [
    'rm',
    '/tmp/raw-input-probe-test',
    { recursive: true, force: true },
  ])
})

test('runner escalates cleanup to SIGKILL when the app ignores SIGTERM', async () => {
  const child = new EventEmitter()
  const signals = []
  child.kill = signal => {
    signals.push(signal)
    if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', 0, signal))
  }
  const dependencies = {
    access: async () => {},
    clearTimeout: () => {},
    mkdtemp: async () => '/tmp/raw-input-probe-force-kill',
    now: Date.now,
    platform: 'darwin',
    readFile: async () => JSON.stringify(RESULT),
    rm: async () => {},
    setTimeout: callback => {
      callback()
      return 1
    },
    spawn: () => child,
    tempDirectory: '/tmp',
  }

  const result = await runRawInputProbe({
    cwd: '/workspace/terminal',
    skipBuild: true,
    targetDirectory: '/workspace/target',
    dependencies,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
})

test('runner cleans the temporary directory when the app emits an error', async () => {
  const child = new EventEmitter()
  child.kill = () => {}
  const calls = []
  const appError = new Error('fixture process failed')
  const dependencies = {
    access: async () => {
      throw new Error('result pending')
    },
    clearTimeout: () => {},
    mkdtemp: async () => '/tmp/raw-input-probe-error',
    now: Date.now,
    platform: 'darwin',
    readFile: async () => JSON.stringify(RESULT),
    rm: async (...args) => calls.push(args),
    setTimeout: () => 1,
    spawn: () => {
      queueMicrotask(() => child.emit('error', appError))
      return child
    },
    tempDirectory: '/tmp',
  }

  await assert.rejects(
    runRawInputProbe({
      cwd: '/workspace/terminal',
      skipBuild: true,
      targetDirectory: '/workspace/target',
      dependencies,
    }),
    /fixture process failed/,
  )
  assert.deepEqual(calls, [
    ['/tmp/raw-input-probe-error', { recursive: true, force: true }],
  ])
})
