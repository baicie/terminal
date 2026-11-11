import { describe, expect, it } from 'vitest'
import {
  getTerminalSnapshot,
  type TerminalRecord,
} from './terminal-session-manager-types'
import {
  markTerminalTerminated,
  updateTerminalState,
} from './terminal-session-state'

function record(overrides: Partial<TerminalRecord> = {}): TerminalRecord {
  return {
    request: { tabId: 'tab-1', tabType: 'remote', cols: 80, rows: 24 },
    requestKey: 'key',
    sessionId: 'session-1',
    status: 'reconnecting',
    error: null,
    audience: {
      publishState: () => {},
      enqueue: () => {},
    } as unknown as TerminalRecord['audience'],
    io: {
      disconnect: () => {},
    } as unknown as TerminalRecord['io'],
    generation: 0,
    startPromise: null,
    startPromises: new Set(),
    connectionAttemptId: null,
    reconnectPromise: null,
    reconnectMode: null,
    reconnectAttempt: 3,
    reconnectReason: 'network unavailable',
    reconnectNextRetryAt: 1234,
    retryable: true,
    recovery: 'automatic',
    credentialKind: null,
    closed: false,
    ...overrides,
  }
}

describe('updateTerminalState', () => {
  it('clears the retry fields when a reconnect ends in a terminal state', () => {
    const target = record()

    updateTerminalState(target, { status: 'disconnected', sessionId: null })

    expect(target.reconnectAttempt).toBeNull()
    expect(target.reconnectReason).toBeNull()
    expect(target.reconnectNextRetryAt).toBeNull()
    // A finished reconnect that left retryable=true would make the pane keep
    // advertising a pending recovery that nothing is going to perform.
    expect(target.retryable).toBeNull()
  })

  it('keeps an explicit retryable verdict on an error state', () => {
    // Not every error ends recovery: the pane has to keep saying a retry is
    // still possible, which is the whole point of the retryable flag.
    const recoverable = record({ status: 'error', retryable: true })
    updateTerminalState(recoverable, { status: 'error', retryable: true })
    expect(recoverable.retryable).toBe(true)

    const permanent = record({ status: 'error', retryable: true })
    updateTerminalState(permanent, { status: 'error', retryable: false })
    expect(permanent.retryable).toBe(false)
  })

  it('records the retry schedule while a reconnect is running', () => {
    const target = record({ status: 'connected', reconnectAttempt: null, reconnectReason: null, reconnectNextRetryAt: null, retryable: null, credentialKind: null })

    updateTerminalState(target, {
      status: 'reconnecting',
      attempt: 2,
      reason: 'network unavailable',
      nextRetryAt: 9999,
      retryable: true,
    })

    expect(target.reconnectAttempt).toBe(2)
    expect(target.reconnectReason).toBe('network unavailable')
    expect(target.reconnectNextRetryAt).toBe(9999)
    // The reconnect loop states this explicitly alongside the schedule.
    expect(target.retryable).toBe(true)
  })
})

describe('markTerminalTerminated', () => {
  it('drops the stale retryable flag when the shell exits', () => {
    const target = record()

    markTerminalTerminated(target, 'shell exited')

    expect(target.sessionId).toBeNull()
    expect(target.status).toBe('disconnected')
    expect(target.retryable).toBeNull()
  })
})

// Phase 10.4.1 WP3 — a stale credential kind must not outlive its failure.
//
// The pane picks its vault action from `credentialKind`. If the record keeps the
// kind from a failed attempt across a later connect or disconnect, the header
// offers "Unlock the vault" on a session that is already working — an action that
// leads somewhere wrong, which is worse than offering none.
describe('a failure diagnosis does not survive the state it described', () => {
  function failed(overrides: Partial<TerminalRecord> = {}): TerminalRecord {
    return record({
      status: 'error',
      retryable: false,
      recovery: 'after-vault',
      credentialKind: 'vault-locked',
      ...overrides,
    })
  }

  it('clears the credential kind when the session connects', () => {
    const target = failed()

    updateTerminalState(target, {
      status: 'connected',
      sessionId: 'session-2',
      error: null,
    })

    expect(target.credentialKind).toBeNull()
    expect(target.recovery).toBeNull()
    expect(getTerminalSnapshot(target).credentialKind).toBeUndefined()
  })

  it('clears it when the session disconnects', () => {
    const target = failed()

    updateTerminalState(target, { status: 'disconnected', sessionId: null })

    expect(target.credentialKind).toBeNull()
  })

  it('clears it when a new attempt starts', () => {
    // Switching hosts reuses the record through `attach`; the connecting state is
    // where the previous host's diagnosis must stop being visible.
    const target = failed()

    updateTerminalState(target, {
      status: 'connecting',
      error: null,
      sessionId: null,
    })

    expect(target.credentialKind).toBeNull()
  })

  it('keeps it across a new error while the pane still needs the action', () => {
    const target = failed()

    updateTerminalState(target, {
      status: 'error',
      error: 'still locked',
      retryable: false,
      recovery: 'after-vault',
      credentialKind: 'vault-locked',
    })

    expect(target.credentialKind).toBe('vault-locked')
  })

  it('does not keep the previous kind when a later failure is a network error', () => {
    // The reconnect ladder writes an error with no credential kind. The old kind
    // must not ride along: the header would offer a vault fix for a Wi-Fi drop.
    const target = failed()

    updateTerminalState(target, {
      status: 'error',
      error: 'connection reset by peer',
      retryable: true,
      recovery: 'automatic',
    })

    expect(target.credentialKind).toBeNull()
  })
})
