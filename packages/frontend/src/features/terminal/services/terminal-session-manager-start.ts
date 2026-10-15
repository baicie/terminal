import { closeTerminalBackend } from './terminal-session-backend'
import type { TerminalSessionEvents } from './terminal-session-events'
import { classifyTerminalFailure } from './terminal-session-manager-errors'
import type { TerminalSessionLifecycle } from './terminal-session-lifecycle-buffer'
import type { TerminalSessionOutputBuffer } from './terminal-session-output-buffer'
import type {
  TerminalSessionReconnect,
  TerminalReconnectStartResult,
} from './terminal-session-manager-reconnect'
import { startTerminalShell } from './terminal-launcher'
import { updateTerminalState } from './terminal-session-state'
import type { TerminalRecord } from './terminal-session-manager-types'

interface StartDependencies {
  events: TerminalSessionEvents
  records: Map<string, TerminalRecord>
  sessionToTab: Map<string, string>
  pendingOutput: TerminalSessionOutputBuffer
  lifecycle: TerminalSessionLifecycle
  reconnects: TerminalSessionReconnect
  flushPendingOutput: (record: TerminalRecord, sessionId: string) => void
}

export async function startTerminalSession(
  dependencies: StartDependencies,
  record: TerminalRecord,
  generation: number,
): Promise<TerminalReconnectStartResult> {
  if (record.status !== 'reconnecting') {
    updateTerminalState(record, { status: 'connecting', error: null })
  }
  const connectionAttemptId =
    record.request.tabType === 'remote' ? createConnectionAttemptId() : null
  record.connectionAttemptId = connectionAttemptId
  try {
    await dependencies.events.ensure(record.request.tabType)
    if (
      record.closed ||
      record.generation !== generation ||
      dependencies.records.get(record.request.tabId) !== record
    ) {
      return 'cancelled'
    }
    const { cols, rows } = record.io.size
    const sessionId = connectionAttemptId
      ? await startTerminalShell(
          record.request.tabType,
          record.request.host,
          record.request.serialSessionId,
          cols,
          rows,
          record.request.jumpHost,
          record.request.expectedHostKey,
          record.request.expectedJumpHostKey,
          connectionAttemptId,
        )
      : await startTerminalShell(
          record.request.tabType,
          record.request.host,
          record.request.serialSessionId,
          cols,
          rows,
          record.request.jumpHost,
          record.request.expectedHostKey,
          record.request.expectedJumpHostKey,
        )
    if (
      record.closed ||
      record.generation !== generation ||
      dependencies.records.get(record.request.tabId) !== record
    ) {
      dependencies.pendingOutput.retire(sessionId)
      dependencies.lifecycle.retire(sessionId)
      await closeTerminalBackend(record.request.tabType, sessionId)
      return 'cancelled'
    }
    record.sessionId = sessionId
    dependencies.pendingOutput.activate(sessionId)
    dependencies.lifecycle.activate(sessionId)
    dependencies.sessionToTab.set(sessionId, record.request.tabId)
    const pendingLifecycle = dependencies.lifecycle.take(sessionId)
    if (pendingLifecycle) {
      dependencies.flushPendingOutput(record, sessionId)
      dependencies.lifecycle.apply(sessionId, pendingLifecycle)
      if (pendingLifecycle.kind === 'close') {
        dependencies.reconnects.automatic(
          record,
          'SSH connection closed unexpectedly',
        )
      }
      if (pendingLifecycle.kind === 'exit') return 'cancelled'
      const failure = classifyTerminalFailure(pendingLifecycle.message)
      return { status: 'failed', ...failure }
    }
    record.io.connect(sessionId)
    updateTerminalState(record, { status: 'connected', sessionId })
    dependencies.flushPendingOutput(record, sessionId)
    return 'connected'
  } catch (error) {
    if (record.closed || record.generation !== generation) return 'cancelled'
    record.io.disconnect()
    const failure = classifyTerminalFailure(error)
    // An attempt that was suspended by host sleep fails without a sessionId, so
    // the ordinary I/O-error path cannot re-arm it. If a wake arrived while it
    // was still in flight, spend a fresh attempt budget now.
    if (
      failure.retryable &&
      dependencies.reconnects.consumeWakeArming(record)
    ) {
      if (record.reconnectMode) {
        return { status: 'retry', error: failure.error }
      }
      dependencies.reconnects.automatic(record, failure.error)
      return 'cancelled'
    }
    if (!record.reconnectMode) {
      if (failure.retryable && record.request.tabType === 'remote') {
        // The very first connection is not covered by the I/O-error path: that
        // path requires a live sessionId, and a connection that never came up
        // has none. Reporting the error alone therefore left the pane dead
        // until a browser wake event or a manual reconnect press, which is
        // exactly the case where a transient network blip should have been
        // ridden out on its own. Spend the automatic attempt budget instead.
        dependencies.reconnects.automatic(record, failure.error)
        return 'cancelled'
      }
      updateTerminalState(record, {
        status: 'error',
        sessionId: null,
        ...failure,
      })
    }
    return { status: 'failed', ...failure }
  } finally {
    // The arming belongs to this attempt only. Whether it connected or failed,
    // leaving it set would make a much later unrelated failure look like wake
    // recovery and trigger a reconnect the user never asked for.
    dependencies.reconnects.clearWakeArming(record)
    if (record.connectionAttemptId === connectionAttemptId) {
      record.connectionAttemptId = null
    }
  }
}

let connectionAttemptSequence = 0

function createConnectionAttemptId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  if (randomUuid) return `terminal-attempt-${randomUuid}`
  connectionAttemptSequence += 1
  return `terminal-attempt-${Date.now()}-${connectionAttemptSequence}`
}
