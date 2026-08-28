import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { startTerminalSmokeSshd } from './terminal-smoke-sshd.mjs'

export const APP_TIMEOUT_MS = 210_000
export const CARGO_METADATA_TIMEOUT_MS = 30_000
export const FORCE_KILL_GRACE_MS = 3_000
export const TAURI_BUILD_TIMEOUT_MS = 900_000

const LOAD_BYTES = 8_388_608
const TARGET_COLS = 97
const TARGET_ROWS = 31
const MAX_RESULT_DURATION_MS = 180_000
const RESULT_KEYS = [
  'afterLoadVisible',
  'durationMs',
  'error',
  'loadBytes',
  'loadEndVisible',
  'ok',
  'reconnectObserved',
  'resizedSizeVisible',
  'resourcesRecovered',
  'roundsCompleted',
  'stage',
  'staleOutputRejected',
  'terminalCols',
  'terminalRows',
  'uniqueSessionCount',
]
const PROFILE_ENVIRONMENT_KEYS = ['ENV', 'BASH_ENV', 'PROMPT_COMMAND', 'CDPATH']
const RECONNECT_CHECKPOINT_TIMEOUT_MS = 30_000
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')

const defaultDependencies = {
  access,
  clearTimeout: globalThis.clearTimeout,
  killProcess: process.kill,
  mkdtemp,
  now: Date.now,
  platform: process.platform,
  readFile,
  rm,
  setTimeout: globalThis.setTimeout,
  spawn,
  startSshd: startTerminalSmokeSshd,
  tempDirectory: os.tmpdir(),
}

function invalidResult(message) {
  return new Error(`Invalid terminal smoke result: ${message}`)
}

function hasExactKeys(value) {
  const keys = Object.keys(value).sort()
  return (
    keys.length === RESULT_KEYS.length &&
    keys.every((key, index) => key === RESULT_KEYS[index])
  )
}

export function parseTerminalSmokeResult(
  serialized,
  { reconnectRequired = false } = {},
) {
  let value
  try {
    value = JSON.parse(serialized)
  } catch {
    throw invalidResult('result is not valid JSON')
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !hasExactKeys(value)
  ) {
    throw invalidResult('unexpected result fields')
  }
  if (value.ok !== true) {
    const stage = typeof value.stage === 'string' ? value.stage : 'unknown'
    const error =
      typeof value.error === 'string' ? value.error : 'no error reported'
    throw invalidResult(`smoke failed at stage ${stage}: ${error}`)
  }
  if (value.stage !== 'complete' || value.error !== null) {
    throw invalidResult('smoke did not report a successful completion')
  }
  if (value.loadBytes !== LOAD_BYTES) {
    throw invalidResult(`expected ${LOAD_BYTES} load bytes`)
  }
  const expectedSessionCount = reconnectRequired ? 11 : 10
  if (
    value.roundsCompleted !== 10 ||
    value.uniqueSessionCount !== expectedSessionCount ||
    value.resourcesRecovered !== true
  ) {
    throw invalidResult(
      `expected ${expectedSessionCount} isolated sessions with recovered resources`,
    )
  }
  if (
    value.terminalCols !== TARGET_COLS ||
    value.terminalRows !== TARGET_ROWS
  ) {
    throw invalidResult(`expected terminal size ${TARGET_COLS}x${TARGET_ROWS}`)
  }
  if (
    value.loadEndVisible !== true ||
    value.afterLoadVisible !== true ||
    value.resizedSizeVisible !== true
  ) {
    throw invalidResult('all terminal markers must be visible')
  }
  if (value.reconnectObserved !== reconnectRequired) {
    throw invalidResult(
      reconnectRequired
        ? 'reconnect was not observed'
        : 'unexpected reconnect observation',
    )
  }
  if (value.staleOutputRejected !== reconnectRequired) {
    throw invalidResult(
      reconnectRequired
        ? 'retired session output was not rejected'
        : 'unexpected stale-output probe result',
    )
  }
  if (
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 1 ||
    value.durationMs > MAX_RESULT_DURATION_MS
  ) {
    throw invalidResult(
      `duration must be within 1..=${MAX_RESULT_DURATION_MS} ms`,
    )
  }

  return value
}

function collectOutput(stream) {
  let output = ''
  stream?.setEncoding('utf8')
  stream?.on('data', chunk => {
    output += chunk
  })
  return () => output
}

function waitForClose(child) {
  return new Promise(resolve => {
    let spawnError = null
    child.once('error', error => {
      spawnError = error
    })
    child.once('close', (code, signal) => {
      resolve({ code, signal, spawnError })
    })
  })
}

