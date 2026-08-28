import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  buildFreshTauriBinary,
  cargoTargetDirectory,
} from './run-terminal-smoke.mjs'

/**
 * Physical keyboard acceptance driver for the terminal input probe.
 *
 * The app mounts a local PTY probe that reports the exact bytes it receives.
 * This driver launches it, then injects overlapping `a/s/d` key events into
 * the real macOS event pipeline (CGEvent) or instructs a human to type them.
 * The probe publishes each round's expected/received hex and a final result.
 */

export const APP_TIMEOUT_MS = 240_000
export const READY_TIMEOUT_MS = 60_000
export const RESULT_TIMEOUT_MS = 120_000
export const SWIFT_COMPILE_TIMEOUT_MS = 60_000

const DEFAULT_ROUNDS = 30
const DEFAULT_EXPECTED = 'asd'
const MAX_ROUNDS = 100
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')

const SWIFT_INJECTOR = `import CoreGraphics
import Foundation

func postKey(_ code: CGKeyCode, _ down: Bool) {
    let source = CGEventSource(stateID: .hidSystemState)
    let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
    event?.post(tap: .cghidEventTap)
}

func pause(_ microseconds: useconds_t) {
    usleep(microseconds)
}

if CommandLine.arguments.count >= 2 && CommandLine.arguments[1] == "access" {
    print(CGPreflightPostEventAccess() ? "allowed" : "denied")
    exit(0)
}

guard CommandLine.arguments.count >= 3 else { exit(2) }
let text = CommandLine.arguments[2]
let keyCodes: [Character: CGKeyCode] = ["a": 0, "s": 1, "d": 2]
var codes: [CGKeyCode] = []
for character in text {
    guard let code = keyCodes[character] else { exit(3) }
    codes.append(code)
}
for code in codes {
    postKey(code, true)
    pause(4_000)
}
for code in codes.reversed() {
    postKey(code, false)
    pause(4_000)
}
pause(30_000)
postKey(36, true)
postKey(36, false)
`

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
  writeFile,
}

function collectOutput(stream) {
  let output = ''
  stream?.setEncoding('utf8')
  stream?.on('data', chunk => (output += chunk))
  return () => output
}

function waitForClose(child) {
  return new Promise(resolve => {
    let settled = false
    const finish = status => {
      if (!settled) resolve(status)
      settled = true
    }
    child.once('error', spawnError => finish({ spawnError }))
    child.once('close', (code, signal) =>
      finish({ code, signal, spawnError: null }),
    )
  })
}

function waitForFile(filePath, timeoutMs, dependencies, label) {
  const deadline = dependencies.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        await dependencies.access(filePath)
        resolve()
        return
      } catch {
        if (dependencies.now() > deadline) {
          reject(new Error(`${label} timed out after ${timeoutMs} ms`))
          return
        }
      }
      dependencies.setTimeout(attempt, 100)
    }
    void attempt()
  })
}

function waitForChildClose(child, timeoutMs, dependencies, label) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      dependencies.clearTimeout(timer)
      fn(value)
    }
    const timer = dependencies.setTimeout(
      () => finish(reject, new Error(`${label} timed out after ${timeoutMs} ms`)),
      timeoutMs,
    )
    child.once('error', error =>
      finish(reject, new Error(`${label} failed: ${error.message}`)),
    )
    child.once('close', (code, signal) => {
      if (code !== 0) {
        finish(
          reject,
          new Error(
            `${label} exited with code ${String(code)}${signal ? ` (${signal})` : ''}`,
          ),
        )
        return
      }
      finish(resolve)
    })
  })
}

async function compileSwiftInjector(directory, dependencies) {
  const sourcePath = path.join(directory, 'post-key-events.swift')
  const binaryPath = path.join(directory, 'post-key-events')
  await dependencies.writeFile(sourcePath, SWIFT_INJECTOR, { encoding: 'utf8' })
  let child
  try {
    child = dependencies.spawn(
      'swiftc',
      ['-O', sourcePath, '-o', binaryPath],
      { cwd: directory, shell: false, stdio: ['ignore', 'ignore', 'pipe'] },
    )
  } catch (error) {
    throw new Error(`swiftc could not start: ${error.message}`)
  }
  await waitForChildClose(child, SWIFT_COMPILE_TIMEOUT_MS, dependencies, 'swiftc')
  return binaryPath
}

