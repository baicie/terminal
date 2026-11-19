/**
 * Make the running extensions match a saved list.
 *
 * ## Why this is its own module
 *
 * It used to be a closure inside `SettingsView`, which meant it ran only while that
 * page was open. The list is persisted in `app_settings`; nothing applied it at
 * startup, so an extension a user enabled in one session was still off in the next
 * while its switch rendered "on" — the setting was stored and never read.
 *
 * Two callers now: the Settings page (on save and on toggle, so the switch does what
 * it looks like it does) and `App` at boot (so the previous session's choice survives
 * a restart).
 *
 * ## What it deliberately does not do
 *
 * It does not enable by default. `defaultEnabled: false` is a design rule — nothing
 * optional runs until the user says so — and this function's contract is "match the
 * list", which for an unlisted extension means *deactivate*.
 *
 * ## Why a stale list cannot undo a newer choice
 *
 * The startup apply in `App` reads `app_settings` and then awaits several other
 * preferences before reaching this call, so its list is a snapshot from an earlier
 * moment. If the user flips a switch in between, the startup list is already out of
 * date when it arrives — and because its contract includes *deactivate*, applying it
 * would silently turn the extension back off with the switch still rendering "on".
 *
 * Measured: the Settings toggle applied the new list without writing it, so
 * `app_settings` kept the old one. Every later re-apply therefore read a list that
 * disagreed with the registry — and a stale list arriving after a newer choice is the
 * one deactivation path that happens without anyone clicking anything. (The toggle now
 * persists; this guard covers the remaining window, where startup's read is already in
 * flight when the user changes the setting.)
 *
 * A caller that has just written a newer list therefore marks it current, and an
 * older snapshot is refused rather than applied.
 */
import { getExtensionRegistry } from './use-extension-runtime'

/**
 * Sequence number of the newest list any caller has applied or superseded.
 *
 * Module scope, next to the registry: both are process-wide singletons, and the guard
 * has to cover the same lifetime the registry does.
 */
let currentSequence = 0

/** A list read from storage: its sequence is its position in the caller's story. */
export interface StoredExtensionList {
  ids: readonly string[]
  /** Taken when the list was *read*, before the caller's other awaits. */
  sequence: number
}

/** Claim the next sequence number. Call before reading the list from storage. */
export function nextExtensionListSequence(): number {
  currentSequence += 1
  return currentSequence
}

/**
 * The apply that is currently running, or a resolved sentinel.
 *
 * ## Why applies are serialised rather than merely guarded by a sequence
 *
 * A sequence check tells a *stale* apply not to start. It cannot stop an apply that has
 * already suspended inside `enable`/`deactivate` from finishing after a newer one and
 * writing the older state back — measured: two applies issued together ended with the
 * extension active when the newer one asked for off.
 *
 * Serialising makes the interleaving impossible instead of detecting it: the second
 * apply waits for the first to finish, then reconciles from the current registry state,
 * so the last one to run is the one whose list wins.
 */
let inFlight: Promise<void> = Promise.resolve()

/** Test-only: forget the in-flight chain between suites. */
export function __resetExtensionApplyQueueForTests(): void {
  inFlight = Promise.resolve()
}

export function applyEnabledExtensions(
  enabledIds: readonly string[] | StoredExtensionList,
): Promise<void> {
  const run = inFlight.then(() => applyNow(enabledIds))
  // The chain must not break on a rejection: the next apply still has to run.
  inFlight = run.catch(() => undefined)
  return run
}

async function applyNow(
  enabledIds: readonly string[] | StoredExtensionList,
): Promise<void> {
  const list: StoredExtensionList = Array.isArray(enabledIds)
    ? { ids: enabledIds as readonly string[], sequence: nextExtensionListSequence() }
    : (enabledIds as StoredExtensionList)

  // A snapshot older than one already applied describes a past the user has left.
  if (list.sequence < currentSequence) return
  const registry = getExtensionRegistry()
  for (const record of registry.list()) {
    const id = record.manifest.id
    const shouldRun = list.ids.includes(id)
    const running = record.status === 'active'
    if (shouldRun && !running) await registry.enable(id)
    else if (!shouldRun && running) await registry.deactivate(id)
  }
}
