/**
 * SSH11 — from a connection context to a sentence that names the machine.
 *
 * ## The problem this solves
 *
 * A jump connection fails with `authentication_rejected`. The plain message is true
 * and useless: the user has two accounts for this connection — one on the bastion, one
 * on the host behind it — and only one was refused. Without a hop the pane says
 * "authentication rejected" and the user guesses which login to go and fix. Guessing
 * wrong means changing a password that was never the problem, then being refused again.
 *
 * So the diagnostic decides which machine the user opens next.
 *
 * ## Split: the classifier names the situation, the UI chooses the words
 *
 * The classifier is the only place that holds `kind`, `hop` and `stage` together, so it
 * is where the situation is decided. It stores a small enum — not a sentence, and
 * **not** the error taxonomy. A rendered sentence stored on the record would freeze the
 * language at the moment the connection failed: switch the locale and the pane keeps
 * the old one.
 *
 * The enum has seven members, deliberately not seventeen: the error kinds are Rust's
 * business, and copying them here would be the second taxonomy this repository has
 * twice refused to build.
 *
 * ## What is deliberately not said
 *
 * A `tunnel_failed` does not claim the bastion is broken. The bastion may have refused
 * forwarding, or the target address may be unreachable from it; the SSH API does not
 * distinguish those. The wording says what is true — the path through the bastion could
 * not be opened — instead of blaming a machine.
 */

import type { TFunction } from 'i18next'
import type { TerminalFailureHop } from './terminal-failure-context'

/**
 * The situations the pane can explain better than the raw error can.
 *
 * Absent means "nothing to add": a direct connection that timed out, a local shell, a
 * malformed host row. Absent is also what an older record carries, so every consumer
 * must treat it as "render what you rendered before".
 */
export type TerminalFailureDiagnosis =
  /** The bastion refused the credential. Two logins, this is the first one. */
  | 'bastion-auth-rejected'
  /** The bastion authenticated; the host behind it refused. Fix the *target's* login. */
  | 'target-auth-rejected'
  /** The bastion never answered. Nothing was authenticated anywhere. */
  | 'bastion-unreachable'
  /** The tunnel opened, but the host at its end did not complete a handshake. */
  | 'target-handshake-failed'
  /** The path from the bastion to the target could not be opened. */
  | 'tunnel-failed'
  /** The bastion's identity does not match what is recorded for it. */
  | 'bastion-host-key-rejected'
  /** The target's identity does not match what is recorded for it. */
  | 'target-host-key-rejected'

/** The minimal context the classifier has in hand when it decides. */
export interface DiagnosisContext {
  /** The structured failure kind (`authentication_rejected`, `host_key_rejected`, …). */
  kind?: string
  hop?: TerminalFailureHop
  stage?: string
}

/** Kinds that mean "a server evaluated the credential and refused it". */
const AUTH_REJECTION_KINDS = new Set([
  'authentication_rejected',
  // Legacy and agent paths still report through this one.
  'authentication_failed',
])

/**
 * Which situation this failure is, or `undefined` when the plain message says it all.
 *
 * Order matters: a hop-specific host-key refusal is more informative than a generic
 * one, and the tunnel is checked before the auth branch because a tunnel that never
 * opened has no credential to refuse.
 */
export function diagnoseFailure(
  context: DiagnosisContext,
): TerminalFailureDiagnosis | undefined {
  const { kind, hop, stage } = context

  if (kind === 'host_key_rejected') {
    if (hop === 'bastion') return 'bastion-host-key-rejected'
    if (hop === 'target') return 'target-host-key-rejected'
    return undefined
  }

  /*
   * Opened *by* the bastion, *towards* the target: the honest subject is the path,
   * not either machine. Claiming a hop here would be the guess this replaces.
   */
  if (stage === 'tunnel_open') return 'tunnel-failed'

  if (kind !== undefined && AUTH_REJECTION_KINDS.has(kind)) {
    if (hop === 'bastion') return 'bastion-auth-rejected'
    if (hop === 'target') return 'target-auth-rejected'
    return undefined
  }

  /*
   * A bastion that never answered versus a host that never answered through a tunnel
   * that did open. Both are "could not reach", and the hop is exactly which machine.
   */
  if (hop === 'bastion' && (stage === 'tcp_connect' || stage === 'handshake')) {
    return 'bastion-unreachable'
  }
  if (hop === 'target' && stage === 'handshake') {
    return 'target-handshake-failed'
  }

  return undefined
}

/**
 * Translation keys, one per diagnosis.
 *
 * Exported so the locale tests can see them: they are selected by value at runtime, so
 * the repository's static `t('literal')` scan would miss every one, and a missing
 * translation would ship as a raw key.
 */
export const DIAGNOSIS_KEYS: Record<TerminalFailureDiagnosis, string> = {
  'bastion-auth-rejected': 'terminal.diagnostic.bastionAuthRejected',
  'target-auth-rejected': 'terminal.diagnostic.targetAuthRejected',
  'bastion-unreachable': 'terminal.diagnostic.bastionUnreachable',
  'target-handshake-failed': 'terminal.diagnostic.targetHandshakeFailed',
  'tunnel-failed': 'terminal.diagnostic.tunnelFailed',
  'bastion-host-key-rejected': 'terminal.diagnostic.bastionHostKeyRejected',
  'target-host-key-rejected': 'terminal.diagnostic.targetHostKeyRejected',
}

/**
 * The explanation line for a failed connection, or `fallback` unchanged.
 *
 * `fallback` is the already-translated error text. Returning it when there is no
 * diagnosis keeps this additive: a pane with no context renders exactly what it
 * rendered before SSH11.
 */
export function connectionDiagnostic(
  diagnosis: TerminalFailureDiagnosis | undefined,
  fallback: string,
  t: TFunction,
): string {
  if (diagnosis === undefined) return fallback
  const key = DIAGNOSIS_KEYS[diagnosis]
  if (key === undefined) return fallback
  const sentence = t(key)
  /*
   * i18next renders a missing key as the key itself. Showing `terminal.diagnostic.x`
   * to a user is worse than showing the error it was meant to explain, so an
   * untranslated diagnosis falls back rather than shouting its own name.
   */
  if (typeof sentence !== 'string' || sentence === key || sentence.length === 0) {
    return fallback
  }
  return sentence
}
