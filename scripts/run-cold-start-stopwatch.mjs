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
export const READINESS_TARGETS = ['window', 'terminal']
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

export function parseColdStartArguments(argv) {
  const option = name =>
    argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined
  const markerChecks = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--marker-check') continue
    const markerPath = argv[index + 1]
    const content = argv[index + 2]
    if (markerPath === undefined || content === undefined) {
      throw new Error('--marker-check requires a path and expected content')
    }
    markerChecks.push({ path: markerPath, content })
    index += 2
  }
  const axProbe = option('--ax-probe')
  const readinessMode = option('--readiness-mode')
  const readinessTarget = option('--readiness-target')
  const markerPath = option('--marker-path')
  const markerContent = option('--marker-content')
  const timeout = option('--timeout-ms')
  return {
    appPath: option('--app-path'),
    ...(axProbe === undefined ? {} : { axProbe }),
    ...(readinessMode === undefined ? {} : { readinessMode }),
    ...(readinessTarget === undefined ? {} : { readinessTarget }),
    ...(markerPath === undefined ? {} : { markerPath }),
    ...(markerContent === undefined ? {} : { markerContent }),
    ...(markerChecks.length === 0 ? {} : { markerChecks }),
    ...(timeout === undefined ? {} : { timeoutMs: Number(timeout) }),
  }
}

export function evaluateReadiness({
  readiness,
  markerReady,
  hasTerminalEvidence,
}) {
  // AX can prove that the application window and its terminal controls are
  // rendered. It cannot prove that a shell is alive: xterm paints the prompt
  // on a canvas and WebKit does not expose that canvas consistently.
  const windowReady = Boolean(
    readiness?.localTab && readiness?.connected && readiness?.terminalInput,
  )
  // A marker is only terminal evidence when the caller supplied it explicitly.
  // The default marker state is true when no marker was requested and must not
  // turn a window observation into a shell-ready claim.
  const terminalReady = Boolean(hasTerminalEvidence && markerReady)
  return { windowReady, terminalReady }
}

