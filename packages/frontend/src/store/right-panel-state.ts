/**
 * The right column's occupant — the same rule as the left.
 *
 * UX-1b established that a column has exactly one panel, resolved by a value
 * rather than by two booleans that can both be true. The right column follows the
 * same shape so the two cannot drift into different conventions.
 *
 * Only `sftp` is implemented in UX-1c. `snippets` and `ai` are named here because
 * the union is what makes "one occupant" enforceable: adding a second panel is
 * then a type change plus a case, not a second boolean nobody checks.
 *
 * **The dock does not own a PTY.** Closing it closes a view; the sessions it
 * showed keep running by their own rules (`INV-14`).
 */

export type RightPanelMode = 'none' | 'sftp'

export interface RightPanelState {
  rightPanel: RightPanelMode
}

/** Opening a panel replaces whatever was there. There is never a second one. */
export function withRightPanel(panel: RightPanelMode): RightPanelState {
  return { rightPanel: panel }
}

/**
 * The dock toggle.
 *
 * From closed it opens SFTP; from SFTP it closes. It never switches to a panel
 * the user did not ask for, and it never leaves two open.
 */
export function toggleRightPanel(current: RightPanelMode): RightPanelState {
  return withRightPanel(current === 'none' ? 'sftp' : 'none')
}
