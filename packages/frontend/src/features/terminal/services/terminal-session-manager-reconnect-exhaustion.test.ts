// F06 — when the automatic ladder runs out, the pane must still know *which machine*
// refused.
//
// ## The defect this file pins
//
// `run()` kept the ladder's last message in a plain string (`lastError`) and wrote the
// terminal state from that string alone. Every structured field the classifier had just
// attached — `hop`, `stage`, `diagnosis` — was dropped on the way out. The non-automatic
// branch (vault, manual) did carry them, so the loss was invisible in exactly the case
// the ladder exists for: a network failure that outlasts the retry budget.
//
// A user with a jump chain then reads "authentication rejected" with no indication of
// whether it was the bastion's account or the target's — the two logins this product
// went to some trouble to keep apart.
//
// ## What "exhausted" means here
//
// Not "the product gave up forever". `scheduleRecovery` may open a new ladder after
// `recoveryDelayMs`, and a host wake may resume earlier. The invariant is narrower: the
// state published at the end of *this* ladder describes the last attempt *of this
// ladder*. Latest failure with no hop must clear an older hop rather than inherit it.

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

const remoteRequest = {
  tabId: 'remote-exhaustion',
  tabType: 'remote' as const,
  cols: 80,
  rows: 24,
}

/**
 * A transient transport failure with the context Rust sends for a jump connection.
 *
 * `connection_failed` is retryable (not in `NON_RETRYABLE_KINDS`), which is what puts it
 * on the automatic ladder; the hop/stage are what the diagnostic is derived from.
 */
const jumpFailure = (
  hop: 'bastion' | 'target',
  stage: string,
  message: string,
) => ({ type: 'connection_failed', message, hop, stage })

const plainFailure = () => ({
  type: 'connection_failed',
  message: 'connection failed: network is unreachable',
})

function createManager(options: Record<string, unknown> = {}) {
  const states: TerminalSessionSnapshot[] = []
  const manager = new TerminalSessionManager({
    maxAttempts: 2,
    sleep: async () => {},
    jitter: (delayMs: number) => delayMs,
    ...options,
  })
  const binding = manager.attach(remoteRequest, {
    onOutput: () => {},
    onState: state => states.push(state),
  })
  return { manager, binding, states }
}

describe('F06 — an exhausted ladder keeps the last failure context', () => {
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

  it('reports the bastion it could not reach after the ladder is exhausted', async () => {
    vi.mocked(startTerminalShell).mockRejectedValue(
      jumpFailure('bastion', 'tcp_connect', 'connect failed: no route to host'),
    )
    const { manager, states } = createManager({ maxAttempts: 2 })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))

    expect(states.at(-1)).toMatchObject({
      status: 'error',
      retryable: true,
      recovery: 'automatic',
      hop: 'bastion',
      stage: 'tcp_connect',
      diagnosis: 'bastion-unreachable',
    })
    await manager.close(remoteRequest.tabId)
  })

  it('reports the target it could not reach after the ladder is exhausted', async () => {
    vi.mocked(startTerminalShell).mockRejectedValue(
      jumpFailure('target', 'handshake', 'handshake failed: reset by peer'),
    )
    const { manager, states } = createManager({ maxAttempts: 2 })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))

    expect(states.at(-1)).toMatchObject({
      hop: 'target',
      stage: 'handshake',
      diagnosis: 'target-handshake-failed',
    })
    await manager.close(remoteRequest.tabId)
  })

  it('replaces an older bastion failure with the newer target failure', async () => {
    /*
     * Both failures must happen *inside* the ladder.
     *
     * The first version of this file mocked the failures onto the first connection and
     * the ladder almost never saw the first one: a first connection that fails retryably
     * hands the ladder only `failure.error` (a string), so the "older" failure was never
     * a ladder attempt at all and the test passed whatever the ladder did with hops.
     * Establishing a session and then dropping it puts every attempt on the same path.
     */
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValueOnce(
        jumpFailure('bastion', 'tcp_connect', 'connect failed: timed out'),
      )
      .mockRejectedValue(
        jumpFailure('target', 'authentication', 'authentication_failed'),
      )
    const { manager, states } = createManager({ maxAttempts: 2 })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))

    /*
     * The failure kind is `connection_failed`, not `authentication_rejected`, so the
     * diagnosis stays absent — but the hop and stage are the *second* attempt's. Keeping
     * `bastion` here would send the user to the wrong machine.
     */
    expect(states.at(-1)).toMatchObject({ hop: 'target', stage: 'authentication' })
    expect(states.at(-1)?.diagnosis).toBeUndefined()
    await manager.close(remoteRequest.tabId)
  })

  it('clears an older bastion context when the last failure carries none', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValueOnce(
        jumpFailure('bastion', 'tcp_connect', 'connect failed: timed out'),
      )
      .mockRejectedValue(plainFailure())
    const { manager, states } = createManager({ maxAttempts: 2 })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))

    /*
     * Absent is not "target". A failure with no recorded hop must publish none, or the
     * pane inherits a claim about a machine this attempt never involved.
     */
    expect(states.at(-1)?.hop).toBeUndefined()
    expect(states.at(-1)?.stage).toBeUndefined()
    expect(states.at(-1)?.diagnosis).toBeUndefined()
    await manager.close(remoteRequest.tabId)
  })

  it('drops the exhausted context once a manual retry connects', async () => {
    vi.mocked(startTerminalShell)
      .mockRejectedValueOnce(jumpFailure('bastion', 'tcp_connect', 'timed out'))
      .mockRejectedValueOnce(jumpFailure('bastion', 'tcp_connect', 'timed out'))
      .mockResolvedValueOnce('session-2')
    const { manager, states } = createManager({ maxAttempts: 1 })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(states.at(-1)?.hop).toBe('bastion')

    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    }).reconnect()

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))
    expect(states.at(-1)?.hop).toBeUndefined()
    expect(states.at(-1)?.diagnosis).toBeUndefined()
    expect(states.at(-1)?.retryable).toBeUndefined()
    await manager.close(remoteRequest.tabId)
  })

  it('clears the exhausted context when the user disconnects', async () => {
    vi.mocked(startTerminalShell).mockRejectedValue(
      jumpFailure('bastion', 'tcp_connect', 'timed out'),
    )
    const { binding, states } = createManager({ maxAttempts: 1 })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))

    binding.disconnect()
    await vi.waitFor(() =>
      expect(states.at(-1)?.status).toBe('disconnected'),
    )
    expect(states.at(-1)?.hop).toBeUndefined()
    expect(states.at(-1)?.diagnosis).toBeUndefined()
  })
})

