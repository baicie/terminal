// F13 — a reconnect policy set at runtime must reach the ladder that runs.
//
// ## The gap this closes
//
// `TerminalSessionManager` has always accepted a policy through its constructor, and the
// shipped singleton is `new TerminalSessionManager()` — no arguments. So every custom
// `baseDelayMs` / `maxAttempts` a test could name was reachable only from inside a unit
// test that built its own manager. The product walked the defaults, and a stored
// preference had no consumer at all.
//
// The assertions below are on *observable attempts*: how many times the ladder called
// `start` and what delays it slept. A test that only read back `reconnectPolicy()` would
// pass on a manager that stores the value and never uses it — the mechanism-with-no-
// consumer defect this repository has hit more than once.

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
  serialService: { disconnect: vi.fn(async () => {}) },
}))

import { startTerminalShell } from './terminal-launcher'
import {
  TerminalSessionManager,
  type TerminalSessionSnapshot,
} from './terminal-session-manager'
import { terminalSessionTransport } from './terminal-session-transport'
import { reconnectPolicyFromSettings } from '@/service/database/app-settings-reconnect-apply'

const remoteRequest = {
  tabId: 'remote-policy',
  tabType: 'remote' as const,
  cols: 80,
  rows: 24,
}

/** A transient failure, so the ladder keeps walking instead of leaving on the first try. */
const transientFailure = () => ({
  type: 'connection_failed',
  message: 'connection failed: connection refused',
})

function attachWith(manager: TerminalSessionManager) {
  const states: TerminalSessionSnapshot[] = []
  const binding = manager.attach(remoteRequest, {
    onOutput: () => {},
    onState: state => states.push(state),
  })
  return { binding, states }
}

