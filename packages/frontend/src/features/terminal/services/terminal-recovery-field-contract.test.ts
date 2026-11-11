// Phase 10.4.1 — which field the session manager actually reads.
//
// The reviewer mutated `start.ts` back to `failure.retryable` and the whole
// credential-retry suite stayed green. That is a real gap in the suite, and it has
// a specific cause: today the classifier never emits `retryable: true` together
// with a non-automatic `recovery`, so the two fields agree on every failure the
// manager can actually receive. A test that only watches for "no reconnect" cannot
// distinguish which field produced that outcome.
//
// This file closes the gap at the boundary instead of pretending the observation
// test covers it: the classifier is replaced with one that deliberately emits the
// divergent combination, so `start.ts` has to read `recovery` to get the right
// answer. If it reads `retryable` instead, this test fails.
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
  startTerminalShell: vi.fn(async () => {
    throw new Error('boom')
  }),
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

// The divergent verdict: recoverable in principle, but not by waiting. No amount
// of classifier correctness produces this pairing today, which is the point.
vi.mock('./terminal-session-manager-errors', () => ({
  classifyTerminalFailure: () => ({
    error: 'the vault is being re-keyed',
    retryable: true,
    recovery: 'after-vault',
    credentialKind: 'credential-read-failed',
  }),
  handleTerminalIoError: vi.fn(() => {
    throw new Error('unused in this file')
  }),
}))

const { TerminalSessionManager } = await import('./terminal-session-manager')
const { startTerminalShell } = await import('./terminal-launcher')

const remoteRequest = {
  tabId: 'remote-1',
  tabType: 'remote' as const,
  cols: 80,
  rows: 24,
}

beforeEach(() => {
  eventHandlers.clear()
})

describe('the automatic ladder keys on recovery, not on retryable', () => {
  it('does not retry a failure that is retryable but not by waiting', async () => {
    const sleep = vi.fn(async () => {})
    const manager = new TerminalSessionManager({
      maxAttempts: 5,
      sleep,
      jitter: delayMs => delayMs,
    })
    const states: Record<string, unknown>[] = []
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state as unknown as Record<string, unknown>),
    })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))

    // `retryable: true` would have sent this through the ladder five times.
    expect(startTerminalShell).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    await manager.close(remoteRequest.tabId)
  })
})

// The same gap exists inside the reconnect loop. Once an automatic reconnect is
// already running, each failed attempt returns a `TerminalReconnectStartResult`,
// and the loop decides whether to keep going. Reverting that check to
// `!result.retryable` used to leave every test green for the same reason as above.
describe('the reconnect loop keys on recovery too', () => {
  it('leaves the loop on a failure that is retryable but not by waiting', async () => {
    // First attempt connects, so the loop is entered by a dropped session rather
    // than by the initial connect — that is the path the loop itself owns.
    const { startTerminalShell: start } = await import('./terminal-launcher')
    vi.mocked(start)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValue(new Error('boom'))

    const sleep = vi.fn(async () => {})
    const manager = new TerminalSessionManager({
      maxAttempts: 5,
      sleep,
      jitter: delayMs => delayMs,
    })
    const states: Record<string, unknown>[] = []
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state as unknown as Record<string, unknown>),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })

    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: 'error' }),
    )
    // One reconnect attempt; the loop must not spend the remaining four on a
    // cause that waiting cannot change.
    expect(vi.mocked(start).mock.calls.length).toBeLessThanOrEqual(3)
    expect(sleep.mock.calls.length).toBeLessThanOrEqual(2)
    await manager.close(remoteRequest.tabId)
  })
})
