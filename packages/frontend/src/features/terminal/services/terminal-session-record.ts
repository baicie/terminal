import { TerminalSessionIo } from './terminal-session-io'
import type {
  TerminalRecord,
  TerminalSessionRequest,
} from './terminal-session-manager-types'
import { TerminalSessionAudience } from './terminal-session-output-buffer'

interface TerminalRecordCallbacks {
  acknowledgeOutput: (sessionId: string, bytes: number) => void
  handleIoError: (error: unknown) => void
}

export function createTerminalRecord(
  request: TerminalSessionRequest,
  requestKey: string,
  callbacks: TerminalRecordCallbacks,
): TerminalRecord {
  return {
    request,
    requestKey,
    sessionId: null,
    status: 'idle',
    error: null,
    audience: new TerminalSessionAudience(callbacks.acknowledgeOutput),
    io: new TerminalSessionIo(
      request.tabType,
      { cols: request.cols, rows: request.rows },
      callbacks.handleIoError,
    ),
    generation: 0,
    startPromise: null,
    reconnectPromise: null,
    reconnectMode: null,
    reconnectAttempt: null,
    reconnectReason: null,
    reconnectNextRetryAt: null,
    retryable: null,
    closed: false,
  }
}
