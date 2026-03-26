import type {
  TeamAuditLogRecord,
  TeamInviteRecord,
  TeamMemberRecord,
  TeamRecord,
  TeamSharedHostRecord,
  TeamSharedSnippetRecord,
  UserProfileRecord,
} from '@/service/database'
import { create } from 'zustand'
import {
  addSharedHost,
  addSharedSnippet,
  addTeamAuditLog,
  addTeamMember,
  createTeam,
  createTeamInvite,
  createUserProfile,
  deleteTeam,
  deleteTeamInvite,
  getSetting,
  getSharedHosts,
  getSharedSnippets,
  getTeamAuditLogs,
  getTeamInvites,
  getTeamMembers,
  getTeams,
  getUserProfile,
  removeSharedHost,
  removeSharedSnippet,
  removeTeamMember,
  setSetting,
  updateTeam,
  updateTeamMember,
} from '@/service/database'
import {
  convertApiAuditLog,
  convertApiMember,
  convertApiShare,
  convertApiTeam,
  teamApi,
} from '@/service/team-api'

// Team collaboration types
export interface TeamSettings {
  enabled: boolean
  mode: 'local' | 'cloud'
  endpoint?: string
  apiToken?: string
  autoSync: boolean
  syncInterval: number
  currentTeamId?: string
}

export interface Team {
  id: string
  name: string
  ownerId: string
  mode: 'local' | 'cloud'
  endpoint?: string
  apiToken?: string
  autoSync: boolean
  createdAt: number
  updatedAt: number
}

export interface TeamMember {
  id: string
  teamId: string
  userId: string
  userName?: string
  userEmail?: string
  role: 'admin' | 'member'
  joinedAt: number
}

export interface SharedHost {
  id: string
  teamId: string
  hostData: Record<string, unknown>
  sharedBy: string
  permission: 'readonly' | 'readwrite'
  createdAt: number
}

export interface SharedSnippet {
  id: string
  teamId: string
  snippetData: Record<string, unknown>
  sharedBy: string
  permission: 'readonly' | 'readwrite'
  createdAt: number
}

export interface TeamInvite {
  id: string
  teamId: string
  type: 'link' | 'code' | 'email'
  code?: string
  linkToken?: string
  email?: string
  role: 'admin' | 'member'
  createdBy: string
  expiresAt: number
  usedAt?: number
  createdAt: number
}

export interface AuditLog {
  id: string
  teamId: string
  userId: string
  userName?: string
  hostName?: string
  action: string
  details?: Record<string, unknown>
  createdAt: number
}

export interface UserProfile {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

interface TeamState {
  // User profile
  userProfile: UserProfile | null

  // Team settings
  settings: TeamSettings

  // Teams
  teams: Team[]
  currentTeam: Team | null

  // Team data
  members: TeamMember[]
  sharedHosts: SharedHost[]
  sharedSnippets: SharedSnippet[]
  invites: TeamInvite[]
  auditLogs: AuditLog[]

  // Sync status
  isSyncing: boolean
  lastSyncAt: number | null
  syncError: string | null

  // Actions
  initialize: () => Promise<void>
  ensureUserId: () => Promise<string>

  // Settings actions
  getSettings: () => Promise<TeamSettings>
  saveSettings: (settings: Partial<TeamSettings>) => Promise<void>
  enableTeamMode: (config: Partial<TeamSettings>) => Promise<void>
  disableTeamMode: () => Promise<void>

  // Team actions
  loadTeams: () => Promise<void>
  createTeam: (name: string, mode: 'local' | 'cloud') => Promise<Team>
  updateTeam: (id: string, updates: Partial<Team>) => Promise<void>
  deleteTeam: (id: string) => Promise<void>
  selectTeam: (id: string | null) => Promise<void>

