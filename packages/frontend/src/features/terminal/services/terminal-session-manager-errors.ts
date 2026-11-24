import { formatIpcError } from '@/hooks/terminal-session-helpers'
import { asCredentialFailure } from './credential-failure'
import { closeTerminalBackend } from './terminal-session-backend'
import type { TerminalSessionOutputBuffer } from './terminal-session-output-buffer'
import { updateTerminalState } from './terminal-session-state'
import type { TerminalRecord } from './terminal-session-manager-types'

import {
  HOPS,
  STAGES,
  readContext,
  type TerminalFailureHop,
  type TerminalFailureStage,
} from './terminal-failure-context'

export type { TerminalFailureHop, TerminalFailureStage } from './terminal-failure-context'

export interface TerminalFailure {
  error: string
  retryable: boolean
  /**
   * What a retry would take, which is not always "wait".
   *
   * One boolean could not say this. "Automatic" means the recovery ladder may
   * run on its own; "manual" means a person must change something first; and
   * "after-vault" means the retry only becomes meaningful once the vault is
   * fixed. Collapsing the last two into `retryable: true` is what put a locked
   * vault on the same five-attempt backoff as a dropped network.
   */
  recovery: TerminalFailureRecovery
  /**
   * Set when the failure came from the credential layer, so the UI can offer the
   * action that actually resolves it (create / unlock the vault, re-save the
   * credential) instead of a generic "retry".
   */
  credentialKind?: string
  /**
   * SSH10: which leg of a jump chain failed. Absent for a direct connection — and absent
   * is **not** "the target failed". Never consulted for retry: that is decided by `kind`.
   */
  hop?: TerminalFailureHop
  /** SSH10: where in the connection sequence it failed. Same rules as `hop`. */
  stage?: TerminalFailureStage
}

/** The three ways a failed connection can become a working one. */
export type TerminalFailureRecovery =
  /** Transient: the session manager may retry without asking. */
  | 'automatic'
  /** The user must change something (credentials, host, key) before retrying. */
  | 'manual'
  /** Blocked on the vault; retry is meaningful only once the vault is usable. */
  | 'after-vault'

