import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import {
  APP_TIMEOUT_MS,
  CARGO_METADATA_TIMEOUT_MS,
  FORCE_KILL_GRACE_MS,
  FRONTMOST_RETRY_LIMIT,
  isFrontmostPreconditionFailure,
  parseTerminalSmokeResult,
  runTerminalSmoke,
  smokeCaseLabel,
} from './run-terminal-smoke.mjs'
import {
  parseMatrixArguments,
  runMatrixCases,
  selectCases,
} from './run-terminal-smoke-matrix.mjs'
import { waitForClose } from './run-terminal-smoke.mjs'
import {
  assertSmokeInstrumentedBinary,
  buildFreshTauriBinary,
  findInstrumentedChunkNames,
  packageManagerCommand,
  terminalExecutablePath,
} from './run-terminal-smoke.mjs'

const PROJECT_ROOT = '/workspace/terminal'
const TEMP_ROOT = '/private/tmp'
const RUN_DIRECTORY = '/private/tmp/terminal-smoke-fixture'
const TARGET_DIRECTORY = '/workspace/terminal-target'
const SSH_CONFIG_PATH = path.join(RUN_DIRECTORY, 'sshd', 'connection.json')
const TAURI_BUILD_TIMEOUT_MS = 900_000

test('resolves platform-specific package and Tauri executable names', () => {
  assert.equal(packageManagerCommand('darwin'), 'pnpm')
  assert.equal(packageManagerCommand('linux'), 'pnpm')
  assert.equal(packageManagerCommand('win32'), 'pnpm.cmd')
  assert.equal(
    terminalExecutablePath(TARGET_DIRECTORY, { platform: 'darwin' }),
    path.join(TARGET_DIRECTORY, 'debug', 'terminal'),
  )
  assert.equal(
    terminalExecutablePath(TARGET_DIRECTORY, { platform: 'win32' }),
    path.join(TARGET_DIRECTORY, 'debug', 'terminal.exe'),
  )
  assert.equal(
    terminalExecutablePath(TARGET_DIRECTORY, {
      platform: 'win32',
      release: true,
    }),
    path.join(TARGET_DIRECTORY, 'release', 'terminal.exe'),
  )
})

const passingResult = {
  ok: true,
  stage: 'complete',
  error: null,
  loadBytes: 8_388_608,
  roundsCompleted: 10,
  uniqueSessionCount: 10,
  resourcesRecovered: true,
  durationMs: 12_345,
  terminalCols: 97,
  terminalRows: 31,
  loadEndVisible: true,
  afterLoadVisible: true,
  resizedSizeVisible: true,
  resizeTrace: [
    { requestedCols: 132, requestedRows: 43, observedCols: 132, observedRows: 43 },
    { requestedCols: 90, requestedRows: 30, observedCols: 90, observedRows: 30 },
    { requestedCols: 120, requestedRows: 40, observedCols: 120, observedRows: 40 },
    { requestedCols: 97, requestedRows: 31, observedCols: 97, observedRows: 31 },
  ],
  reconnectObserved: false,
  hostWakeSynthesized: false,
  staleOutputRejected: false,
  firstConnectionMs: 1_234,
}

const reconnectPassingResult = {
  ...passingResult,
  uniqueSessionCount: 11,
  reconnectObserved: true,
  staleOutputRejected: true,
}

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killSignals = []
  onKill = undefined

  constructor(pid) {
    super()
    this.pid = pid
  }

  kill(signal) {
    this.killSignals.push(signal)
    this.onKill?.(signal)
    return true
  }
}

function finishChild(child, { code = 0, signal = null, stdout = '' } = {}) {
  queueMicrotask(() => {
    child.stdout.end(stdout)
    child.stderr.end()
    child.emit('close', code, signal)
  })
}

function createHarness({
  appExitCode = 0,
  buildExitCode = 0,
  closeApp = true,
  closeBuild = true,
  closeMetadata = true,
  result = passingResult,
  reconnectReady = false,
  restartError = null,
} = {}) {
  const calls = {
    chmod: [],
    mkdtemp: [],
    killProcess: [],
    readFile: [],
    rm: [],
    spawn: [],
    startSshd: [],
    stopSshd: 0,
    restartSshd: 0,
    frontmost: [],
    writeFile: [],
  }
  const appChild = new FakeChild(41_003)
  const buildChild = new FakeChild(41_001)
  const metadataChild = new FakeChild(41_002)
  let appClosed = false
  let reconnectCheckpointReady = reconnectReady

  const dependencies = {
    chmod: async (...args) => calls.chmod.push(args),
    clearTimeout: globalThis.clearTimeout,
    killProcess: (pid, signal) => {
      calls.killProcess.push({ pid, signal })
      if (pid === -buildChild.pid) buildChild.onKill?.(signal)
    },
    mkdtemp: async prefix => {
      calls.mkdtemp.push(prefix)
      return RUN_DIRECTORY
    },
    platform: 'darwin',
    access: async filePath => {
      if (filePath.endsWith('agent.sock')) return
      if (!reconnectCheckpointReady) throw new Error('checkpoint pending')
    },
    readFile: async (...args) => {
      assert.equal(appClosed, true, 'result must be read after child close')
      calls.readFile.push(args)
      return JSON.stringify(result)
    },
    rm: async (...args) => calls.rm.push(args),
    setTimeout,
    startSshd: async options => {
      calls.startSshd.push(options)
      return {
        configPath: SSH_CONFIG_PATH,
        restart: async () => {
          calls.restartSshd += 1
          if (restartError) throw restartError
        },
        stop: async () => {
          calls.stopSshd += 1
        },
      }
    },
    ensureFrontmost: async (pid, runDirectory) => {
      calls.frontmost.push({ pid, runDirectory })
    },
    spawn: (command, args, options) => {
      calls.spawn.push({ command, args, options })
      if (command === 'pnpm' || command === 'pnpm.cmd') {
        if (closeBuild) finishChild(buildChild, { code: buildExitCode })
        return buildChild
      }
      if (command === 'cargo') {
        if (closeMetadata) {
          finishChild(metadataChild, {
            stdout: JSON.stringify({ target_directory: TARGET_DIRECTORY }),
          })
        }
        return metadataChild
      }

      if (closeApp) {
        queueMicrotask(() => {
          appClosed = true
          appChild.emit('close', appExitCode, null)
        })
      }
      return appChild
    },
    tempDirectory: TEMP_ROOT,
    writeFile: async (...args) => calls.writeFile.push(args),
  }

  return {
    appChild,
    buildChild,
    calls,
    dependencies,
    metadataChild,
    setAppClosed: value => (appClosed = value),
    setReconnectCheckpointReady: value => (reconnectCheckpointReady = value),
  }
}

