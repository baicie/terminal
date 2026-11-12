/**
 * Layout schema version and the one migration that has shipped so far.
 *
 * Why this exists: UX-1a made the terminal the main workspace. The activity rail
 * is permanent navigation and the detailed sidebar is an optional panel, so a
 * *new* install starts with the sidebar closed. But every layout already saved by
 * an older build has `sidebarVisible: true` in it, and restoring that faithfully
 * produces the exact regression this phase is meant to remove: a 46px rail next
 * to a 220px sidebar, both listing the same destinations, and a terminal 220px
 * narrower than the user had before the upgrade.
 *
 * Faithful restoration is therefore the wrong behavior for one specific field,
 * once. Version 2 of the layout schema means "`sidebarVisible` is a decision this
 * build's user made"; anything older means "that field predates the rail and its
 * value is not a preference". Only `sidebarVisible` is affected — tab ids, split
 * groups and the active tab are session recovery data and must survive byte for
 * byte.
 *
 * The migration runs at the **serialization boundaries** (`getWorkspaceLayout`
 * and `readRecoveryJournal`) as well as in `restoreLayout`, because a layout can
 * arrive from three directions: the database, a pre-upgrade recovery journal in
 * localStorage, and an in-memory workspace switch. A guard in only one of them is
 * how the double-navigation regression came back the first time.
 */

/** The current on-disk layout schema version. */
export const LAYOUT_SCHEMA_VERSION = 2

/** The fields the migration reads. Everything else is passed through untouched. */
export interface VersionedLayout {
  layoutVersion?: unknown
  sidebarVisible?: unknown
}

export interface LayoutVisibility {
  sidebarVisible: boolean
  layoutVersion: number
}

/**
 * Decide the sidebar's initial visibility for a layout read from storage.
 *
 * - version 2 or newer: the stored boolean is a real preference, honor it
 *   (a non-boolean at a known version is corrupt, and corrupt means closed).
 * - version 1 or absent: this predates the activity rail, so the sidebar opens
 *   closed. Every relay of terminal width matters more than a pre-rail default.
 * - a non-numeric version is corruption from a hand-edited or truncated write;
 *   treat it as legacy rather than trusting a value nothing produced.
 *
 * A *future* version number is treated as current. This build cannot know what a
 * later schema means, but `sidebarVisible` is still a boolean with the same
 * meaning, and discarding the user's explicit choice is the worse mistake.
 */
export function migrateLayoutVisibility(layout: VersionedLayout): LayoutVisibility {
  const version = layout.layoutVersion
  const known = typeof version === 'number' && Number.isInteger(version) && version >= 1
  const isLegacy = !known || version < LAYOUT_SCHEMA_VERSION
  if (isLegacy) {
    return { sidebarVisible: false, layoutVersion: LAYOUT_SCHEMA_VERSION }
  }
  return {
    sidebarVisible: layout.sidebarVisible === true,
    layoutVersion: LAYOUT_SCHEMA_VERSION,
  }
}
