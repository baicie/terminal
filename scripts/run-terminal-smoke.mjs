import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { startTerminalSmokeSshd } from './terminal-smoke-sshd.mjs'
import { startTerminalSmokePasswordSshd } from './terminal-smoke-password-sshd.mjs'
import {
  compileMacFrontmostHelper,
  ensureMacProcessFrontmost,
} from './macos-frontmost.mjs'
import { startTerminalSmokeRendererHeartbeat } from './terminal-smoke-renderer-heartbeat.mjs'

export const APP_TIMEOUT_MS = 210_000
export const CARGO_METADATA_TIMEOUT_MS = 30_000
export const FORCE_KILL_GRACE_MS = 3_000
export const TAURI_BUILD_TIMEOUT_MS = 900_000

const LOAD_BYTES = 8_388_608
const TARGET_COLS = 97
const TARGET_ROWS = 31
const RESIZE_SEQUENCE = [
  { requestedCols: 132, requestedRows: 43, observedCols: 132, observedRows: 43 },
  { requestedCols: 90, requestedRows: 30, observedCols: 90, observedRows: 30 },
  { requestedCols: 120, requestedRows: 40, observedCols: 120, observedRows: 40 },
  { requestedCols: 97, requestedRows: 31, observedCols: 97, observedRows: 31 },
]
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
  'hostWakeSynthesized',
  'loadBytes',
  'loadEndVisible',
  'ok',
  'reconnectObserved',
  'resizeTrace',
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
const FIXTURE_CLEANUP_GRACE_MS = 5_000
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')

