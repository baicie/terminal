import type { Tab, WorkspaceLayout } from '@/types'
import { normalizeTerminalLayout } from '@/store/app-terminal-layout'
import {
  awaitWithRecoveryAbort,
  awaitWithRecoveryTimeout,
  throwIfRecoveryAborted,
} from './workspace-recovery-abort'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { useWorkspaceStore } from '@/store/workspace'
import {
  createRecoveryJournal,
  getWorkspaceRecoveryJournalKey,
  readRecoveryJournal,
  removeRecoveryJournal,
  writeRecoveryJournal,
  type PendingWorkspaceSnapshot,
} from './workspace-recovery-journal'

const WORKSPACE_SAVE_DEBOUNCE_MS = 1_000
export const WORKSPACE_HOST_LOAD_TIMEOUT_MS = 1_500

export interface WorkspaceRecoveryHandle {
  flush: () => Promise<void>
  dispose: () => void
}

export interface WorkspaceRecoveryOptions {
  signal?: AbortSignal
}

export { getWorkspaceRecoveryJournalKey }

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

function canReplaceStartupFallback(tabs: readonly Tab[]): boolean {
  return tabs.length > 0 && tabs.every(tab => tab.startupFallback === true)
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
    sidebarVisible:
      typeof layout.sidebarVisible === 'boolean' ? layout.sidebarVisible : true,
  }
}

function readRecoveryLayout(workspaceId: string): WorkspaceLayout {
  const { tabs, splitGroups, activeTabId, sidebarVisible } =
    useAppStore.getState()
  return sanitizeWorkspaceRecoveryLayout({
    workspaceId,
    tabs,
    splitGroups,
    activeTabId,
    sidebarVisible,
  })
}