function runSwiftInjector(binaryPath, args, dependencies) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = dependencies.spawn(binaryPath, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(new Error(`input injector could not start: ${error.message}`))
      return
    }
    const stdout = collectOutput(child.stdout)
    const stderr = collectOutput(child.stderr)
    child.once('error', error =>
      reject(new Error(`input injector failed: ${error.message}`)),
    )
    child.once('close', code => {
      if (code !== 0) {
        reject(
          new Error(
            `input injector exited with code ${String(code)}: ${stderr().trim() || stdout().trim()}`,
          ),
        )
        return
      }
      resolve(stdout().trim())
    })
  })
}

function parseReadyCheckpoint(serialized) {
  let value
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('input probe checkpoint is not valid JSON')
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof value.round !== 'number' ||
    !Number.isSafeInteger(value.round) ||
    value.round < 1 ||
    value.round > MAX_ROUNDS
  ) {
    throw new Error('input probe checkpoint is invalid')
  }
  return value.round
}

function parseProbeResult(serialized, rounds, expectedHex) {
  let value
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('input probe result is not valid JSON')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('input probe result is invalid')
  }
  const keys = Object.keys(value).sort()
  if (
    keys.join(',') !== 'durationMs,error,expectedHex,expectedText,ok,results,rounds' ||
    value.rounds !== rounds ||
    typeof value.expectedHex !== 'string' ||
    value.expectedHex !== expectedHex ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 1 ||
    !Array.isArray(value.results) ||
    value.results.length !== rounds
  ) {
    throw new Error('input probe result contract is invalid')
  }
  if (value.ok !== true) {
    const error = typeof value.error === 'string' ? value.error : 'no error reported'
    throw new Error(`input probe failed: ${error}`)
  }
  if (value.error !== null) {
    throw new Error('input probe success must not carry an error')
  }
  for (const [index, round] of value.results.entries()) {
    if (
      round.round !== index + 1 ||
      round.expectedHex !== expectedHex ||
      typeof round.receivedHex !== 'string' ||
      round.ok !== (round.receivedHex === expectedHex)
    ) {
      throw new Error(`input probe round ${index + 1} is invalid`)
    }
  }
  return value
}

