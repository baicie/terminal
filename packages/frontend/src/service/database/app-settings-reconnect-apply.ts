/**
 * F13 — turn the stored reconnect settings into the policy the manager walks.
 *
 * ## Why this is a function and not two lines in `App.tsx`
 *
 * "Absent means default" is the whole semantics, and it has to be *written* rather than
 * implied: passing `undefined` through does reach `resolveReconnectPolicy`'s fallback, but
 * a reader of the startup path cannot see that from `setReconnectPolicy({ reconnectBaseDelayMs: s.reconnectBaseDelayMs })`.
 * Spelling the mapping out here also gives the F13 test one place to assert against, so
 * the test proves the shipped wiring rather than a copy of it.
 *
 * ## What it deliberately does not do
 *
 * No validation beyond what `resolveReconnectPolicy` already applies. A user who somehow
 * stored `0` gets the default attempt count rather than an app that will not start, and a
 * `NaN` from a hand-edited row is normalised the same way. Rejecting at this layer would
 * mean startup could fail on a settings value, which is worse than falling back.
 */
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import type { AppSettings } from './types'

export interface ReconnectSettingsInput {
  baseDelayMs?: number
  maxAttempts?: number
}

/** The manager options a settings row implies, with absent fields left absent. */
export function reconnectPolicyFromSettings(
  settings: Pick<AppSettings, 'reconnectBaseDelayMs' | 'reconnectMaxAttempts'>,
): ReconnectSettingsInput {
  /*
   * `> 0` rather than `!== undefined`, and the difference is not cosmetic: the ladder reads
   * `maxAttempts` directly, so a stored `0` would mean "one attempt, never retry" — a
   * behaviour change from a value nobody meant to store. Dropping it here sends the field
   * down the same absent path as a missing row, where the default applies.
   *
   * `Number.isFinite` rejects the `NaN` a hand-edited row can hold; `resolveReconnectPolicy`
   * would also default it, but doing it here keeps this function's output always usable.
   */
  const baseDelayMs = settled(settings.reconnectBaseDelayMs)
  const maxAttempts = settled(settings.reconnectMaxAttempts)
  return {
    ...(baseDelayMs === null ? {} : { baseDelayMs }),
    ...(maxAttempts === null ? {} : { maxAttempts }),
  }
}

/** A stored number the policy can use, or `null` for "treat as absent". */
function settled(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null
}

/**
 * Apply the stored policy to the shipped manager.
 *
 * Called from startup, after settings are hydrated, so the ladder a user's first
 * connection walks is already the one their settings describe. Idempotent: applying the
 * same row twice leaves the manager in the same state.
 */
export function applyReconnectSettings(
  settings: Pick<AppSettings, 'reconnectBaseDelayMs' | 'reconnectMaxAttempts'>,
): void {
  terminalSessionManager.setReconnectPolicy(reconnectPolicyFromSettings(settings))
}
