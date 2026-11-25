// F18 — the terminal's own connection failures reach `connection_logs`.
//
// ## The gap this closes
//
// `recordConnectionFailure` had exactly one caller: `SessionService` (`session.ts`). The
// terminal does not go through it — `terminal-launcher` → `startTerminalShell` is the real
// path — so a connection made from the terminal wrote **nothing** when it failed. The Logs
// view showed successful terminal connections and none of the failures, which is precisely
// the half a user needs when something stops working.
//
// ## What is asserted, and what is deliberately not
//
// One logical connection produces at most one failure row. The retry ladder calls
// `startTerminalSession` once per attempt, so a naive hook here would write five rows for
// one connection the user experienced as one. The record's `connectionAttemptId` is the
// correlation identity that already exists for cancellation; these cases use it to prove
// the row is written once.

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

vi.mock('./session-connection-logs', () => ({
  recordConnectionFailure: vi.fn(async () => 'log-1'),
  recordConnectionSuccess: vi.fn(async () => {}),
  finishConnectionLog: vi.fn(async () => {}),
}))

import { startTerminalShell } from './terminal-launcher'
import { recordConnectionFailure } from './session-connection-logs'
import {
  TerminalSessionManager,
  type TerminalSessionSnapshot,
} from './terminal-session-manager'

const host = {
  id: 'host-a',
  name: 'prod',
  hostname: 'example.test',
  port: 22,
  username: 'alice',
  authType: 'password' as const,
  password: 'secret',
  isFavorite: false,
  portForwards: [],
  createdAt: 0,
  updatedAt: 0,
}

const request = {
  tabId: 'f18-remote',
  tabType: 'remote' as const,
  host,
  cols: 80,
  rows: 24,
}

describe('F18 — a terminal connection failure is recorded', () => {
  beforeEach(() => {
    eventHandlers.clear()
    vi.mocked(startTerminalShell).mockReset()
    vi.mocked(startTerminalShell).mockResolvedValue('session-1')
    vi.mocked(recordConnectionFailure).mockReset()
    vi.mocked(recordConnectionFailure).mockResolvedValue('log-1')
  })

  it('writes one row naming the host and the reason', async () => {
    vi.mocked(startTerminalShell).mockRejectedValue({
      type: 'authentication_rejected',
      message: 'authentication rejected',
    })
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({ sleep: async () => {} })
    manager.attach(request, { onOutput: () => {}, onState: s => states.push(s) })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))

    expect(recordConnectionFailure).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordConnectionFailure).mock.calls[0]?.[0]).toMatchObject({
      id: 'host-a',
      name: 'prod',
    })
    expect(vi.mocked(recordConnectionFailure).mock.calls[0]?.[2]).toContain(
      'authentication rejected',
    )
    await manager.close(request.tabId)
  })

  it('records an exhausted ladder once, not once per attempt', async () => {
    vi.mocked(startTerminalShell).mockRejectedValue({
      type: 'connection_failed',
      message: 'connection failed: network is unreachable',
    })
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 3,
      sleep: async () => {},
      jitter: (delayMs: number) => delayMs,
    })
    manager.attach(request, { onOutput: () => {}, onState: s => states.push(s) })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    /*
     * Four, not three: the first connection is itself the ladder's first attempt, so
     * `maxAttempts: 3` means one initial start plus three ladder attempts. Measured, not
     * assumed — the first version of this test asserted 3 and was wrong about the product.
     */
    expect(startTerminalShell).toHaveBeenCalledTimes(4)
    /*
     * Three attempts, one connection. The user pressed connect once; a Logs view with
     * three rows would describe a different history from the one they lived.
     */
    expect(recordConnectionFailure).toHaveBeenCalledTimes(1)
    await manager.close(request.tabId)
  })

  it('does not record a successful connection as a failure', async () => {
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager()
    manager.attach(request, { onOutput: () => {}, onState: s => states.push(s) })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))
    expect(recordConnectionFailure).not.toHaveBeenCalled()
    await manager.close(request.tabId)
  })

  it('does not let a logging failure turn a working connection into an error', async () => {
    /*
     * The log is an observation. A full disk or a locked database must not take the
     * terminal down with it — the same rule the rest of this module already follows by
     * catching around every write.
     */
    vi.mocked(recordConnectionFailure).mockRejectedValue(new Error('database is locked'))
    vi.mocked(startTerminalShell).mockRejectedValue({
      type: 'authentication_rejected',
      message: 'authentication rejected',
    })
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({ sleep: async () => {} })
    manager.attach(request, { onOutput: () => {}, onState: s => states.push(s) })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(states.at(-1)?.error).toContain('authentication rejected')
    await manager.close(request.tabId)
  })
})
