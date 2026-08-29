import {
  getTerminalSnapshot,
  type TerminalRecord,
  type TerminalSessionSnapshot,
} from './terminal-session-manager-types'

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
  else if (
    next.status !== undefined &&
    next.status !== 'error' &&
    next.status !== 'reconnecting'
  ) {
    record.retryable = null
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
