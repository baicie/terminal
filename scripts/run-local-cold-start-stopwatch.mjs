import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseShellProbeResult } from './run-terminal-shell-probe.mjs'
import { runColdStartStopwatch } from './run-cold-start-stopwatch.mjs'

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')
export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_CASE = 'cat-eof'
const PROBE_ENVIRONMENT_KEYS = [
  'ENV',
  'BASH_ENV',
  'PROMPT_COMMAND',
  'CDPATH',
  'ZDOTDIR',
  'TERMINAL_SHELL_PROBE_SSH_CONFIG_PATH',
]

const defaultDependencies = {
  mkdtemp,
  readFile,
  rm,
  runStopwatch: runColdStartStopwatch,
  tempDirectory: os.tmpdir(),
  platform: process.platform,
}

function absolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`)
  }
  return value
}

export function createLocalColdStartNonce() {
  return `local_${randomBytes(12).toString('hex')}`
}

function parseArguments(argv) {
  const option = name =>
    argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined
  const timeout = option('--timeout-ms')
  return {
    appPath: option('--app-path'),
    caseName: option('--case') ?? DEFAULT_CASE,
    ...(timeout === undefined ? {} : { timeoutMs: Number(timeout) }),
  }
}

/**
 * Measures the instrumented local terminal path from app spawn to a marker
 * produced only after the frontend sends a nonce command through xterm,
 * session_write and the local PTY, then receives the marker back. The marker
 * file is created by the Rust probe command after that PTY output is parsed.
 */
export async function runLocalColdStartStopwatch({
  appPath,
  caseName = DEFAULT_CASE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  environment = process.env,
  dependencies: overrides = {},
} = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (dependencies.platform !== 'darwin') {
    throw new Error('local cold-start stopwatch is supported on macOS only')
  }
  if (caseName !== DEFAULT_CASE) {
    throw new Error(`local cold-start stopwatch only supports ${DEFAULT_CASE}`)
  }
  const shell = path.basename(
    environment.TERMINAL_DEFAULT_SHELL ?? environment.SHELL ?? '/bin/bash',
  )
  if (shell !== 'bash' && shell !== 'zsh') {
    throw new Error(
      `local cold-start stopwatch shell '${shell}' has no posix probe dialect; expected bash/zsh`,
    )
  }
  const executable = absolute(appPath, 'local cold-start stopwatch app path')
  const runDirectory = await dependencies.mkdtemp(
    path.join(dependencies.tempDirectory, 'terminal-local-cold-'),
  )
  const nonce = createLocalColdStartNonce()
  const shellPath =
    environment.TERMINAL_DEFAULT_SHELL ?? environment.SHELL ?? '/bin/bash'
  const resultPath = path.join(runDirectory, 'shell-probe-result.json')
  const markerPath = path.join(runDirectory, 'terminal-ready.marker')
  const markerContent = `TERMINAL_LOCAL_COLD_START_${nonce}`
  const probeEnvironment = {
    ...environment,
    TERMINAL_SHELL_PROBE: '1',
    TERMINAL_SHELL_PROBE_CASE: caseName,
    TERMINAL_SHELL_PROBE_DIALECT: 'posix',
    TERMINAL_SHELL_PROBE_NONCE: nonce,
    TERMINAL_SHELL_PROBE_RESULT_PATH: resultPath,
    TERMINAL_SHELL_PROBE_MARKER_PATH: markerPath,
    TERMINAL_SHELL_PROBE_MARKER_CONTENT: markerContent,
    // Bind the backend's shell selection to the dialect checked above. This
    // prevents a stale host override such as fish or PowerShell from being
    // reintroduced when the stopwatch merges process.env.
    TERMINAL_DEFAULT_SHELL: shellPath,
  }
  for (const key of PROBE_ENVIRONMENT_KEYS) delete probeEnvironment[key]
  try {
    const stopwatch = await dependencies.runStopwatch({
      appPath: executable,
      timeoutMs,
      axProbe: 'native',
      readinessMode: 'local',
      readinessTarget: 'terminal',
      homeDirectory: runDirectory,
      markerPath,
      markerContent,
      nonce,
      environment: probeEnvironment,
      unsetEnvironmentKeys: PROBE_ENVIRONMENT_KEYS,
      dependencies,
    })
    const probeResult = parseShellProbeResult(
      await dependencies.readFile(resultPath, 'utf8'),
      caseName,
    )
    return {
      ...stopwatch,
      caseName,
      marker: markerContent,
      markerPath,
      nonce,
      probeResult,
    }
  } finally {
    await dependencies.rm(runDirectory, { recursive: true, force: true })
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const options = parseArguments(process.argv.slice(2))
  if (!options.appPath) {
    console.error('local cold-start stopwatch requires --app-path')
    process.exitCode = 1
  } else {
    runLocalColdStartStopwatch(options)
      .then(result => console.log(JSON.stringify(result, null, 2)))
      .catch(error => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
      })
  }
}
