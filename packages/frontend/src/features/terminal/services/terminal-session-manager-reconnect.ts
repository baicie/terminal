import { formatIpcError } from '@/hooks/terminal-session-helpers'
import { closeTerminalBackend } from './terminal-session-backend'
import type { TerminalSessionOutputBuffer } from './terminal-session-output-buffer'
import { resolveReconnectPolicy } from './terminal-session-reconnect-policy'
import { updateTerminalState } from './terminal-session-state'
import { TerminalSessionRecoveryTimer } from './terminal-session-recovery-timer'
import { TerminalSessionWakeRecovery } from './terminal-session-wake-recovery'
import type { TerminalRecord } from './terminal-session-manager-types'

export type TerminalReconnectStartResult =
  | 'connected'
  | 'cancelled'
  | { status: 'retry'; error: string }
  | { status: 'failed'; error: string; retryable: boolean }

/** Delay before retrying after an automatic attempt budget is exhausted. */
export interface TerminalReconnectOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  maxAttempts?: number
  recoveryDelayMs?: number
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>
  jitter?: (delayMs: number, attempt: number) => number
  now?: () => number
}

interface TerminalReconnectDependencies {
  sessionToTab: Map<string, string>
  pendingOutput: TerminalSessionOutputBuffer
  retireLifecycle: (sessionId: string) => void
  cancelConnection: (record: TerminalRecord) => void
  start: (
    record: TerminalRecord,
    generation: number,
  ) => Promise<TerminalReconnectStartResult>
  isCurrent: (record: TerminalRecord) => boolean
}

export class TerminalSessionReconnect {
  private readonly policy: ReturnType<typeof resolveReconnectPolicy>
  private readonly abortControllers = new WeakMap<
    TerminalRecord,
    AbortController
  >()
  private readonly recoveryTimer = new TerminalSessionRecoveryTimer()
  private readonly wake = new TerminalSessionWakeRecovery()

  constructor(
    private readonly dependencies: TerminalReconnectDependencies,
    options: TerminalReconnectOptions = {},
  ) {
    this.policy = resolveReconnectPolicy(options)
  }

  async disconnect(record: TerminalRecord): Promise<void> {
    this.cancel(record)
    const sessionId = this.prepare(record, false)
    record.io.disconnect()
    updateTerminalState(record, { status: 'disconnected', sessionId: null })
    if (sessionId) {
      await closeTerminalBackend(record.request.tabType, sessionId)
    }
  }

  retire(record: TerminalRecord): void {
    this.cancel(record)
  }

  manual(record: TerminalRecord): void {
    if (record.closed || record.reconnectMode === 'manual') return
    if (record.request.tabType === 'serial') {
      updateTerminalState(record, {
        error: 'Reconnect serial ports from the serial connection dialog.',
      })
      return
    }
    this.launch(record, 'manual', 'Manual reconnect')
  }

  /**
   * Resume a session that is still retryable after the host woke from sleep.
   */
  resume(record: TerminalRecord, reason: string): boolean {
    if (!this.wake.canResume(record)) return false
    this.launch(record, 'automatic', reason)
    return true
  }

  automatic(record: TerminalRecord, reason: string): void {
    if (
      record.closed ||
      record.request.tabType !== 'remote' ||
      record.reconnectPromise
    ) {
      return
    }
    this.launch(record, 'automatic', reason)
  }

  armAfterWake(record: TerminalRecord): void {
    this.wake.armAfterWake(record)
  }

  consumeWakeArming(record: TerminalRecord): boolean {
    return this.wake.consumeWakeArming(record)
  }

  clearWakeArming(record: TerminalRecord): void {
    this.wake.clearWakeArming(record)
  }

  private cancel(record: TerminalRecord): void {
    this.recoveryTimer.clear(record)
    this.dependencies.cancelConnection(record)
    this.abortControllers.get(record)?.abort()
    this.abortControllers.delete(record)
    record.generation++
    record.reconnectPromise = null
    record.reconnectMode = null
  }

  private launch(
    record: TerminalRecord,
    mode: NonNullable<TerminalRecord['reconnectMode']>,
    reason: string,
  ): void {
    this.recoveryTimer.clear(record)
    this.dependencies.cancelConnection(record)
    this.abortControllers.get(record)?.abort()
    const controller = new AbortController()
    this.abortControllers.set(record, controller)
    const promise = this.run(record, mode, reason, controller.signal)
    record.reconnectMode = mode
    record.reconnectPromise = promise
    void promise.finally(() => {
      if (record.reconnectPromise !== promise) return
      record.reconnectPromise = null
      record.reconnectMode = null
      if (this.abortControllers.get(record) === controller) {
        this.abortControllers.delete(record)
      }
    })
  }

