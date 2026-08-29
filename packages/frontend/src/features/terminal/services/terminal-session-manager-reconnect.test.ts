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
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const remoteRequest = {
  tabId: 'remote-1',
  tabType: 'remote' as const,
  cols: 80,
  rows: 24,
}

describe('TerminalSessionManager reconnect state machine', () => {
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
      maxAttempts: 5,
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
})