const NON_RETRYABLE_KINDS = new Set([
  'authentication_failed',
  // The server evaluated the credential and refused it. Retrying resends a secret it
  // has already rejected; the user has to change something.
  'authentication_rejected',
  // `known_hosts` disagrees with the server. Nothing about a retry can fix that.
  'host_key_rejected',
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
/**
 * Authentication failures that are really *local environment* failures.
 *
 * Every entry is produced by this application's own SSH-agent code, never echoed from a
 * server, so a credential rejection cannot accidentally match one. See the comment in
 * `classifyTerminalFailure` for why the list had to shrink.
 */
/** Transient conditions that can occur before a credential is ever presented. */
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

const TRANSIENT_AGENT_FAILURES = [
  'failed to connect ssh agent',
  'agent auth failed',
  'ssh agent has no available identities',
  'windows openssh authentication agent is unavailable',
]

/**
 * Credential failures and what a retry would take.
 *
 * These arrive as `CredentialFailure` from the launcher, so the decision is made
 * on the kind rather than on the message. None of them may spend the automatic
 * reconnect budget: waiting cannot unlock a vault, create one, or repair a
 * reference, and the budget is then unavailable for the network outage that might
 * genuinely follow.
 *
 * They are not all the same situation, though. A vault problem is fixed on the
 * Vaults page and the connection becomes worth retrying immediately afterwards;
 * a damaged reference or an unbound key path needs the host edited first.
 */
const CREDENTIAL_RECOVERY: Record<string, TerminalFailureRecovery> = {
  'vault-locked': 'after-vault',
  'vault-uninitialized': 'after-vault',
  'vault-unusable': 'after-vault',
  // A decrypt that failed is retried by unlocking or repairing the vault, not by
  // reconnecting. It used to be the one credential kind treated as transient,
  // which is how a vault failure reached the network retry loop.
  'credential-read-failed': 'after-vault',
  'credential-corrupt-reference': 'manual',
  'credential-not-bound': 'manual',
  'credential-missing': 'manual',
}

export function classifyTerminalFailure(error: unknown): TerminalFailure {
  const credential = asCredentialFailure(error)
  if (credential !== null) {
    const recovery = CREDENTIAL_RECOVERY[credential.kind] ?? 'manual'
    return {
      error: credential.message,
      credentialKind: credential.kind,
      recovery,
      // False for every credential kind, including `after-vault`. The pane reads
      // this as "the manager is still trying on its own" and renders "waiting to
      // retry"; nothing is retrying, and the user's next step is on the Vaults
      // page. `recovery` is what carries the difference between "fix the vault
      // and retry" and "edit the host first".
      retryable: false,
    }
  }

  const formatted = formatIpcError(error)
  const record =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : undefined
  const kind = record?.type ?? record?.kind
  // SSH10: read from the raw IPC object — below this point everything is a sentence.
  const hop = readContext(record?.hop, HOPS)
  const stage = readContext(record?.stage, STAGES)
  const normalized = formatted.toLowerCase()
  /*
   * ## A rejected credential is terminal; a broken path to the server is not
   *
   * `authentication_failed` used to be retried whenever the message contained a
   * transient-looking word. Measured: `"authentication failed: password
   * my-timeout-secret rejected"` → `retryable = true`, so a refused password was resent
   * five times with the whole backoff. The rule cannot be fixed lexically — the message
   * carries the server's own words. What separates the two is *where* it happened, which
   * Rust already distinguishes: transport/handshake/agent problems surface as
   * `connection_failed`; only the credential check itself produces
   * `authentication_failed`. One narrow exception remains, because the product depends on
   * it: an unreachable SSH **agent** is a local problem a retry may genuinely fix, and
   * that shape is identifiable by its own wording.
   */
  /*
   * ## Why "rejected" wins over "timeout"
   *
   * A first-connection timeout during auth is transient and must keep retrying (pinned by
   * `keeps the automatic reconnect for a first-connection timeout`). A credential the
   * server *refused* is not, even when the sentence also mentions a transient word — the
   * server can only refuse after the connection succeeded, which makes "refused" the
   * stronger signal in the same sentence.
   */
  /*
   * ## Two signals, not one phrase
   *
   * A single substring cannot carry this: `"password my-timeout-secret rejected"` puts the
   * credential between the noun and the verb, and `"connection refused"` reuses the verb
   * for transport. So a refusal is recognised by a verb of refusal anywhere in a message
   * whose subject is the credential.
   */
  /*
   * `\b` matters: without it "auth" would match inside "author". Written with the
   * escape spelled out because a heredoc once turned it into a literal backspace and
   * the rule silently stopped matching anything.
   */
  /*
   * ## What this classifier can and cannot tell apart
   *
   * `authentication_failed` covers two situations the frontend cannot separate by
   * wording:
   *
   *   * the connection died during the handshake — nothing was authenticated, and a
   *     retry is the right move (`auth failed: connection reset by peer` is pinned by
   *     `terminal-session-manager-reconnect.test.ts`);
   *   * the server checked the key and refused it — a retry resends a secret it already
   *     rejected.
   *
   * Rust emits the same `kind` for both (`SessionError::AuthenticationFailed`), so a
   * lexical rule is all that is available here. An attempt to separate them by "the
   * sentence names a credential and a refusal" was reverted after it broke the
   * connection-reset case: the two sentences share every word class.
   *
   * The honest position is that this list is a heuristic. The structural fix — a
   * distinct kind for "transport failed before authentication" — belongs in the Rust
   * error enum, not in a string match. Recorded as the remaining gap.
   */
  /*
   * The structural fix this module used to ask for: Rust now distinguishes
   * `authentication_rejected` (terminal — the server refused the credential),
   * `authentication_transport_failed` (retry — nothing was decided about it) and
   * `host_key_rejected` (terminal, about `known_hosts`). `authentication_failed`
   * remains for caller errors (no method supplied). The wording heuristics below
   * therefore only describe *legacy* errors; new ones are classified by structure.
   */
  const transportAuthenticationFailure = kind === 'authentication_transport_failed'

  const transientAuthenticationFailure =
    transportAuthenticationFailure ||
    (kind === 'authentication_failed' &&
      (TRANSIENT_AGENT_FAILURES.some(message => normalized.includes(message)) ||
        TRANSIENT_AUTHENTICATION_MESSAGES.some(message =>
          normalized.includes(message),
        )))
  const retryable =
    transientAuthenticationFailure ||
    (!(typeof kind === 'string' && NON_RETRYABLE_KINDS.has(kind)) &&
      !NON_RETRYABLE_MESSAGES.some(message => normalized.includes(message)))
  return {
    error: formatted,
    retryable,
    // Everything that reaches here without a credential kind is a transport or
    // protocol failure. The ones that retry are the transient network cases the
    // ladder exists for; the ones that do not need the user to act.
    recovery: retryable ? 'automatic' : 'manual',
    // SSH10: carried through, never consulted. `retryable` above is decided by `kind`
    // alone, so a bastion and a target refusal retry identically — correct, because both
    // mean "the server said no, stop".
    ...(hop ? { hop } : {}),
    ...(stage ? { stage } : {}),
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
    recovery: failure.recovery,
    ...(failure.credentialKind !== undefined
      ? { credentialKind: failure.credentialKind }
      : {}),
  })
  return failure
}

