/**
 * Team CRUD 操作
 */
import { executeQuery, select } from './connection'
import type {
  TeamRecord,
  TeamMemberRecord,
  TeamSharedHostRecord,
  TeamSharedSnippetRecord,
  TeamInviteRecord,
  TeamAuditLogRecord,
  SyncQueueRecord,
  UserProfileRecord,
} from './types'

// User Profile
export async function getUserProfile(): Promise<UserProfileRecord | null> {
  const results = await select<UserProfileRecord>(
    'SELECT * FROM user_profile LIMIT 1',
  )
  return results[0] || null
}

export async function createUserProfile(
  profile: UserProfileRecord,
): Promise<void> {
  await executeQuery(
    'INSERT INTO user_profile (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [profile.id, profile.name, profile.created_at, profile.updated_at],
  )
}

export async function updateUserProfile(
  id: string,
  updates: Partial<UserProfileRecord>,
): Promise<void> {
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.updated_at !== undefined) {
    fields.push('updated_at = ?')
    values.push(updates.updated_at)
  }

  if (fields.length > 0) {
    values.push(id)
    await executeQuery(
      `UPDATE user_profile SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

// Teams
export async function getTeams(): Promise<TeamRecord[]> {
  return select<TeamRecord>('SELECT * FROM teams ORDER BY name')
}

export async function getTeamById(id: string): Promise<TeamRecord | null> {
  const results = await select<TeamRecord>('SELECT * FROM teams WHERE id = ?', [
    id,
  ])
  return results[0] || null
}

export async function createTeam(team: TeamRecord): Promise<void> {
  await executeQuery(
    `INSERT INTO teams (id, name, owner_id, mode, endpoint, api_token, auto_sync, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      team.id,
      team.name,
      team.owner_id,
      team.mode,
      team.endpoint || null,
      team.api_token || null,
      team.auto_sync,
      team.created_at,
      team.updated_at,
    ],
  )
}

export async function updateTeam(
  id: string,
  updates: Partial<TeamRecord>,
): Promise<void> {
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.mode !== undefined) {
    fields.push('mode = ?')
    values.push(updates.mode)
  }
  if (updates.endpoint !== undefined) {
    fields.push('endpoint = ?')
    values.push(updates.endpoint)
  }
  if (updates.api_token !== undefined) {
    fields.push('api_token = ?')
    values.push(updates.api_token)
  }
  if (updates.auto_sync !== undefined) {
    fields.push('auto_sync = ?')
    values.push(updates.auto_sync)
  }
  if (updates.updated_at !== undefined) {
    fields.push('updated_at = ?')
    values.push(updates.updated_at)
  }

  if (fields.length > 0) {
    values.push(id)
    await executeQuery(
      `UPDATE teams SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

export async function deleteTeam(id: string): Promise<void> {
  await executeQuery('DELETE FROM teams WHERE id = ?', [id])
}

// Team Members
export async function getTeamMembers(
  teamId: string,
): Promise<TeamMemberRecord[]> {
  return select<TeamMemberRecord>(
    'SELECT * FROM team_members WHERE team_id = ? ORDER BY joined_at',
    [teamId],
  )
}

export async function addTeamMember(member: TeamMemberRecord): Promise<void> {
  await executeQuery(
    `INSERT INTO team_members (id, team_id, user_id, user_name, user_email, role, joined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      member.id,
      member.team_id,
      member.user_id,
      member.user_name || null,
      member.user_email || null,
      member.role,
      member.joined_at,
    ],
  )
}

export async function removeTeamMember(id: string): Promise<void> {
  await executeQuery('DELETE FROM team_members WHERE id = ?', [id])
}

export async function updateTeamMember(
  id: string,
  updates: Partial<{ role: string }>,
): Promise<void> {
  if (updates.role) {
    await executeQuery('UPDATE team_members SET role = ? WHERE id = ?', [
      updates.role,
      id,
    ])
  }
}

// Shared Hosts
export async function getSharedHosts(
  teamId: string,
): Promise<TeamSharedHostRecord[]> {
  return select<TeamSharedHostRecord>(
    'SELECT * FROM team_shared_hosts WHERE team_id = ? ORDER BY created_at DESC',
    [teamId],
  )
}

export async function addSharedHost(host: TeamSharedHostRecord): Promise<void> {
  await executeQuery(
    `INSERT INTO team_shared_hosts (id, team_id, host_data, shared_by, permission, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      host.id,
      host.team_id,
      host.host_data,
      host.shared_by,
      host.permission,
      host.created_at,
    ],
  )
}

export async function removeSharedHost(id: string): Promise<void> {
  await executeQuery('DELETE FROM team_shared_hosts WHERE id = ?', [id])
}

// Shared Snippets
export async function getSharedSnippets(
  teamId: string,
): Promise<TeamSharedSnippetRecord[]> {
  return select<TeamSharedSnippetRecord>(
    'SELECT * FROM team_shared_snippets WHERE team_id = ? ORDER BY created_at DESC',
    [teamId],
  )
}

export async function addSharedSnippet(
  snippet: TeamSharedSnippetRecord,
): Promise<void> {
  await executeQuery(
    `INSERT INTO team_shared_snippets (id, team_id, snippet_data, shared_by, permission, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      snippet.id,
      snippet.team_id,
      snippet.snippet_data,
      snippet.shared_by,
      snippet.permission,
      snippet.created_at,
    ],
  )
}

export async function removeSharedSnippet(id: string): Promise<void> {
  await executeQuery('DELETE FROM team_shared_snippets WHERE id = ?', [id])
}

// Team Invites
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

// Team Audit Logs
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

// Sync Queue
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

  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
  }
  if (updates.retry_count !== undefined) {
    fields.push('retry_count = ?')
    values.push(updates.retry_count)
  }
  if (updates.error !== undefined) {
    fields.push('error = ?')
    values.push(updates.error)
  }
  if (updates.synced_at !== undefined) {
    fields.push('synced_at = ?')
    values.push(updates.synced_at)
  }

  if (fields.length > 0) {
    values.push(id)
    await executeQuery(
      `UPDATE sync_queue SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}
