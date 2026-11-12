import type { Tab, WorkspaceLayout } from '@/types'
import { normalizeTerminalLayout } from '@/store/app-terminal-layout'
import { useAppStore } from '@/store/app'
import type { PendingWorkspaceSnapshot } from './workspace-recovery-journal'
import {
  LAYOUT_SCHEMA_VERSION,
  migrateLayoutVisibility,
} from './workspace-layout-version'

function isRestorableTab(tab: Tab, hostIds?: ReadonlySet<string>): boolean {
  if (tab.profileId || tab.type === 'serial') return false
  return (
    tab.type !== 'remote' ||
    (Boolean(tab.hostId) &&
      (hostIds === undefined || hostIds.has(tab.hostId as string)))
  )
}

function stripProcessLocalTabState(tab: Tab): Tab {
  return {
    id: tab.id,
    label: tab.label,
    type: tab.type,
    ...(tab.type === 'remote' && tab.hostId ? { hostId: tab.hostId } : {}),
  }
}

export function canReplaceStartupFallback(tabs: readonly Tab[]): boolean {
  return (
    tabs.length > 0 &&
    tabs.every(
      tab =>
        tab.startupFallback === true && tab.startupFallbackInteracted !== true,
    )
  )
}

export function sanitizeWorkspaceRecoveryLayout(
  layout: WorkspaceLayout,
  workspaceId = layout.workspaceId,
  hostIds?: ReadonlySet<string>,
): WorkspaceLayout {
  const normalized = normalizeTerminalLayout({
    tabs: layout.tabs
      .filter(tab => isRestorableTab(tab, hostIds))
      .map(stripProcessLocalTabState),
    splitGroups: layout.splitGroups,
    activeTabId: layout.activeTabId,
  })

  return {
    workspaceId,
    ...normalized,
    // Same rule as `restoreLayout`: a layout from before the activity rail has
    // `sidebarVisible: true` because that was the old default, not a choice.
    // Sanitizing must not reintroduce it on the way to disk.
    sidebarVisible: migrateLayoutVisibility(layout).sidebarVisible,
    layoutVersion: LAYOUT_SCHEMA_VERSION,
  }
}

export function readRecoveryLayout(workspaceId: string): WorkspaceLayout {
  const { tabs, splitGroups, activeTabId, sidebarVisible } =
    useAppStore.getState()
  return sanitizeWorkspaceRecoveryLayout({
    workspaceId,
    tabs,
    splitGroups,
    activeTabId,
    // In-memory visibility is a decision of *this* build: `restoreLayout`
    // migrated it on entry, and a toggle is the user acting now. Stamping the
    // legacy version here would fold a sidebar the user just opened back shut
    // on every journal write.
    sidebarVisible,
    layoutVersion: LAYOUT_SCHEMA_VERSION,
  })
}

/**
 * Merge a restored layout with a startup fallback the user has typed into.
 *
 * The user's local terminal must survive, but the saved remote tabs must not be
 * lost either. Saved tabs win on id collisions; the current active tab stays
 * active while it still exists, so the restore does not yank the user out of
 * the shell they are using.
 */
export function mergeRecoveryTabs(
  savedTabs: readonly Tab[],
  preservedTabs: readonly Tab[],
): Tab[] {
  const seen = new Set<string>()
  const merged: Tab[] = []
  for (const tab of [...savedTabs, ...preservedTabs]) {
    if (seen.has(tab.id)) continue
    seen.add(tab.id)
    merged.push(tab)
  }
  return merged
}

export interface RecoveryLayoutChoice {
  layout: WorkspaceLayout | null
  /** The journal that should be used, or null when it was dropped as stale. */
  journal: PendingWorkspaceSnapshot | null
  droppedJournal: PendingWorkspaceSnapshot | null
}

/**
 * A journal written from a provisional local fallback must not shadow a real
 * saved remote layout. That is how one failed sample poisoned the next sample
 * on a shared WebKit data store (run 41683645429, samples 228/229): both
 * `terminal-open-start` details carried the same `local-1793728115282` id.
 */
export function chooseRecoveryLayout(
  journal: PendingWorkspaceSnapshot | null,
  savedLayout: WorkspaceLayout | null,
): RecoveryLayoutChoice {
  const journalLayout = journal?.layout ?? null
  const dbHasRemoteTabs =
    savedLayout?.tabs.some(tab => tab.type === 'remote') ?? false
  const journalHasRemoteTabs =
    journalLayout?.tabs.some(tab => tab.type === 'remote') ?? false
  const preferJournal =
    journalLayout !== null && (!dbHasRemoteTabs || journalHasRemoteTabs)
  if (journal && !preferJournal) {
    return { layout: savedLayout, journal: null, droppedJournal: journal }
  }
  return {
    layout: preferJournal ? journalLayout : savedLayout,
    journal: preferJournal ? journal : null,
    droppedJournal: null,
  }
}
