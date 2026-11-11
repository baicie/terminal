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
  /** Which vault situation caused it, when the provider could say. */
  readonly vaultState: 'uninitialized' | 'locked' | 'unusable' | null

  constructor(
    kind: CredentialFailureKind,
    message: string,
    options: {
      reason?: CredentialResolutionFailure['reason'] | null
      vaultState?: 'uninitialized' | 'locked' | 'unusable' | null
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'CredentialFailure'
    this.kind = kind
    this.reason = options.reason ?? null
    this.vaultState = options.vaultState ?? null
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
 * The vault branch reads `state`, which the provider reports structurally. It
 * used to recover the state from the message with `includes('no vault has been
 * set up')` — a string match on English text, which is precisely the failure this
 * module exists to stop. `unusable` is the honest answer for a provider that
 * cannot say why it is unavailable: we know the vault cannot be read.
 */
export function credentialFailureFrom(
  failure: CredentialResolutionFailure,
): CredentialFailure {
  switch (failure.reason) {
    case 'vault-unavailable': {
      // No message matching decides this. When the provider reports a state it is
      // used as-is; when it cannot, `unusable` is the honest answer, because we
      // know the vault cannot be read and not why. Defaulting to `locked` would
      // send the user to an unlock prompt that does not address the problem.
      const kind: CredentialFailureKind =
        failure.state === 'uninitialized'
          ? 'vault-uninitialized'
          : failure.state === 'locked'
            ? 'vault-locked'
            : 'vault-unusable'
      return new CredentialFailure(kind, failure.message, {
        reason: failure.reason,
        ...(failure.state === undefined ? {} : { vaultState: failure.state }),
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
