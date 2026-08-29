import { create } from 'zustand'
import { createCloudActions } from './team-actions-cloud'
import { createCoreActions } from './team-actions-core'
import { createDataActions } from './team-actions-data'
import { createSyncActions } from './team-actions-sync'
import type { TeamState } from './team-types'

export type {
  AuditLog,
  SharedHost,
  SharedSnippet,
  SyncConflict,
  Team,
  TeamInvite,
  TeamMember,
  TeamSettings,
  UserProfile,
} from './team-types'

export const useTeamStore = create<TeamState>((set, get) => ({
  userProfile: null,
  settings: {
    enabled: false,
    mode: 'local',
    autoSync: false,
    syncInterval: 30000,
  },
  teams: [],
  currentTeam: null,
  members: [],
  sharedHosts: [],
  sharedSnippets: [],
  invites: [],
  auditLogs: [],
  isSyncing: false,
  lastSyncAt: null,
  syncError: null,
  syncConflicts: [],
  offlineQueueCount: 0,
  isProcessingQueue: false,
  autoSyncInterval: null,
  ...createCoreActions(set, get),
  ...createDataActions(set, get),
  ...createSyncActions(set, get),
  ...createCloudActions(set, get),
}))

export function useIsTeamEnabled() {
  return useTeamStore(state => state.settings.enabled)
}

export function useIsCloudMode() {
  return useTeamStore(
    state => state.settings.enabled && state.settings.mode === 'cloud',
  )
}

export const useCurrentTeam = () => useTeamStore(state => state.currentTeam)
export const useTeams = () => useTeamStore(state => state.teams)
export const useUserId = () => useTeamStore(state => state.userProfile?.id)
