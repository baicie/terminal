import { executeQuery, select } from './connection'
import type {
  SyncQueueRecord,
  TeamAuditLogRecord,
  TeamInviteRecord,
} from './types'

export {
  addSharedHost,
  addSharedSnippet,
  addTeamMember,
  createTeam,
  createUserProfile,
  deleteTeam,
  getSharedHosts,
  getSharedSnippets,
  getTeamById,
  getTeamMembers,
  getTeams,
  getUserProfile,
  removeSharedHost,
  removeSharedSnippet,
  removeTeamMember,
  updateTeam,
  updateTeamMember,
  updateUserProfile,
} from './teams-core'

export async function getTeamInvites(
  teamId: string,
): Promise<TeamInviteRecord[]> {
  return select<TeamInviteRecord>(
    'SELECT * FROM team_invites WHERE team_id = ? ORDER BY created_at DESC',
    [teamId],
  )
}

export async function createTeamInvite(
  invite: TeamInviteRecord,
): Promise<void> {
  await executeQuery(
    `INSERT INTO team_invites (id, team_id, type, code, link_token, email, role, created_by, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invite.id,
      invite.team_id,
      invite.type,
      invite.code || null,
      invite.link_token || null,
      invite.email || null,
      invite.role,
      invite.created_by,
      invite.expires_at,
      invite.used_at || null,
      invite.created_at,
    ],
  )
}

export async function deleteTeamInvite(id: string): Promise<void> {
  await executeQuery('DELETE FROM team_invites WHERE id = ?', [id])
}

export async function getTeamInviteByCode(
  code: string,
): Promise<TeamInviteRecord | null> {
  const results = await select<TeamInviteRecord>(
    'SELECT * FROM team_invites WHERE code = ? AND expires_at > ? AND used_at IS NULL',
    [code, Date.now()],
  )
  return results[0] || null
}

export async function getTeamInviteByToken(
  token: string,
): Promise<TeamInviteRecord | null> {
  const results = await select<TeamInviteRecord>(
    'SELECT * FROM team_invites WHERE link_token = ? AND expires_at > ? AND used_at IS NULL',
    [token, Date.now()],
  )
  return results[0] || null
}

export async function markInviteUsed(id: string): Promise<void> {
  await executeQuery('UPDATE team_invites SET used_at = ? WHERE id = ?', [
    Date.now(),
    id,
  ])
}

export async function getTeamAuditLogs(
  teamId: string,
  limit = 100,
): Promise<TeamAuditLogRecord[]> {
  return select<TeamAuditLogRecord>(
    'SELECT * FROM team_audit_logs WHERE team_id = ? ORDER BY created_at DESC LIMIT ?',
    [teamId, limit],
  )
}

export async function addTeamAuditLog(log: TeamAuditLogRecord): Promise<void> {
  await executeQuery(
    `INSERT INTO team_audit_logs (id, team_id, user_id, user_name, host_name, action, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.team_id,
      log.user_id,
      log.user_name || null,
      log.host_name || null,
      log.action,
      log.details || null,
      log.created_at,
    ],
  )
}

export async function getPendingSyncItems(): Promise<SyncQueueRecord[]> {
  return select<SyncQueueRecord>(
    "SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at",
  )
}

export async function addSyncQueueItem(item: SyncQueueRecord): Promise<void> {
  await executeQuery(
    `INSERT INTO sync_queue (id, user_id, team_id, type, resource, resource_id, data, status, retry_count, error, created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.user_id,
      item.team_id,
      item.type,
      item.resource,
      item.resource_id,
      item.data || null,
      item.status,
      item.retry_count,
      item.error || null,
      item.created_at,
      item.synced_at || null,
    ],
  )
}

export async function updateSyncQueueItem(
  id: string,
  updates: Partial<SyncQueueRecord>,
): Promise<void> {
  const fields: string[] = []
  const values: unknown[] = []
  const updateFields: Array<[keyof SyncQueueRecord, string]> = [
    ['status', 'status'],
    ['retry_count', 'retry_count'],
    ['error', 'error'],
    ['synced_at', 'synced_at'],
  ]
  for (const [key, column] of updateFields) {
    const value = updates[key]
    if (value !== undefined) {
      fields.push(`${column} = ?`)
      values.push(value)
    }
  }
  if (fields.length > 0) {
    values.push(id)
    await executeQuery(
      `UPDATE sync_queue SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}
