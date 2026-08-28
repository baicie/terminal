import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import {
  APP_TIMEOUT_MS,
  CARGO_METADATA_TIMEOUT_MS,
  FORCE_KILL_GRACE_MS,
  parseTerminalSmokeResult,
  runTerminalSmoke,
} from './run-terminal-smoke.mjs'
import { selectCases } from './run-terminal-smoke-matrix.mjs'

const PROJECT_ROOT = '/workspace/terminal'
const TEMP_ROOT = '/private/tmp'
const RUN_DIRECTORY = '/private/tmp/terminal-smoke-fixture'
const TARGET_DIRECTORY = '/workspace/terminal-target'
const SSH_CONFIG_PATH = path.join(RUN_DIRECTORY, 'sshd', 'connection.json')
const TAURI_BUILD_TIMEOUT_MS = 900_000

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
  reconnectObserved: false,
  staleOutputRejected: false,
  firstConnectionMs: 1_234,
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
    spawn: (command, args, options) => {
      calls.spawn.push({ command, args, options })
      if (command === 'pnpm') {
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
    stopAgent: 0,
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
        stop: async () => {},
      }
    },
    startSshd: async options => {
      calls.startSshd.push(options)
      return {
        configPath: SSH_CONFIG_PATH,
        restart: async () => {},
        stop: async () => {},
      }
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
    ['key', 'key-reconnect', 'password', 'password-reconnect', 'agent', 'cert', 'jump'],
  )
  assert.deepEqual(selectCases('').length, 7)
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
