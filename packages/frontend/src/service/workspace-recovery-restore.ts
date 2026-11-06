import type { WorkspaceLayout } from '@/types'
import { useAppStore } from '@/store/app'
import { useWorkspaceStore } from '@/store/workspace'
import { traceStage } from '@/service/database/startup-trace'
import {
  createRecoveryJournal,
  type PendingWorkspaceSnapshot,
} from './workspace-recovery-journal'
import {
  canReplaceStartupFallback,
  mergeRecoveryTabs,
  sanitizeWorkspaceRecoveryLayout,
} from './workspace-recovery-layout'
import type { WorkspaceRecoveryReporter } from './workspace-recovery-observation'

export interface CommitRecoveryLayoutOptions {
  activeWorkspaceId: string
  layout: WorkspaceLayout | null
  journal: PendingWorkspaceSnapshot | null
  reporter: WorkspaceRecoveryReporter
}

/**
 * Commit a read layout to the app store, or deliberately keep the current tabs.
 *
 * Returns the journal that should be persisted, or null when this attempt must
 * not write anything (workspace switched, user tabs won, or no layout).
 */
export function commitRecoveryLayout({
  activeWorkspaceId,
  layout,
  journal,
  reporter,
}: CommitRecoveryLayoutOptions): PendingWorkspaceSnapshot | null {
  const { report, correlationId } = reporter
  const workspaceStillActive =
    useWorkspaceStore.getState().activeWorkspaceId === activeWorkspaceId
  if (!workspaceStillActive) {
    // Workspace switching is independent of this startup read. A late layout
    // from the previous workspace must never enter the new one.
    report('restore-layout-skipped', {
      workspaceId: activeWorkspaceId,
      reason: 'workspace-switched',
    })
    return null
  }

  const currentTabs = useAppStore.getState().tabs
  const hasLayout = Boolean(layout && layout.tabs.length > 0)
  const shouldReplace =
    hasLayout &&
    layout !== null &&
    (currentTabs.length === 0 || canReplaceStartupFallback(currentTabs))
  const interactedFallbacks = currentTabs.filter(
    tab =>
      tab.startupFallback === true && tab.startupFallbackInteracted === true,
  )
  const nonFallbackTabs = currentTabs.filter(
    tab => tab.startupFallback !== true,
  )
  // A user who typed into the temporary local shell keeps that tab, but the
  // saved remote layout is still restored alongside it. Dropping the whole
  // layout here is what let the temporary session win permanently.
  const shouldMerge =
    hasLayout &&
    layout !== null &&
    !shouldReplace &&
    interactedFallbacks.length > 0 &&
    nonFallbackTabs.length === 0

  if (shouldReplace && layout) {
    useAppStore.getState().restoreLayout(layout)
    report('restore-layout-committed', {
      workspaceId: activeWorkspaceId,
      tabCount: layout.tabs.length,
      remoteTabCount: layout.tabs.filter(tab => tab.type === 'remote').length,
      reason:
        currentTabs.length === 0
          ? 'restored-empty-startup'
          : 'replaced-startup-fallback',
    })
    traceSelectedTab(activeWorkspaceId, correlationId)
    return journal
      ? createRecoveryJournal(
          activeWorkspaceId,
          layout,
          sanitizeWorkspaceRecoveryLayout,
        )
      : null
  }

  if (shouldMerge && layout) {
    const mergedTabs = mergeRecoveryTabs(layout.tabs, interactedFallbacks)
    const currentActiveTabId = useAppStore.getState().activeTabId
    const mergedLayout: WorkspaceLayout = {
      ...layout,
      tabs: mergedTabs,
      activeTabId:
        currentActiveTabId &&
        mergedTabs.some(tab => tab.id === currentActiveTabId)
          ? currentActiveTabId
          : layout.activeTabId,
    }
    useAppStore.getState().restoreLayout(mergedLayout)
    report('restore-layout-committed', {
      workspaceId: activeWorkspaceId,
      tabCount: mergedTabs.length,
      remoteTabCount: mergedTabs.filter(tab => tab.type === 'remote').length,
      reason: 'merged-user-fallback',
    })
    traceSelectedTab(activeWorkspaceId, correlationId)
    return journal
      ? createRecoveryJournal(
          activeWorkspaceId,
          mergedLayout,
          sanitizeWorkspaceRecoveryLayout,
        )
      : null
  }

  // A user may have opened a real tab while recovery was slow. Do not overwrite
  // that usable session with a late database result.
  report('restore-layout-skipped', {
    workspaceId: activeWorkspaceId,
    reason: hasLayout ? 'user-tabs' : 'no-layout',
  })
  return null
}

function traceSelectedTab(workspaceId: string, correlationId: string) {
  const restored = useAppStore.getState()
  const active = restored.tabs.find(tab => tab.id === restored.activeTabId)
  traceStage(
    'active-tab-selected',
    `correlationId=${correlationId} workspaceId=${workspaceId} activeTabId=${restored.activeTabId ?? 'none'} tabType=${active?.type ?? 'none'}`,
  )
}