test('runs the built macOS binary with an isolated direct shell', async () => {
  const { calls, dependencies } = createHarness()

  const result = await runTerminalSmoke({
    cwd: PROJECT_ROOT,
    env: { KEEP_ME: 'yes' },
    dependencies,
  })

  assert.deepEqual(result, passingResult)
  assert.deepEqual(calls.mkdtemp, [path.join(TEMP_ROOT, 'terminal-smoke-')])
  assert.equal(calls.spawn.length, 3)

  const buildCall = calls.spawn[0]
  assert.equal(buildCall.command, 'pnpm')
  assert.deepEqual(buildCall.args, [
    'tauri',
    'build',
    '--debug',
    '--no-bundle',
  ])
  assert.equal(buildCall.options.cwd, PROJECT_ROOT)
  assert.deepEqual(buildCall.options.env, {
    KEEP_ME: 'yes',
    VITE_TERMINAL_SMOKE_BUILD: '1',
  })
  assert.equal(buildCall.options.detached, true)
  assert.equal(buildCall.options.shell, false)
  assert.equal(buildCall.options.stdio, 'inherit')

  const metadataCall = calls.spawn[1]
  assert.equal(metadataCall.command, 'cargo')
  assert.deepEqual(metadataCall.args, [
    'metadata',
    '--format-version',
    '1',
    '--no-deps',
    '--locked',
    '--manifest-path',
    path.join(PROJECT_ROOT, 'src-tauri/Cargo.toml'),
  ])

  const resultPath = path.join(RUN_DIRECTORY, 'result.json')
  const appCall = calls.spawn[2]
  assert.equal(
    appCall.command,
    path.join(TARGET_DIRECTORY, 'debug', 'terminal'),
  )
  assert.deepEqual(appCall.args, [])
  assert.equal(appCall.options.shell, false)
  assert.equal(appCall.options.stdio, 'inherit')
  assert.equal(appCall.options.env.KEEP_ME, 'yes')
  assert.equal(appCall.options.env.TERMINAL_SMOKE, '1')
  assert.equal(appCall.options.env.TERMINAL_SMOKE_RESULT_PATH, resultPath)
  assert.equal(
    appCall.options.env.TERMINAL_SMOKE_SSH_CONFIG_PATH,
    SSH_CONFIG_PATH,
  )
  assert.equal(appCall.options.env.HOME, RUN_DIRECTORY)
  assert.equal(appCall.options.env.HISTFILE, '/dev/null')
  assert.equal(appCall.options.env.PS1, '')
  assert.equal(appCall.options.env.PS2, '')
  assert.equal('ENV' in appCall.options.env, false)
  assert.equal('BASH_ENV' in appCall.options.env, false)
  assert.equal('PROMPT_COMMAND' in appCall.options.env, false)
  assert.equal('CDPATH' in appCall.options.env, false)
  assert.equal(calls.writeFile.length, 0)
  assert.equal(calls.chmod.length, 0)
  assert.deepEqual(calls.startSshd, [{ runDirectory: RUN_DIRECTORY }])
  assert.equal(calls.stopSshd, 1)
  assert.deepEqual(calls.readFile, [[resultPath, 'utf8']])
  assert.deepEqual(calls.rm, [
    [RUN_DIRECTORY, { recursive: true, force: true }],
  ])
})

test('launches the Windows pnpm.cmd shim through a shell', async () => {
  const { calls, dependencies } = createHarness()
  dependencies.platform = 'win32'

  await buildFreshTauriBinary({
    cwd: PROJECT_ROOT,
    env: { KEEP_ME: 'yes' },
    dependencies,
  })

  assert.equal(calls.spawn.length, 1)
  assert.equal(calls.spawn[0].command, 'pnpm.cmd')
  assert.deepEqual(calls.spawn[0].args, [
    'tauri',
    'build',
    '--debug',
    '--no-bundle',
  ])
  assert.equal(calls.spawn[0].options.shell, true)
  assert.equal(calls.spawn[0].options.detached, true)
})

test('does not inspect Cargo or start fixtures when the Tauri build fails', async () => {
  const { calls, dependencies } = createHarness({ buildExitCode: 27 })

  await assert.rejects(
    runTerminalSmoke({ cwd: PROJECT_ROOT, dependencies }),
    /Tauri debug build exited with code 27/,
  )

  assert.equal(calls.spawn.length, 1)
  assert.equal(calls.spawn[0].command, 'pnpm')
  assert.equal(calls.mkdtemp.length, 0)
  assert.equal(calls.startSshd.length, 0)
})