  private async run(
    record: TerminalRecord,
    mode: NonNullable<TerminalRecord['reconnectMode']>,
    reason: string,
    signal: AbortSignal,
  ): Promise<void> {
    const generation = ++record.generation
    const sessionId = this.prepare(record, mode)
    const attempts = mode === 'automatic' ? this.policy.maxAttempts : 1
    let lastError = reason

    let attempt = 0
    while (attempt < attempts) {
      attempt += 1
      if (attempt > 1) this.prepareIo(record, mode)
      const delay = mode === 'automatic' ? this.delayFor(attempt) : 0
      updateTerminalState(record, {
        status: 'reconnecting',
        sessionId: null,
        error: null,
        attempt,
        reason: lastError,
        nextRetryAt:
          mode === 'automatic' ? this.policy.now() + delay : undefined,
        retryable: true,
      })
      if (attempt === 1 && sessionId) {
        await closeTerminalBackend(record.request.tabType, sessionId)
      }
      if (!this.isActive(record, generation)) return

      if (mode === 'automatic') {
        try {
          await this.policy.sleep(delay, signal)
        } catch (error) {
          if (signal.aborted || !this.isActive(record, generation)) return
          if (this.isActive(record, generation)) {
            updateTerminalState(record, {
              status: 'error',
              error: formatIpcError(error),
              retryable: true,
            })
            this.scheduleRecovery(record)
          }
          return
        }
      }
      if (!this.isActive(record, generation)) return

      const result = await this.dependencies.start(record, generation)
      if (result === 'connected' || result === 'cancelled') return
      if (result.status === 'retry') {
        // A host wake can arrive while this reconnect loop is waiting on an
        // in-flight SSH handshake. Restart the same loop with a fresh budget;
        // launching another reconnect here would be rejected by the Promise
        // guard and leave the pane stuck in `reconnecting`.
        lastError = result.error
        attempt = 0
        this.prepareIo(record, mode)
        continue
      }
      lastError = result.error
      if (!result.retryable) {
        updateTerminalState(record, {
          status: 'error',
          sessionId: null,
          error: result.error,
          retryable: false,
        })
        return
      }
    }
    if (!this.isActive(record, generation)) return
    updateTerminalState(record, {
      status: 'error',
      sessionId: null,
      error: lastError,
      retryable: true,
    })
    this.scheduleRecovery(record)
  }

  private scheduleRecovery(record: TerminalRecord): void {
    if (
      record.closed ||
      record.request.tabType !== 'remote' ||
      record.retryable !== true
    ) {
      return
    }
    this.recoveryTimer.schedule(record, this.policy.recoveryDelayMs, () => {
      if (
        record.closed ||
        record.status !== 'error' ||
        record.retryable !== true ||
        record.reconnectPromise
      ) {
        return
      }
      this.launch(record, 'automatic', 'Retrying after automatic backoff')
    })
  }

  private prepare(
    record: TerminalRecord,
    mode: NonNullable<TerminalRecord['reconnectMode']> | false,
  ): string | null {
    const sessionId = record.sessionId
    record.sessionId = null
    if (mode) {
      record.audience.retireAll()
      this.prepareIo(record, mode)
    }
    if (!sessionId) return null
    this.dependencies.sessionToTab.delete(sessionId)
    this.dependencies.pendingOutput.retire(sessionId)
    this.dependencies.retireLifecycle(sessionId)
    record.audience.retire(sessionId)
    return sessionId
  }

  private prepareIo(
    record: TerminalRecord,
    mode: NonNullable<TerminalRecord['reconnectMode']>,
  ): void {
    if (mode === 'automatic') record.io.prepareForAutomaticReconnect()
    else record.io.prepareForReconnect()
  }

  private delayFor(attempt: number): number {
    const exponential = Math.min(
      this.policy.maxDelayMs,
      this.policy.baseDelayMs * 2 ** (attempt - 1),
    )
    const jittered = this.policy.jitter(exponential, attempt)
    return Number.isFinite(jittered) && jittered >= 0
      ? Math.round(jittered)
      : exponential
  }

  private isActive(record: TerminalRecord, generation: number): boolean {
    return (
      !record.closed &&
      record.generation === generation &&
      this.dependencies.isCurrent(record)
    )
  }
}
