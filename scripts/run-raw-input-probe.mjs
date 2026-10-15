import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  buildFreshTauriBinary,
  cargoTargetDirectory,
  terminalExecutablePath,
} from './run-terminal-smoke.mjs'

export const RESULT_TIMEOUT_MS = 60_000
export const CLEANUP_GRACE_MS = 5_000
export const FORCE_KILL_GRACE_MS = 2_000

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')
const CASE_EXPECTED_HEX = {
  'sgr-mouse': '1b5b3c303b333b344d',
  'bracketed-paste':
    '1b5b3230307e66697273740d7365636f6e641b5b3230317e',
  'raw-x10': '1b5b4d20813f',
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
  tempDirectory: os.tmpdir(),
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
          : new Error('raw input probe result wait cancelled'),
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
          finish(new Error(`raw input probe result timed out after ${timeoutMs} ms`))
          return
        }
      }
      timer = dependencies.setTimeout(poll, 100)
    }
    void poll()
  })
}

function invalidResult(message) {
  return new Error(`Invalid raw input probe result: ${message}`)
}

export function parseRawInputProbeResult(serialized, caseName) {
  let value
  try {
    value = JSON.parse(serialized)
  } catch {
    throw invalidResult('result is not valid JSON')
  }
  const expectedHex = CASE_EXPECTED_HEX[caseName]
  if (
    !expectedHex ||
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw invalidResult('result is not an object or case is unsupported')
  }
  const keys = Object.keys(value).sort()
  if (
    keys.join(',') !== 'caseName,durationMs,error,expectedHex,ok,receivedHex' ||
    value.caseName !== caseName ||
    value.expectedHex !== expectedHex ||
    typeof value.receivedHex !== 'string' ||
    !/^[0-9a-f]+$/.test(value.receivedHex) ||
    value.receivedHex.length % 2 !== 0 ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 1 ||
    value.ok !== true ||
    value.error !== null ||
    value.receivedHex !== expectedHex
  ) {
    const error = typeof value.error === 'string' ? value.error : 'contract mismatch'
    throw invalidResult(error)
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

export async function runRawInputProbe({
  cwd = PROJECT_ROOT,
  env = process.env,
  caseName = 'sgr-mouse',
  skipBuild = false,
  targetDirectory,
  dependencies: overrides = {},
} = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (dependencies.platform !== 'darwin') {
    throw new Error('Raw input probe is only supported on macOS')
  }
  if (!Object.hasOwn(CASE_EXPECTED_HEX, caseName)) {
    throw new Error(`Unsupported raw input probe case: ${caseName}`)
  }
  if (!skipBuild) {
    await buildFreshTauriBinary({
      cwd,
      env: { ...env, VITE_TERMINAL_SMOKE_BUILD: '1' },
      dependencies,
    })
  }
  const resolvedTargetDirectory =
    targetDirectory ?? (await cargoTargetDirectory({ cwd, env, dependencies }))
  const runDirectory = await dependencies.mkdtemp(
    path.join(dependencies.tempDirectory, 'terminal-raw-input-probe-'),
  )
  const resultPath = path.join(runDirectory, 'result.json')
  const smokeEnvironment = { ...env }
  for (const key of ['ENV', 'BASH_ENV', 'PROMPT_COMMAND', 'CDPATH']) {
    delete smokeEnvironment[key]
  }
  Object.assign(smokeEnvironment, {
    HOME: runDirectory,
    TERMINAL_RAW_INPUT_PROBE: '1',
    TERMINAL_RAW_INPUT_PROBE_RESULT_PATH: resultPath,
    TERMINAL_RAW_INPUT_PROBE_CASE: caseName,
  })
  const executable = terminalExecutablePath(resolvedTargetDirectory, {
    platform: dependencies.platform,
  })
  let child
  try {
    child = dependencies.spawn(executable, [], {
      cwd,
      env: smokeEnvironment,
      shell: false,
      stdio: 'inherit',
    })
  } catch (error) {
    throw new Error(`Failed to start raw input probe binary: ${error.message}`)
  }
  const application = waitForClose(child)
  const resultWaitController = new AbortController()
  try {
    const earlyClose = application.then(status => {
      resultWaitController.abort(
        status.error ??
          new Error(
            `Raw input probe application closed early with code ${String(status.code)}${status.signal ? ` (${status.signal})` : ''}`,
          ),
      )
      throw new Error(
        `Raw input probe application closed early with code ${String(status.code)}${status.signal ? ` (${status.signal})` : ''}`,
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
    const serialized = await dependencies.readFile(resultPath, 'utf8')
    const result = parseRawInputProbeResult(serialized, caseName)
    return { ...result, caseName }
  } finally {
    resultWaitController.abort()
    signalChild(child, 'SIGTERM')
    let cleanupTimer
    let forceKillTimer
    const cleanupDeadline = new Promise(resolve => {
      cleanupTimer = dependencies.setTimeout(
        () => {
          signalChild(child, 'SIGKILL')
          forceKillTimer = dependencies.setTimeout(
            () => resolve({ code: null, signal: 'SIGKILL', error: null }),
            FORCE_KILL_GRACE_MS,
          )
        },
        CLEANUP_GRACE_MS,
      )
    })
    const status = await Promise.race([application, cleanupDeadline])
    dependencies.clearTimeout(cleanupTimer)
    dependencies.clearTimeout(forceKillTimer)
    try {
      if (status?.error) throw status.error
    } finally {
      await dependencies.rm(runDirectory, { recursive: true, force: true })
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const caseIndex = process.argv.indexOf('--case')
  const caseName = caseIndex >= 0 ? process.argv[caseIndex + 1] : 'sgr-mouse'
  runRawInputProbe({ caseName, skipBuild: process.argv.includes('--skip-build') })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => {
      console.error(error.message)
      process.exitCode = 1
    })
}