export function packageManagerCommand(platform = process.platform) {
  return platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

export function terminalExecutablePath(
  targetDirectory,
  { release = false, platform = process.platform } = {},
) {
  return path.join(
    targetDirectory,
    release ? 'release' : 'debug',
    platform === 'win32' ? 'terminal.exe' : 'terminal',
  )
}

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
  ensureFrontmost: async (pid, runDirectory, dependencies = defaultDependencies) => {
    if (dependencies.platform !== 'darwin') return
    const helper = await compileMacFrontmostHelper(runDirectory, dependencies)
    await ensureMacProcessFrontmost(pid, helper, dependencies)
  },
  startRendererHeartbeat: startTerminalSmokeRendererHeartbeat,
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
  { reconnectRequired = false, hostWakeRequired = false } = {},
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
  if (JSON.stringify(value.resizeTrace) !== JSON.stringify(RESIZE_SEQUENCE)) {
    throw invalidResult('continuous resize trace did not round-trip exactly')
  }
  if (value.reconnectObserved !== reconnectRequired) {
    throw invalidResult(
      reconnectRequired
        ? 'reconnect was not observed'
        : 'unexpected reconnect observation',
    )
  }
  if (value.hostWakeSynthesized !== hostWakeRequired) {
    throw invalidResult(
      hostWakeRequired
        ? 'required host wake checkpoint was not observed'
        : 'unexpected host wake checkpoint in this smoke runner',
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

export function waitForClose(child) {
  return new Promise(resolve => {
    let spawnError = null
    child.once('error', error => {
      spawnError = error
    })
    // A killed process can leave a grandchild holding the stdio pipes, in
    // which case `close` never arrives and only `exit` does. This runner
    // escalates to SIGKILL on timeout, so waiting on `close` alone could hang
    // the acceptance run after it had already given up on the app.
    child.once('exit', (code, signal) => {
      resolve({ code, signal, spawnError })
    })
    child.once('close', (code, signal) => {
      resolve({ code, signal, spawnError })
    })
  })
}

export async function buildFreshTauriBinary({
  cwd,
  env,
  release = false,
  dependencies = defaultDependencies,
}) {
  const buildArgs = release
    ? ['tauri', 'build', '--no-bundle']
    : ['tauri', 'build', '--debug', '--no-bundle']
  const profileLabel = release ? 'release' : 'debug'
  let child
  try {
    child = dependencies.spawn(
      packageManagerCommand(dependencies.platform),
      buildArgs,
      {
        cwd,
        env: { ...env, VITE_TERMINAL_SMOKE_BUILD: '1' },
        detached: true,
        // Windows exposes pnpm through a .cmd shim. Node cannot launch that
        // batch entry point with shell:false on all supported Windows hosts.
        // Keep direct spawning on Unix so process-group handling and the
        // existing macOS/Linux behavior remain unchanged.
        shell: dependencies.platform === 'win32',
        stdio: 'inherit',
      },
    )
  } catch (error) {
    throw new Error(`Failed to start Tauri ${profileLabel} build: ${error.message}`)
  }

  const status = await waitForTimedClose(
    child,
    dependencies,
    TAURI_BUILD_TIMEOUT_MS,
    signalProcessGroup,
  )
  if (status.timedOut) {
    throw new Error(
      `Tauri ${profileLabel} build timed out after ${TAURI_BUILD_TIMEOUT_MS} ms`,
    )
  }
  if (status.spawnError) {
    throw new Error(
      `Failed to run Tauri ${profileLabel} build: ${status.spawnError.message}`,
    )
  }
  if (status.code !== 0) {
    throw new Error(
      `Tauri ${profileLabel} build exited with code ${String(status.code)}${status.signal ? ` (${status.signal})` : ''}`,
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
  abortSignal,
  closePromise,
) {
  let timedOut = false
  let aborted = false
  let forceKillTimer
  const statusPromise = closePromise ?? waitForClose(child)
  const terminate = (reason, markAborted = false) => {
    if (markAborted) aborted = true
    signal(child, reason, dependencies)
    forceKillTimer = dependencies.setTimeout(
      () => signal(child, 'SIGKILL', dependencies),
      FORCE_KILL_GRACE_MS,
    )
  }
  const timeoutTimer = dependencies.setTimeout(() => {
    timedOut = true
    terminate('SIGTERM')
  }, timeoutMs)
  const onAbort = () => terminate('SIGTERM', true)
  if (abortSignal) {
    if (abortSignal.aborted) onAbort()
    else abortSignal.addEventListener('abort', onAbort, { once: true })
  }

  const status = await statusPromise
  dependencies.clearTimeout(timeoutTimer)
  if (forceKillTimer !== undefined) dependencies.clearTimeout(forceKillTimer)
  abortSignal?.removeEventListener('abort', onAbort)

  return { ...status, timedOut, aborted }
}

async function waitForApplication(
  child,
  dependencies,
  abortSignal,
  closePromise,
) {
  const status = await waitForTimedClose(
    child,
    dependencies,
    APP_TIMEOUT_MS,
    signalChild,
    abortSignal,
    closePromise,
  )

  if (status.aborted) throw abortReason(abortSignal)
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

function startAbortable(start, signal, onLateCleanup) {
  const operation = Promise.resolve().then(() => {
    if (signal?.aborted) throw abortReason(signal)
    return start()
  })
  if (!signal) return operation

  return new Promise((resolve, reject) => {
    let settled = false
    let lateCleanupRegistered = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const stopLateFixture = value => {
      if (!value || typeof value.stop !== 'function') return Promise.resolve()
      return Promise.resolve(value.stop()).catch(() => {})
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortReason(signal))
      lateCleanupRegistered = typeof onLateCleanup === 'function'
      onLateCleanup?.(
        operation.then(
          value => stopLateFixture(value),
          () => {},
        ),
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      value => {
        if (settled) {
          if (!lateCleanupRegistered) stopLateFixture(value)
          return
        }
        settled = true
        cleanup()
        resolve(value)
      },
      error => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
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
  outageHoldMs,
  hostWakeControlPath,
  abortSignal,
  firstConnectOutage,
  closePromise,
) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(abortReason(abortSignal))
  abortSignal?.addEventListener('abort', onAbort, { once: true })
  const application = waitForApplication(
    child,
    dependencies,
    abortSignal,
    closePromise,
  ).then(
    status => ({ error: null, status }),
    error => ({ error, status: null }),
  )
  const reconnect = waitForReconnectCheckpoint(
    reconnectControlPath,
    dependencies,
    controller.signal,
  )
    .then(() =>
      // In the first-connect case the host is already down and coming back on
      // its own schedule, so bouncing it here would end the outage before the
      // reconnect ladder had anything to walk.
      firstConnectOutage !== undefined
        ? firstConnectOutage
        : hostWakeControlPath !== undefined
          ? sshd.interruptUntilControl({
              controlPath: hostWakeControlPath,
              signal: controller.signal,
            })
        : outageHoldMs === undefined
          ? sshd.restart()
          : sshd.interrupt({ holdMs: outageHoldMs }),
    )
    .then(
      () => ({ error: null }),
      error => ({ error }),
    )
  try {
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
    if (reconnectOutcome.error && applicationOutcome.status.code !== 0) {
      // The application exited on its own before publishing the checkpoint.
      // Throwing the abort error the local controller just raised would mask
      // that with "Terminal smoke application closed", which names no cause.
      throw new Error(
        `${applicationExitMessage(applicationOutcome.status)} without waiting for the reconnect checkpoint`,
      )
    }
    return applicationOutcome.status
  } finally {
    abortSignal?.removeEventListener('abort', onAbort)
    controller.abort(new Error('Terminal smoke application closed'))
  }
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

/**
 * Resolves the binary a runner is about to launch and returns its digest.
 * Evidence files must record this value: every later build relinks the same
 * path, so a measurement is only reproducible together with its hash.
 */
export async function resolveBuiltBinary({
  targetDirectory,
  release = false,
  cwd = PROJECT_ROOT,
  env = process.env,
  dependencies = defaultDependencies,
}) {
  const resolved =
    targetDirectory ?? (await cargoTargetDirectory({ cwd, env, dependencies }))
  const executable = terminalExecutablePath(resolved, {
    release,
    platform: dependencies.platform,
  })
  await dependencies.access(executable)
  const contents = await dependencies.readFile(executable)
  return {
    executable,
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
}

/**
 * The smoke and probe entry points are only compiled into the frontend when
 * VITE_TERMINAL_SMOKE_BUILD=1, so a plain `tauri build` yields a binary that
 * cannot run a single smoke case. That makes an instrumented binary a genuinely
 * different artifact from a shipping one.
 *
 * This matters for evidence. A cold-start number measured on a shipping binary
 * and an SSH matrix measured on an instrumented one are not measurements of the
 * same build, and a gate that treats a shared sha256 as proof of a shared build
 * would be trusting a coincidence. Instrumented builds reference lazily loaded
 * smoke/probe chunks by filename; shipping builds do not, which makes the
 * embedded asset list a reliable discriminator.
 */
export function findInstrumentedChunkNames(contents) {
  const text = contents.toString('latin1')
  const names = text.match(/[A-Za-z0-9_.-]{4,}\.(?:js|css)/g) ?? []
  return [...new Set(names)].filter(name =>
    /smoke|probe|automation|experiment/i.test(name),
  )
}

export async function assertSmokeInstrumentedBinary(
  binary,
  dependencies = defaultDependencies,
) {
  const contents = await dependencies.readFile(binary.executable)
  const instrumented = findInstrumentedChunkNames(contents)
  if (instrumented.length === 0) {
    throw new Error(
      `${binary.executable} was built without VITE_TERMINAL_SMOKE_BUILD=1, so it ` +
        'cannot run smoke cases. Build with the flag, or drop --reuse-binary to let ' +
        'the matrix build an instrumented binary. Note that an instrumented binary ' +
        'is a different artifact from a shipping one: cold-start numbers measured on ' +
        'a shipping binary must not be presented as covering this matrix.',
    )
  }
  return instrumented
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

async function startSmokeFixtures({
  runDirectory,
  auth,
  dependencies,
  signal,
  onLateCleanup,
}) {
  if (auth === 'password') {
    return {
      fixture: await startAbortable(
        () => dependencies.startPasswordSshd({ runDirectory }),
        signal,
        onLateCleanup,
      ),
      agent: null,
    }
  }
  if (auth === 'cert') {
    return {
      fixture: await startAbortable(
        () => dependencies.startSshd({ runDirectory, mode: 'cert' }),
        signal,
        onLateCleanup,
      ),
      agent: null,
    }
  }
  if (auth === 'agent') {
    const fixture = await startAbortable(
      () =>
        dependencies.startSshd({
          runDirectory,
          connectionExtra: { authMode: 'agent', privateKey: null },
        }),
      signal,
      onLateCleanup,
    )
    try {
      const agent = await startAbortable(
        () =>
          startSmokeAgent({
            runDirectory,
            privateKey: fixture.identityKey,
            dependencies,
          }),
        signal,
        onLateCleanup,
      )
      return { fixture, agent }
    } catch (error) {
      try {
        await fixture.stop()
      } catch {
        // Preserve the agent setup failure; fixture cleanup is best effort.
      }
      throw error
    }
  }
  if (auth === 'jump') {
    const target = await startAbortable(
      () => dependencies.startSshd({ runDirectory }),
      signal,
      onLateCleanup,
    )
    let jump
    try {
      jump = await startAbortable(
        () =>
          dependencies.startSshd({
            runDirectory: path.join(runDirectory, 'jump'),
            role: 'jump',
            targetPort: target.port,
          }),
        signal,
        onLateCleanup,
      )
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
      let restartPromise
      return {
        fixture: {
          ...composed,
          configPath: target.configPath,
          restart: () => {
            if (restartPromise) return restartPromise
            restartPromise = (async () => {
              // Rebuild the bastion transport before the target so the next
              // direct-tcpip session cannot reuse the old forwarding path.
              await jump.restart()
              await target.restart()
            })()
            return restartPromise
          },
          stop: async () => {
            await target.stop()
            await jump.stop()
          },
        },
        agent: null,
      }
    } catch (error) {
      try {
        await jump?.stop()
      } catch {
        // Preserve the setup failure; fixture cleanup is best effort.
      }
      try {
        await target.stop()
      } catch {
        // Preserve the setup failure; fixture cleanup is best effort.
      }
      throw error
    }
  }
  return {
    fixture: await startAbortable(
      () => dependencies.startSshd({ runDirectory }),
      signal,
      onLateCleanup,
    ),
    agent: null,
  }
}

export async function runTerminalSmoke({
  cwd = PROJECT_ROOT,
  env = process.env,
  reconnect = false,
  outageHoldMs,
  firstConnectOutageHoldMs,
  hostWakeRequired = false,
  auth = 'key',
  skipBuild = false,
  release = false,
  targetDirectory,
  signal = new AbortController().signal,
  dependencies: overrides = {},
} = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (dependencies.platform !== 'darwin' && dependencies.platform !== 'linux') {
    throw new Error('Terminal smoke is only supported on macOS and Linux')
  }
  if (!SUPPORTED_AUTH_MODES.includes(auth)) {
    throw new Error(`terminal smoke auth mode must be one of ${SUPPORTED_AUTH_MODES.join('/')}`)
  }
  if (signal.aborted) throw abortReason(signal)

  if (!skipBuild) {
    await buildFreshTauriBinary({ cwd, env, release, dependencies })
  }
  const resolvedTargetDirectory =
    targetDirectory ?? (await cargoTargetDirectory({ cwd, env, dependencies }))
  const runDirectory = await dependencies.mkdtemp(
    path.join(dependencies.tempDirectory, 'terminal-smoke-'),
  )
  let fixture
  let agent = null
  const lateFixtureCleanups = []
  let rendererHeartbeat = null

  try {
    ;({ fixture, agent } = await startSmokeFixtures({
      runDirectory,
      auth,
      dependencies,
      signal,
      onLateCleanup: cleanup => lateFixtureCleanups.push(cleanup),
    }))
    // The first-connect outage has to be armed before the application spawns,
    // and the old daemon must have exited before the first SSH attempt starts.
    // Waiting only for the final promise would wait until the host is back and
    // skip the outage; waiting for its optional `ready` checkpoint preserves
    // the down window while eliminating the old-daemon race.
    const firstConnectOutage =
      firstConnectOutageHoldMs === undefined
        ? undefined
        : fixture.outageBeforeFirstConnect({ holdMs: firstConnectOutageHoldMs })
    if (firstConnectOutage?.ready) await firstConnectOutage.ready
    if (signal.aborted) throw abortReason(signal)
    const resultPath = path.join(runDirectory, 'result.json')
    const reconnectControlPath = path.join(runDirectory, 'reconnect.ready')
    const hostWakeControlPath = path.join(runDirectory, 'host-wake.ready')
    const hostWakeEventPath = path.join(runDirectory, 'host-wake.events.ndjson')
    if (hostWakeRequired) {
      await dependencies.writeFile(hostWakeControlPath, '')
      await dependencies.writeFile(hostWakeEventPath, '')
      rendererHeartbeat = await dependencies.startRendererHeartbeat({
        directory: runDirectory,
      })
    }
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
      ...(hostWakeRequired
        ? { TERMINAL_SMOKE_HOST_WAKE_PATH: hostWakeControlPath }
        : {}),
      ...(rendererHeartbeat
        ? {
            TERMINAL_SMOKE_RENDERER_HEARTBEAT_ENDPOINT:
              rendererHeartbeat.endpoint,
            TERMINAL_SMOKE_RENDERER_HEARTBEAT_TOKEN: rendererHeartbeat.token,
          }
        : {}),
      ...(agent ? agent.env : {}),
    })

    const executable = path.join(
      resolvedTargetDirectory,
      release ? 'release' : 'debug',
      'terminal',
    )
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

    const closePromise = waitForClose(child)
    const application = reconnect
      ? waitForReconnectAndApplication(
          child,
          reconnectControlPath,
          fixture,
          dependencies,
          outageHoldMs,
          hostWakeRequired ? hostWakeControlPath : undefined,
          signal,
          firstConnectOutage,
          closePromise,
        )
      : waitForApplication(child, dependencies, signal, closePromise)
    const applicationOutcome = application.then(
      status => ({ status, error: null }),
      error => ({ status: null, error }),
    )
    if (reconnect) {
      try {
        await dependencies.ensureFrontmost?.(
          child.pid,
          runDirectory,
          dependencies,
        )
      } catch (error) {
        signalChild(child, 'SIGTERM')
        const killTimer = dependencies.setTimeout(
          () => signalChild(child, 'SIGKILL'),
          FORCE_KILL_GRACE_MS,
        )
        await applicationOutcome
        dependencies.clearTimeout(killTimer)
        throw error
      }
    }
    const outcome = await applicationOutcome
    if (outcome.error) throw outcome.error
    const status = outcome.status
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
      hostWakeRequired,
    })
    return result
  } catch (error) {
    if (hostWakeRequired) {
      let events = ''
      let heartbeats = ''
      try {
        events = await dependencies.readFile(
          path.join(runDirectory, 'host-wake.events.ndjson'),
          'utf8',
        )
      } catch {
        // Preserve the original smoke error when diagnostics are unavailable.
      }
      try {
        heartbeats = await dependencies.readFile(
          path.join(runDirectory, 'renderer-heartbeat.ndjson'),
          'utf8',
        )
      } catch {
        // Preserve the original smoke error when the independent signal is unavailable.
      }
      const diagnostics = []
      if (events.trim()) {
        diagnostics.push(
          `hostWakeEvents=${events.trim().split('\n').slice(-12).join('|')}`,
        )
      }
      if (heartbeats.trim()) {
        diagnostics.push(
          `rendererHeartbeats=${heartbeats.trim().split('\n').slice(-12).join('|')}`,
        )
      }
      if (diagnostics.length > 0) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `${message}; ${diagnostics.join('; ')}`,
          { cause: error },
        )
      }
    }
    throw error
  } finally {
    if (lateFixtureCleanups.length > 0) {
      let timer
      await Promise.race([
        Promise.allSettled(lateFixtureCleanups),
        new Promise(resolve => {
          timer = dependencies.setTimeout(resolve, FIXTURE_CLEANUP_GRACE_MS)
        }),
      ])
      if (timer !== undefined) dependencies.clearTimeout(timer)
    }
    try {
      if (agent) await agent.stop()
    } finally {
      try {
        await fixture?.stop()
      } finally {
        await rendererHeartbeat?.close()
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
  runTerminalSmoke({
    reconnect: argv.includes('--reconnect'),
    release: argv.includes('--release'),
    auth,
  })
    .then(result => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
