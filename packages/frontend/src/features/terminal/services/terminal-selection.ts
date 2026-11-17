/**
 * The terminal's current selection, published for capability-gated readers.
 *
 * ## Why this is a module and not React state
 *
 * The extension gateway needs a synchronous answer to "what has the user selected"
 * when an extension asks, and the terminal instance lives inside `TerminalContainer`
 * — below the tree the gateway is created in. A module-level publisher is the
 * smallest thing that bridges them without either owning the other.
 *
 * ## What makes a selection safe to publish
 *
 * Only the *active* tab publishes, and only when that tab is actually rendering a
 * terminal. A background tab's selection is not "what the user has selected": it is
 * text the user highlighted at some earlier moment, possibly for a different host,
 * and handing that to an extension would be exactly the "read something the user did
 * not choose" failure the `terminal.read-selected` capability exists to prevent.
 *
 * The value is read from `term.getSelection()` — the same call the context menu's
 * Copy uses — so an extension sees precisely what the user could have copied, and
 * nothing more.
 */

let current: { text: string, sessionId: string, seq: number } | null = null
/**
 * Bumped on every publish.
 *
 * The identity of a selection cannot be derived from its session: within one tab the
 * user selects, selects something else, and selects the original text again. An
 * approval minted for the first selection must not authorise the third, so the id has
 * to change whenever the selection does — which only the publisher can know.
 */
let nextSeq = 0
/**
 * Components that render the current selection.
 *
 * A module-level value with no notification is invisible to React: the dock reads it
 * during render, so a selection made *after* the dock opened never reached it and the
 * panel stayed on "select something" while text was visibly selected.
 */
const listeners = new Set<() => void>()

/** Notify every subscriber, containing a throwing one. */
function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // One broken subscriber must not stop the others or the publish itself.
    }
  }
}

/**
 * Subscribe to selection changes. Returns an unsubscribe.
 *
 * The callback takes no argument: a subscriber reads `currentTerminalSelection()`,
 * which is the same value the dock uses, so there is one source and no second copy to
 * drift.
 */
export function subscribeTerminalSelection(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Publish the active terminal's selection.
 *
 * `null` clears it. Called by the active container on selection change and cleared
 * on unmount, tab switch and when the selection becomes empty — a stale selection is
 * worse than none.
 */
export function publishTerminalSelection(
  sessionId: string,
  text: string | null | undefined,
): void {
  if (!text) {
    if (current?.sessionId === sessionId) {
      current = null
      notify()
    }
    return
  }
  // Re-selecting identical text is a new selection as far as an approval is
  // concerned: the user performed the gesture again. Bumping unconditionally keeps
  // the rule simple and errs toward requiring a fresh approval.
  nextSeq += 1
  current = { text, sessionId, seq: nextSeq }
  notify()
}

/** Withdraw a selection if it belongs to this session (unmount, tab close). */
export function clearTerminalSelection(sessionId: string): void {
  if (current?.sessionId === sessionId) {
    current = null
    notify()
  }
}

/** What the user currently has selected, or null. */
export function currentTerminalSelection(): {
  text: string
  sessionId: string
  seq: number
} | null {
  return current
}

/** Test-only: forget any published selection. */
export function __resetTerminalSelectionForTests(): void {
  current = null
  nextSeq = 0
  listeners.clear()
}