  // Member actions
  loadMembers: (teamId: string) => Promise<void>
  addMember: (
    teamId: string,
    userId: string,
    userName?: string,
    userEmail?: string,
    role?: 'admin' | 'member',
  ) => Promise<void>
  removeMember: (memberId: string) => Promise<void>
  updateMemberRole: (
    memberId: string,
    role: 'admin' | 'member',
  ) => Promise<void>

  // Share actions
  loadSharedHosts: (teamId: string) => Promise<void>
  shareHost: (
    teamId: string,
    hostData: Record<string, unknown>,
    permission: 'readonly' | 'readwrite',
  ) => Promise<void>
  unshareHost: (shareId: string) => Promise<void>

  loadSharedSnippets: (teamId: string) => Promise<void>
  shareSnippet: (
    teamId: string,
    snippetData: Record<string, unknown>,
    permission: 'readonly' | 'readwrite',
  ) => Promise<void>
  unshareSnippet: (shareId: string) => Promise<void>

  // Invite actions
  loadInvites: (teamId: string) => Promise<void>
  createInvite: (
    teamId: string,
    type: 'link' | 'code' | 'email',
    email?: string,
    role?: 'admin' | 'member',
  ) => Promise<TeamInvite>
  deleteInvite: (inviteId: string) => Promise<void>
  joinByCode: (
    code: string,
  ) => Promise<{ teamId: string; role: 'admin' | 'member' } | null>

  // Audit log actions
  loadAuditLogs: (teamId: string, limit?: number) => Promise<void>
  addAuditLog: (
    teamId: string,
    userId: string,
    userName: string,
    action: string,
    hostName?: string,
    details?: Record<string, unknown>,
  ) => Promise<void>

  // Sync actions
  sync: () => Promise<void>
  setSyncing: (isSyncing: boolean) => void

  // User profile actions
  updateUserProfile: (id: string, updates: { name: string }) => Promise<void>

