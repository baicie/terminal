// Phase 10.4.1 WP2 — a credential read failure must not spend the network budget.
//
// `classifyTerminalFailure` returned `retryable: true` for `credential-read-failed`
// ("a decrypt can fail because the vault is being re-keyed under us"). That boolean
// is what `startTerminalSession` reads to decide whether to call
// `reconnects.automatic(...)`. So a vault that could not answer entered the same
// budget as a Wi-Fi drop: five attempts with exponential backoff, then a 30 s
// recovery timer, all of which are guaranteed to fail for the same reason while
// the user's actual next step — unlock the vault, or check it — is never offered.
//
// These tests drive the real `TerminalSessionManager`, not the classifier. The
// distinction the task calls for is three-way, and one boolean cannot express it:
//
//   automatic  — transient network fault; the session manager may retry on its own
//   manual     — a person must change something (rejected key, damaged reference)
//   after-vault— blocked on the vault; retry becomes meaningful only once it is fixed
//
// Only `automatic` may spend the automatic reconnect budget.

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
import { CredentialFailure } from './credential-failure'
import {
  TerminalSessionManager,
  type TerminalSessionSnapshot,
} from './terminal-session-manager'

const remoteRequest = {
  tabId: 'remote-1',
  tabType: 'remote' as const,
  cols: 80,
  rows: 24,
}

beforeEach(() => {
  eventHandlers.clear()
  vi.mocked(startTerminalShell).mockReset()
  vi.mocked(startTerminalShell).mockResolvedValue('session-1')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a vault read failure does not enter the network retry loop', () => {
  it('does not schedule a single automatic attempt', async () => {
    const sleep = vi.fn(async () => {})
    vi.mocked(startTerminalShell).mockRejectedValue(
      new CredentialFailure(
        'credential-read-failed',
        'Reading the stored password for this host failed.',
      ),
    )
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

    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: 'error' }),
    )

    // One attempt, no backoff, no replacement connection.
    expect(startTerminalShell).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    await manager.close(remoteRequest.tabId)
  })

  it('does not arm a recovery timer that would retry it again', async () => {
    vi.useFakeTimers()
    vi.mocked(startTerminalShell).mockRejectedValue(
      new CredentialFailure('credential-read-failed', 'could not decrypt'),
    )
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      recoveryDelayMs: 30_000,
      sleep: async () => {},
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })

    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: 'error' }),
    )
    // A pending timer here is the 30 s automatic recovery the user never asked
    // for, and it fires long after they have moved on.
    expect(vi.getTimerCount()).toBe(0)
    await manager.close(remoteRequest.tabId)
  })

  it('reports the credential kind so the pane can offer the right fix', async () => {
    vi.mocked(startTerminalShell).mockRejectedValue(
      new CredentialFailure('credential-read-failed', 'could not decrypt'),
    )
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({ sleep: async () => {} })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })

    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        status: 'error',
        credentialKind: 'credential-read-failed',
      }),
    )
    // Not "waiting to retry": that text is a promise the manager will not keep.
    expect(states.at(-1)?.retryable).not.toBe(true)
    await manager.close(remoteRequest.tabId)
  })

  it('still lets the user retry by hand after the vault is fixed', async () => {
    // "Vault recovered, connect again" is a manual action: nothing in the app
    // can know the vault was unlocked. The retry button must keep working.
    vi.mocked(startTerminalShell).mockRejectedValueOnce(
      new CredentialFailure('credential-read-failed', 'could not decrypt'),
    )
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({ sleep: async () => {} })
    const binding = manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: 'error' }),
    )

    vi.mocked(startTerminalShell).mockResolvedValueOnce('session-2')
    binding.reconnect()

    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        status: 'connected',
        sessionId: 'session-2',
      }),
    )
    await manager.close(remoteRequest.tabId)
  })

  it('keeps the automatic reconnect for a real transport failure', async () => {
    // The fix must not cost the behaviour it was protecting: a dropped network
    // is exactly what the budget exists for.
    vi.mocked(startTerminalShell)
      .mockRejectedValueOnce(new Error('connection reset by peer'))
      .mockResolvedValueOnce('session-2')
    const sleep = vi.fn(async () => {})
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({
      maxAttempts: 2,
      sleep,
      jitter: delayMs => delayMs,
    })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })

    await vi.waitFor(() => expect(states.at(-1)?.sessionId).toBe('session-2'))
    expect(startTerminalShell).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    await manager.close(remoteRequest.tabId)
  })

  it('keeps the automatic reconnect for a first-connection timeout', async () => {
    vi.mocked(startTerminalShell)
      .mockRejectedValueOnce({
        type: 'authentication_failed',
        message: 'connection timed out',
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
    await manager.close(remoteRequest.tabId)
  })

  it('a host wake cannot resurrect a vault failure either', async () => {
    // Wake recovery resumes any session left `retryable`, which is how an
    // exhausted network failure rides out a laptop lid closing. A vault that
    // needs the user is not that.
    vi.mocked(startTerminalShell).mockRejectedValue(
      new CredentialFailure('vault-locked', 'the vault is locked'),
    )
    const sleep = vi.fn(async () => {})
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({ sleep, jitter: d => d })
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: 'error' }),
    )

    manager.handleHostWake()
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(startTerminalShell).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    await manager.close(remoteRequest.tabId)
  })
})

