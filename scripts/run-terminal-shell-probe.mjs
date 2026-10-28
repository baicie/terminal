import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  buildFreshTauriBinary,
  cargoTargetDirectory,
  terminalExecutablePath,
} from './run-terminal-smoke.mjs'
import { startTerminalSmokeSshd } from './terminal-smoke-sshd.mjs'

export const RESULT_TIMEOUT_MS = 60_000
export const CLEANUP_GRACE_MS = 5_000
export const FORCE_KILL_GRACE_MS = 2_000
// WebKitGTK can leave a Mesa shader-cache writer alive for a short period
// after the Tauri process closes.  Let fs.rm retry the temporary directory
// while that child finishes instead of turning a successful probe into an
// ENOTEMPTY failure.
const RUN_DIRECTORY_CLEANUP_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 20,
  retryDelay: 100,
}
// The POSIX probe commands exercise bash/zsh line-editing semantics.  They
// are not a generic POSIX script: fish has different assignment/conditional
// syntax and /bin/sh may be dash without readline history.  Keep shells that
// have no matching frontend dialect explicit so an operator gets a clear
// rejection instead of a probe timeout or a misleading result.
export const SUPPORTED_SHELLS = ['bash', 'zsh']
export const SHELLS_WITHOUT_DIALECT = ['fish', 'sh']
// Windows shells get their own dialect instead of the POSIX case scripts:
// every existing case is written in shell syntax neither of them parses.
export const SUPPORTED_WINDOWS_SHELLS = ['powershell', 'cmd']
export const SUPPORTED_TRANSPORTS = ['local', 'ssh']

export function createShellProbeNonce(prefix = 'shell') {
  return `${prefix}_${randomBytes(12).toString('hex')}`
}

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')
const CASE_TRACE = {
  'cat-eof': ['ready', 'pass'],
  'readline-history': ['ready', 'step', 'pass'],
  'readline-tab': ['ready', 'step', 'pass'],
  'vim-edit': ['ready', 'step', 'pass'],
  'nano-edit': ['ready', 'step', 'pass'],
  'pty-resize': ['ready', 'step', 'pass'],
  'ctrl-c-interrupt': ['ready', 'step', 'pass'],
}
const CASES = Object.keys(CASE_TRACE)
const WINDOWS_SHELL_CASES = {
  powershell: ['cat-eof', 'pty-resize', 'ctrl-c-interrupt'],
  cmd: ['cat-eof', 'ctrl-c-interrupt'],
}

const defaultDependencies = {
  access,
  mkdtemp,
  now: Date.now,
  platform: process.platform,
  readFile,
  rm,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  spawn,
  startSshd: startTerminalSmokeSshd,
  tempDirectory: os.tmpdir(),
  writeFile,
}

function invalidResult(message) {
  return new Error(`Invalid shell probe result: ${message}`)
}

function waitForClose(child) {
  return new Promise(resolve => {
    let settled = false
    const finish = status => {
      if (settled) return
      settled = true
      resolve(status)
    }
    child.once('error', error => finish({ code: null, signal: null, error }))
    child.once('close', (code, signal) => finish({ code, signal, error: null }))
  })
}

function waitForFile(filePath, timeoutMs, dependencies, signal) {
  const deadline = dependencies.now() + timeoutMs
  return new Promise((resolve, reject) => {
    let timer
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true
      dependencies.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = () =>
      finish(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error('shell probe result wait cancelled'),
      )
    signal?.addEventListener('abort', onAbort, { once: true })
    const poll = async () => {
      if (settled) return
      try {
        await dependencies.access(filePath)
        finish()
        return
      } catch {
        if (dependencies.now() > deadline) {
          finish(new Error(`shell probe result timed out after ${timeoutMs} ms`))
          return
        }
      }
      timer = dependencies.setTimeout(poll, 100)
    }
    void poll()
  })
}

function parseInputEvents(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) {
    return false
  }
  return value.every(
    event =>
      event &&
      typeof event === 'object' &&
      !Array.isArray(event) &&
      Object.keys(event).sort().join(',') === 'bytes,dataHex,kind' &&
      event.kind === 'text' &&
      Number.isSafeInteger(event.bytes) &&
      event.bytes > 0 &&
      typeof event.dataHex === 'string' &&
      /^[0-9a-f]+$/.test(event.dataHex) &&
      event.dataHex.length === event.bytes * 2,
  )
}

const CASE_REQUIRED_INPUT_HEX = {
  // The interrupt case is only meaningful if the raw ETX byte reached the
  // PTY; a pass verdict without it would prove nothing.
  'ctrl-c-interrupt': ['\u0003'],
}

function hasRequiredInput(value, caseName) {
  const required = CASE_REQUIRED_INPUT_HEX[caseName]
  if (!required) return true
  const typed = value.map(event => bytesToString(event.dataHex))
  return required.every(needle => typed.includes(needle))
}

function bytesToString(dataHex) {
  const bytes = new Uint8Array(dataHex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(dataHex.slice(index * 2, index * 2 + 2), 16)
  }
  return Buffer.from(bytes).toString('latin1')
}

