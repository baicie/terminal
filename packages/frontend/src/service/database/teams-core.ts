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

/**
 * A pulled snapshot never overwrites a newer local row, and it never overwrites a
 * row the user edited locally but the server has not accepted yet: that edit is
 * the only copy of the user's intent, so the pull reports the row as skipped and
 * the push turns it into a conflict instead of dropping it silently. Re-delivery
 * at or below the stored version converges because the incoming snapshot wins only
 * when it is newer, or when it is identical.
 */
function remoteGuard(table: string, dataColumn: string): string {
  return `
       WHERE (COALESCE(${table}.dirty, 0) = 0 OR ${table}.${dataColumn} = excluded.${dataColumn})
         AND (
           ${table}.version IS NULL
           OR excluded.version IS NULL
           OR excluded.version > ${table}.version
           OR (excluded.version = ${table}.version
               AND ${table}.${dataColumn} = excluded.${dataColumn})
         )`
}

function changedRows(result: unknown): number {
  const rows = (result as { rowsAffected?: number } | null | undefined)
    ?.rowsAffected
  return typeof rows === 'number' ? rows : 1
}

/**
 * Who is writing. 'local' is a user edit (always wins here, flagged dirty until
 * the server accepts it), 'override' is a resolved conflict adopting a known
 * server snapshot, and 'remote' is a pulled change, which is guarded.
 */
export type SharedWriteMode = 'remote' | 'local' | 'override'

// Idempotent on purpose: the sync protocol may re-deliver a change (page
// boundary or a round that crashed before the cursor advanced), and a replay
// must converge instead of failing the whole round on a primary key clash.
// Returns true when the row was written; a pulled snapshot that loses against a
// newer or a locally edited row returns false so the caller can report it.
export async function addSharedHost(
  host: TeamSharedHostRecord,
  source: SharedWriteMode = 'remote',
): Promise<boolean> {
  const local = source === 'local'
  const result = await executeQuery(
    `INSERT INTO team_shared_hosts (id, team_id, host_data, shared_by, permission, created_at, version, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET team_id = excluded.team_id, host_data = excluded.host_data,
       shared_by = excluded.shared_by, permission = excluded.permission, created_at = excluded.created_at,
       version = excluded.version, updated_at = excluded.updated_at, dirty = excluded.dirty${source === 'remote' ? remoteGuard('team_shared_hosts', 'host_data') : ''}`,
    [
      host.id,
      host.team_id,
      host.host_data,
      host.shared_by,
      host.permission,
      host.created_at,
      host.version ?? null,
      host.updated_at ?? null,
      local ? 1 : 0,
    ],
  )
  return source !== 'remote' || changedRows(result) > 0
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
  source: SharedWriteMode = 'remote',
): Promise<boolean> {
  const local = source === 'local'
  const result = await executeQuery(
    `INSERT INTO team_shared_snippets (id, team_id, snippet_data, shared_by, permission, created_at, version, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET team_id = excluded.team_id, snippet_data = excluded.snippet_data,
       shared_by = excluded.shared_by, permission = excluded.permission, created_at = excluded.created_at,
       version = excluded.version, updated_at = excluded.updated_at, dirty = excluded.dirty${source === 'remote' ? remoteGuard('team_shared_snippets', 'snippet_data') : ''}`,
    [
      snippet.id,
      snippet.team_id,
      snippet.snippet_data,
      snippet.shared_by,
      snippet.permission,
      snippet.created_at,
      snippet.version ?? null,
      snippet.updated_at ?? null,
      local ? 1 : 0,
    ],
  )
  return source !== 'remote' || changedRows(result) > 0
}

export async function removeSharedSnippet(id: string): Promise<void> {
  await executeQuery('DELETE FROM team_shared_snippets WHERE id = ?', [id])
}