function isReady(
  readiness,
  readinessMode,
  readinessTarget,
  markerReady,
  hasTerminalEvidence,
) {
  const state = evaluateReadiness({
    readiness,
    markerReady,
    hasTerminalEvidence,
  })
  // Remote cold-start always uses an independent end-to-end marker. In local
  // strict mode the same marker contract is opt-in via readinessTarget.
  if (readinessMode === 'remote' || readinessTarget === 'terminal') {
    return state.terminalReady
  }
  return state.windowReady
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

async function terminateAndReap(child, closePromise, dependencies, graceMs) {
  terminate(child, 'SIGTERM')
  try {
    await waitForChildClose(closePromise, dependencies, graceMs)
    return
  } catch {
    terminate(child, 'SIGKILL')
    await waitForChildClose(closePromise, dependencies, graceMs).catch(() => {})
  }
}

function runAccessibilityProbe(
  pid,
  dependencies,
  { mode = 'native', nativeProbePath } = {},
  timeoutMs = AX_PROBE_TIMEOUT_MS,
) {
  return new Promise((resolve, reject) => {
    let child
    const command = mode === 'native' ? nativeProbePath : 'osascript'
    const args =
      mode === 'native' ? [String(pid)] : ['-e', ACCESSIBILITY_PROBE(pid)]
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
    let timedOut = false
    let resolveClosed
    const closePromise = new Promise(resolveClose => {
      resolveClosed = resolveClose
    })
    const clearProbeTimeout = () => {
      if (timeout !== undefined) dependencies.clearTimeout(timeout)
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => (output += chunk))
    child.stderr?.on('data', chunk => (errorOutput += chunk))
    child.once('error', error => {
      clearProbeTimeout()
      if (timedOut) return
      reject(new Error(`AX probe failed: ${error.message}`))
    })
    child.once('close', code => {
      clearProbeTimeout()
      resolveClosed()
      if (timedOut) return
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
      timedOut = true
      void (async () => {
        await terminateAndReap(
          child,
          closePromise,
          dependencies,
          dependencies.probeCleanupGraceMs ?? CLEANUP_GRACE_MS,
        )
        reject(new Error(`AX probe timed out after ${timeoutMs} ms`))
      })()
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
      reject(
        new Error(`native AX probe compiler could not start: ${error.message}`),
      )
      return
    }
    let errorOutput = ''
    let timeout
    let timedOut = false
    let resolveClosed
    const closePromise = new Promise(resolveClose => {
      resolveClosed = resolveClose
    })
    const clearCompileTimeout = () => {
      if (timeout !== undefined) dependencies.clearTimeout(timeout)
    }
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', chunk => (errorOutput += chunk))
    child.once('error', error => {
      clearCompileTimeout()
      if (timedOut) return
      reject(new Error(`native AX probe compiler failed: ${error.message}`))
    })
    child.once('close', (code, signal) => {
      clearCompileTimeout()
      resolveClosed()
      if (timedOut) return
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
      timedOut = true
      void (async () => {
        await terminateAndReap(
          child,
          closePromise,
          dependencies,
          dependencies.probeCleanupGraceMs ?? CLEANUP_GRACE_MS,
        )
        reject(
          new Error(`native AX probe compiler timed out after ${timeoutMs} ms`),
        )
      })()
    }, timeoutMs)
  })
}

function terminate(child, signal = 'SIGTERM') {
  try {
    child.kill(signal)
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
function describeStalledReadiness(readiness, readinessTarget) {
  if (!readiness) return ''
  if (readinessTarget === 'terminal') return ''
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
      reject(
        new Error(
          `application did not exit within ${timeoutMs} ms after SIGTERM`,
        ),
      )
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
  readinessTarget,
  homeDirectory,
  markerPath,
  markerContent,
  markerChecks,
  environment = {},
  unsetEnvironmentKeys = [],
  dependencies: overrides = {},
} = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  const macOs = dependencies.platform === 'darwin'
  const linux = dependencies.platform === 'linux'
  const effectiveAxProbe = macOs ? axProbe : 'none'
  if (!macOs && !linux) {
    throw new Error('cold-start stopwatch is supported on macOS and Linux only')
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
    throw new Error(
      'cold-start stopwatch cleanup grace must be a positive integer',
    )
  }
  if (axProbe !== 'native' && axProbe !== 'osascript' && axProbe !== 'none') {
    throw new Error(
      'cold-start stopwatch AX probe must be native or osascript; none is only valid for remote or strict terminal readiness',
    )
  }
  if (
    axProbe === 'none' &&
    readinessMode !== 'remote' &&
    readinessTarget !== 'terminal'
  ) {
    throw new Error(
      'AX probe none requires remote or strict terminal readiness',
    )
  }
  if (!READINESS_MODES.includes(readinessMode)) {
    throw new Error(
      `cold-start stopwatch readiness mode must be local or remote`,
    )
  }
  const effectiveReadinessTarget =
    readinessTarget ?? (readinessMode === 'remote' ? 'terminal' : 'window')
  if (!READINESS_TARGETS.includes(effectiveReadinessTarget)) {
    throw new Error(
      'cold-start stopwatch readiness target must be window or terminal',
    )
  }
  if (readinessMode === 'remote' && effectiveReadinessTarget !== 'terminal') {
    throw new Error('remote cold-start stopwatch requires terminal readiness')
  }
  const shouldProbeAx =
    macOs &&
    effectiveAxProbe !== 'none' &&
    !(readinessMode === 'local' && effectiveReadinessTarget === 'terminal')
  const reportedAxProbe = shouldProbeAx ? effectiveAxProbe : 'none'
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
    path: ensureAbsolutePath(
      check.path,
      'cold-start stopwatch marker check path',
    ),
    content: check.content,
  }))
  const hasTerminalEvidence =
    requiredMarker !== undefined || requiredMarkerChecks.length > 0
  if (
    readinessMode === 'local' &&
    effectiveReadinessTarget === 'terminal' &&
    !hasTerminalEvidence
  ) {
    throw new Error(
      'local terminal readiness requires marker or marker-check evidence',
    )
  }
  if (
    markerContent !== undefined &&
    (typeof markerContent !== 'string' || markerContent.length === 0)
  ) {
    throw new Error(
      'cold-start stopwatch marker content must be a non-empty string',
    )
  }
  if (
    effectiveReadinessTarget === 'terminal' &&
    ((requiredMarker !== undefined &&
      (await isMarkerReady(requiredMarker, markerContent, dependencies))) ||
      (
        await Promise.all(
          requiredMarkerChecks.map(check =>
            isMarkerReady(check.path, check.content, dependencies),
          ),
        )
      ).some(Boolean))
  ) {
    throw new Error(
      'cold-start stopwatch terminal marker already exists with expected content; remove the stale marker before starting',
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
  let lastWindowReady = false
  let lastTerminalReady = false
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
      try {
        await waitForChildClose(childClosePromise, dependencies, cleanupGraceMs)
      } catch (error) {
        // A Tauri process can ignore or outlive SIGTERM while WebKit is still
        // tearing down. Escalate once so a failed probe cannot leak a desktop
        // process into the next run, but preserve the original cleanup error
        // when the child still refuses to report close.
        if (!childClosed) terminate(child, 'SIGKILL')
        try {
          await waitForChildClose(
            childClosePromise,
            dependencies,
            cleanupGraceMs,
          )
        } catch {
          // The caller still receives the first, more useful timeout error.
        }
        throw error
      }
    }
    if (ownsHome) {
      await dependencies.rm(home, { recursive: true, force: true })
    }
  }

  try {
    if (shouldProbeAx && axProbe === 'native') {
      await compileNativeAccessibilityProbe(
        nativeProbePath,
        dependencies,
        dependencies.nativeAxProbeCompileTimeoutMs ??
          NATIVE_AX_PROBE_COMPILE_TIMEOUT_MS,
      )
      await dependencies.access(nativeProbePath)
    }
    requestStartedAt = dependencies.now()
    child = dependencies.spawn(executable, [], {
      cwd: PROJECT_ROOT,
      env: (() => {
        const childEnvironment = { ...process.env, ...environment, HOME: home }
        for (const key of unsetEnvironmentKeys) delete childEnvironment[key]
        return childEnvironment
      })(),
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

      const failReadinessTimeout = () => {
        if (spawnStartedAt === null) {
          fail(
            new Error(
              `application did not emit a spawn event within ${timeoutMs} ms`,
            ),
          )
          return
        }
        const details =
          lastProbeError ??
          JSON.stringify({
            readiness: lastReadiness,
            readinessTarget: effectiveReadinessTarget,
            windowReady: lastWindowReady,
            terminalReady: lastTerminalReady,
            markerReady: lastMarkerReady,
          })
        const readinessLabel =
          effectiveReadinessTarget === 'terminal' ? 'terminal' : 'window'
        fail(
          new Error(
            `${readinessLabel} readiness did not complete within ${timeoutMs} ms${details ? ` (last probe: ${details})` : ''}` +
              describeStalledReadiness(
                lastReadiness,
                effectiveReadinessTarget,
              ),
          ),
        )
      }

      const poll = async () => {
        while (!settled && !closed) {
          if (spawnStartedAt === null) return
          try {
            if (shouldProbeAx) {
              lastReadiness = await runAccessibilityProbe(
                child.pid,
                dependencies,
                {
                  mode: axProbe,
                  nativeProbePath,
                },
                dependencies.axProbeTimeoutMs ?? AX_PROBE_TIMEOUT_MS,
              )
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
          } catch (error) {
            // Window readiness may use AX, but strict terminal readiness is
            // established by an end-to-end marker. Keep probe failures for
            // timeout reporting and continue polling the marker.
            lastProbeError =
              error instanceof Error ? error.message : String(error)
          }
          try {
            lastMarkerReady =
              (await isMarkerReady(
                requiredMarker,
                markerContent,
                dependencies,
              )) && (await areMarkersReady(requiredMarkerChecks, dependencies))
          } catch (error) {
            lastMarkerReady = false
            lastProbeError =
              error instanceof Error ? error.message : String(error)
          }
          if (settled) return
          const readyNow = dependencies.now()
          if (readyNow - spawnStartedAt >= timeoutMs) {
            failReadinessTimeout()
            return
          }
          const readinessState = evaluateReadiness({
            readiness: lastReadiness,
            markerReady: lastMarkerReady,
            hasTerminalEvidence,
          })
          lastWindowReady = readinessState.windowReady
          lastTerminalReady = readinessState.terminalReady
          if (
            isReady(
              lastReadiness,
              readinessMode,
              effectiveReadinessTarget,
              lastMarkerReady,
              hasTerminalEvidence,
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
              axProbe: reportedAxProbe,
              readinessMode,
              readinessTarget: effectiveReadinessTarget,
              readyAt:
                readinessMode === 'remote' ||
                effectiveReadinessTarget === 'terminal'
                  ? 'terminal'
                  : 'window',
              markerPath: requiredMarker ?? null,
              markerReady: lastMarkerReady,
              markerChecks: requiredMarkerChecks.map(check => ({
                path: check.path,
                content: check.content,
                ready: true,
              })),
              requestToReadyMs: readyNow - requestStartedAt,
              spawnToReadyMs: readyNow - spawnStartedAt,
              windowReady: lastWindowReady,
              terminalReady: lastTerminalReady,
              readiness: lastReadiness,
            })
            stopChild()
            return
          }
          await wait(dependencies, AX_POLL_INTERVAL_MS)
        }
      }

      child.once('spawn', () => {
        spawnStartedAt = dependencies.now()
        void poll()
      })
      child.once('error', error =>
        fail(new Error(`application failed to start: ${error.message}`)),
      )
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
                `application exited with code ${String(closeCode)}${closeSignal ? ` (${closeSignal})` : ''} before ${effectiveReadinessTarget} readiness`,
              ),
            )
          }
        }
      })
      timeoutTimer = dependencies.setTimeout(() => {
        failReadinessTimeout()
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
  let options
  try {
    options = parseColdStartArguments(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    options = null
  }
  if (options)
    runColdStartStopwatch(options)
      .then(result => {
        console.log(JSON.stringify(result, null, 2))
      })
      .catch(error => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
      })
}