test('builds and launches the release profile when release is requested', async () => {
  const { calls, dependencies } = createHarness()

  await runTerminalSmoke({ cwd: PROJECT_ROOT, release: true, dependencies })

  const buildCall = calls.spawn[0]
  assert.equal(buildCall.command, 'pnpm')
  assert.deepEqual(buildCall.args, ['tauri', 'build', '--no-bundle'])
  assert.equal(
    buildCall.args.includes('--debug'),
    false,
    'the release profile must not pass --debug',
  )
  assert.equal(
    calls.spawn[2].command,
    path.join(TARGET_DIRECTORY, 'release', 'terminal'),
    'the release binary must come from target/release',
  )
})

test('reports the release profile in build failures', async () => {
  const { dependencies } = createHarness({ buildExitCode: 27 })

  await assert.rejects(
    runTerminalSmoke({ cwd: PROJECT_ROOT, release: true, dependencies }),
    /Tauri release build exited with code 27/,
  )
})

test('terminates the Tauri build process group when its deadline expires', async () => {
  const { buildChild, calls, dependencies } = createHarness({
    closeBuild: false,
  })
  const delays = []
  dependencies.setTimeout = (callback, delay) => {
    const handle = { callback, delay }
    delays.push(delay)
    queueMicrotask(callback)
    return handle
  }
  buildChild.onKill = signal => {
    if (signal !== 'SIGKILL') return
    queueMicrotask(() => buildChild.emit('close', null, 'SIGKILL'))
  }

  await assert.rejects(
    runTerminalSmoke({ cwd: PROJECT_ROOT, dependencies }),
    new RegExp(`Tauri debug build timed out after ${TAURI_BUILD_TIMEOUT_MS} ms`),
  )

  assert.deepEqual(delays, [TAURI_BUILD_TIMEOUT_MS, FORCE_KILL_GRACE_MS])
  assert.deepEqual(calls.killProcess, [
    { pid: -buildChild.pid, signal: 'SIGTERM' },
    { pid: -buildChild.pid, signal: 'SIGKILL' },
  ])
  assert.equal(calls.spawn.length, 1)
  assert.equal(calls.mkdtemp.length, 0)
  assert.equal(calls.startSshd.length, 0)
})

test('restarts the real SSH fixture only after the reconnect checkpoint', async () => {
  const { appChild, calls, dependencies } = createHarness({
    reconnectReady: true,
    result: {
      ...passingResult,
      uniqueSessionCount: 11,
      reconnectObserved: true,
      hostWakeSynthesized: false,
      staleOutputRejected: true,
    },
  })

  const result = await runTerminalSmoke({
    cwd: PROJECT_ROOT,
    env: {},
    reconnect: true,
    dependencies,
  })

  assert.equal(result.reconnectObserved, true)
  assert.equal(result.staleOutputRejected, true)
  assert.equal(result.uniqueSessionCount, 11)
  assert.equal(calls.restartSshd, 1)
  assert.deepEqual(calls.frontmost, [
    { pid: appChild.pid, runDirectory: RUN_DIRECTORY },
  ])
  const appCall = calls.spawn.at(-1)
  assert.equal(
    appCall.options.env.TERMINAL_SMOKE_RECONNECT_CONTROL_PATH,
    path.join(RUN_DIRECTORY, 'reconnect.ready'),
  )
  assert.equal(appChild.killSignals.length, 0)
})

test('terminates the smoke app when the SSH restart fails', async () => {
  const { appChild, calls, dependencies, setAppClosed } = createHarness({
    closeApp: false,
    reconnectReady: true,
    restartError: new Error('controlled SSH restart failed'),
  })
  appChild.onKill = signal => {
    if (signal !== 'SIGTERM') return
    queueMicrotask(() => {
      setAppClosed(true)
      appChild.emit('close', null, 'SIGTERM')
    })
  }

  await assert.rejects(
    runTerminalSmoke({
      cwd: PROJECT_ROOT,
      reconnect: true,
      dependencies,
    }),
    /controlled SSH restart failed/,
  )

  assert.deepEqual(appChild.killSignals, ['SIGTERM'])
  assert.equal(calls.stopSshd, 1)
  assert.deepEqual(calls.rm, [
    [RUN_DIRECTORY, { recursive: true, force: true }],
  ])
})

test('rejects unsupported hosts before spawning or creating files', async () => {
  const { calls, dependencies } = createHarness()
  dependencies.platform = 'win32'

  await assert.rejects(
    runTerminalSmoke({ cwd: PROJECT_ROOT, dependencies }),
    /only supported on macOS and Linux/,
  )

  assert.equal(calls.spawn.length, 0)
  assert.equal(calls.mkdtemp.length, 0)
})

test('does not start the app when isolated OpenSSH setup fails', async () => {
  const { calls, dependencies } = createHarness()
  dependencies.startSshd = async options => {
    calls.startSshd.push(options)
    throw new Error('OpenSSH readiness probe failed')
  }

  await assert.rejects(
    runTerminalSmoke({ cwd: PROJECT_ROOT, dependencies }),
    /OpenSSH readiness probe failed/,
  )

  assert.equal(calls.spawn.length, 2)
  assert.equal(calls.stopSshd, 0)
  assert.deepEqual(calls.rm, [
    [RUN_DIRECTORY, { recursive: true, force: true }],
  ])
})