  // Cloud mode specific actions
  cloudCreateTeam: (name: string) => Promise<Team | null>
  cloudLoadTeams: () => Promise<void>
  cloudLoadMembers: (teamId: string) => Promise<void>
  cloudLoadShares: (teamId: string) => Promise<void>
  cloudCreateShare: (
    teamId: string,
    type: 'HOST' | 'SNIPPET_PACKAGE',
    data: unknown,
    permission: 'readonly' | 'readwrite',
  ) => Promise<void>
  cloudDeleteShare: (teamId: string, shareId: string) => Promise<void>
  cloudCreateInvite: (
    teamId: string,
    type: 'LINK' | 'CODE' | 'EMAIL',
    email?: string,
    role?: 'admin' | 'member',
  ) => Promise<TeamInvite | null>
  cloudJoinByCode: (
    code: string,
    userName?: string,
  ) => Promise<{ teamId: string; role: 'admin' | 'member' } | null>
  cloudJoinByLink: (
    linkToken: string,
    userName?: string,
  ) => Promise<{ teamId: string; role: 'admin' | 'member' } | null>
  cloudLoadAuditLogs: (teamId: string, limit?: number) => Promise<void>
}

// Convert DB record to frontend type
function toTeam(record: TeamRecord): Team {
  return {
    id: record.id,
    name: record.name,
    ownerId: record.owner_id,
    mode: record.mode as 'local' | 'cloud',
    endpoint: record.endpoint,
    apiToken: record.api_token,
    autoSync: record.auto_sync === 1,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

function toTeamMember(record: TeamMemberRecord): TeamMember {
  return {
    id: record.id,
    teamId: record.team_id,
    userId: record.user_id,
    userName: record.user_name,
    userEmail: record.user_email,
    role: record.role as 'admin' | 'member',
    joinedAt: record.joined_at,
  }
}

function toSharedHost(record: TeamSharedHostRecord): SharedHost {
  return {
    id: record.id,
    teamId: record.team_id,
    hostData: JSON.parse(record.host_data),
    sharedBy: record.shared_by,
    permission: record.permission as 'readonly' | 'readwrite',
    createdAt: record.created_at,
  }
}

function toSharedSnippet(record: TeamSharedSnippetRecord): SharedSnippet {
  return {
    id: record.id,
    teamId: record.team_id,
    snippetData: JSON.parse(record.snippet_data),
    sharedBy: record.shared_by,
    permission: record.permission as 'readonly' | 'readwrite',
    createdAt: record.created_at,
  }
}

function toTeamInvite(record: TeamInviteRecord): TeamInvite {
  return {
    id: record.id,
    teamId: record.team_id,
    type: record.type as 'link' | 'code' | 'email',
    code: record.code,
    linkToken: record.link_token,
    email: record.email,
    role: record.role as 'admin' | 'member',
    createdBy: record.created_by,
    expiresAt: record.expires_at,
    usedAt: record.used_at,
    createdAt: record.created_at,
  }
}

function toAuditLog(record: TeamAuditLogRecord): AuditLog {
  return {
    id: record.id,
    teamId: record.team_id,
    userId: record.user_id,
    userName: record.user_name,
    hostName: record.host_name,
    action: record.action,
    details: record.details ? JSON.parse(record.details) : undefined,
    createdAt: record.created_at,
  }
}

function toUserProfile(record: UserProfileRecord): UserProfile {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

// Generate invite code
function generateInviteCode(teamSlug: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const random = Array.from({ length: 4 })
    .fill(chars[Math.floor(Math.random() * chars.length)])
    .join('')
  return `TEAM-${teamSlug.toUpperCase()}-${random}`
}

// Generate invite link token
function generateLinkToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export const useTeamStore = create<TeamState>((set, get) => ({
  // Initial state
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

  // Initialize team store
  async initialize() {
    await get().ensureUserId()
    await get().getSettings()
    await get().loadTeams()
  },

  // Ensure user has a UUID
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
      profile = {
        id,
        name: 'User',
        created_at: now,
        updated_at: now,
      }
    }
    set({ userProfile: toUserProfile(profile) })
    return profile.id
  },

  // Update user profile
  async updateUserProfile(id: string, updates: { name: string }) {
    const now = Date.now()
    await import('@/service/database').then(
      ({ updateUserProfile: dbUpdate }) => dbUpdate(id, { name: updates.name, updated_at: now }),
    )
    const profile = get().userProfile
    if (profile && profile.id === id) {
      set({ userProfile: { ...profile, name: updates.name, updatedAt: now } })
    }
  },

  // Get settings from database
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

  // Save settings to database
  async saveSettings(newSettings: Partial<TeamSettings>) {
    const current = get().settings
    const merged = { ...current, ...newSettings }
    await setSetting('team_settings', merged)
    set({ settings: merged })
  },

  // Enable team mode
  async enableTeamMode(config: Partial<TeamSettings>) {
    await get().saveSettings({ ...config, enabled: true })
  },

  // Disable team mode
  async disableTeamMode() {
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

  // Load all teams
  async loadTeams() {
    const records = await getTeams()
    const teams = records.map(toTeam)
    set({ teams })

    // Auto-select first team if currentTeamId is set
    const { settings, currentTeam } = get()
    if (settings.currentTeamId && !currentTeam) {
      const team = teams.find(t => t.id === settings.currentTeamId)
      if (team) {
        set({ currentTeam: team })
      }
    }
  },

  // Create a new team
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

    // Add creator as admin member
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

    // Auto-select the new team
    set({ currentTeam: team })
    await get().saveSettings({ currentTeamId: id })

    return team
  },

  // Update team
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

  // Delete team
  async deleteTeam(id: string) {
    await deleteTeam(id)
    set(state => ({
      teams: state.teams.filter(t => t.id !== id),
      currentTeam: state.currentTeam?.id === id ? null : state.currentTeam,
    }))

    if (get().settings.currentTeamId === id) {
      await get().saveSettings({ currentTeamId: undefined })
    }
  },

  // Select team
  async selectTeam(id: string | null) {
    if (!id) {
      set({ currentTeam: null })
      return
    }

    const team = get().teams.find(t => t.id === id)
    if (team) {
      set({ currentTeam: team })
      await get().saveSettings({ currentTeamId: id })
      await get().loadMembers(id)
      await get().loadSharedHosts(id)
      await get().loadSharedSnippets(id)
      await get().loadInvites(id)
    }
  },

  // Load team members
  async loadMembers(teamId: string) {
    const records = await getTeamMembers(teamId)
    set({ members: records.map(toTeamMember) })
  },

  // Add team member
  async addMember(
    teamId: string,
    userId: string,
    userName?: string,
    userEmail?: string,
    role: 'admin' | 'member' = 'member',
  ) {
    const id = crypto.randomUUID()
    const now = Date.now()
    await addTeamMember({
      id,
      team_id: teamId,
      user_id: userId,
      user_name: userName || undefined,
      user_email: userEmail || undefined,
      role,
      joined_at: now,
    })

    const member: TeamMember = {
      id,
      teamId,
      userId,
      userName,
      userEmail,
      role,
      joinedAt: now,
    }

    set(state => ({ members: [...state.members, member] }))
  },

  // Remove team member
  async removeMember(memberId: string) {
    await removeTeamMember(memberId)
    set(state => ({ members: state.members.filter(m => m.id !== memberId) }))
  },

  // Update member role
  async updateMemberRole(memberId: string, role: 'admin' | 'member') {
    await updateTeamMember(memberId, { role })
    set(state => ({
      members: state.members.map(m => (m.id === memberId ? { ...m, role } : m)),
    }))
  },

  // Load shared hosts
  async loadSharedHosts(teamId: string) {
    const records = await getSharedHosts(teamId)
    set({ sharedHosts: records.map(toSharedHost) })
  },

  // Share a host
  async shareHost(
    teamId: string,
    hostData: Record<string, unknown>,
    permission: 'readonly' | 'readwrite',
  ) {
    const id = crypto.randomUUID()
    const userId = get().userProfile?.id || ''
    const now = Date.now()

    await addSharedHost({
      id,
      team_id: teamId,
      host_data: JSON.stringify(hostData),
      shared_by: userId,
      permission,
      created_at: now,
    })

    const sharedHost: SharedHost = {
      id,
      teamId,
      hostData,
      sharedBy: userId,
      permission,
      createdAt: now,
    }

    set(state => ({ sharedHosts: [...state.sharedHosts, sharedHost] }))
  },

  // Unshare a host
  async unshareHost(shareId: string) {
    await removeSharedHost(shareId)
    set(state => ({
      sharedHosts: state.sharedHosts.filter(h => h.id !== shareId),
    }))
  },

  // Load shared snippets
  async loadSharedSnippets(teamId: string) {
    const records = await getSharedSnippets(teamId)
    set({ sharedSnippets: records.map(toSharedSnippet) })
  },

  // Share a snippet
  async shareSnippet(
    teamId: string,
    snippetData: Record<string, unknown>,
    permission: 'readonly' | 'readwrite',
  ) {
    const id = crypto.randomUUID()
    const userId = get().userProfile?.id || ''
    const now = Date.now()

    await addSharedSnippet({
      id,
      team_id: teamId,
      snippet_data: JSON.stringify(snippetData),
      shared_by: userId,
      permission,
      created_at: now,
    })

    const sharedSnippet: SharedSnippet = {
      id,
      teamId,
      snippetData,
      sharedBy: userId,
      permission,
      createdAt: now,
    }

    set(state => ({ sharedSnippets: [...state.sharedSnippets, sharedSnippet] }))
  },

  // Unshare a snippet
  async unshareSnippet(shareId: string) {
    await removeSharedSnippet(shareId)
    set(state => ({
      sharedSnippets: state.sharedSnippets.filter(s => s.id !== shareId),
    }))
  },

  // Load team invites
  async loadInvites(teamId: string) {
    const records = await getTeamInvites(teamId)
    set({ invites: records.map(toTeamInvite) })
  },

  // Create invite
  async createInvite(
    teamId: string,
    type: 'link' | 'code' | 'email',
    email?: string,
    role: 'admin' | 'member' = 'member',
  ) {
    const id = crypto.randomUUID()
    const userId = get().userProfile?.id || ''
    const now = Date.now()
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000 // 7 days

    const team = get().teams.find(t => t.id === teamId)
    const slug = team?.name.replace(/[^a-z0-9]/gi, '').substring(0, 4) || 'TEAM'

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

  // Delete invite
  async deleteInvite(inviteId: string) {
    await deleteTeamInvite(inviteId)
    set(state => ({ invites: state.invites.filter(i => i.id !== inviteId) }))
  },

  // Join team by code
  async joinByCode(_code: string) {
    // This is for cloud mode - local mode uses JSON import
    // For now, return null as this requires server
    return null
  },

  // Load audit logs
  async loadAuditLogs(teamId: string, limit = 100) {
    const records = await getTeamAuditLogs(teamId, limit)
    set({ auditLogs: records.map(toAuditLog) })
  },

  // Add audit log
  async addAuditLog(
    teamId: string,
    userId: string,
    userName: string,
    action: string,
    hostName?: string,
    details?: Record<string, unknown>,
  ) {
    const id = crypto.randomUUID()
    const now = Date.now()

    await addTeamAuditLog({
      id,
      team_id: teamId,
      user_id: userId,
      user_name: userName || undefined,
      host_name: hostName || undefined,
      action,
      details: details ? JSON.stringify(details) : undefined,
      created_at: now,
    })

    const log: AuditLog = {
      id,
      teamId,
      userId,
      userName,
      hostName,
      action,
      details,
      createdAt: now,
    }

    set(state => ({ auditLogs: [log, ...state.auditLogs] }))
  },

  // Sync for cloud mode
  async sync() {
    const { settings, currentTeam, userProfile } = get()

    // Configure API if in cloud mode
    if (
      settings.enabled &&
      settings.mode === 'cloud' &&
      settings.endpoint &&
      settings.apiToken
    ) {
      teamApi.configure(
        settings.endpoint,
        settings.apiToken,
        userProfile?.id || '',
      )
    }

    if (!settings.enabled || settings.mode !== 'cloud' || !currentTeam) {
      return
    }

    set({ isSyncing: true, syncError: null })

    try {
      // 1. Get changes from server since lastSyncAt
      const since = get().lastSyncAt ?? undefined
      const changesResponse = await teamApi.getChanges(since)

      if (changesResponse.error) {
        throw new Error(changesResponse.error)
      }

      // 2. Update local data from server changes
      if (changesResponse.data) {
        const { shares } = changesResponse.data

        // Update shared hosts/snippets from server
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
            // It's a shared host
            if (settings.currentTeamId) {
              await addSharedHost({
                id: converted.id,
                team_id: settings.currentTeamId,
                host_data: JSON.stringify(converted.hostData),
                shared_by: converted.sharedBy,
                permission: converted.permission,
                created_at: converted.createdAt,
              })
            }
          } else if ('snippetData' in converted) {
            // It's a shared snippet
            if (settings.currentTeamId) {
              await addSharedSnippet({
                id: converted.id,
                team_id: settings.currentTeamId,
                snippet_data: JSON.stringify(converted.snippetData),
                shared_by: converted.sharedBy,
                permission: converted.permission,
                created_at: converted.createdAt,
              })
            }
          }
        }
      }

      // 3. Reload local data
      if (currentTeam) {
        await get().loadSharedHosts(currentTeam.id)
        await get().loadSharedSnippets(currentTeam.id)
      }

      set({ lastSyncAt: Date.now() })
    } catch (error) {
      console.error('Sync error:', error)
      set({ syncError: error instanceof Error ? error.message : 'Sync failed' })
    } finally {
      set({ isSyncing: false })
    }
  },

  // Set syncing state
  setSyncing(isSyncing: boolean) {
    set({ isSyncing })
  },

  // ==================== Cloud Mode Actions ====================

  // Create team on cloud server
  async cloudCreateTeam(name: string): Promise<Team | null> {
    const { settings, userProfile } = get()

    if (
      !settings.enabled ||
      settings.mode !== 'cloud' ||
      !settings.endpoint ||
      !settings.apiToken
    ) {
      return null
    }

    teamApi.configure(
      settings.endpoint,
      settings.apiToken,
      userProfile?.id || '',
    )

    const response = await teamApi.createTeam(name)
    if (response.error || !response.data) {
      console.error('Cloud create team error:', response.error)
      return null
    }

    const team = convertApiTeam(response.data)
    set(state => ({ teams: [...state.teams, team] }))
    return team
  },

  // Load teams from cloud server
  async cloudLoadTeams(): Promise<void> {
    const { settings, userProfile } = get()

    if (
      !settings.enabled ||
      settings.mode !== 'cloud' ||
      !settings.endpoint ||
      !settings.apiToken
    ) {
      return
    }

    teamApi.configure(
      settings.endpoint,
      settings.apiToken,
      userProfile?.id || '',
    )

    const response = await teamApi.listTeams()
    if (response.error || !response.data) {
      console.error('Cloud load teams error:', response.error)
      return
    }

    const teams = response.data.map(convertApiTeam)
    set({ teams })
  },

  // Load members from cloud server
  async cloudLoadMembers(teamId: string): Promise<void> {
    const { settings, userProfile } = get()

    if (!settings.enabled || settings.mode !== 'cloud') return

    teamApi.configure(
      settings.endpoint || '',
      settings.apiToken || '',
      userProfile?.id || '',
    )

    const response = await teamApi.listMembers(teamId)
    if (response.error || !response.data) {
      console.error('Cloud load members error:', response.error)
      return
    }

    const members = response.data.map(m => ({ ...convertApiMember(m), teamId }))
    set({ members })
  },

  // Load shares from cloud server
  async cloudLoadShares(teamId: string): Promise<void> {
    const { settings, userProfile } = get()

    if (!settings.enabled || settings.mode !== 'cloud') return

    teamApi.configure(
      settings.endpoint || '',
      settings.apiToken || '',
      userProfile?.id || '',
    )

    const response = await teamApi.listShares(teamId)
    if (response.error || !response.data) {
      console.error('Cloud load shares error:', response.error)
      return
    }

    const sharedHosts: SharedHost[] = []
    const sharedSnippets: SharedSnippet[] = []

    for (const apiShare of response.data) {
      const converted = convertApiShare({
        ...apiShare,
        createdAt: apiShare.createdAt?.toString() || new Date().toISOString(),
      })
      converted.teamId = teamId
      if ('hostData' in converted) {
        sharedHosts.push(converted as SharedHost)
      } else {
        sharedSnippets.push(converted as SharedSnippet)
      }
    }

    set({ sharedHosts, sharedSnippets })
  },

  // Create share on cloud server
  async cloudCreateShare(
    teamId: string,
    type: 'HOST' | 'SNIPPET_PACKAGE',
    data: unknown,
    permission: 'readonly' | 'readwrite',
  ): Promise<void> {
    const { settings, userProfile } = get()

    if (!settings.enabled || settings.mode !== 'cloud') return

    teamApi.configure(
      settings.endpoint || '',
      settings.apiToken || '',
      userProfile?.id || '',
    )

    const apiType = type === 'HOST' ? 'HOST' : 'SNIPPET_PACKAGE'
    const apiPermission = permission.toUpperCase() as 'READONLY' | 'READWRITE'

    const response = await teamApi.createShare(
      teamId,
      apiType,
      data,
      apiPermission,
    )
    if (response.error) {
      console.error('Cloud create share error:', response.error)
    }
  },

  // Delete share on cloud server
  async cloudDeleteShare(teamId: string, shareId: string): Promise<void> {
    const { settings, userProfile } = get()

    if (!settings.enabled || settings.mode !== 'cloud') return

    teamApi.configure(
      settings.endpoint || '',
      settings.apiToken || '',
      userProfile?.id || '',
    )

    const response = await teamApi.deleteShare(teamId, shareId)
    if (response.error) {
      console.error('Cloud delete share error:', response.error)
    }
  },

  // Create invite on cloud server
  async cloudCreateInvite(
    teamId: string,
    type: 'LINK' | 'CODE' | 'EMAIL',
    email?: string,
    role: 'admin' | 'member' = 'member',
  ): Promise<TeamInvite | null> {
    const { settings, userProfile } = get()

    if (!settings.enabled || settings.mode !== 'cloud') return null

    teamApi.configure(
      settings.endpoint || '',
      settings.apiToken || '',
      userProfile?.id || '',
    )

    const apiRole = role.toUpperCase() as 'ADMIN' | 'MEMBER'
    const response = await teamApi.createInvite(teamId, type, email, apiRole)

    if (response.error || !response.data) {
      console.error('Cloud create invite error:', response.error)
      return null
    }

    const invite: TeamInvite = {
      id: response.data.id,
      teamId,
      type: type.toLowerCase() as 'link' | 'code' | 'email',
      code: response.data.code,
      linkToken: response.data.linkToken,
      email,
      role,
      createdBy: userProfile?.id || '',
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    }

    set(state => ({ invites: [...state.invites, invite] }))
    return invite
  },

  // Join team by code from cloud server
  async cloudJoinByCode(
    code: string,
    userName?: string,
  ): Promise<{ teamId: string; role: 'admin' | 'member' } | null> {
    const { settings, userProfile } = get()

    if (!settings.enabled || settings.mode !== 'cloud') return null

    teamApi.configure(
      settings.endpoint || '',
      settings.apiToken || '',
      userProfile?.id || '',
    )

    const response = await teamApi.joinByCode(code, userName)

    if (response.error || !response.data) {
      console.error('Cloud join by code error:', response.error)
      return null
    }

    return {
      teamId: response.data.teamId,
      role: response.data.role.toLowerCase() as 'admin' | 'member',
    }
  },

  // Join team by link from cloud server
  async cloudJoinByLink(
    linkToken: string,
    userName?: string,
  ): Promise<{ teamId: string; role: 'admin' | 'member' } | null> {
    const { settings, userProfile } = get()

    if (!settings.enabled || settings.mode !== 'cloud') return null

    teamApi.configure(
      settings.endpoint || '',
      settings.apiToken || '',
      userProfile?.id || '',
    )

    const response = await teamApi.joinByLink(linkToken, userName)

    if (response.error || !response.data) {
      console.error('Cloud join by link error:', response.error)
      return null
    }

    return {
      teamId: response.data.teamId,
      role: response.data.role.toLowerCase() as 'admin' | 'member',
    }
  },

  // Load audit logs from cloud server
  async cloudLoadAuditLogs(teamId: string, limit = 100): Promise<void> {
    const { settings, userProfile } = get()

    if (!settings.enabled || settings.mode !== 'cloud') return

    teamApi.configure(
      settings.endpoint || '',
      settings.apiToken || '',
      userProfile?.id || '',
    )

    const response = await teamApi.listAuditLogs(teamId, limit)
    if (response.error || !response.data) {
      console.error('Cloud load audit logs error:', response.error)
      return
    }

    const auditLogs = response.data.map(log => ({
      ...convertApiAuditLog({
        ...log,
        createdAt: log.createdAt?.toString() || new Date().toISOString(),
      }),
      teamId,
    }))
    set({ auditLogs })
  },
}))

// Selector helpers
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
