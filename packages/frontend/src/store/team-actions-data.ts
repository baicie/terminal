import {
  addSharedHost,
  addSharedSnippet,
  addTeamAuditLog,
  addTeamMember,
  getSharedHosts,
  getSharedSnippets,
  getTeamAuditLogs,
  getTeamInvites,
  getTeamMembers,
  removeSharedHost,
  removeSharedSnippet,
  removeTeamMember,
  updateTeamMember,
} from '@/service/database'
import { teamApi } from '@/service/team-api'
import type {
  AuditLog,
  SharedHost,
  SharedSnippet,
  TeamMember,
  TeamState,
} from './team-types'
import type { TeamStoreGet, TeamStoreSet } from './team-store-context'
import {
  toAuditLog,
  toSharedHost,
  toSharedSnippet,
  toTeamInvite,
  toTeamMember,
} from './team-types'

export function createDataActions(
  set: TeamStoreSet,
  get: TeamStoreGet,
): Pick<
  TeamState,
  | 'loadMembers'
  | 'addMember'
  | 'removeMember'
  | 'updateMemberRole'
  | 'loadSharedHosts'
  | 'shareHost'
  | 'unshareHost'
  | 'loadSharedSnippets'
  | 'shareSnippet'
  | 'unshareSnippet'
  | 'loadInvites'
  | 'joinByCode'
  | 'joinByLink'
  | 'loadAuditLogs'
  | 'addAuditLog'
> {
  return {
    async loadMembers(teamId: string) {
      set({ members: (await getTeamMembers(teamId)).map(toTeamMember) })
    },
    async addMember(
      teamId: string,
      userId: string,
      userName?: string,
      userEmail?: string,
      role: 'admin' | 'member' = 'member',
    ) {
      const id = crypto.randomUUID()
      const now = Date.now()
      await addTeamMember({
        id,
        team_id: teamId,
        user_id: userId,
        user_name: userName || undefined,
        user_email: userEmail || undefined,
        role,
        joined_at: now,
      })
      const member: TeamMember = {
        id,
        teamId,
        userId,
        userName,
        userEmail,
        role,
        joinedAt: now,
      }
      set(state => ({ members: [...state.members, member] }))
    },
    async removeMember(memberId: string) {
      await removeTeamMember(memberId)
      set(state => ({
        members: state.members.filter(item => item.id !== memberId),
      }))
    },
    async updateMemberRole(memberId: string, role: 'admin' | 'member') {
      await updateTeamMember(memberId, { role })
      set(state => ({
        members: state.members.map(item =>
          item.id === memberId ? { ...item, role } : item,
        ),
      }))
    },

    async loadSharedHosts(teamId: string) {
      set({ sharedHosts: (await getSharedHosts(teamId)).map(toSharedHost) })
    },
    async shareHost(
      teamId: string,
      hostData: Record<string, unknown>,
      permission: 'readonly' | 'readwrite',
    ) {
      const id = crypto.randomUUID()
      const userId = get().userProfile?.id || ''
      const now = Date.now()
      await addSharedHost({
        id,
        team_id: teamId,
        host_data: JSON.stringify(hostData),
        shared_by: userId,
        permission,
        created_at: now,
      })
      const sharedHost: SharedHost = {
        id,
        teamId,
        hostData,
        sharedBy: userId,
        permission,
        createdAt: now,
      }
      set(state => ({ sharedHosts: [...state.sharedHosts, sharedHost] }))
    },
    async unshareHost(shareId: string) {
      await removeSharedHost(shareId)
      set(state => ({
        sharedHosts: state.sharedHosts.filter(item => item.id !== shareId),
      }))
    },

    async loadSharedSnippets(teamId: string) {
      set({
        sharedSnippets: (await getSharedSnippets(teamId)).map(toSharedSnippet),
      })
    },
    async shareSnippet(
      teamId: string,
      snippetData: Record<string, unknown>,
      permission: 'readonly' | 'readwrite',
    ) {
      const id = crypto.randomUUID()
      const userId = get().userProfile?.id || ''
      const now = Date.now()
      await addSharedSnippet({
        id,
        team_id: teamId,
        snippet_data: JSON.stringify(snippetData),
        shared_by: userId,
        permission,
        created_at: now,
      })
      const sharedSnippet: SharedSnippet = {
        id,
        teamId,
        snippetData,
        sharedBy: userId,
        permission,
        createdAt: now,
      }
      set(state => ({
        sharedSnippets: [...state.sharedSnippets, sharedSnippet],
      }))
    },
    async unshareSnippet(shareId: string) {
      await removeSharedSnippet(shareId)
      set(state => ({
        sharedSnippets: state.sharedSnippets.filter(
          item => item.id !== shareId,
        ),
      }))
    },

    async loadInvites(teamId: string) {
      set({ invites: (await getTeamInvites(teamId)).map(toTeamInvite) })
    },
    async joinByCode(code: string) {
      const { settings, userProfile } = get()
      if (settings.mode !== 'cloud' || !settings.endpoint || !settings.apiToken)
        return null
      teamApi.configure(
        settings.endpoint,
        settings.apiToken,
        userProfile?.id || '',
      )
      const response = await teamApi.joinByCode(code, userProfile?.name)
      if (response.error || !response.data) {
        console.error('joinByCode failed:', response.error)
        return null
      }
      return {
        teamId: response.data.teamId,
        role: (response.data.role.toLowerCase() === 'admin'
          ? 'admin'
          : 'member') as 'admin' | 'member',
      }
    },
    async joinByLink(linkToken: string) {
      const { settings, userProfile } = get()
      if (settings.mode !== 'cloud' || !settings.endpoint || !settings.apiToken)
        return null
      teamApi.configure(
        settings.endpoint,
        settings.apiToken,
        userProfile?.id || '',
      )
      const response = await teamApi.joinByLink(linkToken, userProfile?.name)
      if (response.error || !response.data) {
        console.error('joinByLink failed:', response.error)
        return null
      }
      return {
        teamId: response.data.teamId,
        role: (response.data.role.toLowerCase() === 'admin'
          ? 'admin'
          : 'member') as 'admin' | 'member',
      }
    },

    async loadAuditLogs(teamId: string, limit = 100) {
      set({
        auditLogs: (await getTeamAuditLogs(teamId, limit)).map(toAuditLog),
      })
    },
    async addAuditLog(
      teamId: string,
      userId: string,
      userName: string,
      action: string,
      hostName?: string,
      details?: Record<string, unknown>,
    ) {
      const id = crypto.randomUUID()
      const now = Date.now()
      await addTeamAuditLog({
        id,
        team_id: teamId,
        user_id: userId,
        user_name: userName || undefined,
        host_name: hostName || undefined,
        action,
        details: details ? JSON.stringify(details) : undefined,
        created_at: now,
      })
      const log: AuditLog = {
        id,
        teamId,
        userId,
        userName,
        hostName,
        action,
        details,
        createdAt: now,
      }
      set(state => ({ auditLogs: [log, ...state.auditLogs] }))
    },
  }
}
