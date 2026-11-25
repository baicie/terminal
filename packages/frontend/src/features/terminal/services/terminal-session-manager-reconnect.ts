import { formatIpcError } from '@/hooks/terminal-session-helpers'
import { closeTerminalBackend } from './terminal-session-backend'
import { reconnectDelayFor, resolveReconnectPolicy } from './terminal-session-reconnect-policy'
import type {
  TerminalReconnectDependencies,
  TerminalReconnectOptions,
} from './terminal-session-reconnect-types'
import { updateTerminalState, terminalFailureState } from './terminal-session-state'
import type { TerminalFailure } from './terminal-session-manager-errors'
import { TerminalSessionRecoveryTimer } from './terminal-session-recovery-timer'
import {
  prepareReconnectIo,
  prepareReconnectRecord,
  scheduleReconnectRecovery,
} from './terminal-session-reconnect-prepare'
import { TerminalSessionWakeRecovery } from './terminal-session-wake-recovery'
import type { TerminalRecord } from './terminal-session-manager-types'

export type {
  TerminalReconnectDependencies,
  TerminalReconnectOptions,
  TerminalReconnectStartResult,
} from './terminal-session-reconnect-types'

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
    return this.wake.resume(record, () =>
      this.launch(record, 'automatic', reason),
    )
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
    // Publish ownership before run() can synchronously notify reconnect listeners.
    let settleOwnership!: () => void
    const ownership = new Promise<void>(resolve => {
      settleOwnership = resolve
    })
    record.reconnectMode = mode
    record.reconnectPromise = ownership
    const runPromise = this.run(record, mode, reason, controller.signal)
    void runPromise.then(settleOwnership, settleOwnership)
    void ownership.finally(() => {
      if (record.reconnectPromise !== ownership) return
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
    /*
     * F06 — the ladder remembers the last *failure*, not just its sentence.
     *
     * Keeping only a string dropped the hop/stage/diagnosis the classifier had attached,
     * so an exhausted jump connection published "authentication rejected" without saying
     * which of the two logins was refused. The whole failure is replaced on every attempt,
     * never merged: a later failure that carries no hop must clear an older one instead of
     * inheriting a claim about a machine this attempt never touched.
     */
    let lastFailure: TerminalFailure = {
      error: reason,
      retryable: true,
      recovery: 'automatic',
    }

    let attempt = 0
    while (attempt < attempts) {
      attempt += 1
      if (attempt > 1) this.prepareIo(record, mode)
      const delay =
        mode === 'automatic' ? reconnectDelayFor(this.policy, attempt) : 0
      updateTerminalState(record, {
        status: 'reconnecting',
        sessionId: null,
        error: null,
        attempt,
        reason: lastFailure.error,
        nextRetryAt:
          mode === 'automatic' ? this.policy.now() + delay : undefined,
        retryable: true,
        // This loop is the automatic ladder, so the record says so while it
        // runs. Without it the record would carry `null` and a host wake could
        // not tell an in-progress network recovery from a vault failure.
        recovery: 'automatic',
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
              recovery: 'automatic',
            })
            this.scheduleRecovery(record)
          }
          return
        }
      }
      if (!this.isActive(record, generation)) return

      const result = await this.dependencies.start(record, generation, signal)
      if (result === 'connected' || result === 'cancelled') return
      if (result.status === 'retry') {
        // A host wake can arrive while this reconnect loop is waiting on an
        // in-flight SSH handshake. Restart the same loop with a fresh budget;
        // launching another reconnect here would be rejected by the Promise
        // guard and leave the pane stuck in `reconnecting`.
        //
        // F06 — the whole failure travels with the restart. It used to be the message
        // alone, which is how a wake during a bastion failure could end up publishing a
        // context-free verdict.
        lastFailure = result.failure
        attempt = 0
        this.prepareIo(record, mode)
        continue
      }
      lastFailure = {
        error: result.error,
        retryable: result.retryable,
        recovery: result.recovery,
        ...(result.credentialKind !== undefined
          ? { credentialKind: result.credentialKind }
          : {}),
        ...(result.hop !== undefined ? { hop: result.hop } : {}),
        ...(result.stage !== undefined ? { stage: result.stage } : {}),
        ...(result.diagnosis !== undefined
          ? { diagnosis: result.diagnosis }
          : {}),
      }
      if (result.recovery !== 'automatic') {
        // The retry loop is itself the automatic ladder. A failure that needs
        // the vault fixed, or a person to change something, must leave the loop
        // rather than run out its remaining attempts against the same cause.
        // Writing the verdict through `updateTerminalState` also carries the
        // credential kind to the pane.
        updateTerminalState(record, {
          status: 'error',
          sessionId: null,
          ...terminalFailureState(lastFailure),
          attempt,
        })
        return
      }
    }
    if (!this.isActive(record, generation)) return
    /*
     * F06 — the ladder is exhausted, so this verdict describes its *last* attempt.
     *
     * Every field comes from that attempt's failure, not from whichever attempt happened
     * to carry a hop. `recovery` stays `'automatic'`: the budget for this ladder is spent,
     * but `scheduleRecovery` may open another one, and the pane's "waiting to retry" is
     * still true.
     */
    updateTerminalState(record, {
      status: 'error',
      sessionId: null,
      ...terminalFailureState(lastFailure),
      // F10 — "the attempt that ended", republished by the snapshot as `attempts`.
      attempt,
    })
    this.scheduleRecovery(record)
  }

  private scheduleRecovery(record: TerminalRecord): void {
    scheduleReconnectRecovery(
      record,
      this.recoveryTimer,
      this.policy.recoveryDelayMs,
      () => this.launch(record, 'automatic', 'Retrying after automatic backoff'),
    )
  }

  private prepare(
    record: TerminalRecord,
    mode: NonNullable<TerminalRecord['reconnectMode']> | false,
  ): string | null {
    return prepareReconnectRecord(record, mode, this.dependencies)
  }

  private prepareIo(
    record: TerminalRecord,
    mode: NonNullable<TerminalRecord['reconnectMode']>,
  ): void {
    prepareReconnectIo(record, mode)
  }

  private isActive(record: TerminalRecord, generation: number): boolean {
    return (
      !record.closed &&
      record.generation === generation &&
      this.dependencies.isCurrent(record)
    )
  }
}