test('bounds cargo metadata with SIGTERM, SIGKILL, and close waiting', async () => {
  const { calls, dependencies, metadataChild } = createHarness({
    closeMetadata: false,
  })
  const delays = []
  let metadataClosed = false
  dependencies.setTimeout = (callback, delay) => {
    const handle = { callback, delay }
    delays.push(delay)
    if (delay !== TAURI_BUILD_TIMEOUT_MS) queueMicrotask(callback)
    return handle
  }
  metadataChild.on('close', () => {
    metadataClosed = true
  })
  metadataChild.onKill = signal => {
    if (signal !== 'SIGKILL') return
    queueMicrotask(() => metadataChild.emit('close', null, 'SIGKILL'))
  }

  const missingTimeoutGuard = new Promise((_, reject) => {
    setImmediate(() => reject(new Error('cargo metadata timeout guard fired')))
  })
  await assert.rejects(
    Promise.race([
      runTerminalSmoke({ cwd: PROJECT_ROOT, dependencies }),
      missingTimeoutGuard,
    ]),
    new RegExp(
      `cargo metadata timed out after ${CARGO_METADATA_TIMEOUT_MS} ms`,
    ),
  )

  assert.equal(metadataClosed, true)
  assert.deepEqual(delays, [
    TAURI_BUILD_TIMEOUT_MS,
    CARGO_METADATA_TIMEOUT_MS,
    FORCE_KILL_GRACE_MS,
  ])
  assert.deepEqual(metadataChild.killSignals, ['SIGTERM', 'SIGKILL'])
  assert.equal(calls.spawn.length, 2)
  assert.equal(calls.mkdtemp.length, 0)
})

test('requires the exact successful lifecycle result contract', () => {
  assert.deepEqual(
    parseTerminalSmokeResult(JSON.stringify(passingResult)),
    passingResult,
  )

  for (const key of Object.keys(passingResult)) {
    const missing = { ...passingResult }
    delete missing[key]
    assert.throws(
      () => parseTerminalSmokeResult(JSON.stringify(missing)),
      /Invalid terminal smoke result/,
      `missing ${key} must fail`,
    )
  }

  assert.throws(
    () =>
      parseTerminalSmokeResult(
        JSON.stringify({ ...passingResult, unexpected: true }),
      ),
    /Invalid terminal smoke result/,
  )
  assert.throws(
    () =>
      parseTerminalSmokeResult(
        JSON.stringify({ ...passingResult, durationMs: 180_001 }),
      ),
    /Invalid terminal smoke result/,
  )
  assert.throws(
    () =>
      parseTerminalSmokeResult(
        JSON.stringify({ ...passingResult, resizedSizeVisible: false }),
      ),
    /Invalid terminal smoke result/,
  )
})

test('preserves the reported stage and error when the smoke fails', () => {
  assert.throws(
    () =>
      parseTerminalSmokeResult(
        JSON.stringify({
          ...passingResult,
          ok: false,
          stage: 'load',
          error: 'frontend output ACK timed out',
        }),
      ),
    /stage load: frontend output ACK timed out/,
  )
})

test('times out with SIGTERM, escalates after three seconds, and waits for close', async () => {
  const { appChild, calls, dependencies, setAppClosed } = createHarness({
    closeApp: false,
  })
  const delays = []
  dependencies.setTimeout = (callback, delay) => {
    const handle = { callback, delay }
    delays.push(delay)
    if (
      delay !== TAURI_BUILD_TIMEOUT_MS &&
      delay !== CARGO_METADATA_TIMEOUT_MS
    ) {
      queueMicrotask(callback)
    }
    return handle
  }
  appChild.onKill = signal => {
    if (signal !== 'SIGKILL') return
    queueMicrotask(() => {
      setAppClosed(true)
      appChild.emit('close', null, 'SIGKILL')
    })
  }

  await assert.rejects(
    runTerminalSmoke({ cwd: PROJECT_ROOT, dependencies }),
    /timed out after 210000 ms/,
  )

  assert.deepEqual(delays, [
    TAURI_BUILD_TIMEOUT_MS,
    CARGO_METADATA_TIMEOUT_MS,
    APP_TIMEOUT_MS,
    FORCE_KILL_GRACE_MS,
  ])
  assert.deepEqual(appChild.killSignals, ['SIGTERM', 'SIGKILL'])
  assert.equal(calls.readFile.length, 0)
  assert.deepEqual(calls.rm, [
    [RUN_DIRECTORY, { recursive: true, force: true }],
  ])
})

test('reports the structured smoke failure when the app exits unsuccessfully', async () => {
  const { calls, dependencies } = createHarness({
    appExitCode: 1,
    result: {
      ...passingResult,
      ok: false,
      stage: 'connecting',
      error: 'SSH host key rejected',
    },
  })

  await assert.rejects(
    runTerminalSmoke({ cwd: PROJECT_ROOT, dependencies }),
    /stage connecting: SSH host key rejected/,
  )

  assert.equal(calls.readFile.length, 1)
})

test('aborts the smoke app and still stops its fixture when the matrix cancels a case', async () => {
  const harness = createHarness({ closeApp: false })
  harness.appChild.onKill = signal => {
    if (signal !== 'SIGTERM') return
    harness.setAppClosed(true)
    queueMicrotask(() => harness.appChild.emit('close', null, signal))
  }
  const controller = new AbortController()
  const smoke = runTerminalSmoke({
    cwd: PROJECT_ROOT,
    env: {},
    skipBuild: true,
    targetDirectory: TARGET_DIRECTORY,
    dependencies: harness.dependencies,
    signal: controller.signal,
  })
  await new Promise(resolve => setImmediate(resolve))
  controller.abort(new Error('matrix deadline'))

  await assert.rejects(smoke, /matrix deadline/)
  assert.deepEqual(harness.appChild.killSignals, ['SIGTERM'])
  assert.equal(harness.calls.stopSshd, 1)
})

test('cancels fixture startup and stops a fixture that resolves after cancellation', async () => {
  const harness = createHarness()
  let resolveFixture
  harness.dependencies.startSshd = async () =>
    new Promise(resolve => {
      resolveFixture = () =>
        resolve({
          configPath: SSH_CONFIG_PATH,
          stop: async () => {
            harness.calls.stopSshd += 1
          },
        })
    })
  const controller = new AbortController()
  const smoke = runTerminalSmoke({
    cwd: PROJECT_ROOT,
    env: {},
    skipBuild: true,
    targetDirectory: TARGET_DIRECTORY,
    dependencies: harness.dependencies,
    signal: controller.signal,
  })
  await new Promise(resolve => setImmediate(resolve))
  controller.abort(new Error('matrix deadline'))
  resolveFixture()
  await assert.rejects(smoke, /matrix deadline/)

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(harness.calls.stopSshd, 1)
})