export async function startWorkspaceRecovery(
  options: WorkspaceRecoveryOptions = {},
): Promise<WorkspaceRecoveryHandle> {
  const { signal } = options
  const workspaceState = useWorkspaceStore.getState()
  const workspaceLoad = workspaceState.loadWorkspaces(signal)
  const hostLoadController = new AbortController()
  const abortHostLoad = () => hostLoadController.abort()
  const releaseHostLoad = () => {
    hostLoadController.abort()
    signal?.removeEventListener('abort', abortHostLoad)
  }
  if (signal?.aborted) abortHostLoad()
  else signal?.addEventListener('abort', abortHostLoad, { once: true })
  const hostLoad = useHostStore
    .getState()
    .loadHosts(hostLoadController.signal)
    .then(() => true)
    .catch(error => {
      if (signal?.aborted) throw error
      console.warn('Failed to load hosts before workspace recovery:', error)
      return false
    })
  void hostLoad.then(
    () => signal?.removeEventListener('abort', abortHostLoad),
    () => signal?.removeEventListener('abort', abortHostLoad),
  )
  const awaitHostLoad = async () => {
    try {
      return await awaitWithRecoveryTimeout(
        hostLoad,
        signal,
        WORKSPACE_HOST_LOAD_TIMEOUT_MS,
      )
    } catch (error) {
      throwIfRecoveryAborted(signal)
      console.warn('Failed to load hosts before workspace recovery:', error)
      return false
    } finally {
      releaseHostLoad()
    }
  }
  try {
    await awaitWithRecoveryAbort(workspaceLoad, signal)
  } catch (error) {
    // Keep the concurrent host query from mutating the store after this
    // attempt; workspace failure is already terminal for this retry.
    releaseHostLoad()
    throw error
  }
  throwIfRecoveryAborted(signal)

  const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId
  const savedLayoutPromise = activeWorkspaceId
    ? workspaceState.loadLayout(activeWorkspaceId)
    : Promise.resolve(null)
  let savedLayout: WorkspaceLayout | null = null
  try {
    savedLayout = await awaitWithRecoveryAbort(savedLayoutPromise, signal)
  } catch (error) {
    throwIfRecoveryAborted(signal)
    console.warn('Failed to load saved terminal layout:', error)
  }
  throwIfRecoveryAborted(signal)
  let recoveredJournal: PendingWorkspaceSnapshot | null = null
  if (activeWorkspaceId) {
    recoveredJournal = readRecoveryJournal(
      activeWorkspaceId,
      sanitizeWorkspaceRecoveryLayout,
    )
    const recoveryLayout = recoveredJournal?.layout ?? savedLayout
    const layoutNeedsHosts = recoveryLayout?.tabs.some(
      tab => tab.type === 'remote',
    )
    const hostsLoaded = layoutNeedsHosts ? await awaitHostLoad() : false
    const hostIds = new Set(
      (useHostStore.getState().hosts ?? []).map(host => host.id),
    )
    const sanitizedRecoveryLayout = recoveryLayout
      ? sanitizeWorkspaceRecoveryLayout(
          recoveryLayout,
          activeWorkspaceId,
          hostsLoaded ? hostIds : undefined,
        )
      : null
    const workspaceStillActive =
      useWorkspaceStore.getState().activeWorkspaceId === activeWorkspaceId
    if (!workspaceStillActive) {
      // Workspace switching is independent of this startup read. A late
      // layout from the previous workspace must never enter the new one.
      recoveredJournal = null
    } else {
      const currentTabs = useAppStore.getState().tabs
      const shouldRestore =
        Boolean(sanitizedRecoveryLayout?.tabs.length) &&
        (currentTabs.length === 0 || canReplaceStartupFallback(currentTabs))
      if (sanitizedRecoveryLayout && shouldRestore) {
        if (recoveredJournal) {
          recoveredJournal = createRecoveryJournal(
            activeWorkspaceId,
            sanitizedRecoveryLayout,
            sanitizeWorkspaceRecoveryLayout,
          )
        }
        useAppStore.getState().restoreLayout(sanitizedRecoveryLayout)
      } else if (!shouldRestore) {
        // A user may have opened a fallback/local tab while recovery was slow.
        // Do not let a late database result overwrite that usable session.
        recoveredJournal = null
      }
    }
    if (layoutNeedsHosts && !hostsLoaded) recoveredJournal = null
  }

  let pending: PendingWorkspaceSnapshot | null = recoveredJournal
  let timer: ReturnType<typeof setTimeout> | null = null
  let saveQueue = Promise.resolve()

  const flush = async () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const snapshot = pending
    pending = null
    if (snapshot) {
      saveQueue = saveQueue
        .catch(() => undefined)
        .then(() => {
          const { layout, workspaceId } = snapshot
          return useWorkspaceStore
            .getState()
            .saveLayout(
              workspaceId,
              layout.tabs,
              layout.splitGroups,
              layout.activeTabId,
              layout.sidebarVisible,
            )
            .then(() => removeRecoveryJournal(snapshot))
        })
      await saveQueue
    } else {
      await saveQueue
    }
  }
  if (!activeWorkspaceId) {
    releaseHostLoad()
  }

  const schedule = () => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId
    if (!workspaceId) return
    pending = createRecoveryJournal(
      workspaceId,
      readRecoveryLayout(workspaceId),
      sanitizeWorkspaceRecoveryLayout,
    )
    writeRecoveryJournal(pending)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void flush().catch(error => {
        console.warn('Failed to save terminal workspace recovery state:', error)
      })
    }, WORKSPACE_SAVE_DEBOUNCE_MS)
  }

  const unsubscribe = useAppStore.subscribe(schedule)
  if (!pending && useAppStore.getState().tabs.length > 0) {
    // Recovery subscribes after async workspace/host loads. Persist a tab
    // created during that window (including the startup fallback) instead of
    // losing it because no layout snapshot was loaded.
    schedule()
  }
  if (pending) {
    timer = setTimeout(() => {
      void flush().catch(error => {
        console.warn('Failed to persist recovered terminal workspace:', error)
      })
    }, WORKSPACE_SAVE_DEBOUNCE_MS)
  }
  const handlePageHide = () => {
    void flush().catch(error => {
      console.warn('Failed to flush terminal workspace recovery state:', error)
    })
  }
  window.addEventListener('pagehide', handlePageHide)

  return {
    flush,
    dispose: () => {
      releaseHostLoad()
      unsubscribe()
      window.removeEventListener('pagehide', handlePageHide)
      void flush().catch(error => {
        console.warn(
          'Failed to dispose terminal workspace recovery state:',
          error,
        )
      })
    },
  }
}
