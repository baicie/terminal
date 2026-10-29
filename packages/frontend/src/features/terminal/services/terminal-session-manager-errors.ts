import { formatIpcError } from '@/hooks/terminal-session-helpers'
import { closeTerminalBackend } from './terminal-session-backend'
import type { TerminalSessionOutputBuffer } from './terminal-session-output-buffer'
import { updateTerminalState } from './terminal-session-state'
import type { TerminalRecord } from './terminal-session-manager-types'

export interface TerminalFailure {
  error: string
  retryable: boolean
}

const NON_RETRYABLE_KINDS = new Set([
  'authentication_failed',
  'connection_cancelled',
  'invalid_input',
  'key_parse_failed',
  'certificate_parse_failed',
])

const NON_RETRYABLE_MESSAGES = [
  'authentication failed',
  'credentials rejected',
  'host key verification failed',
  'host key changed',
  'known_hosts',
  'key parse failed',
  'certificate parse failed',
  'frontend output ack timed out',
  'terminal output queue exceeded',
  'terminal output byte count does not match',
  'xterm rejected terminal output',
  'terminal input queue exceeded',
]

// russh reports a transport failure that happens during authentication as
// `authentication_failed`, even when the credentials were never evaluated.
// Keep credential and host-key failures terminal, but let a transient network
// boundary (VPN/cellular switch, route black hole, or a sleeping host) retry.
const TRANSIENT_AUTHENTICATION_MESSAGES = [
  'timed out',
  'timeout',
  'connection reset',
  'connection refused',
  'connection aborted',
  'connection closed',
  'network is unreachable',
  'no route to host',
  'broken pipe',
  'transport closed',
]

export function classifyTerminalFailure(error: unknown): TerminalFailure {
  const formatted = formatIpcError(error)
  const record =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : undefined
  const kind = record?.type ?? record?.kind
  const normalized = formatted.toLowerCase()
  const transientAuthenticationFailure =
    kind === 'authentication_failed' &&
    TRANSIENT_AUTHENTICATION_MESSAGES.some(message =>
      normalized.includes(message),
    )
  return {
    error: formatted,
    retryable:
      transientAuthenticationFailure ||
      (!(typeof kind === 'string' && NON_RETRYABLE_KINDS.has(kind)) &&
        !NON_RETRYABLE_MESSAGES.some(message => normalized.includes(message))),
  }
}

export function handleTerminalIoError(
  record: TerminalRecord | undefined,
  error: unknown,
  sessionToTab: Map<string, string>,
  pendingOutput: TerminalSessionOutputBuffer,
  preserveAudienceOutput = false,
  failure = classifyTerminalFailure(error),
): TerminalFailure {
  if (!record || record.closed) return failure
  record.generation++
  const sessionId = record.sessionId
  record.sessionId = null
  record.io.disconnect()
  if (sessionId) {
    sessionToTab.delete(sessionId)
    pendingOutput.retire(sessionId)
    if (!preserveAudienceOutput) record.audience.retire(sessionId)
    void closeTerminalBackend(record.request.tabType, sessionId)
  }
  updateTerminalState(record, {
    status: 'error',
    sessionId: null,
    error: failure.error,
    retryable: failure.retryable,
  })
  return failure
}
