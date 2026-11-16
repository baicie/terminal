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

let current: { text: string, sessionId: string } | null = null

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
    if (current?.sessionId === sessionId) current = null
    return
  }
  current = { text, sessionId }
}

/** Withdraw a selection if it belongs to this session (unmount, tab close). */
export function clearTerminalSelection(sessionId: string): void {
  if (current?.sessionId === sessionId) current = null
}

/** What the user currently has selected, or null. */
export function currentTerminalSelection(): { text: string, sessionId: string } | null {
  return current
}

/** Test-only: forget any published selection. */
export function __resetTerminalSelectionForTests(): void {
  current = null
}