function createMatrixHarness({
  closeBuild = true,
  closeMetadata = true,
  closeApp = true,
  result = passingResult,
} = {}) {
  const calls = {
    spawn: [],
    startPasswordSshd: 0,
    startSshd: [],
    restartSshd: [],
    stopSshd: 0,
    stopAgent: 0,
    frontmost: [],
    writeFile: [],
  }
  const buildChild = new FakeChild(51_001)
  const metadataChild = new FakeChild(51_002)
  const appChild = new FakeChild(51_003)
  const agentChild = new FakeChild(51_004)
  let appClosed = false

  const dependencies = {
    access: async filePath => {
      if (filePath.endsWith('agent.sock')) return
      if (filePath.endsWith('reconnect.ready')) return
      throw new Error('unexpected access')
    },
    chmod: async () => {},
    clearTimeout: globalThis.clearTimeout,
    killProcess: () => {},
    mkdtemp: async prefix => RUN_DIRECTORY,
    platform: 'darwin',
    readFile: async (...args) => {
      assert.equal(appClosed, true, 'result must be read after child close')
      return JSON.stringify(result)
    },
    rm: async () => {},
    setTimeout,
    startPasswordSshd: async options => {
      calls.startPasswordSshd += 1
      return {
        configPath: SSH_CONFIG_PATH,
        restart: async () => {},
        stop: async () => {
          calls.stopSshd += 1
        },
      }
    },
    startSshd: async options => {
      calls.startSshd.push(options)
      return {
        configPath: SSH_CONFIG_PATH,
        restart: async () => {
          calls.restartSshd.push(options)
        },
        stop: async () => {
          calls.stopSshd += 1
        },
      }
    },
    ensureFrontmost: async (pid, runDirectory) => {
      calls.frontmost.push({ pid, runDirectory })
    },
    spawn: (command, args, options) => {
      calls.spawn.push({ command, args, options })
      if (command === 'pnpm') {
        if (closeBuild) finishChild(buildChild, { code: 0 })
        return buildChild
      }
      if (command === 'cargo') {
        if (closeMetadata) {
          finishChild(metadataChild, {
            stdout: JSON.stringify({ target_directory: TARGET_DIRECTORY }),
          })
        }
        return metadataChild
      }
      if (command === '/usr/bin/ssh-agent') {
        return agentChild
      }
      if (command === '/usr/bin/ssh-add') {
        const child = new FakeChild(51_005)
        finishChild(child, { code: 0 })
        return child
      }
      if (closeApp) {
        queueMicrotask(() => {
          appClosed = true
          appChild.emit('close', 0, null)
        })
      }
      return appChild
    },
    tempDirectory: TEMP_ROOT,
    writeFile: async (...args) => calls.writeFile.push(args),
  }

  return { agentChild, calls, dependencies }
}

test('routes the password case to the container fixture', async () => {
  const { calls, dependencies } = createMatrixHarness()

  const result = await runTerminalSmoke({
    cwd: PROJECT_ROOT,
    env: {},
    auth: 'password',
    skipBuild: true,
    targetDirectory: TARGET_DIRECTORY,
    dependencies,
  })

  assert.deepEqual(result, passingResult)
  assert.equal(calls.startPasswordSshd, 1)
  assert.equal(calls.startSshd.length, 0)
})

test('runs the agent case with an isolated ssh-agent holding the smoke key', async () => {
  const { agentChild, calls, dependencies } = createMatrixHarness()
  agentChild.onKill = signal => {
    if (signal === 'SIGTERM') finishChild(agentChild, { signal })
  }

  const result = await runTerminalSmoke({
    cwd: PROJECT_ROOT,
    env: {},
    auth: 'agent',
    skipBuild: true,
    targetDirectory: TARGET_DIRECTORY,
    dependencies,
  })

  assert.deepEqual(result, passingResult)
  assert.deepEqual(calls.startSshd, [
    { runDirectory: RUN_DIRECTORY, connectionExtra: { authMode: 'agent', privateKey: null } },
  ])
  const agentCall = calls.spawn.find(call => call.command === '/usr/bin/ssh-agent')
  assert.ok(agentCall)
  assert.ok(agentCall.args[1].endsWith('agent.sock'))
  const appCall = calls.spawn.find(call => call.command.endsWith('/debug/terminal'))
  assert.match(appCall.options.env.SSH_AUTH_SOCK, /agent\.sock$/)
  assert.deepEqual(agentChild.killSignals, ['SIGTERM'])
})

test('stops the SSH fixture when agent setup fails', async () => {
  const { calls, dependencies } = createMatrixHarness()
  const originalSpawn = dependencies.spawn
  dependencies.spawn = (command, args, options) => {
    if (command === '/usr/bin/ssh-agent') {
      throw new Error('ssh-agent unavailable')
    }
    return originalSpawn(command, args, options)
  }

  await assert.rejects(
    runTerminalSmoke({
      cwd: PROJECT_ROOT,
      env: {},
      auth: 'agent',
      skipBuild: true,
      targetDirectory: TARGET_DIRECTORY,
      dependencies,
    }),
    /ssh-agent unavailable/,
  )
  assert.equal(calls.stopSshd, 1)
})