describe('F10 — the exhausted verdict reports how many attempts it cost', () => {
  /*
   * ## The gap this closes
   *
   * `failureReason.attempts` was structurally unreachable: the snapshot only carries
   * `attempt` while `status === 'reconnecting'` (`terminal-session-manager-types.ts:171`),
   * and every transition to `error` clears `record.reconnectAttempt`
   * (`terminal-session-state.ts:61-65`). So the one thing a failure report most needs —
   * how hard the ladder tried before giving up — was always `null`.
   *
   * `scripts/run-terminal-smoke.test.mjs:1418` asserts `attempts: 5` — but that is a
   * round-trip test of the *artifact parser*: it checks the harness carries the field
   * through unchanged, which it does and should. What was missing is a producer: no real
   * run could ever hand it a number. These cases supply one, from the record the ladder
   * actually ran on.
   */
  beforeEach(() => {
    eventHandlers.clear()
    vi.mocked(startTerminalShell).mockReset()
    vi.mocked(startTerminalShell).mockResolvedValue('session-1')
  })

  it('reports the number of attempts the exhausted ladder actually made', async () => {
    vi.mocked(startTerminalShell).mockRejectedValue({
      type: 'connection_failed',
      message: 'connection failed: network is unreachable',
    })
    const { manager, states } = createManager({ maxAttempts: 3 })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))

    expect(states.at(-1)?.attempts).toBe(3)
    await manager.close(remoteRequest.tabId)
  })

  it('reports one attempt for a manual retry that never entered the ladder', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValue({ type: 'connection_failed', message: 'timed out' })
    const { manager, binding, states } = createManager({ maxAttempts: 3 })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    const attemptsAfterLadder = states.at(-1)?.attempts
    expect(attemptsAfterLadder).toBe(3)

    binding.reconnect()
    await vi.waitFor(() =>
      expect(states.at(-1)?.status).toBe('error'),
    )
    /*
     * A manual retry runs exactly one attempt (`run()` sets `attempts = 1` for a
     * non-automatic mode), so the number must drop rather than keep the ladder's.
     */
    expect(states.at(-1)?.attempts).toBe(1)
    expect(startTerminalShell).toHaveBeenCalledTimes(3 + 1 + 1)
    await manager.close(remoteRequest.tabId)
  })

  it('does not carry a stale attempt count into a successful connection', async () => {
    vi.mocked(startTerminalShell)
      .mockRejectedValueOnce({ type: 'connection_failed', message: 'timed out' })
      .mockResolvedValue('session-2')
    const { manager, states } = createManager({ maxAttempts: 3 })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))
    expect(states.at(-1)?.attempts).toBeUndefined()
    await manager.close(remoteRequest.tabId)
  })
})
