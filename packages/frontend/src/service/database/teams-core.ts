import { executeQuery, select } from './connection'
import type {
  TeamMemberRecord,
  TeamRecord,
  TeamSharedHostRecord,
  TeamSharedSnippetRecord,
  UserProfileRecord,
} from './types'

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
  const updateFields: Array<[keyof TeamRecord, string]> = [
    ['name', 'name'],
    ['mode', 'mode'],
    ['endpoint', 'endpoint'],
    ['api_token', 'api_token'],
    ['auto_sync', 'auto_sync'],
    ['updated_at', 'updated_at'],
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
      `UPDATE teams SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

export async function deleteTeam(id: string): Promise<void> {
  await executeQuery('DELETE FROM teams WHERE id = ?', [id])
}

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
