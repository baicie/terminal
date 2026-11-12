/**
 * The left column's occupant, as a value rather than an inline union.
 *
 * Extracted from `store/app.ts` when that file hit its size limit. Keeping the
 * rules here is also the better shape: "which panel is open" and "is a panel open
 * at all" have to agree, and that agreement is one small function instead of two
 * scattered `set` calls.
 */

export type LeftPanelMode = 'explorer' | 'navigation' | 'none'

export interface LeftPanelState {
  leftPanel: LeftPanelMode
  /** True whenever any panel is open. Persisted with the workspace layout. */
  sidebarVisible: boolean
}

/** Opening a panel means a panel is visible; closing means none is. */
export function withLeftPanel(panel: LeftPanelMode): LeftPanelState {
  return { leftPanel: panel, sidebarVisible: panel !== 'none' }
}

/**
 * The `⌘B` / rail-toggle step.
 *
 * From closed, it opens the **explorer** — the panel a terminal user wants most of
 * the time. From either open state it closes. It never switches *between* panels,
 * because that would make one keystroke both close and open something.
 */
export function toggleLeftPanel(current: LeftPanelMode): LeftPanelState {
  return withLeftPanel(current === 'none' ? 'explorer' : 'none')
}

/**
 * Resolve a restored layout flag into a panel.
 *
 * A restored `sidebarVisible: true` becomes the navigation panel, not the explorer:
 * it is the panel the previous session actually had open.
 */
export function leftPanelForRestoredVisibility(visible: boolean): LeftPanelMode {
  return visible ? 'navigation' : 'none'
}