describe('F13 — a policy set after construction reaches the ladder', () => {
  beforeEach(() => {
    eventHandlers.clear()
    vi.mocked(startTerminalShell).mockReset()
    vi.mocked(startTerminalShell).mockResolvedValue('session-1')
    vi.mocked(terminalSessionTransport.close).mockReset()
    vi.mocked(terminalSessionTransport.close).mockResolvedValue(undefined)
    vi.mocked(terminalSessionTransport.cancelConnection).mockReset()
    vi.mocked(terminalSessionTransport.cancelConnection).mockResolvedValue(
      undefined,
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('walks as many attempts as the policy set at runtime names', async () => {
    /*
     * The shipped defect stated as a test. Construct with no options, then set a policy
     * the way startup does and count the attempts. Before F13 the setter did not exist and
     * this number was always 5, whatever the user had stored.
     */
    const manager = new TerminalSessionManager()
    manager.setReconnectPolicy({
      maxAttempts: 2,
      sleep: async () => {},
      jitter: (delayMs: number) => delayMs,
    })
    vi.mocked(startTerminalShell).mockRejectedValue(transientFailure())

    const { states } = attachWith(manager)
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))

    /*
     * One initial connection plus the ladder's two attempts — the relationship the existing
     * suite pins (`maxAttempts: 2` with one prior connection ends on the third call). The
     * number that matters is the one the *policy* set: 2 attempts, not the shipped 5.
     */
    expect(vi.mocked(startTerminalShell).mock.calls.length).toBe(3)
    // The snapshot's `attempts` is the ladder's own count, not a value echoed from config.
    expect(states.at(-1)?.attempts).toBe(2)
  })

  it('sleeps the delays the policy set at runtime implies', async () => {
    /*
     * 7, 14, 28 proves the ladder used the value just set and not the constructor default
     * of 500. One sleep per attempt (the loop waits, then connects), and jitter is the
     * identity so the recorded series is the backoff itself.
     */
    const delays: number[] = []
    const manager = new TerminalSessionManager()
    manager.setReconnectPolicy({
      baseDelayMs: 7,
      maxAttempts: 3,
      jitter: (delayMs: number) => delayMs,
      sleep: async (delayMs: number) => {
        delays.push(delayMs)
      },
    })
    vi.mocked(startTerminalShell).mockRejectedValue(transientFailure())

    const { states } = attachWith(manager)
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))

    expect(delays).toEqual([7, 14, 28])
  })

  it('applies a change made between ladders to the next one', async () => {
    /*
     * A user who changes the setting after a failure expects the next ladder to follow the
     * new numbers. The second ladder is opened by the **recovery timer** rather than by
     * `binding.reconnect()`, because a manual reconnect is a single attempt that never
     * sleeps (`mode !== 'automatic'`) — so a manual one could not show the backoff at all.
     *
     * The policy is replaced synchronously right after the first ladder ends, before the
     * timer fires, which is the ordering startup's apply has in the real app.
     */
    const delays: number[] = []
    const sleep = async (delayMs: number) => {
      delays.push(delayMs)
    }
    const manager = new TerminalSessionManager({
      baseDelayMs: 5,
      maxAttempts: 1,
      recoveryDelayMs: 40,
      sleep,
      jitter: (delayMs: number) => delayMs,
    })
    vi.mocked(startTerminalShell).mockRejectedValue(transientFailure())

    const { states } = attachWith(manager)
    await vi.waitFor(() => expect(delays.length).toBeGreaterThan(0))
    expect(delays[0]).toBe(5)

    manager.setReconnectPolicy({
      baseDelayMs: 11,
      maxAttempts: 1,
      recoveryDelayMs: 40,
      sleep,
      jitter: (delayMs: number) => delayMs,
    })

    // The next ladder's attempt waits the *new* base delay, not the old one.
    await vi.waitFor(() => expect(delays).toContain(11), { timeout: 3000 })
    expect(delays.filter(delay => delay === 11)).toHaveLength(1)
    expect(states.at(-1)?.status).toBe('error')
  })

  it('replaces rather than merges, so a cleared field falls back to the default', async () => {
    /*
     * Startup applies a row that may name only one field. The other must go back to the
     * default, not keep whatever a previous apply left there — otherwise clearing a field
     * in settings silently keeps the old number for the rest of the session.
     */
    const manager = new TerminalSessionManager({ maxAttempts: 9 })
    manager.setReconnectPolicy({ baseDelayMs: 3 })
    expect(manager.reconnectPolicy().maxAttempts).toBe(5)
    expect(manager.reconnectPolicy().baseDelayMs).toBe(3)
  })

  it('normalises an unusable value instead of throwing', () => {
    // A hand-edited row or an old build can hold 0 or a fraction. Startup must not fail:
    // the resolver falls back and the manager ends up on the shipped defaults.
    const manager = new TerminalSessionManager()
    manager.setReconnectPolicy({ maxAttempts: 0, baseDelayMs: -4 })
    expect(manager.reconnectPolicy().maxAttempts).toBe(5)
    expect(manager.reconnectPolicy().baseDelayMs).toBe(500)
  })
})

describe('F13 — a settings row maps onto the policy', () => {
  it('leaves absent fields absent so the default still applies', () => {
    expect(reconnectPolicyFromSettings({})).toEqual({})
  })

  it('passes through the fields a user actually set', () => {
    expect(
      reconnectPolicyFromSettings({
        reconnectBaseDelayMs: 250,
        reconnectMaxAttempts: 2,
      }),
    ).toEqual({ baseDelayMs: 250, maxAttempts: 2 })
  })

  it('keeps a zero out of the policy, where it would mean "one attempt, never retry"', () => {
    /*
     * The ladder reads `maxAttempts` directly, so a stored 0 is not "unset" to it — it is
     * a connection that fails once and never retries. Dropping it here sends the field down
     * the same absent path as a missing row.
     */
    expect(reconnectPolicyFromSettings({ reconnectMaxAttempts: 0 })).toEqual({})
    expect(reconnectPolicyFromSettings({ reconnectBaseDelayMs: 0 })).toEqual({})
  })

  it('drops a value that is not a finite number', () => {
    // `NaN` survives `typeof === 'number'`; it must not reach the resolver as a delay.
    expect(
      reconnectPolicyFromSettings({ reconnectBaseDelayMs: Number.NaN }),
    ).toEqual({})
  })
})
