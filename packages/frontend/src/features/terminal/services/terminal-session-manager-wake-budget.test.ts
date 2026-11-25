// F08 — one connection, one reconnect owner; and a wake is not a way around the rules.
//
// ## What a host wake is allowed to do
//
// Waking a laptop after sleep is a real event: timers were suspended, the socket is gone,
// and the ladder has already spent its budget against a dead network. Spending a fresh
// budget then is the point of the mechanism.
//
// What it must not do is override the reason the session stopped retrying. A vault that
// is locked, a credential the server refused, a host key that does not match — none of
// those are fixed by the network coming back, and a wake that restarts them produces the
// exact failure the user was told would not repeat.
//
// ## Why these are state-machine tests and not smoke tests
//
// The ordering that matters (wake arrives while the handshake is in flight; wake and the
// recovery timer expire together) is decided by which promise resolves first. Deferred
// promises make each ordering exact and repeatable, which a real backend's timing cannot.

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
import { CredentialFailure } from './credential-failure'
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
  tabId: 'f08-remote',
  tabType: 'remote' as const,
  cols: 80,
  rows: 24,
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function createManager(options: Record<string, unknown> = {}) {
  const states: TerminalSessionSnapshot[] = []
  const manager = new TerminalSessionManager({
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

describe('F08 — wake, recovery timer and the retry budget', () => {
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

  it('does not restart a vault failure when the host wakes', async () => {
    /*
     * `after-vault` is the recovery the classifier assigns to a locked or unusable vault.
     * Waiting cannot unlock it, so the ladder must not run — and a wake must not be the
     * exception that resurrects it.
     *
     * ## What this case does and does not prove
     *
     * Mutation result, recorded rather than hidden: deleting the `recovery === 'automatic'`
     * clause from `resumable()` leaves this test green. That is correct — the classifier
     * also sets `retryable: false` for every credential kind, so `retryable === true` alone
     * already excludes them, and this is an exact-redundancy situation rather than an
     * untested guard. The assertion that a wake does not reconnect here is therefore a
     * statement about the *product's* observable behaviour, not a mutation-proof pin on
     * one line. The line that fails if that behaviour regresses is
     * `terminal-recovery-field-contract.test.ts`, which pins the classifier's two fields
     * separately with a forked combination.
     *
     * The shape below is the one `credentialFailureFrom` builds: a `CredentialFailure`
     * reports its kind as a field, not as text. An earlier version of this test attached a
     * `credential` property that `asCredentialFailure` never reads, so the error classified
     * as a plain transport failure and the case measured nothing.
     */
    const { manager, states } = createManager()
    vi.mocked(startTerminalShell).mockRejectedValue(
      new CredentialFailure('vault-locked', 'The vault is locked.', {
        reason: 'vault-unavailable',
        vaultState: 'locked',
      }),
    )

    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    const attemptsBeforeWake = vi.mocked(startTerminalShell).mock.calls.length

    manager.handleHostWake()
    await settle()

    expect(startTerminalShell).toHaveBeenCalledTimes(attemptsBeforeWake)
    expect(states.at(-1)?.status).toBe('error')
    await manager.close(remoteRequest.tabId)
  })

  it('does not restart a host-key rejection when the host wakes', async () => {
    vi.mocked(startTerminalShell).mockRejectedValue({
      type: 'host_key_rejected',
      message: 'host key verification failed',
      hop: 'bastion',
      stage: 'host_key_verification',
    })
    const { manager, states } = createManager()

    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    const attemptsBeforeWake = vi.mocked(startTerminalShell).mock.calls.length

    manager.handleHostWake()
    manager.handleHostWake()
    await settle()

    expect(startTerminalShell).toHaveBeenCalledTimes(attemptsBeforeWake)
    expect(states.at(-1)).toMatchObject({
      status: 'error',
      hop: 'bastion',
      diagnosis: 'bastion-host-key-rejected',
    })
    await manager.close(remoteRequest.tabId)
  })

  it('a wake during an in-flight ladder attempt spends exactly one fresh budget', async () => {
    /*
     * ## Why the attempt must be *inside* the ladder
     *
     * A first connection that fails goes through the `!record.reconnectMode` branch, which
     * opens a ladder regardless of any wake arming — so a wake there proves nothing about
     * `armAfterWake`. This case establishes a session first, drops it (the ladder starts),
     * and only then lets the replacement hang, so the wake lands on an attempt that
     * `record.reconnectMode === 'automatic'` is true for. That is the branch that returns
     * `{ status: 'retry', failure }` and is the only one the wake arming exists for.
     *
     * Exactly one arming must be consumed for the whole ladder: a wake that armed once but
     * was consumed per-attempt would let a single wake multiply the budget.
     */
    const hangingReplacement = deferred<string>()
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockReturnValueOnce(hangingReplacement.promise)
      .mockRejectedValue({ type: 'connection_failed', message: 'timed out' })
    const { manager, states } = createManager({ maxAttempts: 3 })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    // The ladder's first attempt is now in flight and will hang until we resolve it.
    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledTimes(2))

    // A wake while that attempt is in flight, twice, then the attempt fails.
    manager.handleHostWake()
    manager.handleHostWake()
    hangingReplacement.reject({ type: 'connection_failed', message: 'timed out' })

    /*
     * Measured, both ways, rather than bounded loosely:
     *
     *   wake arming honoured  → 5 attempts (the hung attempt, then a full 3-attempt
     *                           restarted ladder, then one more rung because the ladder
     *                           schedules its own recovery — the count is the product's
     *                           intent, see the overlap case below)
     *   `armAfterWake` a no-op → 4 attempts (the hung attempt plus the ladder's remaining
     *                           two rungs and one recovery rung; the suspended attempt's
     *                           budget is never replaced)
     *
     * An earlier version asserted `3 <= attempts <= 5` and could not see that difference
     * at all: the mutation left the value inside the range. The exact count is the point.
     */
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(vi.mocked(startTerminalShell).mock.calls.length).toBe(5)
    await manager.close(remoteRequest.tabId)
  })

  it('two wakes during one ladder do not produce two concurrent ladders', async () => {
    const replacing = deferred<string>()
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockReturnValue(replacing.promise)
    const { manager, binding, states } = createManager()
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(startTerminalShell).toHaveBeenCalledTimes(2))

    manager.handleHostWake()
    manager.handleHostWake()
    await settle()

    // The ladder is still waiting on the same in-flight replacement, not a second one.
    expect(startTerminalShell).toHaveBeenCalledTimes(2)
    replacing.resolve('session-2')
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ sessionId: 'session-2' }),
    )
    expect(startTerminalShell).toHaveBeenCalledTimes(2)
    binding.disconnect()
    await manager.close(remoteRequest.tabId)
  })

  it('a wake after the user disconnected does not reopen the session', async () => {
    vi.mocked(startTerminalShell)
      .mockResolvedValueOnce('session-1')
      .mockRejectedValue({ type: 'connection_failed', message: 'timed out' })
    const { manager, binding, states } = createManager({ maxAttempts: 1 })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('connected'))

    eventHandlers.get('ssh-close')?.({ payload: 'session-1' })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    binding.disconnect()
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('disconnected'))
    const attemptsBeforeWake = vi.mocked(startTerminalShell).mock.calls.length

    manager.handleHostWake()
    await settle()

    expect(startTerminalShell).toHaveBeenCalledTimes(attemptsBeforeWake)
    expect(states.at(-1)?.status).toBe('disconnected')
    await manager.close(remoteRequest.tabId)
  })

  it('never runs two ladders at once when a wake and the recovery timer overlap', async () => {
    /*
     * ## What the invariant is — and is not
     *
     * EXHAUSTED does not mean "this session will never be tried again": the product
     * deliberately re-opens a ladder after `recoveryDelayMs` (F06 says not to change
     * that). So counting total attempts after a wake measures the product's intent, not
     * its safety.
     *
     * The invariant that matters is **one owner**: at no point may two ladders be in
     * flight for one record. A first version of this test asserted a total attempt count
     * and failed at 4-vs-3, which was the product doing the right thing (wake ladder →
     * exhausts → schedules its own timer → that timer opens one more ladder). This counts
     * concurrent attempts instead, which is what "one owner" actually means.
     */
    vi.useFakeTimers()
    let inFlight = 0
    let peak = 0
    vi.mocked(startTerminalShell).mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      try {
        await Promise.resolve()
        throw { type: 'connection_failed', message: 'timed out' }
      } finally {
        inFlight -= 1
      }
    })
    const { manager, states } = createManager({
      maxAttempts: 1,
      recoveryDelayMs: 30_000,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))

    manager.handleHostWake()
    manager.handleHostWake()
    manager.handleHostWake()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(peak).toBe(1)
    vi.useRealTimers()
    await manager.close(remoteRequest.tabId)
  })
})
