/**
 * The tables `classifyTerminalFailure` decides from.
 *
 * Its own module because they are pure data with no behaviour: keeping them next to the
 * function that reads them pushed that file past the 300-line limit, and a size limit
 * invites deleting the comments that explain why each entry exists — which are the most
 * valuable part of this file.
 *
 * Nothing here decides anything. The classifier in `terminal-session-manager-errors.ts`
 * is the only reader, and the structural kinds (SSH05/SSH06) are checked before any of
 * these lists are consulted, so these are the *legacy* rules plus the non-retryable
 * escape hatches.
 */

import type { TerminalFailureRecovery } from './terminal-session-manager-errors'

/** Kinds that must never be retried automatically. */
export const NON_RETRYABLE_KINDS = new Set([
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

export const NON_RETRYABLE_MESSAGES = [
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
export const TRANSIENT_AUTHENTICATION_MESSAGES = [
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

export const TRANSIENT_AGENT_FAILURES = [
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
export const CREDENTIAL_RECOVERY: Record<string, TerminalFailureRecovery> = {
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
