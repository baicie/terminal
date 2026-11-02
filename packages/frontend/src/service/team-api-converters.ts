import type {
  AuditLog,
  SharedHost,
  SharedSnippet,
  Team,
  TeamInvite,
  TeamMember,
} from '@/store/team-types'

export function convertApiTeam(apiTeam: {
  id: string
  name: string
  ownerId: string
  memberCount?: number
  role?: string
}): Team {
  return {
    id: apiTeam.id,
    name: apiTeam.name,
    ownerId: apiTeam.ownerId,
    mode: 'cloud',
    autoSync: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function convertApiMember(apiMember: {
  id: string
  userId: string
  userName?: string
  userEmail?: string
  role: string
}): TeamMember {
  return {
    id: apiMember.id,
    teamId: '',
    userId: apiMember.userId,
    userName: apiMember.userName,
    userEmail: apiMember.userEmail,
    role: apiMember.role.toLowerCase() as 'admin' | 'member',
    joinedAt: Date.now(),
  }
}

/**
 * Carries the server-issued version through to the caller. Dropping it here is
 * what made every later push an unversioned CREATE: without the version there is
 * no baseVersion to prove freshness with, so an UPDATE can never be submitted.
 * The team id comes from the wire, never from the currently selected team, so a
 * window spanning several teams keeps every share in its own team.
 */
export function convertApiShare(apiShare: {
  id: string
  type: string
  data: unknown
  permission: string
  sharedBy: string
  createdAt: string
  teamId?: string
  version?: number
  updatedAt?: string
}): SharedHost | SharedSnippet {
  const createdAt = new Date(apiShare.createdAt).getTime()
  const base = {
    id: apiShare.id,
    teamId: apiShare.teamId ?? '',
    sharedBy: apiShare.sharedBy,
    permission: apiShare.permission.toLowerCase() as 'readonly' | 'readwrite',
    createdAt,
    version: apiShare.version ?? null,
    updatedAt: apiShare.updatedAt
      ? new Date(apiShare.updatedAt).getTime()
      : createdAt,
  }
  return apiShare.type === 'SNIPPET_PACKAGE'
    ? ({
        ...base,
        snippetData: apiShare.data as Record<string, unknown>,
      } as SharedSnippet)
    : ({
        ...base,
        hostData: apiShare.data as Record<string, unknown>,
      } as SharedHost)
}

export function convertApiInvite(apiInvite: {
  id: string
  type: string
  code?: string
  linkToken?: string
  email?: string
  role: string
  expiresAt: string
  usedAt?: string
}): TeamInvite {
  return {
    id: apiInvite.id,
    teamId: '',
    type: apiInvite.type.toLowerCase() as 'link' | 'code' | 'email',
    code: apiInvite.code,
    linkToken: apiInvite.linkToken,
    email: apiInvite.email,
    role: apiInvite.role.toLowerCase() as 'admin' | 'member',
    createdBy: '',
    expiresAt: new Date(apiInvite.expiresAt).getTime(),
    usedAt: apiInvite.usedAt ? new Date(apiInvite.usedAt).getTime() : undefined,
    createdAt: Date.now(),
  }
}

export function convertApiAuditLog(apiLog: {
  id: string
  userId: string
  userName?: string
  hostName?: string
  action: string
  details?: unknown
  createdAt: string
}): AuditLog {
  return {
    id: apiLog.id,
    teamId: '',
    userId: apiLog.userId,
    userName: apiLog.userName,
    hostName: apiLog.hostName,
    action: apiLog.action,
    details: apiLog.details as Record<string, unknown>,
    createdAt: new Date(apiLog.createdAt).getTime(),
  }
}
