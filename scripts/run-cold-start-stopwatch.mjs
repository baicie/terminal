import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const DEFAULT_TIMEOUT_MS = 10_000
export const AX_POLL_INTERVAL_MS = 100
export const AX_PROBE_TIMEOUT_MS = 3_000
export const NATIVE_AX_PROBE_COMPILE_TIMEOUT_MS = 15_000
export const CLEANUP_GRACE_MS = 3_000
export const READINESS_MODES = ['local', 'remote']
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')
export const NATIVE_AX_PROBE_SOURCE = path.join(
  PROJECT_ROOT,
  'scripts',
  'macos-ax-probe.swift',
)

export const ACCESSIBILITY_PROBE = pid => `
on flagString(value)
  if value then return "1"
  return "0"
end flagString

tell application "System Events"
  tell first process whose unix id is ${pid}
    if (count of windows) = 0 then return "0,0,0,0"
    set localTab to false
    set connectionReady to false
    set terminalInput to false
    set shellPrompt to false
    repeat with currentWindow in windows
      repeat with element in entire contents of currentWindow
        set itemText to ""
        try
          set itemText to (name of element as text)
        end try
        set itemDescription to ""
        try
          set itemDescription to (description of element as text)
        end try
        set itemValue to ""
        try
          set itemValue to (value of element as text)
        end try
        set itemRole to ""
        try
          set itemRole to (role description of element as text)
        end try
        set haystack to itemText & " " & itemDescription & " " & itemValue
        if haystack contains "Local" or haystack contains "本地终端" then set localTab to true
        if haystack contains "Connected" or haystack contains "已连接" then set connectionReady to true
        if ((itemRole contains "text field") or (itemRole contains "text area")) and (haystack contains "Terminal input" or haystack contains "xterm input") then set terminalInput to true
        if haystack contains "zsh" or haystack contains "% " or haystack contains "~%" then set shellPrompt to true
      end repeat
    end repeat
    return my flagString(localTab) & "," & my flagString(connectionReady) & "," & my flagString(terminalInput) & "," & my flagString(shellPrompt)
  end tell
end tell
`

const defaultDependencies = {
  access,
  clearTimeout: globalThis.clearTimeout,
  mkdtemp,
  now: () => Number(process.hrtime.bigint() / 1_000_000n),
  platform: process.platform,
  readFile,
  rm,
  setTimeout: globalThis.setTimeout,
  spawn,
  tempDirectory: os.tmpdir(),
}

function ensureAbsoluteAppPath(appPath) {
  if (typeof appPath !== 'string' || !path.isAbsolute(appPath)) {
    throw new Error('cold-start stopwatch requires an absolute --app-path')
  }
  return appPath
}

function ensureAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`)
  }
  return value
}

export function parseAccessibilityReadiness(serialized) {
  const flags = String(serialized).trim().split(',')
  if (flags.length !== 4) {
    throw new Error('AX probe must return exactly four readiness flags')
  }
  if (flags.some(flag => flag !== '0' && flag !== '1')) {
    throw new Error('AX readiness flags must be 0 or 1')
  }
  return {
    localTab: flags[0] === '1',
    connected: flags[1] === '1',
    terminalInput: flags[2] === '1',
    shellPrompt: flags[3] === '1',
  }
}

function isReady(readiness, readinessMode, markerReady, hasRemoteEvidence) {
  // xterm renders the shell prompt on a canvas, which WebKit does not expose
  // consistently through AX.  The local PTY smoke separately proves that the
  // connected terminal has a live shell and accepts input.
  if (readinessMode === 'remote') {
    // Remote cold-start has an independent end-to-end marker: the first marker
    // is written by the remote startup command and the prompt marker is only
    // written after the command has travelled through xterm input, IPC, PTY,
    // and back through terminal output. WebKit may expose neither the status
    // label nor the hidden xterm input, so AX is advisory in this mode.
    return hasRemoteEvidence && markerReady
  }
  return readiness.localTab && readiness.connected && readiness.terminalInput
}

async function isMarkerReady(markerPath, markerContent, dependencies) {
  if (markerPath === undefined) return markerContent === undefined
  try {
    if (markerContent === undefined) {
      await dependencies.access(markerPath)
      return true
    }
    const actualContent = await dependencies.readFile(markerPath, 'utf8')
    return actualContent === markerContent
  } catch {
    return false
  }
}

async function areMarkersReady(markerChecks, dependencies) {
  for (const check of markerChecks ?? []) {
    if (!(await isMarkerReady(check.path, check.content, dependencies))) {
      return false
    }
  }
  return true
}

function runAccessibilityProbe(
  pid,
  dependencies,
  {
    mode = 'native',
    nativeProbePath,
  } = {},
  timeoutMs = AX_PROBE_TIMEOUT_MS,
) {
  return new Promise((resolve, reject) => {
    let child
    const command = mode === 'native' ? nativeProbePath : 'osascript'
    const args = mode === 'native' ? [String(pid)] : ['-e', ACCESSIBILITY_PROBE(pid)]
    if (typeof command !== 'string' || command.length === 0) {
      reject(new Error('native AX probe path is required'))
      return
    }
    try {
      child = dependencies.spawn(command, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(new Error(`AX probe could not start: ${error.message}`))
      return
    }
    let output = ''
    let errorOutput = ''
    let timeout
    const clearProbeTimeout = () => {
      if (timeout !== undefined) dependencies.clearTimeout(timeout)
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => (output += chunk))
    child.stderr?.on('data', chunk => (errorOutput += chunk))
    child.once('error', error => {
      clearProbeTimeout()
      reject(new Error(`AX probe failed: ${error.message}`))
    })
    child.once('close', code => {
      clearProbeTimeout()
      if (code !== 0) {
        reject(
          new Error(
            `AX probe exited with code ${String(code)}${errorOutput.trim() ? `: ${errorOutput.trim()}` : ''}`,
          ),
        )
        return
      }
      try {
        resolve(parseAccessibilityReadiness(output))
      } catch (error) {
        reject(error)
      }
    })
    timeout = dependencies.setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        // The probe may have exited between the timer and signal.
      }
      reject(new Error(`AX probe timed out after ${timeoutMs} ms`))
    }, timeoutMs)
  })
}

function compileNativeAccessibilityProbe(
  outputPath,
  dependencies,
  timeoutMs = NATIVE_AX_PROBE_COMPILE_TIMEOUT_MS,
) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = dependencies.spawn(
        'swiftc',
        [
          NATIVE_AX_PROBE_SOURCE,
          '-framework',
          'ApplicationServices',
          '-O',
          '-o',
          outputPath,
        ],
        {
          cwd: PROJECT_ROOT,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
    } catch (error) {
      reject(new Error(`native AX probe compiler could not start: ${error.message}`))
      return
    }
    let errorOutput = ''
    let timeout
    const clearCompileTimeout = () => {
      if (timeout !== undefined) dependencies.clearTimeout(timeout)
    }
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', chunk => (errorOutput += chunk))
    child.once('error', error => {
      clearCompileTimeout()
      reject(new Error(`native AX probe compiler failed: ${error.message}`))
    })
    child.once('close', (code, signal) => {
      clearCompileTimeout()
      if (code !== 0) {
        reject(
          new Error(
            `native AX probe compiler exited with code ${String(code)}${signal ? ` (${signal})` : ''}${errorOutput.trim() ? `: ${errorOutput.trim()}` : ''}`,
          ),
        )
        return
      }
      resolve()
    })
    timeout = dependencies.setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        // The compiler may have exited between the timer and signal.
      }
      reject(new Error(`native AX probe compiler timed out after ${timeoutMs} ms`))
    }, timeoutMs)
  })
}

function terminate(child) {
  try {
    child.kill('SIGTERM')
  } catch {
    // The child may have exited between readiness and cleanup.
  }
}

function wait(dependencies, delayMs) {
  return new Promise(resolve => dependencies.setTimeout(resolve, delayMs))
}

/**
 * A window that never exposes any readiness marker is almost always a UI that
 * rendered nothing, because a binary produced by `pnpm tauri build` embeds the
 * frontend while one produced by a bare `cargo build` loads build.devUrl from
 * the Vite dev server. The two binaries are otherwise indistinguishable, so
 * this explains the failure instead of guessing the build mode beforehand.
 */
function describeStalledReadiness(readiness) {
  if (!readiness) return ''
  if (Object.values(readiness).some(Boolean)) return ''
  return (
    '. The window exposed no terminal readiness at all, which means the UI ' +
    'never rendered. If this binary came from `cargo build` rather than ' +
    '`pnpm tauri build`, it loads build.devUrl and needs `pnpm dev:frontend` ' +
    'running; a `pnpm tauri build` binary embeds its frontend and needs nothing.'
  )
}

function waitForChildClose(closePromise, dependencies, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = dependencies.setTimeout(() => {
      reject(new Error(`application did not exit within ${timeoutMs} ms after SIGTERM`))
    }, timeoutMs)
    closePromise.then(
      () => {
        dependencies.clearTimeout(timer)
        resolve()
      },
      error => {
        dependencies.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function sha256(filePath, dependencies) {
  const contents = await dependencies.readFile(filePath)
  return createHash('sha256').update(contents).digest('hex')
}

export async function runColdStartStopwatch({
  appPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cleanupGraceMs = CLEANUP_GRACE_MS,
  axProbe = 'native',
  readinessMode = 'local',
  homeDirectory,
  markerPath,
  markerContent,
  markerChecks,
  environment = {},
  dependencies: overrides = {},
} = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  const macOs = dependencies.platform === 'darwin'
  const linux = dependencies.platform === 'linux'
  const effectiveAxProbe = macOs ? axProbe : 'none'
  if (!macOs && !linux) {
    throw new Error(
      'cold-start stopwatch is supported on macOS and Linux only',
    )
  }
  if (linux && readinessMode !== 'remote') {
    throw new Error(
      'Linux cold-start stopwatch requires remote readiness with marker evidence',
    )
  }
  const executable = ensureAbsoluteAppPath(appPath)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('cold-start stopwatch timeout must be a positive integer')
  }
  if (!Number.isSafeInteger(cleanupGraceMs) || cleanupGraceMs < 1) {
    throw new Error('cold-start stopwatch cleanup grace must be a positive integer')
  }
  if (axProbe !== 'native' && axProbe !== 'osascript' && axProbe !== 'none') {
    throw new Error(
      'cold-start stopwatch AX probe must be native or osascript; none is only valid for remote readiness',
    )
  }
  if (axProbe === 'none' && readinessMode !== 'remote') {
    throw new Error('AX probe none is only supported for remote readiness')
  }
  if (!READINESS_MODES.includes(readinessMode)) {
    throw new Error(
      `cold-start stopwatch readiness mode must be local or remote`,
    )
  }
  await dependencies.access(executable)
  const suppliedHome =
    homeDirectory === undefined
      ? undefined
      : ensureAbsolutePath(homeDirectory, 'cold-start stopwatch home directory')
  const requiredMarker =
    markerPath === undefined
      ? undefined
      : ensureAbsolutePath(markerPath, 'cold-start stopwatch marker path')
  if (markerContent !== undefined && markerPath === undefined) {
    throw new Error('cold-start stopwatch marker content requires marker path')
  }
  if (
    markerChecks !== undefined &&
    (!Array.isArray(markerChecks) ||
      markerChecks.some(
        check =>
          typeof check !== 'object' ||
          check === null ||
          typeof check.path !== 'string' ||
          typeof check.content !== 'string' ||
          check.content.length === 0,
      ))
  ) {
    throw new Error('cold-start stopwatch marker checks must be valid')
  }
  const requiredMarkerChecks = (markerChecks ?? []).map(check => ({
    path: ensureAbsolutePath(check.path, 'cold-start stopwatch marker check path'),
    content: check.content,
  }))
  const hasRemoteEvidence =
    requiredMarker !== undefined || requiredMarkerChecks.length > 0
  if (
    markerContent !== undefined &&
    (typeof markerContent !== 'string' || markerContent.length === 0)
  ) {
    throw new Error(
      'cold-start stopwatch marker content must be a non-empty string',
    )
  }
  const binarySha256 = await sha256(executable, dependencies)
  const home =
    suppliedHome ??
    (await dependencies.mkdtemp(
      path.join(dependencies.tempDirectory, 'terminal-cold-start-'),
    ))
  const ownsHome = suppliedHome === undefined
  const nativeProbePath = path.join(home, 'terminal-macos-ax-probe')
  let requestStartedAt = null
  let child
  let spawnStartedAt = null
  let lastReadiness = null
  let lastProbeError = null
  let lastMarkerReady = requiredMarker === undefined
  let settled = false
  let timeoutTimer
  let childClosed = false
  let terminationRequested = false
  let resolveChildClosed
  const childClosePromise = new Promise(resolve => {
    resolveChildClosed = resolve
  })
  const stopChild = () => {
    if (!child || terminationRequested || childClosed) return
    terminationRequested = true
    terminate(child)
  }

  const finishCleanup = async () => {
    if (timeoutTimer !== undefined) dependencies.clearTimeout(timeoutTimer)
    if (child && !childClosed) {
      stopChild()
      await waitForChildClose(childClosePromise, dependencies, cleanupGraceMs)
    }
    if (ownsHome) {
      await dependencies.rm(home, { recursive: true, force: true })
    }
  }

  try {
    if (macOs && axProbe === 'native') {
      await compileNativeAccessibilityProbe(nativeProbePath, dependencies)
      await dependencies.access(nativeProbePath)
    }
    requestStartedAt = dependencies.now()
    child = dependencies.spawn(executable, [], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...environment, HOME: home },
      shell: false,
      stdio: process.env.TERMINAL_DEBUG_SSH_PROFILE ? 'inherit' : 'ignore',
    })
    const result = await new Promise((resolve, reject) => {
      let closed = false
      let closeCode = null
      let closeSignal = null

      const fail = error => {
        if (settled) return
        settled = true
        stopChild()
        reject(error)
      }

      const poll = async () => {
        while (!settled && !closed) {
          if (spawnStartedAt === null) return
          try {
            if (macOs && axProbe !== 'none') {
              lastReadiness = await runAccessibilityProbe(child.pid, dependencies, {
                mode: axProbe,
                nativeProbePath,
              })
              lastProbeError = null
            } else {
              // Linux runners do not expose macOS Accessibility APIs, and a
              // remote marker run does not need AX at all. In both cases the
              // marker is the end-to-end signal: startup writes the first
              // marker, then the prompt command travels through the Tauri
              // WebView, SSH PTY and terminal output before the second marker
              // is written.
              lastReadiness = null
              lastProbeError = null
            }
            lastMarkerReady =
              (await isMarkerReady(
                requiredMarker,
                markerContent,
                dependencies,
              )) &&
              (await areMarkersReady(requiredMarkerChecks, dependencies))
            if (
              isReady(
                lastReadiness,
                readinessMode,
                lastMarkerReady,
                hasRemoteEvidence,
              )
            ) {
              settled = true
              resolve({
                ok: true,
                appPath: executable,
                binarySha256,
                capturedAt: new Date().toISOString(),
                pid: child.pid,
                measuredFrom: 'child-spawn-event',
                axProbe: effectiveAxProbe,
                readinessMode,
                markerPath: requiredMarker ?? null,
                markerReady: lastMarkerReady,
                markerChecks: requiredMarkerChecks.map(check => ({
                  path: check.path,
                  content: check.content,
                  ready: true,
                })),
                requestToReadyMs: dependencies.now() - requestStartedAt,
                spawnToReadyMs: dependencies.now() - spawnStartedAt,
                readiness: lastReadiness,
              })
              stopChild()
              return
            }
          } catch (error) {
            lastProbeError = error instanceof Error ? error.message : String(error)
          }
          await wait(dependencies, AX_POLL_INTERVAL_MS)
        }
      }

      child.once('spawn', () => {
        spawnStartedAt = dependencies.now()
        void poll()
      })
      child.once('error', error => fail(new Error(`application failed to start: ${error.message}`)))
      child.once('close', (code, signal) => {
        closed = true
        childClosed = true
        resolveChildClosed()
        closeCode = code
        closeSignal = signal
        if (!settled) {
          if (spawnStartedAt === null) {
            fail(new Error('application did not emit a spawn event'))
          } else {
            fail(
              new Error(
                `application exited with code ${String(closeCode)}${closeSignal ? ` (${closeSignal})` : ''} before AX readiness`,
              ),
            )
          }
        }
      })
      timeoutTimer = dependencies.setTimeout(() => {
        if (spawnStartedAt === null) {
          fail(new Error(`application did not emit a spawn event within ${timeoutMs} ms`))
        } else {
          const details =
            lastProbeError ??
            JSON.stringify({ readiness: lastReadiness, markerReady: lastMarkerReady })
          fail(
            new Error(
              `AX readiness did not complete within ${timeoutMs} ms${details ? ` (last probe: ${details})` : ''}` +
                describeStalledReadiness(lastReadiness),
            ),
          )
        }
      }, timeoutMs)
    })
    return result
  } finally {
    await finishCleanup()
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const argv = process.argv.slice(2)
  const option = name =>
    argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined
  const appPath = option('--app-path')
  const timeout = option('--timeout-ms')
  const axProbe = option('--ax-probe')
  runColdStartStopwatch({
    appPath,
    ...(axProbe === undefined ? {} : { axProbe }),
    ...(timeout === undefined ? {} : { timeoutMs: Number(timeout) }),
  })
    .then(result => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
