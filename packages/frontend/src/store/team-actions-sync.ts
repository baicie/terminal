import {
  addSharedHost,
  addSharedSnippet,
  removeSharedHost,
  removeSharedSnippet,
} from '@/service/database'
import { convertApiShare, teamApi } from '@/service/team-api'
import type { SharedHost, SharedSnippet, TeamState } from './team-types'
import type { TeamStoreGet, TeamStoreSet } from './team-store-context'

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
      } = get()
      if (
        settings.enabled &&
        settings.mode === 'cloud' &&
        settings.endpoint &&
        settings.apiToken
      )
        teamApi.configure(
          settings.endpoint,
          settings.apiToken,
          userProfile?.id || '',
        )
      if (!settings.enabled || settings.mode !== 'cloud' || !currentTeam) return
      set({ isSyncing: true, syncError: null, syncConflicts: [] })
      try {
        const changesResponse = await teamApi.getChanges(
          get().lastSyncAt ?? undefined,
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
            if ('hostData' in converted)
              await addSharedHost({
                id: converted.id,
                team_id: settings.currentTeamId!,
                host_data: JSON.stringify(converted.hostData),
                shared_by: converted.sharedBy,
                permission: converted.permission,
                created_at: converted.createdAt,
              })
            else if ('snippetData' in converted)
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
        const localShares = [
          ...sharedHosts.map(item => ({ ...item, _type: 'HOST' as const })),
          ...sharedSnippets.map(item => ({
            ...item,
            _type: 'SNIPPET' as const,
          })),
        ]
        if (localShares.length > 0) {
          const conflictCheckItems = localShares
            .filter(item => item.createdAt)
            .map(item => ({
              id: item.id,
              updatedAt: item.createdAt,
              type:
                item._type === 'HOST'
                  ? ('HOST' as const)
                  : ('SNIPPET_PACKAGE' as const),
            }))
          if (conflictCheckItems.length > 0) {
            const conflicts = await teamApi.checkConflicts(conflictCheckItems)
            if (!conflicts.error && conflicts.data && conflicts.data.length > 0)
              set({ syncConflicts: conflicts.data })
          }
          const pushResult = await teamApi.pushChanges(
            localShares.map(item => ({
              id: item.id,
              teamId: currentTeam.id,
              type: item._type === 'HOST' ? 'HOST' : 'SNIPPET_PACKAGE',
              data:
                item._type === 'HOST'
                  ? (item as SharedHost).hostData
                  : (item as SharedSnippet).snippetData,
              permission: item.permission.toUpperCase() as
                | 'READONLY'
                | 'READWRITE',
              baseVersion: item.createdAt,
            })),
          )
          if (pushResult.error) throw new Error(pushResult.error)
          if (
            pushResult.data?.conflicts &&
            pushResult.data.conflicts.length > 0
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
      if (settings.endpoint && settings.apiToken)
        teamApi.configure(
          settings.endpoint,
          settings.apiToken,
          userProfile?.id || '',
        )
      const result = await teamApi.resolveConflict(
        shareId,
        resolution,
        localData
          ? { data: localData, isSensitive: false, permission: 'READONLY' }
          : undefined,
      )
      if (!result.error)
        set(state => ({
          syncConflicts: state.syncConflicts.filter(
            conflict => conflict.shareId !== shareId,
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
      if (settings.endpoint && settings.apiToken)
        teamApi.configure(
          settings.endpoint,
          settings.apiToken,
          userProfile?.id || '',
        )
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
