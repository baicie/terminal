/**
 * The Context Dock's occupant — one column, one panel, decided by a value.
 *
 * ## Why a union and not booleans
 *
 * The left column learned this in UX-1b: `sftpOpen` + `snippetsOpen` can both be
 * true, and then two panels stack or one silently wins depending on render order.
 * A single `RightPanelMode` makes "two open" unrepresentable. Adding an occupant is
 * a type change plus a case — and the compiler names every place that has to be
 * updated, which is exactly what a pair of booleans cannot do.
 *
 * ## The occupants, and what each one is allowed to do
 *
 * - `sftp` — a file browser over an existing SSH session. It does not own that
 *   session; `INV-13`/`INV-14` cover the pinning and the deferred release.
 * - `snippets` — a list of saved commands, used by an extension in UX-3.
 * - `inspector` — read-only host facts over SSH, UX-4.
 * - `ai` — the assistant panel, UX-4. Its context is only what the user selected.
 *
 * The doc names these now, before they exist, because the union is the contract:
 * a future panel plugs into `RIGHT_PANEL_OCCUPANTS` and a render case, and the
 * tests below refuse a second boolean that would let two of them coexist.
 *
 * ## What the dock must never own
 *
 * Closing the dock closes a *view*. It must not close a PTY, an SSH session or a
 * running SFTP transfer: those belong to `TerminalSessionManager` and the transfer
 * queue, and a panel remount is not a lifecycle event. The `occupantOwnsSession`
 * rule below states it once so a new occupant cannot quietly claim otherwise.
 */

/**
 * Every occupant the dock can show.
 *
 * `none` is the closed state and is part of the value, not a separate flag.
 */
export const RIGHT_PANEL_OCCUPANTS = [
  'none',
  'sftp',
  'snippets',
  'inspector',
  'ai',
] as const

export type RightPanelMode = (typeof RIGHT_PANEL_OCCUPANTS)[number]

/**
 * The panels that exist in this build. The rest are named for the contract.
 *
 * `snippets` moved here when `snippet-dock` shipped: it is the first occupant added
 * *through* the contract rather than beside it, which is what the union was for.
 */
export const IMPLEMENTED_RIGHT_PANEL_OCCUPANTS = ['none', 'sftp', 'snippets'] as const

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
 * From closed it opens the default occupant; from anything open it closes. It
 * never switches to a panel the user did not ask for, and it never leaves two open.
 *
 * `from` is only `none | sftp` in this build, but the parameter is the full union so
 * that adding an occupant cannot change the toggle's *meaning* by accident: closing
 * is closing regardless of what was open.
 */
export function toggleRightPanel(current: RightPanelMode): RightPanelState {
  return withRightPanel(current === 'none' ? 'sftp' : 'none')
}

/**
 * Is this occupant implemented in this build?
 *
 * The union names panels that do not exist yet so the contract is stable. A
 * renderer that case-switched over the union without this check would show an empty
 * box for `ai` instead of not offering it — the user-visible form of "declared but
 * not built".
 */
export function isRightPanelImplemented(panel: RightPanelMode): boolean {
  return (IMPLEMENTED_RIGHT_PANEL_OCCUPANTS as readonly string[]).includes(panel)
}

/**
 * Does showing this occupant require a session of its own?
 *
 * `false` for every occupant, and that is the point: the dock renders against
 * resources that already exist. An occupant that answered `true` here would be
 * asking the shell to open a connection because a panel opened, which is the
 * ownership inversion the architecture forbids. Kept as a function rather than a
 * comment so the rule has one place to be asserted.
 */
export function occupantOwnsSession(): false {
  return false
}

/**
 * Which mode should the dock show, given what the user last selected and what this
 * build can render?
 *
 * A mode restored from persisted state can name an occupant that a later build
 * removed or has not shipped. Falling back to `none` keeps the dock closed instead
 * of rendering an empty panel; falling back to a *different* panel would open
 * something the user did not choose.
 */
export function resolveRightPanelMode(persisted: string | null | undefined): RightPanelMode {
  if (!persisted) return 'none'
  if (!(RIGHT_PANEL_OCCUPANTS as readonly string[]).includes(persisted)) return 'none'
  if (!isRightPanelImplemented(persisted as RightPanelMode)) return 'none'
  return persisted as RightPanelMode
}