function assertCaseSupportedByShell(shell, caseName) {
  if (!SUPPORTED_WINDOWS_SHELLS.includes(shell)) return
  const supported = WINDOWS_SHELL_CASES[shell]
  if (supported.includes(caseName)) return
  throw new Error(
    `shell probe shell '${shell}' does not support case '${caseName}'; ` +
      `supported: ${supported.join("','")}`,
  )
}

export function parseShellProbeResult(serialized, caseName) {
  if (!CASES.includes(caseName)) throw invalidResult('unsupported case')
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
    Object.keys(value).sort().join(',') !==
      'caseName,durationMs,error,inputEvents,ok,trace' ||
    value.caseName !== caseName ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 1 ||
    typeof value.ok !== 'boolean' ||
    value.error !== null && typeof value.error !== 'string' ||
    JSON.stringify(value.trace) !== JSON.stringify(CASE_TRACE[caseName]) ||
    !parseInputEvents(value.inputEvents) ||
    !hasRequiredInput(value.inputEvents, caseName) ||
    value.ok !== true ||
    value.error !== null
  ) {
    throw invalidResult('contract mismatch')
  }
  return value
}

function signalChild(child, signal) {
  try {
    child.kill(signal)
  } catch {
    // The application may have exited before cleanup.
  }
}

/**
 * Stops the sshd fixture, preserving whatever the run actually failed with.
 * Cleanup that throws would replace a real diagnosis with "stop failed", which
 * is the one thing an acceptance runner must not do.
 */
async function stopFixture(fixture) {
  try {
    await fixture.stop()
  } catch {
    // Best effort: the run directory is removed either way.
  }
}

