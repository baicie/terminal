import { formatIpcError } from '@/hooks/terminal-session-helpers'
import { asCredentialFailure } from './credential-failure'
import { closeTerminalBackend } from './terminal-session-backend'
import type { TerminalSessionOutputBuffer } from './terminal-session-output-buffer'
import { updateTerminalState } from './terminal-session-state'
import type { TerminalRecord } from './terminal-session-manager-types'

export interface TerminalFailure {
  error: string
  retryable: boolean
  /**
   * Set when the failure came from the credential layer, so the UI can offer the
   * action that actually resolves it (create / unlock the vault, re-save the
   * credential) instead of a generic "retry".
   */
  credentialKind?: string
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
  // Fallbacks for errors that reach this classifier without the structured
  // wrapper — a record serialised before this change, or a path that still throws
  // a plain Error. These sentences are constants this repository owns, not input.
  'which is locked. unlock the vault',
  'no vault has been set up yet',
  'the vault could not be read',
  'this build cannot read',
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

/**
 * Credential failures that no amount of waiting fixes.
 *
 * These arrive as `CredentialFailure` from the launcher, so the decision is made
 * on the kind rather than on the message. A locked vault, an uninitialised vault
 * and a damaged reference all need the user to do something; retrying spends the
 * budget that a real network outage would need.
 */
const TERMINAL_CREDENTIAL_KINDS = new Set([
  'vault-locked',
  'vault-uninitialized',
  'vault-unusable',
  'credential-corrupt-reference',
  'credential-not-bound',
  'credential-missing',
])

export function classifyTerminalFailure(error: unknown): TerminalFailure {
  const credential = asCredentialFailure(error)
  if (credential !== null) {
    return {
      error: credential.message,
      credentialKind: credential.kind,
      // `credential-read-failed` is the one credential case that may be
      // transient — a decrypt can fail because the vault is being re-keyed under
      // us. It still does not climb the network ladder; the pane says what to
      // check rather than "waiting to retry".
      retryable:
        credential.kind === 'credential-read-failed' ||
        !TERMINAL_CREDENTIAL_KINDS.has(credential.kind),
    }
  }

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
    ...(failure.credentialKind !== undefined
      ? { credentialKind: failure.credentialKind }
      : {}),
  })
  return failure
}