export async function runInputProbe({
  cwd = PROJECT_ROOT,
  env = process.env,
  rounds = DEFAULT_ROUNDS,
  expected = DEFAULT_EXPECTED,
  inject = 'auto',
  checkpointOnly = false,
  skipBuild = false,
  targetDirectory,
  dependencies: overrides = {},
} = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (dependencies.platform !== 'darwin') {
    throw new Error('Terminal input probe is only supported on macOS')
  }
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
    throw new Error(`input probe rounds must be within 1..=${MAX_ROUNDS}`)
  }
  if (expected.length === 0 || expected.length > 32 || /[\x00-\x1f\x7f]/.test(expected)) {
    throw new Error('input probe expected text is invalid')
  }
  if (!['auto', 'swift', 'osascript', 'manual'].includes(inject)) {
    throw new Error('input probe injector must be auto/swift/osascript/manual')
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
    path.join(dependencies.tempDirectory, 'terminal-input-probe-'),
  )
  const readyPath = path.join(runDirectory, 'ready.json')
  const resultPath = path.join(runDirectory, 'result.json')
  const expectedHex = Array.from(new TextEncoder().encode(expected), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

  let injector
  let injectorBinary
  if (inject === 'auto' || inject === 'swift') {
    injectorBinary = await compileSwiftInjector(runDirectory, dependencies)
    const accessResult = await runSwiftInjector(
      injectorBinary,
      ['access'],
      dependencies,
    )
    if (accessResult === 'allowed') {
      injector = 'swift'
    } else if (inject === 'swift') {
      throw new Error(
        'CGEvent posting requires Accessibility permission for this host process. Grant it under System Settings → Privacy & Security → Accessibility, or run with --inject manual and type the keys yourself.',
      )
    }
  }
  if (inject === 'osascript') injector = 'osascript'
  if (inject === 'manual') injector = 'manual'
  if (injector === undefined) injector = 'manual'

  const smokeEnvironment = { ...env }
  for (const key of ['ENV', 'BASH_ENV', 'PROMPT_COMMAND', 'CDPATH']) {
    delete smokeEnvironment[key]
  }
  Object.assign(smokeEnvironment, {
    HOME: runDirectory,
    TERMINAL_INPUT_PROBE: '1',
    TERMINAL_INPUT_PROBE_READY_PATH: readyPath,
    TERMINAL_INPUT_PROBE_RESULT_PATH: resultPath,
    TERMINAL_INPUT_PROBE_ROUNDS: String(rounds),
    TERMINAL_INPUT_PROBE_EXPECTED: expected,
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
    throw new Error(`Failed to start terminal input probe binary: ${error.message}`)
  }
  const application = waitForClose(child).then(status => ({ status }))
  const applicationClosed = application.then(
    ({ status }) => {
      throw new Error(
        `Terminal input probe application closed early with code ${String(status.code)}${status.signal ? ` (${status.signal})` : ''}`,
      )
    },
    error => error,
  )

  try {
    await Promise.race([
      waitForFile(readyPath, READY_TIMEOUT_MS, dependencies, 'input probe round 1 checkpoint'),
      applicationClosed,
    ])
    let firstSerialized
    try {
      firstSerialized = await dependencies.readFile(readyPath, 'utf8')
    } catch {
      throw new Error('input probe round 1 checkpoint is unreadable')
    }
    if (parseReadyCheckpoint(firstSerialized) !== 1) {
      throw new Error('input probe expected round 1 for its first checkpoint')
    }
    if (checkpointOnly) {
      console.log('[input-probe] round 1 checkpoint observed; local PTY probe is awaiting input')
      return { checkpointObserved: true, injector: 'none' }
    }
    for (let round = 1; round <= rounds; round += 1) {
      if (round > 1) {
        await Promise.race([
          waitForFile(readyPath, READY_TIMEOUT_MS, dependencies, `input probe round ${round} checkpoint`),
          applicationClosed,
        ])
        let serialized
        try {
          serialized = await dependencies.readFile(readyPath, 'utf8')
        } catch {
          throw new Error(`input probe round ${round} checkpoint is unreadable`)
        }
        const checkpoint = parseReadyCheckpoint(serialized)
        if (checkpoint !== round) {
          throw new Error(`input probe expected round ${round}, got checkpoint ${checkpoint}`)
        }
      }
      if (injector !== 'manual') {
        await activateApplication(child.pid, dependencies)
      }
      if (injector === 'swift') {
        await runSwiftInjector(injectorBinary, ['overlap', expected], dependencies)
      } else if (injector === 'osascript') {
        await postOsascriptKeys(expected, dependencies)
      } else {
        console.log(
          `[input-probe] Round ${round}/${rounds}: type '${expected}' + Enter into the focused terminal window now.`,
        )
      }
    }

    await Promise.race([
      waitForFile(resultPath, RESULT_TIMEOUT_MS, dependencies, 'input probe result'),
      applicationClosed,
    ])
    const serialized = await dependencies.readFile(resultPath, 'utf8')
    const result = parseProbeResult(serialized, rounds, expectedHex)
    console.log(
      `[input-probe] ${rounds} rounds completed via ${injector} injection: expected=${expectedHex}, all rounds match`,
    )
    return { ...result, injector }
  } finally {
    try {
      child?.kill('SIGTERM')
    } catch {
      // The app may already be gone.
    }
    await application
    await dependencies.rm(runDirectory, { recursive: true, force: true })
  }
}

function activateApplication(pid, dependencies) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = dependencies.spawn(
        'osascript',
        [
          '-e',
          `tell application "System Events" to set frontmost of first process whose unix id is ${pid} to true`,
        ],
        { shell: false, stdio: ['ignore', 'ignore', 'pipe'] },
      )
    } catch (error) {
      reject(new Error(`osascript could not start: ${error.message}`))
      return
    }
    child.once('error', error =>
      reject(new Error(`osascript failed: ${error.message}`)),
    )
    child.once('close', code =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `could not focus the terminal input probe window (osascript exit ${String(code)}); grant Accessibility permission and retry`,
            ),
          ),
    )
  })
}

function postOsascriptKeys(expected, dependencies) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = dependencies.spawn(
        'osascript',
        [
          '-e',
          `tell application "System Events" to keystroke "${expected}"`,
          '-e',
          'tell application "System Events" to key code 36',
        ],
        { shell: false, stdio: ['ignore', 'ignore', 'pipe'] },
      )
    } catch (error) {
      reject(new Error(`osascript could not start: ${error.message}`))
      return
    }
    child.once('error', error =>
      reject(new Error(`osascript failed: ${error.message}`)),
    )
    child.once('close', code =>
      code === 0
        ? resolve()
        : reject(new Error(`osascript exited with code ${String(code)}`)),
    )
  })
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const argv = process.argv.slice(2)
  const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
  const inject = option('--inject') ?? 'auto'
  runInputProbe({
    inject,
    checkpointOnly: argv.includes('--checkpoint-only'),
    ...(option('--rounds') ? { rounds: Number(option('--rounds')) } : {}),
    ...(option('--expected') ? { expected: option('--expected') } : {}),
  })
    .then(result => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
