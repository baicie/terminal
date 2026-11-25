// F06 — the record transitions a reconnect owns, lifted out of the class.
//
// `terminal-session-manager-reconnect.ts` was over its 300-line limit once the exhausted
// ladder started publishing the full failure context. These three helpers are the ones
// that do not need `this`: they take the record and the dependencies they use. Moving
// them keeps the class about the loop and the file inside its limit without deleting any
// of the comments that explain why the loop behaves as it does.

import type { TerminalRecord } from './terminal-session-manager-types'
import type { TerminalReconnectDependencies } from './terminal-session-reconnect-types'

/**
 * Retire the session a reconnect is replacing and return it for the caller to close.
 *
 * `mode` decides whether the output path is prepared: a manual retry and an automatic
 * ladder drain the audience differently, and doing it here keeps the two call sites (the
 * ladder's first attempt and `disconnect`) from drifting apart.
 */
export function prepareReconnectRecord(
  record: TerminalRecord,
  mode: NonNullable<TerminalRecord['reconnectMode']> | false,
  dependencies: Pick<
    TerminalReconnectDependencies,
    'sessionToTab' | 'pendingOutput' | 'retireLifecycle'
  >,
): string | null {
  const sessionId = record.sessionId
  record.sessionId = null
  if (mode) {
    record.audience.retireAll()
    prepareReconnectIo(record, mode)
  }
  if (!sessionId) return null
  dependencies.sessionToTab.delete(sessionId)
  dependencies.pendingOutput.retire(sessionId)
  dependencies.retireLifecycle(sessionId)
  record.audience.retire(sessionId)
  return sessionId
}

export function prepareReconnectIo(
  record: TerminalRecord,
  mode: NonNullable<TerminalRecord['reconnectMode']>,
): void {
  if (mode === 'automatic') record.io.prepareForAutomaticReconnect()
  else record.io.prepareForReconnect()
}

/**
 * Reopen the ladder after `recoveryDelayMs`, when the product's rules still allow it.
 *
 * F06: "exhausted" ends *this* ladder, not the product's willingness to try again — so
 * this timer exists and must keep existing. What it must not do is fire against a record
 * that moved on: the checks run twice, once when scheduling and once when firing, because
 * a session can connect, be closed, or start another reconnection during the wait.
 */
export function scheduleReconnectRecovery(
  record: TerminalRecord,
  timer: { schedule: (record: TerminalRecord, delayMs: number, cb: () => void) => void },
  delayMs: number,
  relaunch: () => void,
): void {
  if (
    record.closed ||
    record.request.tabType !== 'remote' ||
    record.retryable !== true
  ) {
    return
  }
  timer.schedule(record, delayMs, () => {
    if (
      record.closed ||
      record.status !== 'error' ||
      record.retryable !== true ||
      record.reconnectPromise
    ) {
      return
    }
    relaunch()
  })
}