async function buildFreshTauriBinary({ cwd, env, dependencies }) {
  let child
  try {
    child = dependencies.spawn(
      'pnpm',
      ['tauri', 'build', '--debug', '--no-bundle'],
      {
        cwd,
        env: { ...env, VITE_TERMINAL_SMOKE_BUILD: '1' },
        detached: true,
        shell: false,
        stdio: 'inherit',
      },
    )
  } catch (error) {
    throw new Error(`Failed to start Tauri debug build: ${error.message}`)
  }

  const status = await waitForTimedClose(
    child,
    dependencies,
    TAURI_BUILD_TIMEOUT_MS,
    signalProcessGroup,
  )
  if (status.timedOut) {
    throw new Error(
      `Tauri debug build timed out after ${TAURI_BUILD_TIMEOUT_MS} ms`,
    )
  }
  if (status.spawnError) {
    throw new Error(
      `Failed to run Tauri debug build: ${status.spawnError.message}`,
    )
  }
  if (status.code !== 0) {
    throw new Error(
      `Tauri debug build exited with code ${String(status.code)}${status.signal ? ` (${status.signal})` : ''}`,
    )
  }
}

async function cargoTargetDirectory({ cwd, env, dependencies }) {
  const manifestPath = path.join(cwd, 'src-tauri/Cargo.toml')
  let child
  try {
    child = dependencies.spawn(
      'cargo',
      [
        'metadata',
        '--format-version',
        '1',
        '--no-deps',
        '--locked',
        '--manifest-path',
        manifestPath,
      ],
      {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
  } catch (error) {
    throw new Error(`Failed to start cargo metadata: ${error.message}`)
  }

  const stdout = collectOutput(child.stdout)
  const stderr = collectOutput(child.stderr)
  const status = await waitForTimedClose(
    child,
    dependencies,
    CARGO_METADATA_TIMEOUT_MS,
  )
  if (status.timedOut) {
    throw new Error(
      `cargo metadata timed out after ${CARGO_METADATA_TIMEOUT_MS} ms`,
    )
  }
  if (status.spawnError) {
    throw new Error(
      `Failed to run cargo metadata: ${status.spawnError.message}`,
    )
  }
  if (status.code !== 0) {
    const detail = stderr().trim()
    throw new Error(
      `cargo metadata exited with code ${String(status.code)}${detail ? `: ${detail}` : ''}`,
    )
  }

  let metadata
  try {
    metadata = JSON.parse(stdout())
  } catch {
    throw new Error('cargo metadata returned invalid JSON')
  }
  if (
    typeof metadata?.target_directory !== 'string' ||
    !path.isAbsolute(metadata.target_directory)
  ) {
    throw new Error(
      'cargo metadata did not return an absolute target_directory',
    )
  }
  return metadata.target_directory
}

function signalChild(child, signal) {
  try {
    child.kill(signal)
  } catch {
    // The process may have closed between the timeout callback and kill.
  }
}

function signalProcessGroup(child, signal, dependencies) {
  if (Number.isSafeInteger(child.pid) && child.pid > 0) {
    try {
      dependencies.killProcess(-child.pid, signal)
      return
    } catch {
      // Fall back when the process exited before its group could be signalled.
    }
  }
  signalChild(child, signal)
}

async function waitForTimedClose(
  child,
  dependencies,
  timeoutMs,
  signal = signalChild,
) {
  let timedOut = false
  let forceKillTimer
  const timeoutTimer = dependencies.setTimeout(() => {
    timedOut = true
    signal(child, 'SIGTERM', dependencies)
    forceKillTimer = dependencies.setTimeout(
      () => signal(child, 'SIGKILL', dependencies),
      FORCE_KILL_GRACE_MS,
    )
  }, timeoutMs)

  const status = await waitForClose(child)
  dependencies.clearTimeout(timeoutTimer)
  if (forceKillTimer !== undefined) dependencies.clearTimeout(forceKillTimer)

  return { ...status, timedOut }
}

async function waitForApplication(child, dependencies) {
  const status = await waitForTimedClose(child, dependencies, APP_TIMEOUT_MS)

  if (status.timedOut) {
    throw new Error(`Terminal smoke timed out after ${APP_TIMEOUT_MS} ms`)
  }
  if (status.spawnError) {
    throw new Error(
      `Failed to start terminal smoke binary: ${status.spawnError.message}`,
    )
  }
  return status
}

function applicationExitMessage(status) {
  return `Terminal smoke exited with code ${String(status.code)}${status.signal ? ` (${status.signal})` : ''}`
}

function abortReason(signal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Terminal smoke reconnect control cancelled')
}

async function waitForReconnectCheckpoint(filePath, dependencies, signal) {
  const deadline = dependencies.now() + RECONNECT_CHECKPOINT_TIMEOUT_MS
  while (dependencies.now() <= deadline) {
    if (signal.aborted) throw abortReason(signal)
    try {
      await dependencies.access(filePath)
      return
    } catch {
      await new Promise((resolve, reject) => {
        let timer
        const finish = error => {
          signal.removeEventListener('abort', onAbort)
          if (error) reject(error)
          else resolve()
        }
        const onAbort = () => {
          dependencies.clearTimeout(timer)
          finish(abortReason(signal))
        }
        timer = dependencies.setTimeout(() => finish(), 100)
        signal.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
  throw new Error(
    `Terminal smoke reconnect checkpoint did not arrive within ${RECONNECT_CHECKPOINT_TIMEOUT_MS} ms`,
  )
}

async function waitForReconnectAndApplication(
  child,
  reconnectControlPath,
  sshd,
  dependencies,
) {
  const controller = new AbortController()
  const application = waitForApplication(child, dependencies).then(
    status => ({ error: null, status }),
    error => ({ error, status: null }),
  )
  const reconnect = waitForReconnectCheckpoint(
    reconnectControlPath,
    dependencies,
    controller.signal,
  )
    .then(() => sshd.restart())
    .then(
      () => ({ error: null }),
      error => ({ error }),
    )
  const first = await Promise.race([
    application.then(outcome => ({ kind: 'application', outcome })),
    reconnect.then(outcome => ({ kind: 'reconnect', outcome })),
  ])

  if (first.kind === 'reconnect' && first.outcome.error) {
    signalChild(child, 'SIGTERM')
    const forceKillTimer = dependencies.setTimeout(
      () => signalChild(child, 'SIGKILL'),
      FORCE_KILL_GRACE_MS,
    )
    await application
    dependencies.clearTimeout(forceKillTimer)
    throw first.outcome.error
  }

  const applicationOutcome =
    first.kind === 'application' ? first.outcome : await application
  controller.abort(new Error('Terminal smoke application closed'))
  const reconnectOutcome = await reconnect
  if (applicationOutcome.error) throw applicationOutcome.error
  if (applicationOutcome.status.code === 0 && reconnectOutcome.error) {
    throw reconnectOutcome.error
  }
  return applicationOutcome.status
}

export async function runTerminalSmoke({
  cwd = PROJECT_ROOT,
  env = process.env,
  reconnect = false,
  dependencies: overrides = {},
} = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (dependencies.platform !== 'darwin') {
    throw new Error('Terminal smoke is only supported on macOS')
  }

  await buildFreshTauriBinary({ cwd, env, dependencies })
  const targetDirectory = await cargoTargetDirectory({
    cwd,
    env,
    dependencies,
  })
  const runDirectory = await dependencies.mkdtemp(
    path.join(dependencies.tempDirectory, 'terminal-smoke-'),
  )
  let sshd

  try {
    sshd = await dependencies.startSshd({ runDirectory })
    const resultPath = path.join(runDirectory, 'result.json')
    const reconnectControlPath = path.join(runDirectory, 'reconnect.ready')
    const smokeEnvironment = { ...env }
    for (const key of PROFILE_ENVIRONMENT_KEYS) {
      delete smokeEnvironment[key]
    }
    Object.assign(smokeEnvironment, {
      HOME: runDirectory,
      HISTFILE: '/dev/null',
      PS1: '',
      PS2: '',
      TERMINAL_SMOKE: '1',
      TERMINAL_SMOKE_RESULT_PATH: resultPath,
      TERMINAL_SMOKE_SSH_CONFIG_PATH: sshd.configPath,
      ...(reconnect
        ? { TERMINAL_SMOKE_RECONNECT_CONTROL_PATH: reconnectControlPath }
        : {}),
    })

    const executable = path.join(targetDirectory, 'debug', 'terminal')
    let child
    try {
      child = dependencies.spawn(executable, [], {
        cwd,
        env: smokeEnvironment,
        shell: false,
        stdio: 'inherit',
      })
    } catch (error) {
      throw new Error(`Failed to start terminal smoke binary: ${error.message}`)
    }

    const status = reconnect
      ? await waitForReconnectAndApplication(
          child,
          reconnectControlPath,
          sshd,
          dependencies,
        )
      : await waitForApplication(child, dependencies)
    let serialized
    try {
      serialized = await dependencies.readFile(resultPath, 'utf8')
    } catch (error) {
      if (status.code !== 0) {
        throw new Error(
          `${applicationExitMessage(status)} without a readable result: ${error.message}`,
        )
      }
      throw error
    }
    const result = parseTerminalSmokeResult(serialized, {
      reconnectRequired: reconnect,
    })
    return result
  } finally {
    try {
      await sshd?.stop()
    } finally {
      await dependencies.rm(runDirectory, { recursive: true, force: true })
    }
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  runTerminalSmoke({ reconnect: process.argv.includes('--reconnect') })
    .then(result => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
