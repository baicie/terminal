import { describe, expect, it } from 'vitest'
import type { TerminalRecord } from './terminal-session-manager-types'
import { TerminalSessionWakeRecovery } from './terminal-session-wake-recovery'

function record(overrides: Partial<TerminalRecord> = {}): TerminalRecord {
  return {
    request: { tabId: 'tab-1', tabType: 'remote', cols: 80, rows: 24 },
    requestKey: 'key',
    sessionId: null,
    status: 'connecting',
    error: null,
    audience: {} as TerminalRecord['audience'],
    io: {} as TerminalRecord['io'],
    generation: 0,
    startPromise: null,
    startPromises: new Set(),
    connectionAttemptId: null,
    reconnectPromise: null,
    reconnectMode: null,
    reconnectAttempt: null,
    reconnectReason: null,
    reconnectNextRetryAt: null,
    retryable: null,
    closed: false,
    ...overrides,
  }
}

describe('TerminalSessionWakeRecovery', () => {
  it('consumes an arming exactly once', () => {
    const wake = new TerminalSessionWakeRecovery()
    const target = record()

    wake.armAfterWake(target)

    expect(wake.consumeWakeArming(target)).toBe(true)
    expect(wake.consumeWakeArming(target)).toBe(false)
  })

  it('clears an arming once the woken attempt resolves without failing', () => {
    const wake = new TerminalSessionWakeRecovery()
    const target = record()

    wake.armAfterWake(target)
    wake.clearWakeArming(target)

    expect(wake.consumeWakeArming(target)).toBe(false)
  })

  it('never arms sessions that cannot use automatic reconnect', () => {
    const wake = new TerminalSessionWakeRecovery()

    wake.armAfterWake(
      record({ request: { tabId: 'l', tabType: 'local', cols: 80, rows: 24 } }),
    )
    wake.armAfterWake(
      record({
        request: { tabId: 's', tabType: 'serial', cols: 80, rows: 24 },
        status: 'connecting',
      }),
    )
    wake.armAfterWake(record({ closed: true }))
    wake.armAfterWake(record({ reconnectMode: 'manual' }))

    expect(wake.consumeWakeArming(record())).toBe(false)
    expect(
      wake.canResume(
        record({
          request: { tabId: 'l', tabType: 'local', cols: 80, rows: 24 },
        }),
      ),
    ).toBe(false)
    // A serial session has no reconnect budget to spend: it must be reopened
    // from the serial dialog with a fresh device, so waking must never arm it.
    expect(
      wake.canResume(
        record({
          request: { tabId: 's', tabType: 'serial', cols: 80, rows: 24 },
          status: 'error',
          retryable: true,
        }),
      ),
    ).toBe(false)
  })

  it('never arms a session that has no attempt in flight', () => {
    // A healthy connected session is handed to armAfterWake by the wake sweep
    // because it is remote and not in manual mode. Nothing is in flight for it,
    // so no attempt end will ever clear the arming, and it would sit armed until
    // some unrelated failure much later consumed a wake budget it never earned.
    const wake = new TerminalSessionWakeRecovery()
    // The arming set is keyed by record identity, so the check has to use the
    // same instance that was armed.
    const healthy = record({ status: 'connected', sessionId: 'session-1' })

    wake.armAfterWake(healthy)

    expect(wake.consumeWakeArming(healthy)).toBe(false)
  })

  it('arms only an attempt that is still connecting', () => {
    const wake = new TerminalSessionWakeRecovery()
    const connecting = record({ status: 'connecting' })
    const reconnecting = record({ status: 'reconnecting' })
    const disconnected = record({ status: 'disconnected' })

    wake.armAfterWake(connecting)
    wake.armAfterWake(reconnecting)
    wake.armAfterWake(disconnected)

    expect(wake.consumeWakeArming(connecting)).toBe(true)
    expect(wake.consumeWakeArming(reconnecting)).toBe(true)
    expect(wake.consumeWakeArming(disconnected)).toBe(false)
  })

  it('resumes only retryable remote sessions that are not already reconnecting', () => {
    const wake = new TerminalSessionWakeRecovery()

    expect(wake.canResume(record({ status: 'error', retryable: true }))).toBe(
      true,
    )
    expect(wake.canResume(record({ status: 'error', retryable: false }))).toBe(
      false,
    )
    expect(
      wake.canResume(record({ status: 'connected', retryable: true })),
    ).toBe(false)
    expect(
      wake.canResume(
        record({
          status: 'error',
          retryable: true,
          reconnectPromise: Promise.resolve(),
        }),
      ),
    ).toBe(false)
  })

  it('does not resume an old wake after a newer reconnect generation takes over', async () => {
    let resolveOwnership!: () => void
    const ownership = new Promise<void>(resolve => {
      resolveOwnership = resolve
    })
    const wake = new TerminalSessionWakeRecovery()
    const target = record({
      generation: 7,
      status: 'error',
      reconnectMode: 'automatic',
      reconnectPromise: ownership,
      retryable: true,
    })
    let resumed = 0

    expect(wake.resume(target, () => resumed++)).toBe(true)

    // The original automatic run settles, then a new run reaches the same
    // retryable error state before the delayed wake continuation executes.
    target.reconnectPromise = null
    target.reconnectMode = null
    target.status = 'error'
    target.retryable = true
    target.generation = 8
    resolveOwnership()
    await ownership
    await Promise.resolve()

    expect(resumed).toBe(0)
  })
})
