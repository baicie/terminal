/**
 * A credential failure that carries *why* it failed.
 *
 * The resolver already distinguishes a locked vault from a corrupt reference from
 * a failed decrypt. That distinction was being flattened: `terminal-launcher`
 * threw `new Error(message)` and the session classifier could only look at the
 * text. Text matching is how "the vault is locked" ended up classified as a
 * transient network error and spent the reconnect budget.
 *
 * So the reason travels as data. `classifyTerminalFailure` reads `kind` first and
 * only falls back to message matching for errors that arrive from outside this
 * process (Rust IPC), where the structure is whatever the command returned.
 */

import type { CredentialResolutionFailure } from '@/service/credential-boundary'

/**
 * The stable kinds a credential failure can have.
 *
 * These are the resolver's own reasons, not a new vocabulary: adding one here
 * means the resolver can produce it, which keeps the two from drifting.
 */
export type CredentialFailureKind =
  | 'vault-locked'
  | 'vault-uninitialized'
  | 'vault-unusable'
  | 'credential-read-failed'
  | 'credential-corrupt-reference'
  | 'credential-not-bound'
  | 'credential-missing'

export class CredentialFailure extends Error {
  readonly kind: CredentialFailureKind
  /** The resolver reason this came from, when there was one. */
  readonly reason: CredentialResolutionFailure['reason'] | null

  constructor(
    kind: CredentialFailureKind,
    message: string,
    options: {
      reason?: CredentialResolutionFailure['reason'] | null
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'CredentialFailure'
    this.kind = kind
    this.reason = options.reason ?? null
    if (options.cause !== undefined) this.cause = options.cause
  }
}

/** Narrow an unknown error to a credential failure, if it is one. */
export function asCredentialFailure(error: unknown): CredentialFailure | null {
  if (error instanceof CredentialFailure) return error
  // Cross-realm errors (a module loaded twice) lose the prototype but keep the
  // own properties this checks for.
  if (
    error !== null &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'CredentialFailure' &&
    typeof (error as { kind?: unknown }).kind === 'string'
  ) {
    return error as CredentialFailure
  }
  return null
}

/**
 * Map a resolver failure onto the stable kind the classifier uses.
 *
 * `vault-unavailable` is one reason but three situations with three different
 * next steps (create / unlock / check the vault), so the message the resolver
 * already produced is what distinguishes them — and that message is a constant
 * this repository owns, not user input.
 */
export function credentialFailureFrom(
  failure: CredentialResolutionFailure,
): CredentialFailure {
  switch (failure.reason) {
    case 'vault-unavailable': {
      const kind: CredentialFailureKind = failure.message.includes(
        'no vault has been set up',
      )
        ? 'vault-uninitialized'
        : failure.message.includes('could not be read')
          ? 'vault-unusable'
          : 'vault-locked'
      return new CredentialFailure(kind, failure.message, {
        reason: failure.reason,
      })
    }
    case 'read-failed':
      return new CredentialFailure('credential-read-failed', failure.message, {
        reason: failure.reason,
        cause: failure.cause ?? undefined,
      })
    case 'corrupt-reference':
      return new CredentialFailure(
        'credential-corrupt-reference',
        failure.message,
        { reason: failure.reason },
      )
  }
}
