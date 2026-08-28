import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { startTerminalSmokeSshd } from './terminal-smoke-sshd.mjs'
import { startTerminalSmokePasswordSshd } from './terminal-smoke-password-sshd.mjs'

export const APP_TIMEOUT_MS = 210_000
export const CARGO_METADATA_TIMEOUT_MS = 30_000
export const FORCE_KILL_GRACE_MS = 3_000
export const TAURI_BUILD_TIMEOUT_MS = 900_000

const LOAD_BYTES = 8_388_608
const TARGET_COLS = 97
const TARGET_ROWS = 31
const MAX_RESULT_DURATION_MS = 180_000
const FIRST_CONNECTION_DEADLINE_MS = 10_000
const SSH_AGENT_PATH = '/usr/bin/ssh-agent'
const SSH_ADD_PATH = '/usr/bin/ssh-add'
const SUPPORTED_AUTH_MODES = ['key', 'password', 'agent', 'cert', 'jump']
const RESULT_KEYS = [
  'afterLoadVisible',
  'durationMs',
  'error',
  'firstConnectionMs',
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
const AGENT_ADD_TIMEOUT_MS = 10_000
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
  startPasswordSshd: startTerminalSmokePasswordSshd,
  tempDirectory:
    process.env.TERMINAL_SMOKE_TMP ||
    (process.platform === 'linux' ? os.homedir() : os.tmpdir()),
  writeFile,
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
  if (
    !Number.isSafeInteger(value.firstConnectionMs) ||
    value.firstConnectionMs < 0 ||
    (value.ok &&
      (value.firstConnectionMs < 1 ||
        value.firstConnectionMs >= FIRST_CONNECTION_DEADLINE_MS))
  ) {
    throw invalidResult(
      `first connection must complete within 1..=${FIRST_CONNECTION_DEADLINE_MS - 1} ms`,
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

export async function buildFreshTauriBinary({
  cwd,
  env,
  dependencies = defaultDependencies,
}) {
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

export async function cargoTargetDirectory({
  cwd,
  env,
  dependencies = defaultDependencies,
}) {
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

function collectOutputPipe(command, args, options, dependencies, label) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = dependencies.spawn(command, args, options)
    } catch (error) {
      reject(new Error(`${label} could not start: ${error.message}`))
      return
    }
    let output = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => (output += chunk))
    child.stderr?.on('data', chunk => (output += chunk))
    const timer = dependencies.setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // The command closed between the timer and signal.
      }
      reject(new Error(`${label} timed out`))
    }, AGENT_ADD_TIMEOUT_MS)
    child.once('error', error => {
      dependencies.clearTimeout(timer)
      reject(new Error(`${label} could not start: ${error.message}`))
    })
    child.once('close', code => {
      dependencies.clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`${label} exited with code ${String(code)}: ${output.trim()}`))
        return
      }
      resolve(output)
    })
  })
}

