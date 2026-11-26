import { closeTerminalBackend } from './terminal-session-backend'
import {
  TerminalReconnectPolicyHolder,
  type ResolvedReconnectPolicy,
} from './terminal-reconnect-policy-holder'
import type {
  TerminalReconnectDependencies,
  TerminalReconnectOptions,
} from './terminal-session-reconnect-types'
import { updateTerminalState } from './terminal-session-state'
import { TerminalSessionRecoveryTimer } from './terminal-session-recovery-timer'
import {
  prepareReconnectIo,
  prepareReconnectRecord,
  scheduleReconnectRecovery,
} from './terminal-session-reconnect-prepare'
import { runReconnectLadder } from './terminal-session-reconnect-ladder'
import { TerminalSessionWakeRecovery } from './terminal-session-wake-recovery'
import type { TerminalRecord } from './terminal-session-manager-types'

export type {
  TerminalReconnectDependencies,
  TerminalReconnectOptions,
  TerminalReconnectStartResult,
} from './terminal-session-reconnect-types'
export type { ResolvedReconnectPolicy } from './terminal-reconnect-policy-holder'

export class TerminalSessionReconnect {
  /*
   * F13 — the policy is replaceable, because it is a *user* setting.
   *
   * It was `readonly` while the only way to shape it was the constructor, and the shipped
   * singleton never passed one (`new TerminalSessionManager()`), so every custom value a
   * test could name was unreachable from the real backend. A reconnect policy the user can
   * change is only meaningful if the change reaches the ladder that runs; storing it once
   * at construction makes the answer "no".
   *
   * Replacement takes effect on the **next** ladder rung: a ladder already walking reads
   * `this.policies.get()` fresh each time, so a mid-ladder change is honoured from the
   * attempt after the one in flight. That is deliberately not a restart — cancelling and
   * relaunching on a settings write would make changing a preference drop a live attempt.
   */
  private readonly policies: TerminalReconnectPolicyHolder
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
    this.policies = new TerminalReconnectPolicyHolder(options)
  }

  /**
   * The policy the ladder is actually walking, with the same normalisation the run
   * applies — so a caller comparing "what I configured" to "what runs" sees the resolved
   * numbers rather than its own input echoed back.
   */
  reconnectPolicy(): ResolvedReconnectPolicy {
    return this.policies.get()
  }

  /**
   * Replace the policy for every ladder started from here on.
   *
   * `undefined` values fall back to the defaults through `resolveReconnectPolicy`, which
   * is the same normalisation the constructor uses; passing nothing therefore restores the
   * shipped behaviour rather than leaving the previous custom value in place.
   */
  setReconnectPolicy(options: TerminalReconnectOptions = {}): void {
    this.policies.set(options)
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
    /*
     * Read once, at the top of the ladder, from the holder rather than a field copied at
     * construction. A change made before this line reaches this ladder; one made after it
     * applies to the next. That is the guarantee worth stating: a ladder is a unit of work
     * with one budget, and letting its attempt count change halfway through would make the
     * number it finally reports depend on when a settings write landed.
     */
    const policy = this.policies.get()
    const sessionId = this.prepare(record, mode)
    await runReconnectLadder({
      record,
      mode,
      reason,
      signal,
      generation,
      policy,
      dependencies: {
        start: (target, attemptGeneration, attemptSignal) =>
          this.dependencies.start(target, attemptGeneration, attemptSignal),
        isActive: (target, attemptGeneration) =>
          this.isActive(target, attemptGeneration),
        prepareIo: target => this.prepareIo(target, mode),
        initialSessionId: sessionId,
        armRecovery: ladderPolicy => this.armRecovery(record, ladderPolicy),
      },
    })
  }

  /**
   * Arm the timer that opens the next ladder after a backoff.
   *
   * Extracted because two paths end an automatic ladder the same way (the last attempt
   * exhausted, and a sleep that failed), and a policy change must reach both. A copy per
   * call site is how one of them ends up reading a stale `recoveryDelayMs`.
   */
  private armRecovery(
    record: TerminalRecord,
    policy: ResolvedReconnectPolicy,
  ): void {
    scheduleReconnectRecovery(
      record,
      this.recoveryTimer,
      policy.recoveryDelayMs,
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