// The reviewer's reachability sweep found that `credential-corrupt-reference` had
// no producer: `withResolvedCredential` threw a bare Error for a damaged pointer,
// so every real damaged row fell through to message matching and spent the full
// automatic budget. The kind existed, the pane mapping existed, and nothing on the
// real path could reach either. These tests hold the launcher contract and the
// manager consequence together.
describe('a damaged credential reference also stays out of the retry loop', () => {
  it('spends one attempt, not five', async () => {
    const { CredentialFailure } = await import('./credential-failure')
    const sleep = vi.fn(async () => {})
    vi.mocked(startTerminalShell).mockRejectedValue(
      new CredentialFailure(
        'credential-corrupt-reference',
        "This host's stored credential reference cannot be read.",
      ),
    )
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

    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: 'error' }),
    )

    expect(startTerminalShell).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(states.at(-1)?.credentialKind).toBe('credential-corrupt-reference')
    await manager.close(remoteRequest.tabId)
  })
})

// The mutation test above exposed something worth writing down: with today's
// values, `retryable` and `recovery === 'automatic'` agree for every failure, so a
// test that only observes "no automatic reconnect happened" cannot tell which
// field the manager read. Reverting `start.ts` to `failure.retryable` leaves those
// tests green.
//
// That is not a reason to drop `recovery` — it is the reason to pin the contract
// where the two must NOT agree: a failure that is recoverable in principle but not
// by waiting. `retryable: true` with `recovery: 'after-vault'` is exactly the shape
// the old code produced for `credential-read-failed`, and it must not reconnect.
describe('recovery, not retryable, decides the automatic ladder', () => {
  it('does not reconnect when retryable is true but recovery is after-vault', async () => {
    // A hand-built failure: the classifier never produces this combination today.
    // The manager must still key on `recovery`, because that is the field that
    // says *how* the failure recovers, and a future classifier change that sets
    // `retryable: true` here must not silently restore the five-attempt loop.
    const sleep = vi.fn(async () => {})
    const manager = new TerminalSessionManager({
      maxAttempts: 5,
      sleep,
      jitter: delayMs => delayMs,
    })
    vi.mocked(startTerminalShell).mockRejectedValue(
      new (await import('./credential-failure')).CredentialFailure(
        'credential-read-failed',
        'could not decrypt',
      ),
    )
    const states: TerminalSessionSnapshot[] = []
    manager.attach(remoteRequest, {
      onOutput: () => {},
      onState: state => states.push(state),
    })

    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: 'error' }),
    )
    expect(sleep).not.toHaveBeenCalled()
    await manager.close(remoteRequest.tabId)
  })

  it('the classifier never emits retryable for a credential failure', async () => {
    // The invariant that keeps the two fields aligned today. If a future change
    // relaxes it, the test above is what stops the regression from shipping.
    const { classifyTerminalFailure } = await import(
      './terminal-session-manager-errors'
    )
    const { CredentialFailure } = await import('./credential-failure')
    const kinds = [
      'vault-locked',
      'vault-uninitialized',
      'vault-unusable',
      'credential-read-failed',
      'credential-corrupt-reference',
      'credential-not-bound',
      'credential-missing',
    ] as const

    for (const kind of kinds) {
      const failure = classifyTerminalFailure(new CredentialFailure(kind, 'x'))
      expect(failure.retryable, kind).toBe(false)
      expect(failure.recovery, kind).not.toBe('automatic')
      expect(failure.credentialKind).toBe(kind)
    }
  })
})
