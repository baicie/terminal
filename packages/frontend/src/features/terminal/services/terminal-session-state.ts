import {
  getTerminalSnapshot,
  type TerminalRecord,
  type TerminalSessionSnapshot,
} from './terminal-session-manager-types'

/**
 * A state the session has left behind: it is not waiting on a user decision any
 * more, so whatever classified failure explained it is stale.
 *
 * `connected` and `connecting` mean the connection works or is being retried by
 * the ladder; `disconnected` and `idle` are deliberate ends. Keeping a
 * `credentialKind` from a previous attempt across any of them makes the pane offer
 * "Unlock the vault" for a session that is already connected — a stale diagnosis
 * is worse than none, because the action it offers leads somewhere wrong.
 */
function leavesFailureBehind(status: TerminalSessionSnapshot['status']): boolean {
  return status !== 'error' && status !== 'reconnecting'
}

export function updateTerminalState(
  record: TerminalRecord,
  next: Partial<TerminalSessionSnapshot>,
): void {
  if (next.sessionId !== undefined) record.sessionId = next.sessionId
  if (next.status !== undefined) record.status = next.status
  if (next.error !== undefined) record.error = next.error
  if (next.status === 'reconnecting') {
    record.reconnectAttempt = next.attempt ?? null
    record.reconnectReason = next.reason ?? null
    record.reconnectNextRetryAt = next.nextRetryAt ?? null
  } else if (next.status !== undefined) {
    record.reconnectAttempt = null
    record.reconnectReason = null
    record.reconnectNextRetryAt = null
  }
  if (next.retryable !== undefined) record.retryable = next.retryable
  if (next.recovery !== undefined) record.recovery = next.recovery
  if (next.credentialKind !== undefined) {
    record.credentialKind = next.credentialKind
  } else if (next.status === 'error' || next.status === 'reconnecting') {
    // A new failure with no credential kind is not a credential failure at all:
    // a network drop that follows a vault error must not keep offering "Unlock
    // the vault" for the drop. Each failure states its own cause or none.
    record.credentialKind = null
  }
  if (next.status !== undefined && leavesFailureBehind(next.status)) {
    // A retryable flag with no failure behind it keeps advertising a recovery
    // nothing is going to perform. Cleared here rather than at each call site.
    record.retryable = null
    record.recovery = null
    record.credentialKind = null
  }
  const snapshot = getTerminalSnapshot(record)
  record.audience.publishState(snapshot)
}

export function markTerminalTerminated(
  record: TerminalRecord,
  message: string,
): void {
  record.sessionId = null
  record.io.disconnect()
  record.audience.enqueue({ data: message })
  updateTerminalState(record, { status: 'disconnected', sessionId: null })
}
