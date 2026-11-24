/**
 * SSH10 — the connection context a terminal failure can carry.
 *
 * ## Why this is its own module
 *
 * `terminal-session-manager-errors.ts` was already at its line limit when the context
 * arrived. Splitting the *types and the reader* out keeps that file about classification
 * and this one about a wire vocabulary.
 *
 * ## Why the reader validates instead of trusting the wire
 *
 * The values come from Rust as strings. A build that adds a hop this one does not know —
 * or a hand-written error object in a test — must not reach a consumer whose `switch`
 * has two cases and a default that reads as "target". An unrecognised value becomes
 * `undefined`, which every consumer already treats as "not recorded".
 */

/** The two legs a jump connection can fail at. */
export type TerminalFailureHop = 'bastion' | 'target'

/** The connection steps, mirroring Rust's `ConnectionStage`. */
export type TerminalFailureStage =
  | 'tcp_connect'
  | 'handshake'
  | 'host_key_verification'
  | 'authentication'
  | 'tunnel_open'
  | 'channel_open'

export const HOPS: readonly TerminalFailureHop[] = ['bastion', 'target']

export const STAGES: readonly TerminalFailureStage[] = [
  'tcp_connect',
  'handshake',
  'host_key_verification',
  'authentication',
  'tunnel_open',
  'channel_open',
]

/** Read one of the context fields off an IPC error, or `undefined` when unusable. */
export function readContext<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}
