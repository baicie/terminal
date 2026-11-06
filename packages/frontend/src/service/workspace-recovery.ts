import type { WorkspaceLayout } from '@/types'
import {
  awaitWithRecoveryTimeout,
  throwIfRecoveryAborted,
} from './workspace-recovery-abort'
import { useHostStore } from '@/store/host'
import { useWorkspaceStore } from '@/store/workspace'
import {
  getWorkspaceRecoveryJournalKey,
  readRecoveryJournal,
  removeRecoveryJournal,
  type PendingWorkspaceSnapshot,
} from './workspace-recovery-journal'
import {
  chooseRecoveryLayout,
  sanitizeWorkspaceRecoveryLayout,
} from './workspace-recovery-layout'
import { commitRecoveryLayout } from './workspace-recovery-restore'
import { createRecoveryPersistence } from './workspace-recovery-persistence'
import {
  createWorkspaceRecoveryReporter,
  errorMessage,
  type WorkspaceRecoveryObservation,
} from './workspace-recovery-observation'

export { getWorkspaceRecoveryJournalKey, sanitizeWorkspaceRecoveryLayout }
export type {
  WorkspaceRecoveryObservation,
  WorkspaceRecoveryPhase,
} from './workspace-recovery-observation'

export const WORKSPACE_HOST_LOAD_TIMEOUT_MS = 1_500
export const WORKSPACE_LOAD_TIMEOUT_MS = 3_000
export const WORKSPACE_LAYOUT_LOAD_TIMEOUT_MS = 3_000

export interface WorkspaceRecoveryHandle {
  flush: () => Promise<void>
  dispose: () => void
}

export interface WorkspaceRecoveryOptions {
  signal?: AbortSignal
  /** The startup arbiter consumes these; they never contain host secrets. */
  onObservation?: (observation: WorkspaceRecoveryObservation) => void
}

