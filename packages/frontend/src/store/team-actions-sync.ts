import {
  removeSharedHost,
  removeSharedSnippet,
  removeUnauthorizedTeamShares,
} from '@/service/database'
import { teamApi } from '@/service/team-api'
import type { TeamState } from './team-types'
import type { TeamStoreGet, TeamStoreSet } from './team-store-context'
import type { SyncCursorScope } from './team-sync-engine'
import {
  MAX_SYNC_PAGES as SYNC_ROUND_PAGES,
  mergeConflicts,
  pullChanges,
  pushLocalShares,
} from './team-sync-engine'
import {
  adoptRemoteShare,
  buildLocalResolution,
  fetchRemoteSnapshot,
  findLocalShare,
} from './team-actions-sync-conflict'
import type { RemoteSnapshotValue } from './team-actions-sync-conflict'

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
      const local = findLocalShare(get, shareId)
      // The version the user was shown when they chose. A push-only conflict
      // carries no remote snapshot, and inventing one here is what made the write
      // unconditional, so it stays absent and the server refuses by name.
      const seenRemoteVersion
        = conflict !== undefined && typeof conflict.remoteVersion.version === 'number'
          ? conflict.remoteVersion.version
          : null
      const payload
        = resolution === 'LOCAL'
          ? buildLocalResolution(
              local,
              localData ?? conflict?.localVersion.data,
              seenRemoteVersion,
            )
          : undefined
      if (resolution === 'LOCAL' && payload === null) {
        // Without the stored row there is no honest security state to send, and
        // guessing one is the downgrade this path was rewritten to stop.
        set({ syncError: 'Cannot resolve this conflict: the share is no longer stored locally' })
        return
      }
      const outcome = await teamApi.resolveConflict(
        shareId,
        resolution,
        payload ?? undefined,
      )
      if (!outcome.ok) {
        // The conflict stays: nothing has converged, and dropping it here is how
        // a refused write became invisible (P9.2-3).
        set({ syncError: outcome.message })
        return
      }
      if (resolution === 'REMOTE') {
        // A conflict reported by a pull already carries the exact snapshot the
        // user was shown, so that copy is adopted as-is: re-reading the server
        // here would adopt a version newer than the one they agreed to. A
        // push-only conflict carries none, and only the server can supply it.
        const resolved
          = conflict !== undefined
            && typeof conflict.remoteVersion.version === 'number'
            ? {
                ok: true as const,
                snapshot: {
                  version: conflict.remoteVersion.version,
                  updatedAt: conflict.remoteVersion.updatedAt,
                  data: conflict.remoteVersion.data,
                  isSensitive: conflict.remoteVersion.isSensitive === true,
                  encryptedData: local.host?.encryptedData
                    ?? local.snippet?.encryptedData
                    ?? null,
                } satisfies RemoteSnapshotValue,
              }
            : await fetchRemoteSnapshot(local.teamId, shareId)
        if (!resolved.ok) {
          // The server has already accepted the resolution, but this device
          // cannot adopt the copy it was resolved to. Removing the conflict here
          // would hide the user's edit behind a row nobody can reconstruct, so it
          // stays and says which of the four situations it is (P9.2-4).
          if (resolved.reason === 'deleted') {
            // Nothing is left to adopt: the row the conflict was about is gone
            // from the server. Dropping the local copy and the conflict together
            // is the only honest convergence.
            await removeSharedHost(shareId)
            await removeSharedSnippet(shareId)
            await get().loadSharedHosts(local.teamId)
            await get().loadSharedSnippets(local.teamId)
          } else {
            set({ syncError: resolved.message })
            return
          }
        } else {
          const adopted = await adoptRemoteShare(get, shareId, resolved.snapshot)
          if (!adopted) {
            set({
              syncError:
                'The server accepted the resolution but the snapshot could not be stored; the conflict stays until it can be',
            })
            return
          }
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