export async function runShellProbe({
  cwd = PROJECT_ROOT,
  env = process.env,
  caseName = 'cat-eof',
  shell,
  transport = 'local',
  skipBuild = false,
  release = false,
  targetDirectory,
  dependencies: overrides = {},
} = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  const windowsShell = SUPPORTED_WINDOWS_SHELLS.includes(shell)
  const unixShell = shell === undefined || SUPPORTED_SHELLS.includes(shell)
  if (SHELLS_WITHOUT_DIALECT.includes(shell)) {
    throw new Error(
      `Terminal shell probe shell ${shell} has no dialect; ` +
        `expected one of ${SUPPORTED_SHELLS.concat(SUPPORTED_WINDOWS_SHELLS).join('/')}`,
    )
  }
  if (dependencies.platform === 'win32' && !windowsShell) {
    throw new Error(
      `Terminal shell probe on Windows requires --shells ${SUPPORTED_WINDOWS_SHELLS.join('/')}`,
    )
  }
  if (dependencies.platform !== 'win32' && !unixShell) {
    throw new Error(
      `Terminal shell probe shell ${shell} is only supported on Windows; expected one of ${SUPPORTED_WINDOWS_SHELLS.join('/')}`,
    )
  }
  if (dependencies.platform !== 'darwin' && dependencies.platform !== 'linux' && dependencies.platform !== 'win32') {
    throw new Error(
      'Terminal shell probe is only supported on macOS, Linux and Windows',
    )
  }
  if (!CASES.includes(caseName)) {
    throw new Error(`Unsupported terminal shell probe case: ${caseName}`)
  }
  assertCaseSupportedByShell(shell, caseName)
  if (shell !== undefined && !SUPPORTED_SHELLS.includes(shell)) {
    if (!SUPPORTED_WINDOWS_SHELLS.includes(shell)) {
      throw new Error(
        `Unsupported terminal shell probe shell: ${shell}; expected one of ${SUPPORTED_SHELLS.concat(SUPPORTED_WINDOWS_SHELLS).join('/')}`,
      )
    }
  }
  if (!SUPPORTED_TRANSPORTS.includes(transport)) {
    throw new Error(
      `Unsupported terminal shell probe transport: ${transport}; expected one of ${SUPPORTED_TRANSPORTS.join('/')}`,
    )
  }
  if (!skipBuild) {
    await buildFreshTauriBinary({
      cwd,
      env: { ...env, VITE_TERMINAL_SMOKE_BUILD: '1' },
      release,
      dependencies,
    })
  }
  const resolvedTargetDirectory =
    targetDirectory ?? (await cargoTargetDirectory({ cwd, env, dependencies }))
  const runDirectory = await dependencies.mkdtemp(
    path.join(dependencies.tempDirectory, 'terminal-shell-probe-'),
  )
  const resultPath = path.join(runDirectory, 'result.json')
  const nonce = createShellProbeNonce()
  // The SSH transport reuses the smoke matrix's loopback sshd fixture rather
  // than a bespoke one, so the interaction cases run against exactly the same
  // daemon, host-key checking and key material the matrix already trusts. That
  // matters because the cases under test — line editing, PTY geometry and
  // interrupt delivery — break precisely where a hand-rolled server would
  // differ from the real thing.
  const fixture =
    transport === 'ssh'
      ? await dependencies.startSshd({ runDirectory })
      : null
  const probeEnvironment = { ...env }
  for (const key of ['ENV', 'BASH_ENV', 'PROMPT_COMMAND', 'CDPATH']) {
    delete probeEnvironment[key]
  }
  Object.assign(probeEnvironment, {
    HOME: runDirectory,
    TERMINAL_SHELL_PROBE: '1',
    TERMINAL_SHELL_PROBE_CASE: caseName,
    TERMINAL_SHELL_PROBE_RESULT_PATH: resultPath,
    TERMINAL_SHELL_PROBE_NONCE: nonce,
  })
  if (fixture) {
    const sshConfigPath = path.join(runDirectory, 'ssh-config.json')
    const sshConfig = JSON.stringify({
      host: fixture.host,
      port: fixture.port,
      username: fixture.username,
      authMode: fixture.authMode,
      expectedHostKey: fixture.expectedHostKey,
      privateKey: fixture.privateKey,
      password: fixture.password,
      certificate: fixture.certificate,
      jump: fixture.jump,
    })
    await dependencies.writeFile(sshConfigPath, sshConfig + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    })
    probeEnvironment.TERMINAL_SHELL_PROBE_SSH_CONFIG_PATH = sshConfigPath
  } else if (shell !== undefined) {
    // Only the local PTY is launched by this process, so only then does the
    // requested shell apply. Over SSH the login shell is the fixture's, and
    // silently pretending otherwise would mislabel what was measured.
    // The backend matches these names exactly, so the dialect names are
    // translated into the executables it knows how to launch.
    probeEnvironment.TERMINAL_DEFAULT_SHELL =
      shell === 'powershell'
        ? 'powershell.exe'
        : shell === 'cmd'
          ? 'cmd.exe'
          : shell
  }
  // The backend serves the dialect to the frontend, which is what keeps a
  // mislabelled run honest: the probe never guesses its own shell.
  probeEnvironment.TERMINAL_SHELL_PROBE_DIALECT =
    shell === 'powershell'
      ? 'powershell'
      : shell === 'cmd'
        ? 'cmd'
        : 'posix'
  const executable = terminalExecutablePath(resolvedTargetDirectory, {
    release,
    platform: dependencies.platform,
  })
  let child
  try {
    child = dependencies.spawn(executable, [], {
      cwd,
      env: probeEnvironment,
      shell: false,
      stdio: 'inherit',
    })
  } catch (error) {
    // The fixture outlives a failed spawn, so it has to be torn down here too;
    // otherwise a single bad launch leaks an sshd into the next run.
    if (fixture) await stopFixture(fixture)
    await dependencies.rm(runDirectory, RUN_DIRECTORY_CLEANUP_OPTIONS)
    throw new Error(`Failed to start shell probe binary: ${error.message}`)
  }
  const application = waitForClose(child)
  const resultWaitController = new AbortController()
  try {
    const earlyClose = application.then(status => {
      resultWaitController.abort(
        status.error ??
          new Error(
            `Shell probe application closed early with code ${String(status.code)}${status.signal ? ` (${status.signal})` : ''}`,
          ),
      )
      throw new Error(
        `Shell probe application closed early with code ${String(status.code)}${status.signal ? ` (${status.signal})` : ''}`,
      )
    })
    await Promise.race([
      waitForFile(
        resultPath,
        RESULT_TIMEOUT_MS,
        dependencies,
        resultWaitController.signal,
      ),
      earlyClose,
    ])
    return parseShellProbeResult(
      await dependencies.readFile(resultPath, 'utf8'),
      caseName,
    )
  } finally {
    resultWaitController.abort()
    signalChild(child, 'SIGTERM')
    let cleanupTimer
    let forceKillTimer
    const cleanupDeadline = new Promise(resolve => {
      cleanupTimer = dependencies.setTimeout(() => {
        signalChild(child, 'SIGKILL')
        forceKillTimer = dependencies.setTimeout(
          () => resolve({ code: null, signal: 'SIGKILL', error: null }),
          FORCE_KILL_GRACE_MS,
        )
      }, CLEANUP_GRACE_MS)
    })
    const status = await Promise.race([application, cleanupDeadline])
    dependencies.clearTimeout(cleanupTimer)
    dependencies.clearTimeout(forceKillTimer)
    try {
      if (status?.error) throw status.error
    } finally {
      if (fixture) await stopFixture(fixture)
      await dependencies.rm(runDirectory, RUN_DIRECTORY_CLEANUP_OPTIONS)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const caseIndex = process.argv.indexOf('--case')
  const caseName = caseIndex >= 0 ? process.argv[caseIndex + 1] : 'cat-eof'
  const transportIndex = process.argv.indexOf('--transport')
  const transport =
    transportIndex >= 0 ? process.argv[transportIndex + 1] : 'local'
  runShellProbe({
    caseName,
    transport,
    skipBuild: process.argv.includes('--skip-build'),
  })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