test('composes the jump connection from target and jump fixtures', async () => {
  const { calls, dependencies } = createMatrixHarness()

  const result = await runTerminalSmoke({
    cwd: PROJECT_ROOT,
    env: {},
    auth: 'jump',
    skipBuild: true,
    targetDirectory: TARGET_DIRECTORY,
    dependencies,
  })

  assert.deepEqual(result, passingResult)
  assert.equal(calls.startSshd.length, 2)
  assert.deepEqual(calls.startSshd[0], { runDirectory: RUN_DIRECTORY })
  assert.deepEqual(calls.startSshd[1], {
    runDirectory: path.join(RUN_DIRECTORY, 'jump'),
    role: 'jump',
    targetPort: undefined,
  })
  const configWrite = calls.writeFile.find(([filePath]) =>
    filePath === SSH_CONFIG_PATH,
  )
  assert.ok(configWrite, 'the composed jump connection must be written')
})

test('stops a target fixture when jump setup fails', async () => {
  const { calls, dependencies } = createMatrixHarness()
  const originalStartSshd = dependencies.startSshd
  dependencies.startSshd = async options => {
    if (calls.startSshd.length === 1) throw new Error('jump fixture unavailable')
    return originalStartSshd(options)
  }

  await assert.rejects(
    runTerminalSmoke({
      cwd: PROJECT_ROOT,
      env: {},
      auth: 'jump',
      skipBuild: true,
      targetDirectory: TARGET_DIRECTORY,
      dependencies,
    }),
    /jump fixture unavailable/,
  )
  assert.equal(calls.stopSshd, 1)
})

test('restarts the jump transport before the target during reconnect', async () => {
  const { calls, dependencies } = createMatrixHarness({
    result: reconnectPassingResult,
  })

  const result = await runTerminalSmoke({
    cwd: PROJECT_ROOT,
    env: {},
    auth: 'jump',
    reconnect: true,
    skipBuild: true,
    targetDirectory: TARGET_DIRECTORY,
    dependencies,
  })

  assert.deepEqual(result, reconnectPassingResult)
  assert.deepEqual(calls.restartSshd, [
    {
      runDirectory: path.join(RUN_DIRECTORY, 'jump'),
      role: 'jump',
      targetPort: undefined,
    },
    { runDirectory: RUN_DIRECTORY },
  ])
  assert.deepEqual(calls.frontmost, [
    { pid: 51_003, runDirectory: RUN_DIRECTORY },
  ])
})

test('rejects unsupported authentication modes before spawning', async () => {
  const { calls, dependencies } = createMatrixHarness()

  await assert.rejects(
    runTerminalSmoke({
      cwd: PROJECT_ROOT,
      dependencies,
      auth: 'keyboard-interactive',
    }),
    /auth mode must be one of/,
  )

  assert.equal(calls.spawn.length, 0)
  assert.equal(calls.startSshd.length, 0)
})

test('selects the default matrix when no filter is given', () => {
  assert.deepEqual(
    selectCases(undefined).map(item => item.name),
    [
      'key',
      'key-reconnect',
      'key-outage-reconnect',
      'key-outage-wake-reconnect',
      'key-first-connect-outage',
      'password',
      'password-reconnect',
      'agent',
      'agent-reconnect',
      'cert',
      'cert-reconnect',
      'jump',
      'jump-reconnect',
    ],
  )
  assert.deepEqual(selectCases('').length, 13)
})

test('uses a host-wake control checkpoint instead of a fixed outage duration', () => {
  const [hostWakeCase] = selectCases('key-outage-wake-reconnect')

  assert.equal(hostWakeCase.outageHoldMs, undefined)
  assert.equal(hostWakeCase.hostWakeRequired, true)
})

