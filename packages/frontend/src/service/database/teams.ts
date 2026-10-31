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

/**
 * Deletes the local shares of every team the server no longer authorizes for this
 * identity. The authorized set is the server's answer (docs/phase8/sync-protocol.md
 * §3.8) and an empty one authorizes nothing: deleting everything is the
 * fail-closed direction, because a revoked team's rows must stop being readable
 * offline while a wrongly deleted row simply returns on the next full window.
 */
export async function removeUnauthorizedTeamShares(
  authorizedTeamIds: string[],
): Promise<void> {
  const where = authorizedTeamIds.length === 0
    ? ''
    : ` WHERE team_id NOT IN (${authorizedTeamIds.map(() => '?').join(', ')})`
  await executeQuery(`DELETE FROM team_shared_hosts${where}`, authorizedTeamIds)
  await executeQuery(
    `DELETE FROM team_shared_snippets${where}`,
    authorizedTeamIds,
  )
}

/**
 * Delete the local shares a complete resynchronization proved the server no longer
 * has.
 *
 * A cursor the server cannot prove it issued is answered with a full resnapshot
 * (`resync: true`) instead of a guess, and such a snapshot can only say which rows
 * exist — it can never name the rows deleted before the watermark it was cut at,
 * because their change-log entries belong to a window this client is no longer
 * positioned to read. Left alone those rows stay readable forever, and the next push
 * offers them back to the server: the ghost row of docs/phase8/sync-protocol.md §5.
 *
 * Deletion is narrowed to what the snapshot proves:
 *
 * - only rows of a team this round was authorized to read — absence from a snapshot
 *   of another scope proves nothing;
 * - only rows carrying a server version — `version IS NULL` means the server has
 *   never accepted the row, so it is a local share that has not been pushed yet and
 *   a snapshot says nothing about it;
 * - never a row flagged `dirty` — that local edit has not reached the server, so
 *   deleting it would destroy unsent work on the strength of an absence.
 *
 * A dirty row the server has deleted is therefore kept and offered back as an
 * UPDATE, which the server answers with a visible conflict instead of silence.
 */
export async function removeSharesAbsentFromSnapshot(
  authorizedTeamIds: string[],
  keptShareIds: string[],
): Promise<number> {
  // No authorized team means nothing was proven: removeUnauthorizedTeamShares owns
  // that case, and it deletes far more than this function ever should.
  if (authorizedTeamIds.length === 0) return 0
  const teams = authorizedTeamIds.map(() => '?').join(', ')
  const kept = keptShareIds.length === 0
    ? ''
    : ` AND id NOT IN (${keptShareIds.map(() => '?').join(', ')})`
  const where = ` WHERE team_id IN (${teams}) AND version IS NOT NULL AND COALESCE(dirty, 0) = 0${kept}`
  const params = [...authorizedTeamIds, ...keptShareIds]
  let removed = 0
  for (const table of ['team_shared_hosts', 'team_shared_snippets']) {
    const result = await executeQuery(`DELETE FROM ${table}${where}`, params)
    removed += (result as { rowsAffected?: number } | null | undefined)
      ?.rowsAffected ?? 0
  }
  return removed
}

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
