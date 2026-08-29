import { TeamApiAuth } from './team-api-auth'
import type { ApiResponse } from './team-api-types'

type TeamSummary = {
  id: string
  name: string
  ownerId: string
  memberCount: number
  role: string
}
type ApiShare = {
  id: string
  type: string
  data: unknown
  permission: string
  sharedBy: string
  createdAt: string
}
type ApiInvite = {
  id: string
  type: string
  code?: string
  linkToken?: string
  email?: string
  role: string
  expiresAt: string
  usedAt?: string
}

export class TeamApiResources extends TeamApiAuth {
  async listTeams(): Promise<ApiResponse<TeamSummary[]>> {
    return this.request('GET', '/teams')
  }
  async getTeam(teamId: string): Promise<ApiResponse<TeamSummary>> {
    return this.request('GET', `/teams/${teamId}`)
  }
  async createTeam(
    name: string,
  ): Promise<ApiResponse<{ id: string; name: string; ownerId: string }>> {
    return this.request('POST', '/teams', { name })
  }
  async updateTeam(
    teamId: string,
    name: string,
  ): Promise<ApiResponse<{ id: string; name: string }>> {
    return this.request('PUT', `/teams/${teamId}`, { name })
  }
  async deleteTeam(teamId: string): Promise<ApiResponse<void>> {
    return this.request('DELETE', `/teams/${teamId}`)
  }

  async listMembers(teamId: string): Promise<
    ApiResponse<
      Array<{
        id: string
        userId: string
        userName?: string
        userEmail?: string
        role: string
      }>
    >
  > {
    return this.request('GET', `/teams/${teamId}/members`)
  }
  async addMember(
    teamId: string,
    userId: string,
    userName?: string,
    userEmail?: string,
    role: 'ADMIN' | 'MEMBER' = 'MEMBER',
  ): Promise<ApiResponse<{ id: string }>> {
    return this.request('POST', `/teams/${teamId}/members`, {
      userId,
      userName,
      userEmail,
      role,
    })
  }
  async updateMemberRole(
    teamId: string,
    memberId: string,
    role: 'ADMIN' | 'MEMBER',
  ): Promise<ApiResponse<void>> {
    return this.request('PUT', `/teams/${teamId}/members/${memberId}`, { role })
  }
  async removeMember(
    teamId: string,
    memberId: string,
  ): Promise<ApiResponse<void>> {
    return this.request('DELETE', `/teams/${teamId}/members/${memberId}`)
  }

  async listShares(teamId: string): Promise<ApiResponse<ApiShare[]>> {
    return this.request('GET', `/teams/${teamId}/shares`)
  }
  async createShare(
    teamId: string,
    type: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE',
    data: unknown,
    permission: 'READONLY' | 'READWRITE',
    encryptedData?: string,
    isSensitive?: boolean,
  ): Promise<ApiResponse<{ id: string }>> {
    return this.request('POST', `/teams/${teamId}/shares`, {
      type,
      data,
      permission,
      ...(encryptedData !== undefined && {
        encryptedData,
        isSensitive: isSensitive ?? true,
      }),
    })
  }
  async updateShare(
    teamId: string,
    shareId: string,
    permission?: 'READONLY' | 'READWRITE',
    data?: unknown,
    encryptedData?: string,
    isSensitive?: boolean,
  ): Promise<ApiResponse<void>> {
    return this.request('PUT', `/teams/${teamId}/shares/${shareId}`, {
      ...(permission !== undefined && { permission }),
      ...(data !== undefined && { data }),
      ...(encryptedData !== undefined && { encryptedData }),
      ...(isSensitive !== undefined && { isSensitive }),
    })
  }
  async deleteShare(
    teamId: string,
    shareId: string,
  ): Promise<ApiResponse<void>> {
    return this.request('DELETE', `/teams/${teamId}/shares/${shareId}`)
  }

  async listInvites(teamId: string): Promise<ApiResponse<ApiInvite[]>> {
    return this.request('GET', `/teams/${teamId}/invites`)
  }
  async createInvite(
    teamId: string,
    type: 'LINK' | 'CODE' | 'EMAIL',
    email?: string,
    role: 'ADMIN' | 'MEMBER' = 'MEMBER',
  ): Promise<ApiResponse<{ id: string; code?: string; linkToken?: string }>> {
    return this.request('POST', `/teams/${teamId}/invites`, {
      type,
      email,
      role,
    })
  }
  async deleteInvite(
    teamId: string,
    inviteId: string,
  ): Promise<ApiResponse<void>> {
    return this.request('DELETE', `/teams/${teamId}/invites/${inviteId}`)
  }
  async joinByCode(
    code: string,
    userName?: string,
  ): Promise<ApiResponse<{ teamId: string; role: string }>> {
    return this.request('POST', '/invites/join', { code, userName })
  }
  async getInviteByLink(
    linkToken: string,
  ): Promise<ApiResponse<{ teamName: string; role: string }>> {
    return this.request('GET', `/invites/link/${linkToken}`)
  }
  async joinByLink(
    linkToken: string,
    userName?: string,
  ): Promise<ApiResponse<{ teamId: string; role: string }>> {
    return this.request('POST', `/invites/link/${linkToken}/join`, { userName })
  }

  async listAuditLogs(
    teamId: string,
    limit = 100,
  ): Promise<
    ApiResponse<
      Array<{
        id: string
        userId: string
        userName?: string
        hostName?: string
        action: string
        details?: unknown
        createdAt: string
      }>
    >
  > {
    return this.request('GET', `/teams/${teamId}/audit?limit=${limit}`)
  }
}
