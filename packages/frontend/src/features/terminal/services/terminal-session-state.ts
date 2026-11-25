import {
  getTerminalSnapshot,
  type TerminalRecord,
  type TerminalSessionSnapshot,
} from './terminal-session-manager-types'
import type { TerminalFailure } from './terminal-session-manager-errors'

/**
 * F06 — the record fields a classified failure sets, in one place.
 *
 * Three paths publish a classified failure (the first connection, the non-automatic end
 * of a retry, and an exhausted ladder) and they must agree on which fields travel with
 * it. The exhausted ladder was the one that did not: it wrote `error` alone, so a jump
 * connection that used up its budget lost the hop the classifier had already resolved.
 *
 * Optional fields are spread only when present — that is what lets `updateTerminalState`
 * clear an older hop instead of inheriting a claim about a machine this attempt never
 * reached.
 */
export function terminalFailureState(
  failure: TerminalFailure,
): Partial<TerminalSessionSnapshot> {
  return {
    error: failure.error,
    retryable: failure.retryable,
    recovery: failure.recovery,
    ...(failure.credentialKind !== undefined
      ? { credentialKind: failure.credentialKind }
      : {}),
    ...(failure.hop !== undefined ? { hop: failure.hop } : {}),
    ...(failure.stage !== undefined ? { stage: failure.stage } : {}),
    ...(failure.diagnosis !== undefined ? { diagnosis: failure.diagnosis } : {}),
  }
}

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
  /*
   * SSH10 — the same rule for the connection context, and for the same reason.
   *
   * A direct failure that follows a bastion failure must not inherit `hop: 'bastion'`:
   * the pane would tell the user to check a bastion account on a connection that has no
   * bastion. Each failure states its own context or none.
   */
  if (next.hop !== undefined) {
    record.hop = next.hop
  } else if (next.status === 'error' || next.status === 'reconnecting') {
    record.hop = null
  }
  if (next.stage !== undefined) {
    record.stage = next.stage
  } else if (next.status === 'error' || next.status === 'reconnecting') {
    record.stage = null
  }
  /*
   * SSH11 — same rule once more. A diagnosis is a claim about *which machine* refused;
   * inheriting "check the bastion's account" onto a failure that has no bastion would
   * send the user to the wrong machine, which is worse than saying nothing.
   */
  if (next.diagnosis !== undefined) {
    record.diagnosis = next.diagnosis
  } else if (next.status === 'error' || next.status === 'reconnecting') {
    record.diagnosis = null
  }
  if (next.status !== undefined && leavesFailureBehind(next.status)) {
    // A retryable flag with no failure behind it keeps advertising a recovery
    // nothing is going to perform. Cleared here rather than at each call site.
    record.retryable = null
    record.recovery = null
    record.credentialKind = null
    record.hop = null
    record.stage = null
    record.diagnosis = null
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
