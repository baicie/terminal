import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const eventHandlers = new Map<string, (event: { payload: unknown }) => void>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      eventHandlers.set(name, handler)
      return () => eventHandlers.delete(name)
    },
  ),
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
  serialService: {
    disconnect: vi.fn(async () => {}),
  },
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
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const remoteRequest = {
  tabId: 'remote-1',
  tabType: 'remote' as const,
  cols: 80,
  rows: 24,
}

describe('TerminalSessionManager reconnect state machine', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    eventHandlers.clear()
    vi.mocked(startTerminalShell).mockReset()
    vi.mocked(startTerminalShell).mockResolvedValue('session-1')
    vi.mocked(terminalSessionTransport.write).mockReset()
    vi.mocked(terminalSessionTransport.write).mockResolvedValue(undefined)
    vi.mocked(terminalSessionTransport.resize).mockReset()
    vi.mocked(terminalSessionTransport.resize).mockResolvedValue(undefined)
    vi.mocked(terminalSessionTransport.close).mockReset()
    vi.mocked(terminalSessionTransport.close).mockResolvedValue(undefined)
    vi.mocked(terminalSessionTransport.cancelConnection).mockReset()
    vi.mocked(terminalSessionTransport.cancelConnection).mockResolvedValue(
      undefined,
    )
  })

  it('reconnects an unexpectedly closed SSH session on the same audience', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2')
    const delays: number[] = []
    const manager = new TerminalSessionManager({
      baseDelayMs: 100,
      sleep: async delayMs => {
        delays.push(delayMs)
      },
      jitter: delayMs => delayMs,
    })
    const states: TerminalSessionSnapshot[] = []
    const output: string[] = []

    manager.attach(remoteRequest, {
      onOutput: data => output.push(data),
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-1'))

    eventHandlers.get('ssh-data')?.({
      payload: { session_id: 'session-1', data: 'before\r\n' },
    })
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-2'))
    eventHandlers.get('ssh-data')?.({
      payload: { session_id: 'session-2', data: 'after\r\n' },
    })

    expect(delays).toEqual([100])
    expect(states).toContainEqual(
      expect.objectContaining({
        status: 'reconnecting',
        attempt: 1,
        reason: expect.stringContaining('closed'),
      }),
    )
    expect(output).toEqual([
      'before\r\n',
      '\r\n[disconnected]\r\n',
      'after\r\n',
    ])
  })

  it('uses injectable jitter over exponential retry delays', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce('session-3')
    const delays: number[] = []
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      maxAttempts: 3,
      sleep: async delayMs => {
        delays.push(delayMs)
      },
      jitter: delayMs => delayMs + 7,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-1'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })

    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-3'))
    expect(delays).toEqual([107, 207])
    expect(
      states
        .filter(state => state.status === 'reconnecting')
        .map(state => state.attempt),
    ).toEqual([1, 2])
  })

  it('cancels a delayed automatic retry when its generation is retired', async () => {
    const wait = deferred<void>()
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      sleep: () => wait.promise,
      jitter: delayMs => delayMs,
    })
    const binding = manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('reconnecting'))
    binding.disconnect()
    wait.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(startTerminalShell).toHaveBeenCalledTimes(1)
    expect(states.at(-1)?.status).toBe('disconnected')
  })

  it('does not schedule automatic reconnect after a manual disconnect', async () => {
    const sleep = vi.fn(async () => {})
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({ sleep })
    const binding = manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    binding.disconnect()
    await vi.waitFor(() =>
      expect(terminalSessionTransport.close).toHaveBeenCalledWith('session-1'),
    )
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(sleep).not.toHaveBeenCalled()
    expect(startTerminalShell).toHaveBeenCalledTimes(1)
    expect(states.at(-1)?.status).toBe('disconnected')
  })

  it('drops stale queued input but preserves the first input after manual reconnect', async () => {
    const oldWrite = deferred<void>()
    const replacement = deferred<string>()
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockReturnValueOnce(replacement.promise)
    vi.mocked(terminalSessionTransport.write).mockImplementation(
      async (sessionId, data) => {
        if (sessionId === 'session-1' && data === 'old-in-flight') {
          await oldWrite.promise
        }
      },
    )
    const manager = new TerminalSessionManager()
    const binding = manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: () => {},
    })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledOnce())

    binding.write('old-in-flight')
    binding.write('old-queued')
    await vi.waitFor(() =>
      expect(terminalSessionTransport.write).toHaveBeenCalledWith(
        'session-1',
        'old-in-flight',
      ),
    )

    binding.reconnect()
    binding.write('fresh-first')
    oldWrite.resolve()
    replacement.resolve('session-2')

    await vi.waitFor(() =>
      expect(terminalSessionTransport.write).toHaveBeenCalledWith(
        'session-2',
        'fresh-first',
      ),
    )
    expect(terminalSessionTransport.write).not.toHaveBeenCalledWith(
      'session-2',
      'old-queued',
    )
  })

  it('ends in a retryable error after automatic reconnect attempts are exhausted', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValue(new Error('network unavailable'))
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 2,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(startTerminalShell).toHaveBeenCalledTimes(3)
    expect(states.at(-1)).toMatchObject({
      sessionId: null,
      status: 'error',
      error: expect.stringContaining('network unavailable'),
      retryable: true,
    })
  })

  it('retries a first connection that fails with a retryable error', async () => {
    vi.mocked(startTerminalShell)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValue('session-2')
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 2,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })

    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-2'))
    expect(states.at(-1)?.status).toBe('connected')
    expect(startTerminalShell).toHaveBeenCalledTimes(2)
    await manager.close(remoteRequest.tabId)
  })

  it('ends a first connection that keeps failing in a retryable error with a recovery timer', async () => {
    vi.useFakeTimers()
    vi.mocked(startTerminalShell).mockRejectedValue(
      new Error('network unavailable'),
    )
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 2,
      recoveryDelayMs: 10_000,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })

    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        status: 'error',
        retryable: true,
      }),
    )
    expect(vi.getTimerCount()).toBe(1)
    await manager.close(remoteRequest.tabId)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry a first connection that fails with a non-retryable error', async () => {
    vi.useFakeTimers()
    vi.mocked(startTerminalShell).mockRejectedValue({
      kind: 'authentication_failed',
      message: 'all methods rejected',
    })
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(states.at(-1)).toMatchObject({
      error: 'all methods rejected',
      retryable: false,
    })
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(startTerminalShell).toHaveBeenCalledTimes(1)
    await manager.close(remoteRequest.tabId)
  })

  it.each([
    [
      'authentication timeout',
      'authenticate SSH user timed out before its deadline',
    ],
    ['authentication transport reset', 'auth failed: connection reset by peer'],
  ])(
    'retries %s caused by a transient network failure',
    async (_label, message) => {
      vi.mocked(startTerminalShell)
        .mockRejectedValueOnce({
          type: 'authentication_failed',
          message,
        })
        .mockResolvedValueOnce('session-2')
      const states: TerminalSessionSnapshot[] = []
      const manager = new TerminalSessionManager({
        maxAttempts: 2,
        sleep: async () => {},
        jitter: delayMs => delayMs,
      })
      manager.attach(remoteRequest, {
        onOutput: () => {},
        onState: state => states.push(state),
      })

      await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-2'))

      expect(states.at(-1)?.status).toBe('connected')
      expect(startTerminalShell).toHaveBeenCalledTimes(2)
      expect(states).toContainEqual(
        expect.objectContaining({
          status: 'reconnecting',
          reason: message,
        }),
      )
      await manager.close(remoteRequest.tabId)
    },
  )

  it('retries an exhausted network failure without a browser wake event', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce('session-2')
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 1,
      recoveryDelayMs: 10,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() =>
      expect(
        states.some(
          state => state.status === 'error' && state.retryable === true,
        ),
      ).toBe(true),
    )
    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-2'))
    expect(states.at(-1)?.status).toBe('connected')
    expect(startTerminalShell).toHaveBeenCalledTimes(3)
  })

  it('lets a manual retry recover immediately after the automatic budget is exhausted', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce('session-2')
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 1,
      recoveryDelayMs: 60_000,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    const binding = manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: 'error', retryable: true }),
    )

    binding.reconnect()
    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-2'))
    expect(states.at(-1)?.status).toBe('connected')
    expect(startTerminalShell).toHaveBeenCalledTimes(3)
    await manager.close(remoteRequest.tabId)
  })

  it('schedules one recovery timer and cancels it for a manual retry', async () => {
    vi.useFakeTimers()
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce('session-2')
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 1,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    const binding = manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: 'error', retryable: true }),
    )
    expect(vi.getTimerCount()).toBe(1)

    binding.reconnect()
    expect(vi.getTimerCount()).toBe(0)
    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-2'))
    await manager.close(remoteRequest.tabId)
  })

  it.each(['host wake', 'disconnect', 'tab close'] as const)(
    'cancels the recovery timer when the user or host requests %s',
    async action => {
      vi.useFakeTimers()
      vi.mocked(startTerminalShell)
        .mockResolvedValueOnce('session-1')
        .mockRejectedValueOnce(new Error('network unavailable'))
        .mockResolvedValueOnce('session-2')
      const states: TerminalSessionSnapshot[] = []
      const manager = new TerminalSessionManager({
        maxAttempts: 1,
        sleep: async () => {},
        jitter: delayMs => delayMs,
      })
      const binding = manager.attach(remoteRequest, {
        onOutput: () => {},
        onState: state => states.push(state),
      })
      await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

      eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
      await vi.waitFor(() =>
        expect(states.at(-1)).toMatchObject({
          status: 'error',
          retryable: true,
        }),
      )
      expect(vi.getTimerCount()).toBe(1)

      if (action === 'host wake') manager.handleHostWake()
      else if (action === 'disconnect') await binding.disconnect()
      else await manager.close(remoteRequest.tabId)

      expect(vi.getTimerCount()).toBe(0)
      if (action === 'host wake') {
        await vi.waitFor(() =>
          expect(states.at(-1)?.sessionId).toBe('session-2'),
        )
        await manager.close(remoteRequest.tabId)
      }
    },
  )

  it('stops automatic reconnect when authentication is rejected', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValueOnce({
        type: 'authentication_failed',
        message: 'credentials rejected',
      })
    const sleep = vi.fn(async () => {})
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 1,
      sleep,
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(startTerminalShell).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
    expect(states.at(-1)).toMatchObject({
      error: 'credentials rejected',
      retryable: false,
    })
  })

  it('does not reconnect a frontend output flow-control failure', async () => {
    const sleep = vi.fn(() => new Promise<void>(() => {}))
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({ sleep })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('terminal-error')?.({
      payload: {
        session_id: 'session-1',
        message: 'frontend output ACK timed out after 10000 ms',
      },
    })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(sleep).not.toHaveBeenCalled()
    expect(startTerminalShell).toHaveBeenCalledOnce()
    expect(states.at(-1)).toMatchObject({ retryable: false })
  })

  it('drops input typed during automatic reconnect backoff', async () => {
    // Deliberate, and the manual reconnect path deliberately differs. Input
    // typed here was aimed at whatever prompt the *previous* session was
    // showing — a sudo password, a destructive command, half a line. Replaying
    // it into a brand new shell could execute something the user never meant to
    // run against a different machine state. Dropping it is the safe choice.
    //
    // A manual reconnect is different: the user is deliberately retrying the
    // same thing and expects their keystrokes to land, so that path buffers
    // (TerminalSessionIo.prepareForReconnect -> 'connecting'). This test exists
    // to keep the automatic path from drifting into the manual behaviour.
    const wait = deferred<void>()
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2')
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      sleep: () => wait.promise,
      jitter: delayMs => delayMs,
    })
    const binding = manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('reconnecting'))
    binding.write('must-not-run-after-reconnect\r')
    wait.resolve()
    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-2'))

    expect(terminalSessionTransport.write).not.toHaveBeenCalledWith(
      'session-2',
      'must-not-run-after-reconnect\r',
    )
  })

  it('publishes a final error when every replacement closes before attach', async () => {
    const second = deferred<string>()
    const third = deferred<string>()
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 2,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledTimes(2))
    eventHandlers.get('ssh-close')?.({ payload: 'session-2' })
    second.resolve('session-2')
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledTimes(3))
    eventHandlers.get('ssh-close')?.({ payload: 'session-3' })
    third.resolve('session-3')

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(states.at(-1)).toMatchObject({
      error: expect.stringContaining('disconnected'),
      retryable: true,
    })
  })

  it('keeps the retry loop alive when one pane listener throws', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockResolvedValueOnce('session-2')
    const healthy: TerminalSessionSnapshot[] = []
    const throwing: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 3,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: snapshot => healthy.push(snapshot),
    })
    await vi.waitFor(() => expect(healthy.at(-1)?.sessionId).toBe('session-1'))

    // A second surface (for example a re-rendered pane) throws while the state
    // is being published. The retry loop publishes from inside its own promise
    // chain, so an escaping exception used to abandon the attempt budget and
    // leave the pane stuck on `reconnecting` with no retry and no error.
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: snapshot => {
        throwing.push(snapshot)
        if (snapshot.status === 'reconnecting') {
          throw new Error('reconnecting pane render failed')
        }
      },
    })

    const healthyBefore = healthy.length
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })

    await vi.waitFor(() => expect(healthy.at(-1)?.sessionId).toBe('session-2'))
    expect(healthy.length).toBeGreaterThan(healthyBefore)
    expect(throwing.at(-1)?.status).toBe('connected')
  })

  it('cancels the active retry delay when its tab is closed', async () => {
    let retrySignal: AbortSignal | undefined
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      sleep: async (_delay, signal) => {
        retrySignal = signal
        await new Promise<void>(resolve =>
          signal?.addEventListener('abort', () => resolve(), { once: true }),
        )
      },
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(retrySignal).toBeDefined())

    await manager.close('remote-1')

    expect(retrySignal?.aborted).toBe(true)
  })

  it('resumes an exhausted-but-retryable session after the host wakes', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce('session-2')
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 2,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    // Sleep suspends timers and the socket, so every retry is spent while the
    // machine is asleep and the record settles in a retryable error state.
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        status: 'error',
        retryable: true,
      }),
    )

    manager.handleHostWake()

    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-2'))
    expect(states.at(-1)?.status).toBe('connected')
  })

  it('does not disturb connected, idle or permanently failed sessions on wake', async () => {
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 1,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    manager.handleHostWake()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(startTerminalShell).toHaveBeenCalledTimes(1)
    expect(states.at(-1)?.status).toBe('connected')
  })

  it('does not let a wake over a connected session arm a later unrelated failure', async () => {
    // A healthy session has no attempt in flight, so nothing would ever clear
    // an arming left behind by the wake sweep. If it were armed anyway, the next
    // ordinary disconnect would look like a post-wake failure and spend an extra
    // budget the user never asked for.
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValueOnce(new Error('network unavailable'))
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 1,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    manager.handleHostWake()
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })

    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        status: 'error',
        retryable: true,
      }),
    )
    expect(startTerminalShell).toHaveBeenCalledTimes(2)
  })

  it('recovers a session whose attempt was still connecting when the host woke', async () => {
    // Waking resumes timers and the socket at the same time, so the backend
    // deadline for an in-flight attempt can land right after the wake event.
    // That failure carries no sessionId, so the ordinary I/O-error path cannot
    // re-arm it and the pane would otherwise stay stuck on "connecting".
    const pending = deferred<string>()
    vi.mocked(startTerminalShell).mockReturnValueOnce(pending.promise)
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connecting'))

    // A single wake, exactly as the OS delivers it after sleep.
    manager.handleHostWake()
    expect(states.at(-1)?.status).toBe('connecting')

    // Only afterwards does the suspended attempt fail with a retryable error.
    pending.reject(new Error('network unavailable'))

    // No second wake ever arrives, so this single wake must have armed the
    // recovery rather than leaving the session stuck for the rest of the day.
    vi.mocked(startTerminalShell).mockResolvedValueOnce('session-2')

    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-2'))
    expect(states.at(-1)?.status).toBe('connected')
  })

  it('restarts an in-flight automatic reconnect after a host wake', async () => {
    const pending = deferred<string>()
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce('session-3')
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 1,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-1'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('reconnecting'))

    manager.handleHostWake()
    pending.reject(new Error('network unavailable'))

    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-3'))
    expect(states.at(-1)?.status).toBe('connected')
    expect(startTerminalShell).toHaveBeenCalledTimes(3)
  })

  it('does not let a wake arming from a successful attempt trigger a later unrelated recovery', async () => {
    // An arming belongs to the attempt that was in flight when the host woke.
    // If that attempt connects, the arming must be gone, otherwise a much later
    // failure would spend an extra retry budget the user never asked for.
    const pending = deferred<string>()
    vi.mocked(startTerminalShell)
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error('network unavailable'))
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 1,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connecting'))

    manager.handleHostWake()
    pending.resolve('session-1')
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))
    expect(states.at(-1)?.sessionId).toBe('session-1')

    // A plain disconnect later on is not a wake, so it gets only its own budget
    // and no extra wake-driven attempt.
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        status: 'error',
        retryable: true,
      }),
    )
    expect(startTerminalShell).toHaveBeenCalledTimes(2)
  })
})
