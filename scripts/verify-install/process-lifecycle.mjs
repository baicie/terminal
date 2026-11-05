/**
 * Asynchronous child-process lifecycle for the upgrade harness.
 *
 * The old stop() polled with Atomics.wait(), which blocks Node's event loop and
 * can delay the very exit events it is waiting for. This module waits on real
 * `exit` and `close` events, never treats kill()'s return value as proof of
 * exit, and records whether stdout/stderr were closed before the log was
 * written.
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Promise.race() leaves the losing timer armed, which keeps Node's event loop
// alive for up to waitMs after the harness has already finished. Clear it as
// soon as either side settles.
export function raceAfter(promise, ms) {
  let timer
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function launchProcess(command, args = [], options = {}) {
  const output = []
  const state = {
    spawned: false,
    spawnError: null,
    exitObserved: false,
    closeObserved: false,
    exitCode: null,
    signal: null,
    stdoutClosed: false,
    stderrClosed: false,
    exitPromise: null,
    closePromise: null,
    stopPromise: null,
    logWritten: false,
    logError: null,
    logPath: options.logPath || null,
  }
  let resolveExit
  let resolveClose
  state.exitPromise = new Promise(resolve => { resolveExit = resolve })
  state.closePromise = new Promise(resolve => { resolveClose = resolve })

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  })
  child.lifecycle = state
  child.once('spawn', () => { state.spawned = true })
  child.once('error', error => {
    state.spawnError = error
    // A spawn error may be followed by close without a real exit. Keep
    // exitObserved false so callers do not treat it as a graceful process exit.
    resolveExit()
  })
  if (child.stdout) {
    child.stdout.on('data', chunk => output.push(String(chunk)))
    child.stdout.once('close', () => { state.stdoutClosed = true })
  } else {
    state.stdoutClosed = true
  }
  if (child.stderr) {
    child.stderr.on('data', chunk => output.push(String(chunk)))
    child.stderr.once('close', () => { state.stderrClosed = true })
  } else {
    state.stderrClosed = true
  }
  child.once('exit', (code, signal) => {
    state.exitObserved = true
    state.exitCode = code
    state.signal = signal
    resolveExit()
  })
  child.once('close', (code, signal) => {
    state.closeObserved = true
    state.exitCode = code
    state.signal = signal
    if (!state.spawnError && !state.exitObserved) {
      state.exitObserved = true
      resolveExit()
    }
    if (state.logPath && !state.logWritten) {
      state.logWritten = true
      // close fires after stdout/stderr are closed, so the log is complete.
      try {
        writeFileSync(
          state.logPath,
          output.join('') + `\n[exit code=${code} signal=${signal}]\n`,
        )
      } catch (error) {
        state.logError = String(error?.message || error)
      } finally {
        resolveClose()
      }
    } else {
      resolveClose()
    }
  })
  return child
}

export async function stopProcess(child, {
  waitMs = 30_000,
  killWaitMs = 5_000,
  closeWaitMs = 2_000,
  onBeforeSignal = null,
} = {}) {
  const state = child?.lifecycle
  const started = Date.now()
  if (!state) {
    return {
      outcome: 'spawn-error', pid: child?.pid ?? null, exitCode: null, signal: null,
      exitObserved: false, closeObserved: false, elapsedMs: 0, escalationUsed: false,
      error: 'process has no lifecycle state',
    }
  }
  if (state.stopPromise) return state.stopPromise
  state.stopPromise = (async () => {
    const result = {
      outcome: 'graceful',
      pid: child.pid ?? null,
      exitCode: state.exitCode,
      signal: state.signal,
      exitObserved: state.exitObserved,
      closeObserved: state.closeObserved,
      stdoutClosed: state.stdoutClosed,
      stderrClosed: state.stderrClosed,
      elapsedMs: 0,
      escalationUsed: false,
      ownedChildren: null,
    }
    const termination = (forced = false) => {
      if (state.spawnError) return 'spawn-error'
      if (forced) return 'forced-sigkill'
      if (state.signal === 'SIGTERM') return 'terminated-by-sigterm'
      if (state.signal !== null && state.signal !== undefined) return 'terminated-by-' + state.signal
      return state.exitObserved ? 'clean-exit' : 'timeout'
    }
    result.termination = termination(false)
    if (state.spawnError) {
      result.outcome = 'spawn-error'
      result.termination = 'spawn-error'
      result.error = String(state.spawnError.message || state.spawnError)
      result.elapsedMs = Date.now() - started
      return result
    }
    if (state.exitObserved) {
      result.outcome = 'already-exited'
      result.exitObserved = true
      result.exitCode = state.exitCode
      result.signal = state.signal
      await raceAfter(state.closePromise, closeWaitMs)
      result.closeObserved = state.closeObserved
      result.stdoutClosed = state.stdoutClosed
      result.stderrClosed = state.stderrClosed
      result.termination = termination(false)
      result.logError = state.logError
      result.elapsedMs = Date.now() - started
      return result
    }

    // Snapshot descendants before the signal: once the parent exits, its
    // children are reparented and can no longer be attributed to it.
    if (typeof onBeforeSignal === 'function') {
      try {
        result.ownedChildren = onBeforeSignal(child.pid)
      } catch (error) {
        result.ownedChildren = {
          supported: false,
          pids: [],
          error: String(error?.message || error),
        }
      }
    }
    const sent = child.kill('SIGTERM')
    if (!sent && !state.exitObserved) {
      result.outcome = 'spawn-error'
      result.error = 'SIGTERM could not be delivered'
      result.elapsedMs = Date.now() - started
      return result
    }
    await raceAfter(state.exitPromise, waitMs)
    if (!state.exitObserved) {
      result.escalationUsed = true
      child.kill('SIGKILL')
      await raceAfter(state.exitPromise, killWaitMs)
      result.outcome = state.exitObserved ? 'forced' : 'timeout'
      result.termination = termination(state.exitObserved)
    } else {
      result.outcome = 'graceful'
      result.termination = termination(false)
    }
    await raceAfter(state.closePromise, closeWaitMs)
    result.exitObserved = state.exitObserved
    result.closeObserved = state.closeObserved
    result.stdoutClosed = state.stdoutClosed
    result.stderrClosed = state.stderrClosed
    result.exitCode = state.exitCode
    result.signal = state.signal
    result.logError = state.logError
    result.elapsedMs = Date.now() - started
    if (!state.exitObserved) {
      result.error = 'process did not exit after SIGKILL within ' + killWaitMs + ' ms'
    }
    return result
  })()
  return state.stopPromise
}

export function requireStopped(result, { allowForced = false, allowSignals = ['SIGTERM'] } = {}) {
  const problems = []
  if (!result || typeof result !== 'object') problems.push('no stop result')
  else {
    if (result.outcome === 'spawn-error' || result.termination === 'spawn-error') {
      problems.push('spawn-error')
    }
    if (result.outcome === 'timeout' || result.termination === 'timeout') problems.push('timeout')
    if (result.exitObserved !== true) problems.push('exitObserved=false')
    if (result.closeObserved !== true) problems.push('closeObserved=false')
    if (result.stdoutClosed === false) problems.push('stdoutClosed=false')
    if (result.stderrClosed === false) problems.push('stderrClosed=false')
    if (result.logError) problems.push('logError=' + result.logError)
    if (!allowForced && result.outcome === 'forced') problems.push('forced-sigkill')
    if (!allowForced && result.termination === 'forced-sigkill') problems.push('forced-sigkill')
    if (typeof result.termination === 'string' && result.termination.startsWith('terminated-by-')) {
      const signal = result.termination.slice('terminated-by-'.length).toLowerCase()
      if (!allowSignals.some(allowed => allowed.toLowerCase() === signal)) {
        problems.push('unexpected termination signal ' + signal)
      }
    }
  }
  if (problems.length > 0) {
    throw new Error('process did not stop cleanly: ' + problems.join(', '))
  }
  return result
}

export function describeStop(result) {
  return [
    result.outcome,
    'termination=' + (result.termination ?? 'unknown'),
    'pid=' + (result.pid ?? 'null'),
    'exit=' + (result.exitCode ?? 'null'),
    'signal=' + (result.signal ?? 'null'),
    'exitObserved=' + result.exitObserved,
    'closeObserved=' + result.closeObserved,
    'stdoutClosed=' + result.stdoutClosed,
    'stderrClosed=' + result.stderrClosed,
    'escalation=' + result.escalationUsed,
    'children=' + (result.ownedChildren?.pids ? result.ownedChildren.pids.length : 'unobserved'),
    'elapsedMs=' + result.elapsedMs,
  ].join(' ')
}
