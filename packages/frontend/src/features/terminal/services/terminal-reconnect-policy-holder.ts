/**
 * F13 — where the reconnect policy lives and how it changes.
 *
 * ## Why this is its own module
 *
 * The policy used to be a `readonly` field resolved once in the reconnect class's
 * constructor. That was correct while the only way to shape it was that constructor — and
 * the shipped singleton never passed one (`new TerminalSessionManager()`), so every custom
 * `baseDelayMs` / `maxAttempts` a test could name was unreachable from the real backend.
 *
 * A policy the user can change is only meaningful if the change reaches the ladder that
 * runs. Storing it here, behind an explicit holder, is what makes "the value the user
 * chose" and "the value the ladder walks" the same object rather than two copies that
 * happen to start equal.
 *
 * ## Why replacement does not cancel an in-flight ladder
 *
 * `run()` reads `policy()` once per rung. A settings write mid-ladder therefore takes
 * effect from the attempt after the one in flight, and cancelling to force it sooner would
 * make changing a preference drop a live connection attempt. The weaker guarantee is the
 * right one: a preference is not an instruction to reconnect now.
 */

import {
  resolveReconnectPolicy,
  type ReconnectPolicyOptions,
} from './terminal-session-reconnect-policy'

export type ResolvedReconnectPolicy = ReturnType<typeof resolveReconnectPolicy>

export class TerminalReconnectPolicyHolder {
  private current: ResolvedReconnectPolicy

  constructor(options: ReconnectPolicyOptions = {}) {
    this.current = resolveReconnectPolicy(options)
  }

  /**
   * The resolved policy the ladder walks.
   *
   * Resolved, not the raw options: a caller comparing "what I configured" to "what runs"
   * must see the normalised numbers, or an invalid input would look applied here and be
   * silently defaulted at the point of use.
   */
  get(): ResolvedReconnectPolicy {
    return this.current
  }

  /**
   * Replace the policy for every ladder started from here on.
   *
   * Omitted values fall back to the defaults through `resolveReconnectPolicy`, the same
   * normalisation the constructor applies — so `set()` with nothing restores shipped
   * behaviour instead of keeping the previous custom value.
   */
  set(options: ReconnectPolicyOptions = {}): void {
    this.current = resolveReconnectPolicy(options)
  }
}
