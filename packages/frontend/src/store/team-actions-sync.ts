import {
  addSharedHost,
  addSharedSnippet,
  removeSharedHost,
  removeSharedSnippet,
} from '@/service/database'
import { convertApiShare, teamApi } from '@/service/team-api'
import type { SharedHost, SharedSnippet, TeamState } from './team-types'
import type { TeamStoreGet, TeamStoreSet } from './team-store-context'

const SYNC_CURSOR_STORAGE_KEY = 'terminal.team.syncCursor'

/**
 * The sync cursor is opaque and server issued: it is stored verbatim and sent
 * back unchanged. It is never derived from the local clock, and it is only
 * advanced once every change of the round has been applied, so a crash can only
 * cause a re-delivery, never a gap (docs/phase8/sync-protocol.md §5).
 */
function readStoredCursor(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(SYNC_CURSOR_STORAGE_KEY)
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
  } catch {
    return null
  }
}

function storeCursor(cursor: number | null): void {
  try {
    if (cursor === null) {
      globalThis.localStorage?.removeItem(SYNC_CURSOR_STORAGE_KEY)
      return
    }
    globalThis.localStorage?.setItem(SYNC_CURSOR_STORAGE_KEY, String(cursor))
  } catch {
    // Storage unavailable: the next round simply starts from a full resnapshot.
  }
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
      const {
        settings,
        currentTeam,
        userProfile,
        sharedHosts,
        sharedSnippets,
        isSyncing,
      } = get()
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
      // Conflicts from an earlier run stay visible until they are resolved;
      // clearing them here hid unreviewed conflicts behind a fresh sync.
      set({ isSyncing: true, syncError: null })
      try {
        const changesResponse = await teamApi.getChanges(
          readStoredCursor() ?? undefined,
        )
        if (changesResponse.error) throw new Error(changesResponse.error)
        if (changesResponse.data) {
          const { shares, deletedShareIds } = changesResponse.data
          for (const shareId of deletedShareIds) {
            await removeSharedHost(shareId)
            await removeSharedSnippet(shareId)
          }
          for (const apiShare of shares) {
            const converted = convertApiShare({
              id: apiShare.id,
              type: apiShare.type,
              data: apiShare.data,
              permission: apiShare.permission,
              sharedBy: apiShare.sharedBy,
              createdAt: apiShare.createdAt,
            })
            if ('hostData' in converted) {
              await addSharedHost({
                id: converted.id,
                team_id: settings.currentTeamId!,
                host_data: JSON.stringify(converted.hostData),
                shared_by: converted.sharedBy,
                permission: converted.permission,
                created_at: converted.createdAt,
              })
            } else if ('snippetData' in converted) {
              await addSharedSnippet({
                id: converted.id,
                team_id: settings.currentTeamId!,
                snippet_data: JSON.stringify(converted.snippetData),
                shared_by: converted.sharedBy,
                permission: converted.permission,
                created_at: converted.createdAt,
              })
            }
          }
        }
        const localShares = [
          ...sharedHosts.map(item => ({ ...item, _type: 'HOST' as const })),
          ...sharedSnippets.map(item => ({
            ...item,
            _type: 'SNIPPET' as const,
          })),
        ]
        if (localShares.length > 0) {
          // Declared CREATE: the server answers a replay of an already applied
          // create with an idempotent acknowledgement, and refuses to overwrite
          // a newer version instead of silently losing the remote change.
          const pushResult = await teamApi.pushChanges(
            localShares.map(item => ({
              id: item.id,
              teamId: currentTeam.id,
              type:
                item._type === 'HOST'
                  ? ('HOST' as const)
                  : ('SNIPPET_PACKAGE' as const),
              data:
                item._type === 'HOST'
                  ? (item as SharedHost).hostData
                  : (item as SharedSnippet).snippetData,
              permission: item.permission.toUpperCase() as
                | 'READONLY'
                | 'READWRITE',
              operation: 'CREATE' as const,
            })),
          )
          if (pushResult.error) throw new Error(pushResult.error)
          if (
            pushResult.data?.conflicts
            && pushResult.data.conflicts.length > 0
          ) {
            const conflictDetails = pushResult.data.conflicts.map(id => {
              const local = localShares.find(item => item.id === id)
              return {
                shareId: id,
                localVersion: {
                  updatedAt: local?.createdAt ?? 0,
                  data: local ?? {},
                },
                remoteVersion: { updatedAt: 0, data: {}, updatedBy: '' },
              }
            })
            set(state => ({
              syncConflicts: [...state.syncConflicts, ...conflictDetails],
            }))
          }
        }
        await get().loadSharedHosts(currentTeam.id)
        await get().loadSharedSnippets(currentTeam.id)
        // The cursor advances only after every change landed locally.
        storeCursor(changesResponse.data?.cursor ?? null)
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
      const result = await teamApi.resolveConflict(
        shareId,
        resolution,
        localData
          ? { data: localData, isSensitive: false, permission: 'READONLY' }
          : undefined,
      )
      if (!result.error) {
        set(state => ({
          syncConflicts: state.syncConflicts.filter(
            conflict => conflict.shareId !== shareId,
          ),
        }))
      }
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
