/**
 * Record-to-store mappers for the team feature, split out of team-types.ts to keep
 * that module inside the file-size gate. Only types are imported from it, so the
 * two modules have no runtime cycle.
 */
import type {
  TeamAuditLogRecord,
  TeamInviteRecord,
  TeamMemberRecord,
  TeamRecord,
  TeamSharedHostRecord,
  TeamSharedSnippetRecord,
  UserProfileRecord,
} from '@/service/database'
import type {
  AuditLog,
  SharedHost,
  SharedSnippet,
  Team,
  TeamInvite,
  TeamMember,
  UserProfile,
} from './team-types'

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
    version: record.version ?? null,
    updatedAt: record.updated_at ?? record.created_at,
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
    version: record.version ?? null,
    updatedAt: record.updated_at ?? record.created_at,
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
