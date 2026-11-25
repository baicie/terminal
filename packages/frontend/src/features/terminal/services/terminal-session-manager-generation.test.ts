// F07 — a cancelled attempt must not come back and win.
//
// ## The scenario the state machine exists for
//
// A connection is in flight against a real backend (a slow SSH handshake is the ordinary
// case). The user gives up, disconnects, and connects again. The second attempt succeeds.
// Then the *first* attempt's backend finally answers — successfully.
//
// Everything that answer could do is wrong: publish its session id over the second
// attempt's, flip the pane back to `connecting`, resurrect a closed tab, or start an
// automatic ladder nobody asked for. The generation counter is what prevents this, and
// these cases pin each consequence separately rather than trusting one aggregate
// assertion to cover them.
//
// ## Why deferred promises instead of sleeps
//
// Every ordering below is decided by resolving a promise at a chosen moment. No test here
// guesses at timing; each one would be deterministic on a machine of any speed.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const eventHandlers = new Map<string, (event: { payload: unknown }) => void>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      eventHandlers.set(name, handler)
      return () => eventHandlers.delete(name)
    },
  ),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}))

vi.mock('./terminal-launcher', () => ({
  startTerminalShell: vi.fn(async () => 'session-1'),
}))

vi.mock('./terminal-session-transport', () => ({
  terminalSessionTransport: {
    write: vi.fn(async () => {}),
    writeRaw: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    ackOutput: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    cancelConnection: vi.fn(async () => {}),
  },
}))

vi.mock('./serial', () => ({
  serialService: { disconnect: vi.fn(async () => {}) },
}))

import { startTerminalShell } from './terminal-launcher'
import {
  TerminalSessionManager,
  type TerminalSessionSnapshot,
} from './terminal-session-manager'
import { terminalSessionTransport } from './terminal-session-transport'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const remoteRequest = {
  tabId: 'f07-remote',
  tabType: 'remote' as const,
  cols: 80,
  rows: 24,
}

/** Long enough to cover every microtask the manager schedules, without real waiting. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('F07 — cancellation and generation ownership', () => {
  beforeEach(() => {
    eventHandlers.clear()
    vi.mocked(startTerminalShell).mockReset()
    vi.mocked(startTerminalShell).mockResolvedValue('session-1')
    vi.mocked(terminalSessionTransport.write).mockReset()
    vi.mocked(terminalSessionTransport.write).mockResolvedValue(undefined)
    vi.mocked(terminalSessionTransport.close).mockReset()
    vi.mocked(terminalSessionTransport.close).mockResolvedValue(undefined)
    vi.mocked(terminalSessionTransport.cancelConnection).mockReset()
    vi.mocked(terminalSessionTransport.cancelConnection).mockResolvedValue(
      undefined,
    )
  })

  it('a late success from a cancelled attempt never replaces the session that replaced it', async () => {
    const firstAttempt = deferred<string>()
    vi.mocked(startTerminalShell)
      .mockReturnValueOnce(firstAttempt.promise)
      .mockResolvedValueOnce('session-b')

    const manager = new TerminalSessionManager()
    const states: TerminalSessionSnapshot[] = []
    const binding = manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledTimes(1))

    // The user gives up on the in-flight attempt and connects again.
    binding.disconnect()
    binding.reconnect()
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        sessionId: 'session-b',
        status: 'connected',
      }),
    )

    // The first attempt's backend finally reports success, after all of that.
    firstAttempt.resolve('session-a')
    await settle()

    expect(states.at(-1)).toMatchObject({
      sessionId: 'session-b',
      status: 'connected',
    })
    // The abandoned session is not left running on the backend.
    expect(terminalSessionTransport.close).toHaveBeenCalledWith('session-a')
    // And the pane's input still reaches the session that owns the tab.
    binding.write('still-mine\r')
    await vi.waitFor(() =>
      expect(terminalSessionTransport.write).toHaveBeenCalledWith(
        'session-b',
        'still-mine\r',
      ),
    )
    expect(terminalSessionTransport.write).not.toHaveBeenCalledWith(
      'session-a',
      expect.anything(),
    )
    await manager.close(remoteRequest.tabId)
  })

  it('a late success after the tab was closed does not resurrect it', async () => {
    const inFlight = deferred<string>()
    vi.mocked(startTerminalShell).mockReturnValue(inFlight.promise)

    const manager = new TerminalSessionManager()
    const states: TerminalSessionSnapshot[] = []
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledTimes(1))

    const closing = manager.close(remoteRequest.tabId)
    inFlight.resolve('session-late')
    await closing
    const published = states.length
    await settle()

    // Nothing new was published after close, and the late session was cleaned up.
    expect(states.length).toBe(published)
    expect(states.some(state => state.sessionId === 'session-late')).toBe(false)
    expect(terminalSessionTransport.close).toHaveBeenCalledWith('session-late')
  })

  it('a late failure from a cancelled attempt does not start an automatic ladder', async () => {
    const inFlight = deferred<string>()
    vi.mocked(startTerminalShell)
      .mockReturnValueOnce(inFlight.promise)
      .mockResolvedValueOnce('session-b')

    const manager = new TerminalSessionManager({
      sleep: async () => {},
      jitter: (delayMs: number) => delayMs,
    })
    const states: TerminalSessionSnapshot[] = []
    const binding = manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledTimes(1))

    binding.disconnect()
    binding.reconnect()
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ sessionId: 'session-b' }),
    )

    // The abandoned attempt fails after the replacement succeeded. A transient transport
    // failure is exactly what would normally open the automatic ladder (five attempts
    // with the full backoff), so this is the case where a stale failure does real damage.
    inFlight.reject({
      type: 'connection_failed',
      message: 'connection failed: timed out',
    })
    await settle()

    expect(states.at(-1)).toMatchObject({
      sessionId: 'session-b',
      status: 'connected',
    })
    // Two calls: the original attempt and the user's reconnect. A ladder would add more.
    expect(startTerminalShell).toHaveBeenCalledTimes(2)
    await manager.close(remoteRequest.tabId)
  })

  it('cancelling during the retry sleep stops the ladder without arming another attempt', async () => {
    /*
     * The ladder is asleep between attempts. Cancelling must end the loop *there* — not
     * after the sleep elapses and one more connection is opened. The sleep below is a
     * deferred so the test decides when (and whether) the backoff finishes.
     */
    const sleepStarted = deferred<void>()
    const sleepFinished = deferred<void>()
    let sleepCalls = 0
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValue({ type: 'connection_failed', message: 'timed out' })

    const manager = new TerminalSessionManager({
      sleep: async (_delayMs, signal) => {
        sleepCalls += 1
        if (sleepCalls === 1) return
        sleepStarted.resolve()
        // A real sleep rejects on abort; honour the signal here so this measures the
        // manager's loop rather than this stub's disregard for cancellation.
        await new Promise<void>((resolve, reject) => {
          sleepFinished.promise.then(resolve, reject)
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Reconnect cancelled', 'AbortError')),
          )
        })
      },
      jitter: (delayMs: number) => delayMs,
    })
    const states: TerminalSessionSnapshot[] = []
    const binding = manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await sleepStarted.promise
    const attemptsBeforeCancel = vi.mocked(startTerminalShell).mock.calls.length

    binding.disconnect()
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('disconnected'))
    await settle()

    expect(startTerminalShell).toHaveBeenCalledTimes(attemptsBeforeCancel)
    expect(states.at(-1)?.status).toBe('disconnected')
    // No recovery timer is left armed to reopen a ladder for a session the user ended.
    await manager.close(remoteRequest.tabId)
  })
})
