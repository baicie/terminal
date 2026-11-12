/**
 * Which host the SFTP panel is bound to.
 *
 * `INV-13`. Before this module the answer was "whichever tab is active":
 * `sftp-container.tsx` read `activeTab.hostId`, so switching tabs silently
 * repointed the file browser at a different server. Once the panel becomes a dock
 * that stays open while the user works in another tab, that behaviour is not
 * merely surprising — it means a delete or a rename can be aimed at a host the
 * user did not pick.
 *
 * The binding is now explicit and *pinned*: it changes when the user asks for a
 * different host, never as a side effect of focus.
 *
 * What pins it:
 * - opening the panel for a host (a deliberate action) sets it;
 * - closing the panel clears it, so the next open re-reads the active tab;
 * - it is **not** persisted. A restored dock that silently reconnects to a server
 *   on launch is a connection the user did not request this session.
 */

export interface SftpBindingState {
  /** The host the panel is showing, or null when the panel is closed. */
  hostId: string | null
}

export interface SftpBindingActions {
  /** Pin the panel to a host. Called when the user opens the dock for it. */
  openFor: (hostId: string) => void
  /** Forget the binding. Called when the panel closes. */
  close: () => void
}

export type SftpBindingStore = SftpBindingState & SftpBindingActions

/**
 * Resolve the host to show, given the pinned binding and the active tab.
 *
 * Kept as a function rather than inlined because the rule has one subtlety worth
 * testing: a *pinned* binding wins over the active tab, and an *unpinned* one
 * follows it. That is what makes the first open feel immediate while later tab
 * switches leave the panel alone.
 */
export function resolveSftpHostId(
  pinnedHostId: string | null,
  activeTabHostId: string | null | undefined,
): string | null {
  if (pinnedHostId !== null) return pinnedHostId
  return activeTabHostId ?? null
}

/**
 * Is the active tab a different host than the one the panel shows?
 *
 * Used only to render a hint ("showing prod-01, not the host in this tab"), never
 * to repoint the panel. A silent repoint is the defect; an explicit affordance to
 * follow the tab is the fix the user can choose.
 */
export function differsFromActiveTab(
  pinnedHostId: string | null,
  activeTabHostId: string | null | undefined,
): boolean {
  if (pinnedHostId === null) return false
  return pinnedHostId !== (activeTabHostId ?? null)
}