async function startSmokeAgent({ runDirectory, privateKey, dependencies }) {
  const socketPath = path.join(runDirectory, 'agent.sock')
  let agent
  try {
    agent = dependencies.spawn(SSH_AGENT_PATH, ['-a', socketPath, '-D'], {
      cwd: runDirectory,
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
  } catch (error) {
    throw new Error(`SSH agent could not start: ${error.message}`)
  }
  const agentClose = new Promise(resolve => {
    agent.once('error', () => resolve())
    agent.once('close', () => resolve())
  })
  const agentEnv = { SSH_AUTH_SOCK: socketPath }
  try {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        await dependencies.access(socketPath)
        break
      } catch {
        if (attempt === 20) {
          throw new Error('SSH agent socket did not appear')
        }
        await new Promise(resolve => dependencies.setTimeout(resolve, 100))
      }
    }
    const privateKeyPath = path.join(runDirectory, 'agent-identity')
    await dependencies.writeFile(privateKeyPath, privateKey, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await collectOutputPipe(
      SSH_ADD_PATH,
      [privateKeyPath],
      { cwd: runDirectory, env: { ...process.env, ...agentEnv }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      dependencies,
      'ssh-add',
    )
  } catch (error) {
    try {
      agent.kill('SIGTERM')
    } catch {
      // The agent may already be gone.
    }
    await agentClose
    throw error
  }
  return {
    env: agentEnv,
    stop: async () => {
      try {
        agent.kill('SIGTERM')
      } catch {
        // The agent may already be gone.
      }
      await agentClose
    },
  }
}

async function startSmokeFixtures({ runDirectory, auth, dependencies }) {
  if (auth === 'password') {
    return { fixture: await dependencies.startPasswordSshd({ runDirectory }), agent: null }
  }
  if (auth === 'cert') {
    return { fixture: await dependencies.startSshd({ runDirectory, mode: 'cert' }), agent: null }
  }
  if (auth === 'agent') {
    const fixture = await dependencies.startSshd({
      runDirectory,
      connectionExtra: { authMode: 'agent', privateKey: null },
    })
    const agent = await startSmokeAgent({
      runDirectory,
      privateKey: fixture.identityKey,
      dependencies,
    })
    return { fixture, agent }
  }
  if (auth === 'jump') {
    const target = await dependencies.startSshd({ runDirectory })
    const jump = await dependencies.startSshd({
      runDirectory: path.join(runDirectory, 'jump'),
      role: 'jump',
      targetPort: target.port,
    })
    const composed = {
      host: target.host,
      port: target.port,
      username: target.username,
      authMode: 'key',
      expectedHostKey: target.expectedHostKey,
      privateKey: target.privateKey,
      password: null,
      certificate: null,
      jump: {
        host: jump.host,
        port: jump.port,
        username: jump.username,
        privateKey: jump.privateKey,
        expectedHostKey: jump.expectedHostKey,
      },
    }
    await dependencies.writeFile(target.configPath, `${JSON.stringify(composed)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    return {
      fixture: {
        ...composed,
        configPath: target.configPath,
        restart: () => target.restart(),
        stop: async () => {
          await target.stop()
          await jump.stop()
        },
      },
      agent: null,
    }
  }
  return { fixture: await dependencies.startSshd({ runDirectory }), agent: null }
}

export async function runTerminalSmoke({
  cwd = PROJECT_ROOT,
  env = process.env,
  reconnect = false,
  auth = 'key',
  skipBuild = false,
  targetDirectory,
  dependencies: overrides = {},
} = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (dependencies.platform !== 'darwin' && dependencies.platform !== 'linux') {
    throw new Error('Terminal smoke is only supported on macOS and Linux')
  }
  if (!SUPPORTED_AUTH_MODES.includes(auth)) {
    throw new Error(`terminal smoke auth mode must be one of ${SUPPORTED_AUTH_MODES.join('/')}`)
  }

  if (!skipBuild) {
    await buildFreshTauriBinary({ cwd, env, dependencies })
  }
  const resolvedTargetDirectory =
    targetDirectory ?? (await cargoTargetDirectory({ cwd, env, dependencies }))
  const runDirectory = await dependencies.mkdtemp(
    path.join(dependencies.tempDirectory, 'terminal-smoke-'),
  )
  let fixture
  let agent = null

  try {
    ;({ fixture, agent } = await startSmokeFixtures({
      runDirectory,
      auth,
      dependencies,
    }))
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
      TERMINAL_SMOKE_SSH_CONFIG_PATH: fixture.configPath,
      ...(reconnect
        ? { TERMINAL_SMOKE_RECONNECT_CONTROL_PATH: reconnectControlPath }
        : {}),
      ...(agent ? agent.env : {}),
    })

    const executable = path.join(resolvedTargetDirectory, 'debug', 'terminal')
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
          fixture,
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
      if (agent) await agent.stop()
    } finally {
      try {
        await fixture?.stop()
      } finally {
        await dependencies.rm(runDirectory, { recursive: true, force: true })
      }
    }
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const argv = process.argv.slice(2)
  const auth = argv.includes('--auth') ? argv[argv.indexOf('--auth') + 1] : 'key'
  runTerminalSmoke({ reconnect: argv.includes('--reconnect'), auth })
    .then(result => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
