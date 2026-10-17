import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  parseInputProbeSource,
  withInputProbeSource,
} from './input-probe-source.mjs'
import {
  inputProbeInstruction,
  inputProbeScenario,
  validateCompositionEvidence,
  validateManualInputEvidence,
} from './input-probe-scenarios.mjs'
import {
  buildFreshTauriBinary,
  cargoTargetDirectory,
  terminalExecutablePath,
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
const MAX_ROUNDS = 100
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')

const SWIFT_INJECTOR = `import CoreGraphics
import Foundation
import Carbon
import AppKit

func property(_ source: TISInputSource, _ key: CFString) -> AnyObject? {
    guard let raw = TISGetInputSourceProperty(source, key) else { return nil }
    return Unmanaged<AnyObject>.fromOpaque(raw).takeUnretainedValue()
}

func reportSource(_ source: TISInputSource) {
    let id = property(source, kTISPropertyInputSourceID) as? String ?? ""
    let ascii = (property(source, kTISPropertyInputSourceIsASCIICapable) as? NSNumber)?.boolValue ?? false
    let type = property(source, kTISPropertyInputSourceType) as? String ?? ""
    let data = try! JSONSerialization.data(withJSONObject: ["id": id, "asciiCapable": ascii, "type": type])
    print(String(data: data, encoding: .utf8)!)
}

if CommandLine.arguments.count >= 2 {
    switch CommandLine.arguments[1] {
    case "activate":
        guard CommandLine.arguments.count == 3, let pid = pid_t(CommandLine.arguments[2]) else { exit(4) }
        guard let application = NSRunningApplication(processIdentifier: pid) else { exit(9) }
        application.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
        exit(0)
    case "frontmost":
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier else { exit(10) }
        print(pid)
        exit(0)
    case "input-source":
        reportSource(TISCopyCurrentKeyboardInputSource().takeRetainedValue())
        exit(0)
    case "ascii-source":
        reportSource(TISCopyCurrentASCIICapableKeyboardLayoutInputSource().takeRetainedValue())
        exit(0)
    case "lookup-source", "select-source":
        guard CommandLine.arguments.count == 3 else { exit(6) }
        let filter = [kTISPropertyInputSourceID as String: CommandLine.arguments[2]] as CFDictionary
        let sources = TISCreateInputSourceList(filter, false).takeRetainedValue() as! [TISInputSource]
        guard let source = sources.first else { exit(7) }
        if CommandLine.arguments[1] == "lookup-source" {
            reportSource(source)
            exit(0)
        }
        guard TISSelectInputSource(source) == noErr else { exit(7) }
        // Allow the foreground application's input context to observe the change.
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
        reportSource(TISCopyCurrentKeyboardInputSource().takeRetainedValue())
        exit(0)
    default: break
    }
}

// Delivers key events straight into the target app's event stream.
// A nil event source plus postToPid is required: events built on the HID
// system state source are dropped for cross-process injection on macOS 15.
func postKey(_ code: CGKeyCode, _ down: Bool, _ pid: pid_t) {
    let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
    event?.postToPid(pid)
}

func pause(_ microseconds: useconds_t) {
    usleep(microseconds)
}

if CommandLine.arguments.count >= 2 && CommandLine.arguments[1] == "access" {
    print(CGPreflightPostEventAccess() ? "allowed" : "denied")
    exit(0)
}

if CommandLine.arguments.count >= 5 && CommandLine.arguments[2] == "click" {
    guard let pid = pid_t(CommandLine.arguments[1]) else { exit(4) }
    guard let x = Double(CommandLine.arguments[3]), let y = Double(CommandLine.arguments[4]) else { exit(5) }
    let point = CGPoint(x: x, y: y)
    let down = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseDown,
        mouseCursorPosition: point,
        mouseButton: .left
    )
    down?.postToPid(pid)
    usleep(50_000)
    let up = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseUp,
        mouseCursorPosition: point,
        mouseButton: .left
    )
    up?.postToPid(pid)
    exit(0)
}

guard CommandLine.arguments.count >= 4 else { exit(2) }
guard let pid = pid_t(CommandLine.arguments[1]) else { exit(4) }
let text = CommandLine.arguments[3]
let keyCodes: [Character: CGKeyCode] = ["a": 0, "s": 1, "d": 2, "z": 6, "h": 4, "o": 31, "n": 45, "g": 5, "w": 13, "e": 14, "i": 34]
func tap(_ code: CGKeyCode) {
    postKey(code, true, pid)
    pause(20_000)
    postKey(code, false, pid)
    pause(80_000)
}
func typeKeys(_ word: String) {
    for character in word {
        guard let code = keyCodes[character] else { exit(3) }
        tap(code)
    }
    pause(500_000)
}
let action = CommandLine.arguments[2]
if action == "ime-commit" || action == "ime-cancel" || action == "ime-enter" {
    if action == "ime-cancel" {
        typeKeys("nihao")
        tap(53) // Escape cancels marked text, it must never reach the PTY.
        pause(500_000)
    }
    typeKeys(action == "ime-enter" ? "asd" : "zhongwen")
    tap(action == "ime-enter" ? 36 : 49) // Enter commits literals; Space selects a Chinese candidate.
    pause(500_000)
    tap(36) // A separate Return submits the shell read after the IME commit.
    exit(0)
}
guard action == "overlap" else { exit(8) }
var codes: [CGKeyCode] = []
for character in text {
    guard let code = keyCodes[character] else { exit(3) }
    codes.append(code)
}
pause(100_000)
for code in codes {
    postKey(code, true, pid)
    pause(20_000)
}
for code in codes.reversed() {
    postKey(code, false, pid)
    pause(20_000)
}
pause(50_000)
postKey(36, true, pid)
postKey(36, false, pid)
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

function waitForFile(filePath, timeoutMs, dependencies, label, signal) {
  const deadline = dependencies.now() + timeoutMs
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    const finish = error => {
      if (settled) return
      settled = true
      dependencies.clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(new Error(`${label} cancelled`))
    signal?.addEventListener('abort', abort, { once: true })
    const attempt = async () => {
      if (settled) return
      if (signal?.aborted) return abort()
      try {
        await dependencies.access(filePath)
        finish()
        return
      } catch {
        if (dependencies.now() > deadline) {
          finish(new Error(`${label} timed out after ${timeoutMs} ms`))
          return
        }
      }
      if (!settled) timer = dependencies.setTimeout(attempt, 100)
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
      () =>
        finish(reject, new Error(`${label} timed out after ${timeoutMs} ms`)),
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
    child = dependencies.spawn('swiftc', ['-O', sourcePath, '-o', binaryPath], {
      cwd: directory,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } catch (error) {
    throw new Error(`swiftc could not start: ${error.message}`)
  }
  await waitForChildClose(
    child,
    SWIFT_COMPILE_TIMEOUT_MS,
    dependencies,
    'swiftc',
  )
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

export function parseProbeResult(serialized, rounds, expectedHex) {
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
    keys.join(',') !==
      'durationMs,error,expectedHex,expectedText,ok,results,rounds' ||
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
    const error =
      typeof value.error === 'string' ? value.error : 'no error reported'
    throw new Error(`input probe failed: ${error}`)
  }
  if (value.error !== null) {
    throw new Error('input probe success must not carry an error')
  }
  for (const [index, round] of value.results.entries()) {
    if (
      round.round !== index + 1 ||
      round.expectedHex !== expectedHex ||
      round.receivedHex !== expectedHex ||
      round.ok !== true
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
  expected,
  scenario = 'overlap',
  inject = 'auto',
  inputSource = 'current',
  inputSourceId,
  checkpointOnly = false,
  skipBuild = false,
  targetDirectory,
  dependencies: overrides = {},
} = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  const probeScenario = inputProbeScenario(scenario, expected)
  expected = probeScenario.expected
  if (probeScenario.manualOnly && inject !== 'manual') {
    throw new Error(`input probe scenario ${scenario} requires --inject manual`)
  }
  if (dependencies.platform !== 'darwin') {
    throw new Error('Terminal input probe is only supported on macOS')
  }
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
    throw new Error(`input probe rounds must be within 1..=${MAX_ROUNDS}`)
  }
  if (
    expected.length === 0 ||
    expected.length > 32 ||
    /[\x00-\x1f\x7f]/.test(expected)
  ) {
    throw new Error('input probe expected text is invalid')
  }
  if (!['auto', 'swift', 'osascript', 'manual'].includes(inject)) {
    throw new Error('input probe injector must be auto/swift/osascript/manual')
  }
  if (!['current', 'ascii'].includes(inputSource)) {
    throw new Error('input-source policy must be current/ascii')
  }
  if (
    inputSourceId !== undefined &&
    (typeof inputSourceId !== 'string' ||
      !/^[A-Za-z0-9._-]{1,200}$/.test(inputSourceId) ||
      inputSource !== 'current')
  ) {
    throw new Error(
      'input-source-id must be a source identifier with --input-source current',
    )
  }
  if (inputSourceId && !['auto', 'swift'].includes(inject))
    throw new Error('input-source-id requires the swift injector')
  if (inputSource === 'ascii' && !['auto', 'swift', 'manual'].includes(inject)) {
    throw new Error(
      '--input-source ascii requires the native input-source helper',
    )
  }
  if (
    probeScenario.source === 'ime' &&
    (inputSource !== 'current' || inject === 'osascript')
  ) {
    throw new Error(
      'IME scenarios require current input source and swift/manual injection',
    )
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
  const diagPath = path.join(runDirectory, 'diag.log')
  const expectedHex = Array.from(new TextEncoder().encode(expected), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

  let injector
  let injectorBinary
  if (
    inject === 'auto' ||
    inject === 'swift' ||
    inject === 'manual'
  ) {
    injectorBinary = await compileSwiftInjector(runDirectory, dependencies)
    if (inject !== 'manual') {
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
    TERMINAL_INPUT_PROBE_DIAG_PATH: diagPath,
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
    throw new Error(
      `Failed to start terminal input probe binary: ${error.message}`,
    )
  }
  const application = waitForClose(child).then(status => ({ status }))
  const pollAbort = new AbortController()
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
      waitForFile(
        readyPath,
        READY_TIMEOUT_MS,
        dependencies,
        'input probe round 1 checkpoint',
        pollAbort.signal,
      ),
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
      console.log(
        '[input-probe] round 1 checkpoint observed; local PTY probe is awaiting input',
      )
      return { checkpointObserved: true, injector: 'none' }
    }
    const runRounds = async (source = null) => {
      console.log(
        source
          ? `[input-probe] input source: ${source.id} type=${source.type ?? 'unknown'} asciiCapable=${String(source.asciiCapable)}`
          : '[input-probe] input source: manual/unverified',
      )
      for (let round = 1; round <= rounds; round += 1) {
        if (round > 1) {
          await Promise.race([
            waitForFile(
              readyPath,
              READY_TIMEOUT_MS,
              dependencies,
              `input probe round ${round} checkpoint`,
              pollAbort.signal,
            ),
            applicationClosed,
          ])
          let serialized
          try {
            serialized = await dependencies.readFile(readyPath, 'utf8')
          } catch {
            throw new Error(
              `input probe round ${round} checkpoint is unreadable`,
            )
          }
          const checkpoint = parseReadyCheckpoint(serialized)
          if (checkpoint !== round) {
            throw new Error(
              `input probe expected round ${round}, got checkpoint ${checkpoint}`,
            )
          }
        }
        if (injector !== 'manual') {
          await ensureFrontmost(child.pid, injectorBinary, dependencies)
        }
        if (source) {
          const current = parseInputProbeSource(
            await runSwiftInjector(
              injectorBinary,
              ['input-source'],
              dependencies,
            ),
          )
          if (
            current.id !== source.id ||
            current.asciiCapable !== source.asciiCapable ||
            current.type !== source.type
          ) {
            throw new Error(
              `input source changed during ${scenario} acceptance: ${current.id}`,
            )
          }
        }
        if (injector === 'swift') {
          // Clicking the terminal after selecting a TIS input method can make
          // WKWebView reacquire its default ASCII input context. The probe
          // already focuses xterm on mount; preserve the selected IME context.
          if (probeScenario.source !== 'ime')
            await clickWindowCenter(child.pid, injectorBinary, dependencies)
          await runSwiftInjector(
            injectorBinary,
            [String(child.pid), probeScenario.action, expected],
            dependencies,
          )
        } else if (injector === 'osascript') {
          await postOsascriptKeys(expected, dependencies)
        } else {
          console.log(
            `[input-probe] Round ${round}/${rounds}: ${inputProbeInstruction(scenario, expected)} in the focused terminal window now.`,
          )
        }
        if (round < rounds) {
          await Promise.race([
            waitForRoundAdvance(
              readyPath,
              round + 1,
              injector === 'manual' ? RESULT_TIMEOUT_MS : 2_500,
              dependencies,
            ),
            applicationClosed,
          ])
        }
        if (round % 10 === 0)
          console.log(
            `[input-probe] injected ${round}/${rounds} rounds (one injection per round)`,
          )
      }

      await Promise.race([
        waitForFile(
          resultPath,
          injector === 'manual' ? RESULT_TIMEOUT_MS : 2_500,
          dependencies,
          'input probe result',
          pollAbort.signal,
        ),
        applicationClosed,
      ])
      const serialized = await dependencies.readFile(resultPath, 'utf8')
      const result = parseProbeResult(serialized, rounds, expectedHex)
      const needsDiagnostics =
        probeScenario.manualOnly || probeScenario.source === 'ime'
      const diagnostics = needsDiagnostics
        ? await dependencies.readFile(diagPath, 'utf8')
        : ''
      const manualEvidence =
        injector === 'manual' && probeScenario.manualOnly
          ? validateManualInputEvidence(
              scenario,
              rounds,
              expected,
              diagnostics,
            )
          : undefined
      const compositionEvidence =
        probeScenario.source === 'ime'
          ? validateCompositionEvidence(
              scenario,
              rounds,
              diagnostics,
            )
          : undefined
      console.log(
        `[input-probe] ${rounds} rounds completed via ${injector} injection: expected=${expectedHex}, all rounds match`,
      )
      return {
        ...result,
        injector,
        scenario,
        ...(source
          ? {
              inputSource: source.id,
              inputSourceInfo: {
                id: source.id,
                asciiCapable: source.asciiCapable,
                type: source.type ?? null,
              },
            }
          : {}),
        ...(compositionEvidence ? { compositionEvidence } : {}),
        ...(manualEvidence ? { manualEvidence } : {}),
      }
    }
    if (injector === 'swift') {
      await ensureFrontmost(child.pid, injectorBinary, dependencies)
      if (probeScenario.source === 'ime')
        await clickWindowCenter(child.pid, injectorBinary, dependencies)
      return await withInputProbeSource(
        inputSource,
        args => runSwiftInjector(injectorBinary, args, dependencies),
        runRounds,
        probeScenario.source,
        inputSourceId,
      )
    }
    if (probeScenario.source === 'ime') {
      return await withInputProbeSource(
        'current',
        args => runSwiftInjector(injectorBinary, args, dependencies),
        runRounds,
        'ime',
      )
    }
    if (probeScenario.source === 'ascii') {
      return await withInputProbeSource(
        inputSource,
        args => runSwiftInjector(injectorBinary, args, dependencies),
        runRounds,
        'ascii',
      )
    }
    if (inputSource === 'ascii' || inputSourceId)
      throw new Error(
        'ASCII input source selection requires Accessibility access',
      )
    return await runRounds()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    let diagnostics = ''
    try {
      diagnostics = await dependencies.readFile(diagPath, 'utf8')
    } catch {
      // Diagnostics are best effort.
    }
    throw new Error(
      diagnostics.trim()
        ? `${message}\n[input-probe diag]\n${diagnostics.trim()}`
        : message,
    )
  } finally {
    pollAbort.abort()
    try {
      child?.kill('SIGTERM')
    } catch {
      // The app may already be gone.
    }
    await application
    await dependencies.rm(runDirectory, { recursive: true, force: true })
  }
}

function runOsascript(script, dependencies) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = dependencies.spawn('osascript', ['-e', script], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(new Error(`osascript could not start: ${error.message}`))
      return
    }
    let output = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', chunk => (output += chunk))
    child.once('error', error =>
      reject(new Error(`osascript failed: ${error.message}`)),
    )
    child.once('close', code =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error(
              `osascript exited with code ${String(code)}: ${output.trim()}`,
            ),
          ),
    )
  })
}

const FRONTMOST_RETRIES = 10
const FRONTMOST_SETTLE_MS = 1_000
const CLICK_SETTLE_MS = 300

function windowCenter(pid, dependencies) {
  return runOsascript(
    `tell application "System Events" to tell first process whose unix id is ${pid} to get {position, size} of window 1`,
    dependencies,
  ).then(output => {
    const match = output.match(/^(-?\d+), (-?\d+), (\d+), (\d+)$/)
    if (!match) {
      throw new Error(`unexpected window bounds: ${output || 'empty'}`)
    }
    const [x, y, width, height] = match.slice(1).map(Number)
    if (width <= 0 || height <= 0) {
      throw new Error('input probe window has invalid bounds')
    }
    return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) }
  })
}

async function clickWindowCenter(pid, injectorBinary, dependencies) {
  const center = await windowCenter(pid, dependencies)
  await runSwiftInjector(
    injectorBinary,
    [String(pid), 'click', String(center.x), String(center.y)],
    dependencies,
  )
  await new Promise(resolve =>
    dependencies.setTimeout(resolve, CLICK_SETTLE_MS),
  )
}

async function ensureFrontmost(pid, injectorBinary, dependencies) {
  let lastFailure = 'unverified'
  for (let attempt = 1; attempt <= FRONTMOST_RETRIES; attempt += 1) {
    try {
      const current = await runSwiftInjector(
        injectorBinary,
        ['frontmost'],
        dependencies,
      )
      if (current === String(pid)) return
      await runSwiftInjector(
        injectorBinary,
        ['activate', String(pid)],
        dependencies,
      )
      await new Promise(resolve =>
        dependencies.setTimeout(resolve, FRONTMOST_SETTLE_MS),
      )
      const frontmost = await runSwiftInjector(
        injectorBinary,
        ['frontmost'],
        dependencies,
      )
      if (frontmost === String(pid)) return
      lastFailure = `frontmost process id is ${frontmost || 'unknown'}, expected ${pid}`
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(
    `could not bring the terminal input probe window to the front: ${lastFailure}; grant Accessibility permission and retry`,
  )
}

async function waitForRoundAdvance(
  readyPath,
  expectedRound,
  timeoutMs,
  dependencies,
) {
  const deadline = dependencies.now() + timeoutMs
  for (;;) {
    let serialized
    try {
      serialized = await dependencies.readFile(readyPath, 'utf8')
    } catch {
      // The checkpoint file may be mid-write.
    }
    if (serialized) {
      const checkpoint = parseReadyCheckpoint(serialized)
      if (checkpoint >= expectedRound) return checkpoint
    }
    if (dependencies.now() > deadline) {
      throw new Error(
        `input probe round ${expectedRound} checkpoint did not arrive within ${timeoutMs} ms`,
      )
    }
    await new Promise(resolve => dependencies.setTimeout(resolve, 100))
  }
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
  const option = name =>
    argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined
  const inject = option('--inject') ?? 'auto'
  runInputProbe({
    inject,
    scenario: option('--scenario') ?? 'overlap',
    inputSource: option('--input-source') ?? 'current',
    inputSourceId: option('--input-source-id'),
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
