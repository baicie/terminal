/**
 * The one-time secret waiting for its connection to prove itself.
 *
 * ## Why a module-level map rather than component state
 *
 * The secret is recorded where the connection is *started* (`useHostConnectActions`) but
 * the proof that it worked arrives in a different tree — the `TerminalContainer` that
 * creates the session. The two are siblings, not parent and child, so component state
 * cannot carry the value between them.
 *
 * That is the same problem `temporary-terminal-profiles.ts` solves for the credential
 * itself, and this uses the same shape for the same reason. It is a single entry per tab:
 * one tab, one connection attempt, one secret.
 *
 * ## What it is careful about
 *
 * - **Removed on read.** `take` hands the secret out once. Holding it after the question
 *   is answered — or declined — keeps a plaintext secret in memory for the rest of the
 *   session for no reason.
 * - **Removed when the tab goes.** A prompt surviving its tab would be answered against
 *   whatever renders next.
 * - **Never persisted.** No `localStorage`, no store, no module that outlives the tab.
 */

import type { Host } from '@/types'
import type { OneTimeSecret } from '@/features/terminal/services/one-time-credential'

export interface PendingSave {
  host: Host
  secret: OneTimeSecret
  /** The tab whose connection will prove the credential. */
  tabId: string
  /**
   * The process-local profile carrying the secret.
   *
   * Kept so both answers can scrub it: the profile outlives this question, and a
   * plaintext password has no reason to survive the answer. See
   * `scrubTemporaryTerminalProfileSecrets`.
   */
  profileId: string
}

const pending = new Map<string, PendingSave>()

/** Record the secret that a tab is about to try. Replaces any earlier attempt. */
export function armSaveAfterAuth(
  tabId: string,
  host: Host,
  secret: OneTimeSecret,
  profileId: string,
): void {
  pending.set(tabId, { host, secret, tabId, profileId })
}

/** Drop a pending save without showing it — a failed attempt, or a closed tab. */
export function disarmSaveAfterAuth(tabId: string): void {
  pending.delete(tabId)
}

/**
 * Read and forget the pending save for a tab.
 *
 * Called once when the connection succeeds. Removing on read is what makes it a
 * one-time secret rather than a cached one: a later reconnect of the same tab will not
 * find it and therefore will not ask again, which is the intended behaviour — the
 * question has already been put to the user.
 */
export function takeSaveAfterAuth(tabId: string): PendingSave | null {
  const entry = pending.get(tabId)
  if (!entry) return null
  pending.delete(tabId)
  return entry
}

/** Test-only: start a suite with nothing armed. */
export function __resetPendingSavesForTests(): void {
  pending.clear()
}
