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

/** Result of creating a cloud team through the real server. */
export interface CloudTeamCreateResult {
  ok: boolean
  team: Team | null
  /** True when a server team with this name already existed and was adopted. */
  adopted?: boolean
  /** Server id, present even when local persistence failed and a retry must adopt. */
  serverTeamId?: string
  stage?: 'validate' | 'create' | 'persist' | 'settings'
  error?: string
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
  /** Server-issued version this copy is based on; null when the server has never seen it. */
  version?: number | null
  /** Last server-side change, used to display and to report conflicts. */
  updatedAt?: number
  /**
   * Server security state. A conflict resolution must send these back unchanged:
   * a client that guesses them is how a sensitive share became plaintext (P9.2-2).
   */
  isSensitive?: boolean
  /** Ciphertext of a sensitive share; never the plaintext payload. */
  encryptedData?: string | null
}

export interface SharedSnippet {
  id: string
  teamId: string
  snippetData: Record<string, unknown>
  sharedBy: string
  permission: 'readonly' | 'readwrite'
  createdAt: number
  /** Server-issued version this copy is based on; null when the server has never seen it. */
  version?: number | null
  /** Last server-side change, used to display and to report conflicts. */
  updatedAt?: number
  /** Server security state; see SharedHost. */
  isSensitive?: boolean
  /** Ciphertext of a sensitive share; see SharedHost. */
  encryptedData?: string | null
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
  /** Share kind, so a resolution can fetch or adopt the right resource. */
  shareType?: 'HOST' | 'SNIPPET_PACKAGE'
  localVersion: { updatedAt: number; data: unknown }
  remoteVersion: {
    updatedAt: number
    data: unknown
    updatedBy: string
    /** Server version of the snapshot a pull had to skip; absent on a push-only report. */
    version?: number | null
    /** True when the remote copy is sensitive and `data` is only a placeholder. */
    isSensitive?: boolean
    /**
     * The server's ciphertext for a sensitive snapshot.
     *
     * It belongs to the snapshot, not to the local row: adopting a REMOTE
     * resolution with the local ciphertext would write the server's version
     * number over the user's own ciphertext, i.e. claim convergence while the
     * content is still the discarded one (P9.3.1 P0-1). Absent when the snapshot
     * was recorded before this field existed or when the row is not sensitive.
     */
    encryptedData?: string | null
    /** Owner and permission as the server reported them for the same snapshot. */
    sharedBy?: string
    permission?: string
  }
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
  /**
   * Local edit of an already shared host. It keeps the server version this copy
   * is based on and flags the row dirty, so the next sync submits it as an
   * UPDATE with that baseVersion and a concurrent remote write becomes a
   * conflict instead of a silent overwrite.
   */
  updateSharedHost: (
    shareId: string,
    hostData: Record<string, unknown>,
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
  createCloudTeamWithSettings: (
    name: string,
    endpoint: string,
    apiToken: string,
  ) => Promise<CloudTeamCreateResult>
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
export {
  toAuditLog,
  toSharedHost,
  toSharedSnippet,
  toTeam,
  toTeamInvite,
  toTeamMember,
  toUserProfile,
} from './team-types-mappers'
