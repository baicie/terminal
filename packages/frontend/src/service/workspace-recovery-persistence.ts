import { useAppStore } from '@/store/app'
import { useWorkspaceStore } from '@/store/workspace'
import {
  createRecoveryJournal,
  removeRecoveryJournal,
  writeRecoveryJournal,
  type PendingWorkspaceSnapshot,
} from './workspace-recovery-journal'
import {
  readRecoveryLayout,
  sanitizeWorkspaceRecoveryLayout,
} from './workspace-recovery-layout'

const WORKSPACE_SAVE_DEBOUNCE_MS = 1_000

export interface RecoveryPersistenceHandle {
  flush: () => Promise<void>
  dispose: () => void
}

export function createRecoveryPersistence({
  initialJournal,
  activeWorkspaceId,
  releaseHostLoad,
}: {
  initialJournal: PendingWorkspaceSnapshot | null
  activeWorkspaceId: string | null
  releaseHostLoad: () => void
}): RecoveryPersistenceHandle {
  let pending: PendingWorkspaceSnapshot | null = initialJournal
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
  // schedule() above already armed the debounce; arming a second timer here
  // would orphan the first one, which flush()/dispose() could never cancel.
  if (pending && timer === null) {
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
