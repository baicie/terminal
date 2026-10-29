import type { TeamInviteRecord } from '@/service/database'
import {
  addTeamMember,
  createTeam,
  createTeamInvite,
  createUserProfile,
  deleteTeam,
  deleteTeamInvite,
  getSetting,
  getTeams,
  getUserProfile,
  setSetting,
  updateTeam,
} from '@/service/database'
import { toTeam, toUserProfile } from './team-types'
import type { Team, TeamInvite, TeamSettings, TeamState } from './team-types'
import type { TeamStoreGet, TeamStoreSet } from './team-store-context'

function generateInviteCode(teamSlug: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const randomBytes = crypto.getRandomValues(new Uint8Array(4))
  // The alphabet has 32 characters, so bit masking maps each byte uniformly.
  const random = Array.from(randomBytes, byte => chars[byte & 31]).join('')
  return `TEAM-${teamSlug.toUpperCase()}-${random}`
}

function generateLinkToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function createCoreActions(
  set: TeamStoreSet,
  get: TeamStoreGet,
): Pick<
  TeamState,
  | 'initialize'
  | 'ensureUserId'
  | 'updateUserProfile'
  | 'getSettings'
  | 'saveSettings'
  | 'startAutoSync'
  | 'stopAutoSync'
  | 'enableTeamMode'
  | 'disableTeamMode'
  | 'loadTeams'
  | 'createTeam'
  | 'updateTeam'
  | 'deleteTeam'
  | 'selectTeam'
  | 'createInvite'
  | 'deleteInvite'
