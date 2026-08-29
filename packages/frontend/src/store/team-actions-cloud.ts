import {
  convertApiAuditLog,
  convertApiMember,
  convertApiShare,
  convertApiTeam,
  teamApi,
} from '@/service/team-api'
import type {
  SharedHost,
  SharedSnippet,
  TeamInvite,
  TeamState,
} from './team-types'
import type { TeamStoreGet, TeamStoreSet } from './team-store-context'

function configureCloudApi(get: TeamStoreGet): boolean {
  const { settings, userProfile } = get()
  if (!settings.enabled || settings.mode !== 'cloud') return false
  teamApi.configure(
    settings.endpoint || '',
    settings.apiToken || '',
    userProfile?.id || '',
  )
  return true
}

export function createCloudActions(
  set: TeamStoreSet,
  get: TeamStoreGet,
): Pick<
  TeamState,
  | 'cloudCreateTeam'
  | 'cloudLoadTeams'
  | 'cloudLoadMembers'
  | 'cloudLoadShares'
  | 'cloudCreateShare'
  | 'cloudDeleteShare'
  | 'cloudCreateInvite'
  | 'cloudJoinByCode'
  | 'cloudJoinByLink'
  | 'cloudLoadAuditLogs'
> {
  return {
    async cloudCreateTeam(name: string) {
      const { settings, userProfile } = get()
      if (
        !settings.enabled ||
        settings.mode !== 'cloud' ||
        !settings.endpoint ||
        !settings.apiToken
      )
        return null
      teamApi.configure(
        settings.endpoint,
        settings.apiToken,
        userProfile?.id || '',
      )
      const response = await teamApi.createTeam(name)
      if (response.error || !response.data) {
        console.error('Cloud create team error:', response.error)
        return null
      }
      const team = convertApiTeam(response.data)
      set(state => ({ teams: [...state.teams, team] }))
      return team
    },

    async cloudLoadTeams() {
      const { settings, userProfile } = get()
      if (
        !settings.enabled ||
        settings.mode !== 'cloud' ||
        !settings.endpoint ||
        !settings.apiToken
      )
        return
      teamApi.configure(
        settings.endpoint,
        settings.apiToken,
        userProfile?.id || '',
      )
      const response = await teamApi.listTeams()
      if (response.error || !response.data) {
        console.error('Cloud load teams error:', response.error)
        return
      }
      set({ teams: response.data.map(convertApiTeam) })
    },

    async cloudLoadMembers(teamId: string) {
      if (!configureCloudApi(get)) return
      const response = await teamApi.listMembers(teamId)
      if (response.error || !response.data) {
        console.error('Cloud load members error:', response.error)
        return
      }
      set({
        members: response.data.map(member => ({
          ...convertApiMember(member),
          teamId,
        })),
      })
    },

    async cloudLoadShares(teamId: string) {
      if (!configureCloudApi(get)) return
      const response = await teamApi.listShares(teamId)
      if (response.error || !response.data) {
        console.error('Cloud load shares error:', response.error)
        return
      }
      const sharedHosts: SharedHost[] = []
      const sharedSnippets: SharedSnippet[] = []
      for (const apiShare of response.data) {
        const converted = convertApiShare({
          ...apiShare,
          createdAt: apiShare.createdAt?.toString() || new Date().toISOString(),
        })
        converted.teamId = teamId
        if ('hostData' in converted) sharedHosts.push(converted as SharedHost)
        else sharedSnippets.push(converted as SharedSnippet)
      }
      set({ sharedHosts, sharedSnippets })
    },

    async cloudCreateShare(
      teamId: string,
      type: 'HOST' | 'SNIPPET_PACKAGE',
      data: unknown,
      permission: 'readonly' | 'readwrite',
    ) {
      if (!configureCloudApi(get)) return
      const response = await teamApi.createShare(
        teamId,
        type === 'HOST' ? 'HOST' : 'SNIPPET_PACKAGE',
        data,
        permission.toUpperCase() as 'READONLY' | 'READWRITE',
      )
      if (response.error)
        console.error('Cloud create share error:', response.error)
    },
    async cloudDeleteShare(teamId: string, shareId: string) {
      if (!configureCloudApi(get)) return
      const response = await teamApi.deleteShare(teamId, shareId)
      if (response.error)
        console.error('Cloud delete share error:', response.error)
    },

    async cloudCreateInvite(
      teamId: string,
      type: 'LINK' | 'CODE' | 'EMAIL',
      email?: string,
      role: 'admin' | 'member' = 'member',
    ) {
      if (!configureCloudApi(get)) return null
      const response = await teamApi.createInvite(
        teamId,
        type,
        email,
        role.toUpperCase() as 'ADMIN' | 'MEMBER',
      )
      if (response.error || !response.data) {
        console.error('Cloud create invite error:', response.error)
        return null
      }
      const userId = get().userProfile?.id || ''
      const invite: TeamInvite = {
        id: response.data.id,
        teamId,
        type: type.toLowerCase() as 'link' | 'code' | 'email',
        code: response.data.code,
        linkToken: response.data.linkToken,
        email,
        role,
        createdBy: userId,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
      }
      set(state => ({ invites: [...state.invites, invite] }))
      return invite
    },

    async cloudJoinByCode(code: string, userName?: string) {
      if (!configureCloudApi(get)) return null
      const response = await teamApi.joinByCode(code, userName)
      if (response.error || !response.data) {
        console.error('Cloud join by code error:', response.error)
        return null
      }
      return {
        teamId: response.data.teamId,
        role: response.data.role.toLowerCase() as 'admin' | 'member',
      }
    },
    async cloudJoinByLink(linkToken: string, userName?: string) {
      if (!configureCloudApi(get)) return null
      const response = await teamApi.joinByLink(linkToken, userName)
      if (response.error || !response.data) {
        console.error('Cloud join by link error:', response.error)
        return null
      }
      return {
        teamId: response.data.teamId,
        role: response.data.role.toLowerCase() as 'admin' | 'member',
      }
    },

    async cloudLoadAuditLogs(teamId: string, limit = 100) {
      if (!configureCloudApi(get)) return
      const response = await teamApi.listAuditLogs(teamId, limit)
      if (response.error || !response.data) {
        console.error('Cloud load audit logs error:', response.error)
        return
      }
      set({
        auditLogs: response.data.map(log => ({
          ...convertApiAuditLog({
            ...log,
            createdAt: log.createdAt?.toString() || new Date().toISOString(),
          }),
          teamId,
        })),
      })
    },
  }
}
