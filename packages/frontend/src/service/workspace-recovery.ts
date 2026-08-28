import type { Tab, WorkspaceLayout } from '@/types'
import { normalizeTerminalLayout } from '@/store/app-terminal-layout'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { useWorkspaceStore } from '@/store/workspace'

const WORKSPACE_SAVE_DEBOUNCE_MS = 1_000
const WORKSPACE_RECOVERY_JOURNAL_VERSION = 1
const WORKSPACE_RECOVERY_JOURNAL_PREFIX = 'terminal.workspace.recovery.v1.'

interface PendingWorkspaceSnapshot {
  workspaceId: string
  layout: WorkspaceLayout
  journalValue: string
}

interface WorkspaceRecoveryJournal {
  version: 1
  savedAt: number
  layout: WorkspaceLayout
}

export interface WorkspaceRecoveryHandle {
  flush: () => Promise<void>
  dispose: () => void
}

export function getWorkspaceRecoveryJournalKey(workspaceId: string): string {
  return `${WORKSPACE_RECOVERY_JOURNAL_PREFIX}${workspaceId}`
}

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

function createRecoveryJournal(
  workspaceId: string,
  layout: WorkspaceLayout,
): PendingWorkspaceSnapshot {
    const sanitized = sanitizeWorkspaceRecoveryLayout(layout, workspaceId)
  const journal: WorkspaceRecoveryJournal = {
    version: WORKSPACE_RECOVERY_JOURNAL_VERSION,
    savedAt: Date.now(),
    layout: sanitized,
  }
  return {
    workspaceId,
    layout: sanitized,
    journalValue: JSON.stringify(journal),
  }
}

function writeRecoveryJournal(snapshot: PendingWorkspaceSnapshot): void {
  try {
    localStorage.setItem(
      getWorkspaceRecoveryJournalKey(snapshot.workspaceId),
      snapshot.journalValue,
    )
  } catch (error) {
    console.warn('Failed to journal terminal workspace recovery state:', error)
  }
}

function readRecoveryJournal(
  workspaceId: string,
): PendingWorkspaceSnapshot | null {
  const key = getWorkspaceRecoveryJournalKey(workspaceId)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WorkspaceRecoveryJournal>
    if (
      parsed.version !== WORKSPACE_RECOVERY_JOURNAL_VERSION ||
      !parsed.layout ||
      typeof parsed.layout !== 'object'
    ) {
      localStorage.removeItem(key)
      return null
    }
    const snapshot = createRecoveryJournal(workspaceId, parsed.layout)
    writeRecoveryJournal(snapshot)
    return snapshot
  } catch (error) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Storage may be unavailable; SQLite recovery still remains usable.
    }
    console.warn(
      'Ignored an invalid terminal workspace recovery journal:',
      error,
    )
    return null
  }
}

function removeRecoveryJournal(snapshot: PendingWorkspaceSnapshot): void {
  const key = getWorkspaceRecoveryJournalKey(snapshot.workspaceId)
  try {
    if (localStorage.getItem(key) === snapshot.journalValue) {
      localStorage.removeItem(key)
    }
  } catch {
    // The sanitized journal is safe to retry on the next launch.
  }
}

export async function startWorkspaceRecovery(): Promise<WorkspaceRecoveryHandle> {
  const workspaceState = useWorkspaceStore.getState()
  const workspaceLoad = workspaceState.loadWorkspaces()
  const hostLoad = useHostStore
    .getState()
    .loadHosts()
    .catch(error => {
      console.warn('Failed to load hosts before workspace recovery:', error)
    })
  await workspaceLoad

  const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId
  const savedLayoutPromise = activeWorkspaceId
    ? workspaceState.loadLayout(activeWorkspaceId)
    : Promise.resolve(null)
  const [savedLayout] = await Promise.all([savedLayoutPromise, hostLoad])
  let recoveredJournal: PendingWorkspaceSnapshot | null = null
  if (activeWorkspaceId) {
    recoveredJournal = readRecoveryJournal(activeWorkspaceId)
    const hostIds = new Set(
      (useHostStore.getState().hosts ?? []).map(host => host.id),
    )
    const recoveryLayout = recoveredJournal?.layout ?? savedLayout
    if (recoveryLayout) {
      const sanitizedRecoveryLayout = sanitizeWorkspaceRecoveryLayout(
        recoveryLayout,
        activeWorkspaceId,
        hostIds,
      )
      if (recoveredJournal) {
        recoveredJournal = createRecoveryJournal(
          activeWorkspaceId,
          sanitizedRecoveryLayout,
        )
      }
      useAppStore
        .getState()
        .restoreLayout(sanitizedRecoveryLayout)
    }
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

  const schedule = () => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId
    if (!workspaceId) return
    pending = createRecoveryJournal(
      workspaceId,
      readRecoveryLayout(workspaceId),
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