test('preserves independent renderer heartbeats with host-wake failure diagnostics', async () => {
  const harness = createMatrixHarness({
    result: {
      ...passingResult,
      ok: false,
      stage: 'reconnect',
      error: 'host wake failed',
    },
  })
  const pulse = JSON.stringify({
    seq: 1,
    performanceNow: 234.5,
    visibilityState: 'visible',
    hasFocus: true,
    online: true,
  })
  let closeCount = 0
  harness.dependencies.startRendererHeartbeat = async () => ({
    endpoint: 'http://127.0.0.1:43127/heartbeat',
    token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    close: async () => {
      closeCount += 1
    },
  })
  const readFile = harness.dependencies.readFile
  harness.dependencies.readFile = async (filePath, ...args) => {
    if (filePath.endsWith('host-wake.events.ndjson')) {
      return '{"elapsedMs":1000,"event":"fallback-armed"}\n'
    }
    if (filePath.endsWith('renderer-heartbeat.ndjson')) return `${pulse}\n`
    return readFile(filePath, ...args)
  }

  await assert.rejects(
    runTerminalSmoke({
      cwd: PROJECT_ROOT,
      env: {},
      hostWakeRequired: true,
      skipBuild: true,
      targetDirectory: TARGET_DIRECTORY,
      dependencies: harness.dependencies,
    }),
    error => {
      assert.match(error.message, /hostWakeEvents=.*fallback-armed/)
      assert.match(error.message, /rendererHeartbeats=.*\"seq\":1/)
      return true
    },
  )

  const smokeInvocation = harness.calls.spawn.find(call =>
    call.command.endsWith('terminal'),
  )
  assert.equal(
    smokeInvocation.options.env.TERMINAL_SMOKE_RENDERER_HEARTBEAT_ENDPOINT,
    'http://127.0.0.1:43127/heartbeat',
  )
  assert.equal(
    smokeInvocation.options.env.TERMINAL_SMOKE_RENDERER_HEARTBEAT_TOKEN.length,
    64,
  )
  assert.equal(closeCount, 1)
})

test('selects comma-separated matrix cases in declaration order', () => {
  assert.deepEqual(
    selectCases('jump,key').map(item => item.name),
    ['key', 'jump'],
  )
  assert.deepEqual(
    selectCases(' password , password-reconnect ').map(item => item.name),
    ['password', 'password-reconnect'],
  )
})

test('rejects unknown matrix case filters before building', () => {
  assert.throws(() => selectCases('ssh-keys'), /unknown terminal smoke case 'ssh-keys'/)
  assert.throws(() => selectCases('key,passwordx'), /unknown terminal smoke case 'passwordx'/)
})

test('separates the release option from the positional case filter', () => {
  // The runner must never treat an option as a case name, otherwise
  // `--release` is rejected as an unknown case instead of selecting release.
  const positional = ['--release', 'key,jump']
    .filter(argument => !argument.startsWith('--'))
  assert.deepEqual(
    selectCases(positional[0]).map(item => item.name),
    ['key', 'jump'],
  )
  assert.deepEqual(
    selectCases(['--release'].filter(argument => !argument.startsWith('--'))[0]),
    selectCases(undefined),
  )
})

test('parses matrix options without treating them as case names', () => {
  assert.deepEqual(parseMatrixArguments([]), {
    filter: undefined,
    release: false,
    reuseBinary: false,
  })
  assert.deepEqual(parseMatrixArguments(['--release', '--reuse-binary', 'key']), {
    filter: 'key',
    release: true,
    reuseBinary: true,
  })
})

test('reusing the binary is opt-in so the default keeps measuring a fresh build', () => {
  // The matrix used to always rebuild, which meant a matrix run could never
  // describe the same artifact as a cold-start run measured moments earlier.
  assert.equal(parseMatrixArguments(['--release']).reuseBinary, false)
  assert.equal(parseMatrixArguments(['--release', '--reuse-binary']).reuseBinary, true)
})

test('detects smoke instrumentation from the embedded asset list', () => {
  // A shipping build references only real chunks; an instrumented one also
  // references the lazily loaded smoke/probe roots. The embedded filenames are
  // the only reliable discriminator, because both builds contain the guard
  // string 'Terminal smoke UI is not included in this build'.
  const shipping = findInstrumentedChunkNames(
    Buffer.from('index.Aa1.js hosts.Bb2.js container.Cc3.js'),
  )
  assert.deepEqual(shipping, [])

  const instrumented = findInstrumentedChunkNames(
    Buffer.from(
      'index.Aa1.js terminal-smoke-root.Dd4.js automation-root.Ee5.js shell.css',
    ),
  )
  assert.deepEqual(instrumented.sort(), [
    'automation-root.Ee5.js',
    'terminal-smoke-root.Dd4.js',
  ])
})

test('refuses to run smoke cases against a shipping binary', async () => {
  // Silently running ten cases that each fail with 'Terminal smoke UI is not
  // included in this build' hides the real cause: the binary on disk was never
  // instrumented, so it is not the artifact the matrix claims to measure.
  await assert.rejects(
    assertSmokeInstrumentedBinary(
      { executable: '/build/terminal' },
      { readFile: async () => Buffer.from('index.Aa1.js hosts.Bb2.js') },
    ),
    /built without VITE_TERMINAL_SMOKE_BUILD=1/,
  )
})

test('accepts an instrumented binary and reports what proved it', async () => {
  const chunks = await assertSmokeInstrumentedBinary(
    { executable: '/build/terminal' },
    {
      readFile: async () =>
        Buffer.from('index.Aa1.js terminal-smoke-root.Dd4.js'),
    },
  )
  assert.deepEqual(chunks, ['terminal-smoke-root.Dd4.js'])
})

test('a case that never settles is reported as failed instead of hanging the matrix', async () => {
  // A smoke case can stall on a fixture, a port, or a child process that keeps
  // its stdio open. Awaiting it directly means one stuck case silently cancels
  // every remaining acceptance case, so the run needs an explicit deadline.
  const started = Date.now()
  const results = await runMatrixCases(
    [
      { name: 'stuck', auth: 'key', reconnect: false },
      { name: 'later', auth: 'agent', reconnect: false },
    ],
    {
      runCase: async item =>
        item.name === 'stuck'
          ? new Promise(() => {})
          : {
              durationMs: 10,
              firstConnectionMs: 5,
              uniqueSessionCount: 10,
            },
      caseTimeoutMs: 60,
      onProgress: () => {},
    },
  )

  assert.equal(results[0].ok, false)
  assert.match(results[0].error, /timed out after 60 ms/)
  assert.equal(results[1].ok, true)
  assert.ok(Date.now() - started < 10_000)
})

test('aborts a timed out case and waits for its cleanup before the next case', async () => {
  const events = []
  const results = await runMatrixCases(
    [
      { name: 'stuck', auth: 'key', reconnect: false },
      { name: 'later', auth: 'agent', reconnect: false },
    ],
    {
      runCase: (item, { signal }) => {
        if (item.name === 'later') {
          events.push('later-start')
          return { durationMs: 10, firstConnectionMs: 5, uniqueSessionCount: 10 }
        }
        events.push('stuck-start')
        return new Promise((resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              events.push('stuck-abort')
              setTimeout(() => {
                events.push('stuck-cleanup')
                reject(signal.reason)
              }, 5)
            },
            { once: true },
          )
        })
      },
      caseTimeoutMs: 20,
      cleanupTimeoutMs: 100,
      onProgress: () => {},
    },
  )

  assert.deepEqual(events, [
    'stuck-start',
    'stuck-abort',
    'stuck-cleanup',
    'later-start',
  ])
  assert.equal(results[0].ok, false)
  assert.equal(results[1].ok, true)
})

test('a smoke app killed with a grandchild holding stdio still settles', async () => {
  // The runner escalates to SIGKILL on timeout. If only `exit` ever fires the
  // acceptance run would wait forever on a process it already gave up on.
  const child = new FakeChild()
  const settled = waitForClose(child)
  child.emit('exit', null, 'SIGKILL')
  assert.deepEqual(await settled, { code: null, signal: 'SIGKILL', spawnError: null })
})

