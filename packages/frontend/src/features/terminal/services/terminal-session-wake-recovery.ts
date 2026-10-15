import type { TerminalRecord } from './terminal-session-manager-types'

/**
 * Tracks host sleep/wake recovery for remote sessions.
 *
 * Sleeping suspends timers and tears down the socket, so an automatic
 * reconnect normally spends its whole attempt budget against a dead network
 * and then rests in a state no further I/O event will re-arm. There are two
 * distinct shapes to recover from, and both need an explicit wake signal:
 *
 * - The attempt already failed, leaving a retryable error. `canResume` allows
 *   a restart of that attempt budget.
 * - The attempt was still in flight when the wake arrived, so it fails a moment
 *   later with no sessionId and the ordinary I/O-error path never calls back.
 *   `armAfterWake` records the wake so that next failure spends a fresh budget.
 *
 * Only a session with an attempt actually in flight may be armed. A healthy
 * connected session has no attempt that will ever end, so nothing would clear
 * its arming, and it would sit armed until some unrelated failure much later
 * consumed a wake budget it never earned.
 */
export class TerminalSessionWakeRecovery {
  private readonly wakeArmed = new WeakSet<TerminalRecord>()

  canResume(record: TerminalRecord): boolean {
    return (
      !record.closed &&
      record.request.tabType === 'remote' &&
      !record.reconnectPromise &&
      record.reconnectMode !== 'manual' &&
      record.status === 'error' &&
      record.retryable === true
    )
  }

  armAfterWake(record: TerminalRecord): void {
    if (
      record.closed ||
      record.request.tabType !== 'remote' ||
      record.reconnectMode === 'manual' ||
      (record.status !== 'connecting' && record.status !== 'reconnecting')
    ) {
      return
    }
    this.wakeArmed.add(record)
  }

  consumeWakeArming(record: TerminalRecord): boolean {
    return this.wakeArmed.delete(record)
  }

  clearWakeArming(record: TerminalRecord): void {
    this.wakeArmed.delete(record)
  }
}
