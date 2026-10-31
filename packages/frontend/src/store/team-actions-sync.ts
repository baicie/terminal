import {
  addSharedHost,
  addSharedSnippet,
  removeUnauthorizedTeamShares,
} from '@/service/database'
import { teamApi } from '@/service/team-api'
import type { TeamState } from './team-types'
import type { TeamStoreGet, TeamStoreSet } from './team-store-context'
import type { SyncCursorScope } from './team-sync-engine'
import {
  MAX_SYNC_PAGES as SYNC_ROUND_PAGES,
  hasData,
  mergeConflicts,
  pullChanges,
  pushLocalShares,
} from './team-sync-engine'

/**
 * Adopts a server snapshot the pull had to skip because the row carried a local
 * edit: the user chose the server's copy and the cursor already moved past it, so
 * the snapshot recorded with the conflict is the only way back to convergence.
 */
async function adoptRemoteShare(
  get: TeamStoreGet,
  shareId: string,
  remote: { version: number, updatedAt: number, data: unknown },
): Promise<void> {
  if (!hasData(remote.data)) return
  const host = get().sharedHosts.find(item => item.id === shareId)
  if (host !== undefined) {
    await addSharedHost(
      {
        id: host.id,
        team_id: host.teamId,
        host_data: JSON.stringify(remote.data),
        shared_by: host.sharedBy,
        permission: host.permission,
        created_at: host.createdAt,
        version: remote.version,
        updated_at: remote.updatedAt,
      },
      'override',
    )
    await get().loadSharedHosts(host.teamId)
    return
  }
  const snippet = get().sharedSnippets.find(item => item.id === shareId)
  if (snippet === undefined) return
  await addSharedSnippet(
    {
      id: snippet.id,
      team_id: snippet.teamId,
      snippet_data: JSON.stringify(remote.data),
      shared_by: snippet.sharedBy,
      permission: snippet.permission,
      created_at: snippet.createdAt,
      version: remote.version,
      updated_at: remote.updatedAt,
    },
    'override',
  )
  await get().loadSharedSnippets(snippet.teamId)
}

export function createSyncActions(
  set: TeamStoreSet,
  get: TeamStoreGet,
): Pick<
  TeamState,
  | 'sync'
  | 'syncWithConflictResolution'
  | 'getSyncConflicts'
  | 'clearSyncConflicts'
  | 'syncOfflineQueue'
  | 'getOfflineQueueCount'
  | 'setSyncing'
> {
  return {
    async sync() {
      const { settings, currentTeam, userProfile, isSyncing } = get()
      if (
        settings.enabled
        && settings.mode === 'cloud'
        && settings.endpoint
        && settings.apiToken
      ) {
        teamApi.configure(
          settings.endpoint,
          settings.apiToken,
          userProfile?.id || '',
        )
      }
      if (!settings.enabled || settings.mode !== 'cloud' || !currentTeam) return
      // A second run while one is in flight would push the same shares twice
      // and let the two runs overwrite each other's state.
      if (isSyncing) return
      // The cursor belongs to one server and one identity, never to one team:
      // the window covers every team this identity may read, and the server
      // redecides that scope on each request (docs/phase8/sync-protocol.md §3.8).
      // Without both identities it cannot be attributed, so this round has none
      // and the server answers with a full resnapshot.
      const scope: SyncCursorScope | null
        = settings.endpoint && userProfile?.id
          ? { endpoint: settings.endpoint, userId: userProfile.id }
          : null
      // Conflicts from an earlier run stay visible until they are resolved;
      // clearing them here hid unreviewed conflicts behind a fresh sync.
      set({ isSyncing: true, syncError: null })
      try {
        const pull = await pullChanges(get, scope)
        // Teams this identity may no longer read lose their local rows before
        // anything is reloaded or pushed: keeping them would leave revoked data
        // readable offline, and pushing them would aim writes at a team the
        // server has already refused.
        if (pull.authorizedTeams !== null) {
          await removeUnauthorizedTeamShares(pull.authorizedTeams)
        }
        // Reload before pushing, so the push starts from the versions that just
        // landed instead of a snapshot taken before the pull advanced them.
        await get().loadSharedHosts(currentTeam.id)
        await get().loadSharedSnippets(currentTeam.id)
        // A round that ran out of pages has not seen the whole window. The cursor it
        // persisted page by page resumes it on the next call, so nothing is lost by
        // stopping here — but pushing from a half-built picture would submit changes
        // against versions this round never reconciled, and "last synced" would claim
        // a completion the round cannot back.
        if (pull.hasMore) {
          set(state => ({
            syncConflicts: mergeConflicts(state.syncConflicts, pull.conflicts),
          }))
          console.warn(
            `[Sync] the change window is larger than one round of ${SYNC_ROUND_PAGES} pages; resuming on the next sync`,
          )
          return
        }
        const pushConflicts = await pushLocalShares(get, currentTeam.id)
        set(state => ({
          syncConflicts: mergeConflicts(state.syncConflicts, [
            ...pull.conflicts,
            ...pushConflicts,
          ]),
        }))
        // Display only: this local timestamp is never used as a cursor.
        set({ lastSyncAt: Date.now() })
      } catch (error) {
        console.error('Sync error:', error)
        set({
          syncError: error instanceof Error ? error.message : 'Sync failed',
        })
      } finally {
        set({ isSyncing: false })
      }
    },

    async syncWithConflictResolution(
      resolution: 'LOCAL' | 'REMOTE',
      shareId: string,
      localData?: unknown,
    ) {
      const { settings, userProfile } = get()
      if (!settings.enabled || settings.mode !== 'cloud') return
      if (settings.endpoint && settings.apiToken) {
        teamApi.configure(
          settings.endpoint,
          settings.apiToken,
          userProfile?.id || '',
        )
      }
      const conflict = get().syncConflicts.find(
        item => item.shareId === shareId,
      )
      const result = await teamApi.resolveConflict(
        shareId,
        resolution,
        resolution === 'LOCAL'
          ? {
              data: localData ?? conflict?.localVersion.data ?? {},
              isSensitive: false,
              permission: 'READONLY',
            }
          : undefined,
      )
      if (result.error) {
        set({ syncError: result.error })
        return
      }
      if (resolution === 'REMOTE' && conflict !== undefined) {
        const remote = conflict.remoteVersion
        if (typeof remote.version === 'number') {
          await adoptRemoteShare(get, shareId, {
            version: remote.version,
            updatedAt: remote.updatedAt,
            data: remote.data,
          })
        }
      }
      set(state => ({
        syncConflicts: state.syncConflicts.filter(
          item => item.shareId !== shareId,
        ),
      }))
    },
    getSyncConflicts() {
      return get().syncConflicts
    },
    clearSyncConflicts() {
      set({ syncConflicts: [] })
    },

    async syncOfflineQueue() {
      const { settings, userProfile } = get()
      if (!settings.enabled || settings.mode !== 'cloud') return
      if (settings.endpoint && settings.apiToken) {
        teamApi.configure(
          settings.endpoint,
          settings.apiToken,
          userProfile?.id || '',
        )
      }
      set({ isProcessingQueue: true })
      try {
        const result = await teamApi.processOfflineQueue()
        if (!result.error && result.data) {
          const pending = await teamApi.getPendingOperations()
          set({ offlineQueueCount: pending.data?.length ?? 0 })
        }
      } finally {
        set({ isProcessingQueue: false })
      }
    },
    getOfflineQueueCount() {
      return get().offlineQueueCount
    },
    setSyncing(isSyncing: boolean) {
      set({ isSyncing })
    },
  }
}
