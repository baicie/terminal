import { addTeamMember, createTeam as persistTeam } from '@/service/database'
import { convertApiTeam, teamApi } from '@/service/team-api'
import type { CloudTeamCreateResult } from './team-types'
import type { TeamStoreGet, TeamStoreSet } from './team-store-context'

/**
 * Creates a team on the configured server and only then writes the local
 * identity. A retry (or double click) adopts the server team with the same
 * name instead of creating a second one; a local write failure reports the
 * server id so the next attempt can adopt it.
 */
export async function createTeamOnServer(
  set: TeamStoreSet,
  get: TeamStoreGet,
  name: string,
  endpoint: string,
  apiToken: string,
): Promise<CloudTeamCreateResult> {
  const trimmedName = name.trim()
  const trimmedEndpoint = endpoint.trim().replace(/\/+$/, '')
  const trimmedToken = apiToken.trim()
  const invalid = (error: string): CloudTeamCreateResult => ({
    ok: false,
    team: null,
    stage: 'validate',
    error,
  })
  if (trimmedName === '') return invalid('team name is required')
  if (!/^https?:\/\//.test(trimmedEndpoint)) {
    return invalid('endpoint must start with http:// or https://')
  }
  if (trimmedToken === '') return invalid('api token is required')

  const userId = get().userProfile?.id || (await get().ensureUserId())
  teamApi.configure(trimmedEndpoint, trimmedToken, userId)

  // A retry or a double click must adopt the team the server already has
  // instead of creating a second one with the same name.
  const listed = await teamApi.listTeams()
  if (listed.error && listed.error !== '') {
    return { ok: false, team: null, stage: 'create', error: listed.error }
  }
  let serverTeam: { id: string, name: string, ownerId: string } | undefined =
    listed.data?.find(team => team.name === trimmedName)
  const adopted = serverTeam !== undefined
  if (!serverTeam) {
    const created = await teamApi.createTeam(trimmedName)
    if (created.error || !created.data) {
      return {
        ok: false,
        team: null,
        stage: 'create',
        error: created.error || 'server did not return a team',
      }
    }
    serverTeam = {
      id: created.data.id,
      name: created.data.name,
      ownerId: created.data.ownerId,
    }
  }

  const team = convertApiTeam(serverTeam)
  try {
    await persistTeam({
      id: team.id,
      name: team.name,
      owner_id: userId,
      mode: 'cloud',
      auto_sync: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    })
  } catch (error) {
    // A duplicate row means a previous attempt already persisted it; any
    // other failure leaves the server team unadopted, and the caller must
    // retry adoption rather than create another team.
    if (!String(error).includes('UNIQUE')) {
      return {
        ok: false,
        team,
        adopted,
        serverTeamId: team.id,
        stage: 'persist',
        error: String(error),
      }
    }
  }
  try {
    await addTeamMember({
      id: crypto.randomUUID(),
      team_id: team.id,
      user_id: userId,
      user_name: get().userProfile?.name,
      role: 'admin',
      joined_at: Date.now(),
    })
  } catch {
    // A duplicate membership is expected on retry.
  }
  try {
    await get().saveSettings({
      enabled: true,
      mode: 'cloud',
      endpoint: trimmedEndpoint,
      apiToken: trimmedToken,
      currentTeamId: team.id,
    })
  } catch (error) {
    return {
      ok: false,
      team,
      adopted,
      serverTeamId: team.id,
      stage: 'settings',
      error: String(error),
    }
  }
  set(state => ({
    teams: [...state.teams.filter(item => item.id !== team.id), team],
    currentTeam: team,
  }))
  return { ok: true, team, adopted }
}