// ---------------------------------------------------------------------------
// Frontmost precondition retries
//
// On a hosted macOS runner another application occasionally keeps focus across
// all eight accessibility attempts. That is a precondition, not a result, so a
// case may be re-run — but an authentication rejection, a timeout or a content
// mismatch must fail on the first attempt, otherwise the evidence would say
// "eventually green" instead of naming the defect.
// ---------------------------------------------------------------------------

const FRONTMOST_FAILURE =
  'expected process 41003 to be frontmost, got 351 after 8 attempts'

/**
 * createHarness whose application child is fresh per spawn.
 *
 * An attempt that is re-run spawns a second application, and a fake that hands
 * out the same already-ended streams twice would fail on the harness instead of
 * on the behaviour under test.
 */
function createRetryHarness(options) {
  const harness = createHarness(options)
  const appChildren = []
  const spawnChild = harness.dependencies.spawn
  harness.dependencies.spawn = (command, args, spawnOptions) => {
    if (command === 'pnpm' || command === 'cargo') {
      return spawnChild(command, args, spawnOptions)
    }
    const child = new FakeChild(43_000 + appChildren.length)
    appChildren.push(child)
    harness.calls.spawn.push({ command, args, options: spawnOptions })
    queueMicrotask(() => {
      harness.setAppClosed(true)
      child.emit('close', 0, null)
    })
    return child
  }
  return { ...harness, appChildren }
}

test('only the frontmost assertion is classified as retryable', () => {
  assert.equal(isFrontmostPreconditionFailure(new Error(FRONTMOST_FAILURE)), true)
  assert.equal(
    isFrontmostPreconditionFailure(
      new Error('smoke failed at stage connecting: authenticate SSH user failed'),
    ),
    false,
  )
  assert.equal(
    isFrontmostPreconditionFailure(new Error('smoke timed out after 210000 ms')),
    false,
  )
  assert.equal(isFrontmostPreconditionFailure('not an error object'), false)
  assert.equal(FRONTMOST_RETRY_LIMIT, 2)
})

test('a retry line names the same case the matrix selected', () => {
  for (const item of selectCases(undefined)) {
    if (!item.reconnect) continue
    assert.equal(smokeCaseLabel(item), item.name)
  }
})

test('retries a case that only lost the frontmost precondition and records the attempt', async t => {
  const log = t.mock.method(console, 'log', () => {})
  const { appChildren, calls, dependencies } = createRetryHarness({
    reconnectReady: true,
    result: reconnectPassingResult,
  })
  let attempts = 0
  dependencies.ensureFrontmost = async (pid, runDirectory) => {
    attempts += 1
    calls.frontmost.push({ pid, runDirectory })
    if (attempts === 1) throw new Error(FRONTMOST_FAILURE)
  }

  const result = await runTerminalSmoke({
    cwd: PROJECT_ROOT,
    reconnect: true,
    // Each attempt re-spawns only the application: the case under test is the
    // retry policy, not the build.
    skipBuild: true,
    targetDirectory: TARGET_DIRECTORY,
    dependencies,
  })

  assert.equal(attempts, 2)
  assert.equal(calls.mkdtemp.length, 2)
  assert.equal(appChildren.length, 2)
  assert.deepEqual(appChildren[0].killSignals, ['SIGTERM'])
  assert.equal(result.attempt, 2)
  assert.equal(result.frontmostRetries, 1)
  assert.equal(result.reconnectObserved, true)
  assert.equal(result.uniqueSessionCount, 11)
  const retryLine = log.mock.calls
    .map(call => call.arguments.join(' '))
    .find(line => line.includes('attempt 2/3 after a frontmost precondition failure'))
  assert.equal(
    retryLine,
    `[key-reconnect] attempt 2/3 after a frontmost precondition failure: ${FRONTMOST_FAILURE}`,
  )
  assert.ok(
    log.mock.calls
      .map(call => call.arguments.join(' '))
      .includes('[key-reconnect] attempt 2/3 passed after a frontmost precondition failure'),
  )
})

test('does not retry a functional failure', async () => {
  const { calls, dependencies } = createHarness({
    result: {
      ...passingResult,
      ok: false,
      stage: 'connecting',
      error:
        'smoke failed at stage connecting: authenticate SSH user failed: authentication failed: all methods rejected',
    },
  })

  await assert.rejects(
    runTerminalSmoke({
      cwd: PROJECT_ROOT,
      skipBuild: true,
      targetDirectory: TARGET_DIRECTORY,
      dependencies,
    }),
    /all methods rejected/,
  )

  assert.equal(calls.mkdtemp.length, 1)
  // One application spawn for the whole case: a functional failure is a result,
  // not a precondition to re-establish.
  assert.equal(calls.spawn.length, 1)
})

test('stops after three attempts when the frontmost precondition never holds', async () => {
  const { appChildren, calls, dependencies } = createRetryHarness({
    reconnectReady: true,
    result: reconnectPassingResult,
  })
  dependencies.ensureFrontmost = async (pid, runDirectory) => {
    calls.frontmost.push({ pid, runDirectory })
    throw new Error(FRONTMOST_FAILURE)
  }

  await assert.rejects(
    runTerminalSmoke({
      cwd: PROJECT_ROOT,
      reconnect: true,
      skipBuild: true,
      targetDirectory: TARGET_DIRECTORY,
      dependencies,
    }),
    new RegExp(`expected process 41003 to be frontmost`),
  )

  assert.equal(calls.mkdtemp.length, 3)
  assert.equal(calls.frontmost.length, 3)
  assert.equal(appChildren.length, 3)
  assert.deepEqual(
    appChildren.map(child => child.killSignals),
    [['SIGTERM'], ['SIGTERM'], ['SIGTERM']],
  )
})

