import type {
  TeamAuditLogRecord,
  TeamInviteRecord,
  TeamMemberRecord,
  TeamRecord,
  TeamSharedHostRecord,
  TeamSharedSnippetRecord,
  UserProfileRecord,
} from '@/service/database'

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

export interface SyncConflict {
  shareId: string
  localVersion: { updatedAt: number; data: unknown }
  remoteVersion: { updatedAt: number; data: unknown; updatedBy: string }
}

export interface TeamState {
  userProfile: UserProfile | null
  settings: TeamSettings
  teams: Team[]
  currentTeam: Team | null
  members: TeamMember[]
  sharedHosts: SharedHost[]
  sharedSnippets: SharedSnippet[]
  invites: TeamInvite[]
  auditLogs: AuditLog[]
  isSyncing: boolean
  lastSyncAt: number | null
  syncError: string | null
  syncConflicts: SyncConflict[]
  offlineQueueCount: number
  isProcessingQueue: boolean
  autoSyncInterval: ReturnType<typeof setInterval> | null
  initialize: () => Promise<void>
  ensureUserId: () => Promise<string>
  getSettings: () => Promise<TeamSettings>
  saveSettings: (settings: Partial<TeamSettings>) => Promise<void>
  startAutoSync: () => void
  stopAutoSync: () => void
  enableTeamMode: (config: Partial<TeamSettings>) => Promise<void>
  disableTeamMode: () => Promise<void>
  loadTeams: () => Promise<void>
  createTeam: (name: string, mode: 'local' | 'cloud') => Promise<Team>
  updateTeam: (id: string, updates: Partial<Team>) => Promise<void>
  deleteTeam: (id: string) => Promise<void>
  selectTeam: (id: string | null) => Promise<void>
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
  joinByLink: (
    linkToken: string,
  ) => Promise<{ teamId: string; role: 'admin' | 'member' } | null>
  loadAuditLogs: (teamId: string, limit?: number) => Promise<void>
  addAuditLog: (
    teamId: string,
    userId: string,
    userName: string,
    action: string,
    hostName?: string,
    details?: Record<string, unknown>,
  ) => Promise<void>
  sync: () => Promise<void>
  setSyncing: (isSyncing: boolean) => void
  syncWithConflictResolution: (
    resolution: 'LOCAL' | 'REMOTE',
    shareId: string,
    localData?: unknown,
  ) => Promise<void>
  getSyncConflicts: () => SyncConflict[]
  clearSyncConflicts: () => void
  syncOfflineQueue: () => Promise<void>
  getOfflineQueueCount: () => number
  updateUserProfile: (id: string, updates: { name: string }) => Promise<void>
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

export function toTeam(record: TeamRecord): Team {
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
export function toTeamMember(record: TeamMemberRecord): TeamMember {
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
export function toSharedHost(record: TeamSharedHostRecord): SharedHost {
  return {
    id: record.id,
    teamId: record.team_id,
    hostData: JSON.parse(record.host_data),
    sharedBy: record.shared_by,
    permission: record.permission as 'readonly' | 'readwrite',
    createdAt: record.created_at,
  }
}
export function toSharedSnippet(
  record: TeamSharedSnippetRecord,
): SharedSnippet {
  return {
    id: record.id,
    teamId: record.team_id,
    snippetData: JSON.parse(record.snippet_data),
    sharedBy: record.shared_by,
    permission: record.permission as 'readonly' | 'readwrite',
    createdAt: record.created_at,
  }
}
export function toTeamInvite(record: TeamInviteRecord): TeamInvite {
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
export function toAuditLog(record: TeamAuditLogRecord): AuditLog {
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
export function toUserProfile(record: UserProfileRecord): UserProfile {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}