> {
  return {
    async initialize() {
      await get().ensureUserId()
      const settings = await get().getSettings()
      await get().loadTeams()
      if (settings.enabled && settings.mode === 'cloud' && settings.autoSync)
        get().startAutoSync()
    },

    async ensureUserId() {
      let profile = await getUserProfile()
      if (!profile) {
        const id = crypto.randomUUID()
        const now = Date.now()
        await createUserProfile({
          id,
          name: 'User',
          created_at: now,
          updated_at: now,
        })
        profile = { id, name: 'User', created_at: now, updated_at: now }
      }
      set({ userProfile: toUserProfile(profile) })
      return profile.id
    },

    async updateUserProfile(id: string, updates: { name: string }) {
      const now = Date.now()
      await import('@/service/database').then(
        ({ updateUserProfile: dbUpdate }) =>
          dbUpdate(id, { name: updates.name, updated_at: now }),
      )
      const profile = get().userProfile
      if (profile && profile.id === id)
        set({ userProfile: { ...profile, name: updates.name, updatedAt: now } })
    },

    async getSettings() {
      const settings = await getSetting<TeamSettings>('team_settings', {
        enabled: false,
        mode: 'local',
        autoSync: false,
        syncInterval: 30000,
      })
      set({ settings })
      return settings
    },

    async saveSettings(newSettings: Partial<TeamSettings>) {
      const merged = { ...get().settings, ...newSettings }
      await setSetting('team_settings', merged)
      set({ settings: merged })
      get().stopAutoSync()
      if (merged.enabled && merged.mode === 'cloud' && merged.autoSync)
        get().startAutoSync()
    },

    async enableTeamMode(config: Partial<TeamSettings>) {
      await get().saveSettings({ ...config, enabled: true })
    },

    async disableTeamMode() {
      get().stopAutoSync()
      await get().saveSettings({
        enabled: false,
        mode: 'local',
        autoSync: false,
      })
      set({
        currentTeam: null,
        members: [],
        sharedHosts: [],
        sharedSnippets: [],
        invites: [],
        auditLogs: [],
      })
    },

    startAutoSync() {
      if (get().autoSyncInterval !== null) return
      const interval =
        get().settings.syncInterval > 0 ? get().settings.syncInterval : 30_000
      set({ autoSyncInterval: setInterval(() => get().sync(), interval) })
    },

    stopAutoSync() {
      const timer = get().autoSyncInterval
      if (timer === null) return
      clearInterval(timer)
      set({ autoSyncInterval: null })
    },

    async loadTeams() {
      const teams = (await getTeams()).map(toTeam)
      set({ teams })
      const { settings, currentTeam } = get()
      if (settings.currentTeamId && !currentTeam) {
        const team = teams.find(item => item.id === settings.currentTeamId)
        if (team) set({ currentTeam: team })
      }
    },

    async createTeam(name: string, mode: 'local' | 'cloud') {
      const userId = get().userProfile?.id || (await get().ensureUserId())
      const now = Date.now()
      const id = crypto.randomUUID()
      await createTeam({
        id,
        name,
        owner_id: userId,
        mode,
        auto_sync: 0,
        created_at: now,
        updated_at: now,
      })
      await addTeamMember({
        id: crypto.randomUUID(),
        team_id: id,
        user_id: userId,
        user_name: get().userProfile?.name,
        role: 'admin',
        joined_at: now,
      })
      const team: Team = {
        id,
        name,
        ownerId: userId,
        mode,
        autoSync: false,
        createdAt: now,
        updatedAt: now,
      }
      set(state => ({ teams: [...state.teams, team] }))
      set({ currentTeam: team })
      await get().saveSettings({ currentTeamId: id })
      return team
    },

    async updateTeam(id: string, updates: Partial<Team>) {
      const now = Date.now()
      await updateTeam(id, {
        name: updates.name,
        mode: updates.mode,
        endpoint: updates.endpoint,
        api_token: updates.apiToken,
        auto_sync: updates.autoSync ? 1 : 0,
        updated_at: now,
      })
      set(state => ({
        teams: state.teams.map(t =>
          t.id === id ? { ...t, ...updates, updatedAt: now } : t,
        ),
        currentTeam:
          state.currentTeam?.id === id
            ? { ...state.currentTeam, ...updates, updatedAt: now }
            : state.currentTeam,
      }))
    },

    async deleteTeam(id: string) {
      await deleteTeam(id)
      set(state => ({
        teams: state.teams.filter(t => t.id !== id),
        currentTeam: state.currentTeam?.id === id ? null : state.currentTeam,
      }))
      if (get().settings.currentTeamId === id)
        await get().saveSettings({ currentTeamId: undefined })
    },

    async selectTeam(id: string | null) {
      if (!id) {
        set({ currentTeam: null })
        return
      }
      const team = get().teams.find(item => item.id === id)
      if (team) {
        set({ currentTeam: team })
        await get().saveSettings({ currentTeamId: id })
        await get().loadMembers(id)
        await get().loadSharedHosts(id)
        await get().loadSharedSnippets(id)
        await get().loadInvites(id)
      }
    },

    async createInvite(
      teamId: string,
      type: 'link' | 'code' | 'email',
      email?: string,
      role: 'admin' | 'member' = 'member',
    ) {
      const id = crypto.randomUUID()
      const userId = get().userProfile?.id || ''
      const now = Date.now()
      const expiresAt = now + 7 * 24 * 60 * 60 * 1000
      const team = get().teams.find(item => item.id === teamId)
      const slug =
        team?.name.replace(/[^a-z0-9]/gi, '').substring(0, 4) || 'TEAM'
      const inviteRecord: TeamInviteRecord = {
        id,
        team_id: teamId,
        type,
        code: type === 'code' ? generateInviteCode(slug) : undefined,
        link_token: type === 'link' ? generateLinkToken() : undefined,
        email: type === 'email' ? email : undefined,
        role,
        created_by: userId,
        expires_at: expiresAt,
        created_at: now,
      }
      await createTeamInvite(inviteRecord)
      const invite: TeamInvite = {
        id,
        teamId,
        type,
        code: inviteRecord.code,
        linkToken: inviteRecord.link_token,
        email: inviteRecord.email,
        role,
        createdBy: userId,
        expiresAt,
        createdAt: now,
      }
      set(state => ({ invites: [...state.invites, invite] }))
      return invite
    },

    async deleteInvite(inviteId: string) {
      await deleteTeamInvite(inviteId)
      set(state => ({
        invites: state.invites.filter(item => item.id !== inviteId),
      }))
    },
  }
}