export async function startWorkspaceRecovery(
  options: WorkspaceRecoveryOptions = {},
): Promise<WorkspaceRecoveryHandle> {
  const { signal } = options
  const reporter = createWorkspaceRecoveryReporter(options.onObservation)
  const { report } = reporter
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
    .then(hosts => hosts ?? null)
    .catch(error => {
      if (signal?.aborted) throw error
      console.warn('Failed to load hosts before workspace recovery:', error)
      return null
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
      return null
    } finally {
      releaseHostLoad()
    }
  }
  report('workspace-load-start')
  try {
    await awaitWithRecoveryTimeout(
      workspaceLoad,
      signal,
      WORKSPACE_LOAD_TIMEOUT_MS,
    )
  } catch (error) {
    // Keep the concurrent host query from mutating the store after this
    // attempt; workspace failure is already terminal for this retry.
    releaseHostLoad()
    throwIfRecoveryAborted(signal)
    report('workspace-load-failed', { reason: errorMessage(error) })
    throw error
  }
  throwIfRecoveryAborted(signal)

  const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId
  report('workspace-load-done', {
    workspaceId: activeWorkspaceId ?? undefined,
  })
  const savedLayoutPromise = activeWorkspaceId
    ? workspaceState.loadLayout(activeWorkspaceId)
    : Promise.resolve(null)
  report('layout-load-start', {
    workspaceId: activeWorkspaceId ?? undefined,
  })
  let savedLayout: WorkspaceLayout | null = null
  try {
    // A layout read failure is not "no layout". Let it reject so the caller
    // retries instead of persisting a local fallback over a recoverable saved
    // remote layout (Issue #184).
    savedLayout = await awaitWithRecoveryTimeout(
      savedLayoutPromise,
      signal,
      WORKSPACE_LAYOUT_LOAD_TIMEOUT_MS,
    )
  } catch (error) {
    throwIfRecoveryAborted(signal)
    report('layout-load-failed', {
      workspaceId: activeWorkspaceId ?? undefined,
      reason: errorMessage(error),
    })
    throw error
  }
  throwIfRecoveryAborted(signal)
  if (savedLayout !== null) {
    report('layout-load-done', {
      workspaceId: activeWorkspaceId ?? undefined,
      remoteLayoutExpected: savedLayout.tabs.some(tab => tab.type === 'remote'),
    })
  }
  let recoveredJournal: PendingWorkspaceSnapshot | null = null
  if (activeWorkspaceId) {
    recoveredJournal = readRecoveryJournal(
      activeWorkspaceId,
      sanitizeWorkspaceRecoveryLayout,
    )
    // A journal written from a provisional local fallback must not shadow a
    // real saved remote layout. That is how one failed sample poisoned the
    // next sample on a shared WebKit data store (run 41683645429, samples
    // 228/229): both `terminal-open-start` details carried the same
    // `local-1793728115282` tab id.
    const choice = chooseRecoveryLayout(recoveredJournal, savedLayout)
    if (choice.droppedJournal) {
      removeRecoveryJournal(choice.droppedJournal)
    }
    recoveredJournal = choice.journal
    const recoveryLayout = choice.layout
    // "Absent" is only true when neither the database nor the crash journal
    // has a layout. A DB miss with a journal hit is still a restorable layout.
    if (recoveryLayout === null) {
      report('layout-absent', { workspaceId: activeWorkspaceId })
    } else if (savedLayout === null) {
      report('layout-load-done', {
        workspaceId: activeWorkspaceId,
        remoteLayoutExpected: recoveryLayout.tabs.some(
          tab => tab.type === 'remote',
        ),
      })
    }
    const layoutNeedsHosts = recoveryLayout?.tabs.some(
      tab => tab.type === 'remote',
    )
    if (layoutNeedsHosts) {
      report('host-load-start', { workspaceId: activeWorkspaceId })
    }
    const loadedHosts = layoutNeedsHosts ? await awaitHostLoad() : null
    // A superseded concurrent load returns null but may still have populated
    // the store. Only a real, non-empty list or a definite empty result may
    // filter saved remote tabs; "unknown" must keep them.
    const storeHosts = useHostStore.getState().hosts ?? []
    const hostSnapshot =
      loadedHosts ?? (storeHosts.length > 0 ? storeHosts : null)
    const hostsLoaded = hostSnapshot !== null
    if (layoutNeedsHosts) {
      report(hostsLoaded ? 'host-load-done' : 'host-load-failed', {
        workspaceId: activeWorkspaceId,
        reason: hostsLoaded ? 'loaded' : 'unavailable',
      })
    }
    const hostIds = new Set((hostSnapshot ?? []).map(host => host.id))
    const sanitizedRecoveryLayout = recoveryLayout
      ? sanitizeWorkspaceRecoveryLayout(
          recoveryLayout,
          activeWorkspaceId,
          hostsLoaded ? hostIds : undefined,
        )
      : null
    const tabCount = sanitizedRecoveryLayout?.tabs.length ?? 0
    if (recoveryLayout && recoveryLayout.tabs.length > 0 && tabCount === 0) {
      // A saved layout exists but none of it can be restored right now (for
      // example every remote tab lost its host). Treating this as "absent"
      // would persist a local fallback over the user's saved remote layout.
      report('restore-layout-skipped', {
        workspaceId: activeWorkspaceId,
        reason: 'unrestorable-layout',
      })
      throw new Error(
        'A saved terminal layout exists, but no tab can be restored from it',
      )
    }
    if (sanitizedRecoveryLayout && tabCount > 0) {
      report('recovery-layout-available', {
        workspaceId: activeWorkspaceId,
        tabCount,
        remoteTabCount: sanitizedRecoveryLayout.tabs.filter(
          tab => tab.type === 'remote',
        ).length,
      })
    }
    recoveredJournal = commitRecoveryLayout({
      activeWorkspaceId,
      layout: sanitizedRecoveryLayout,
      journal: recoveredJournal,
      reporter,
    })
    if (layoutNeedsHosts && !hostsLoaded) recoveredJournal = null
  } else {
    // No active workspace means there is no layout to restore. Say so
    // explicitly instead of leaving the arbiter in `pending` for the whole
    // defer budget.
    report('layout-absent', {})
  }

  return createRecoveryPersistence({
    initialJournal: recoveredJournal,
    activeWorkspaceId,
    releaseHostLoad,
  })
}
