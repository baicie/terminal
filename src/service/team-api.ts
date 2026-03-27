/**
 * Team API Service - 连接 NestJS 后端服务
 */
import type {
  AuditLog,
  SharedHost,
  SharedSnippet,
  Team,
  TeamInvite,
  TeamMember,
} from '@/store/team'

interface ApiResponse<T> {
  data?: T
  error?: string
}

interface ApiError {
  statusCode: number
  message: string
}

class TeamApiService {
  private endpoint: string = ''
  private apiToken: string = ''
  private userId: string = ''

  configure(endpoint: string, apiToken: string, userId: string) {
    this.endpoint = endpoint.replace(/\/$/, '') // 移除末尾斜杠
    this.apiToken = apiToken
    this.userId = userId
  }

  isConfigured(): boolean {
    return Boolean(this.endpoint && this.apiToken && this.userId)
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    if (!this.isConfigured()) {
      return { error: 'API not configured' }
    }

    try {
      const url = `${this.endpoint}/api/v1${path}`
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      if (!response.ok) {
        const errorData: ApiError = await response.json().catch(() => ({
          statusCode: response.status,
          message: 'Request failed',
        }))
        return { error: errorData.message || `HTTP ${response.status}` }
      }

      // DELETE requests may return empty body
      const text = await response.text()
      const data = text ? JSON.parse(text) : null
      return { data }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Network error' }
    }
  }

  // ==================== Auth ====================

  async register(
    userId: string,
    name?: string,
  ): Promise<ApiResponse<{ id: string; token?: string }>> {
    return this.request('POST', '/auth/register', { userId, name })
  }

  async createToken(
    name: string,
  ): Promise<ApiResponse<{ id: string; token: string; name: string }>> {
    return this.request('POST', '/auth/tokens', { name })
  }

  async listTokens(): Promise<
    ApiResponse<Array<{ id: string; name: string; createdAt: string }>>
  > {
    return this.request('GET', '/auth/tokens')
  }

  async revokeToken(tokenId: string): Promise<ApiResponse<void>> {
    return this.request('DELETE', `/auth/tokens/${tokenId}`)
  }

  // ==================== Teams ====================

  async listTeams(): Promise<
    ApiResponse<
      Array<{
        id: string
        name: string
        ownerId: string
        memberCount: number
        role: string
      }>
    >
  > {
    return this.request('GET', '/teams')
  }

  async getTeam(teamId: string): Promise<
    ApiResponse<{
      id: string
      name: string
      ownerId: string
      memberCount: number
      role: string
    }>
  > {
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

  // ==================== Members ====================

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

  // ==================== Shares ====================

  async listShares(teamId: string): Promise<
    ApiResponse<
      Array<{
        id: string
        type: string
        data: unknown
        permission: string
        sharedBy: string
        createdAt: string
      }>
    >
  > {
    return this.request('GET', `/teams/${teamId}/shares`)
  }

  async createShare(
    teamId: string,
    type: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE',
    data: unknown,
    permission: 'READONLY' | 'READWRITE',
  ): Promise<ApiResponse<{ id: string }>> {
    return this.request('POST', `/teams/${teamId}/shares`, {
      type,
      data,
      permission,
    })
  }

  async updateShare(
    teamId: string,
    shareId: string,
    permission: 'READONLY' | 'READWRITE',
  ): Promise<ApiResponse<void>> {
    return this.request('PUT', `/teams/${teamId}/shares/${shareId}`, {
      permission,
    })
  }

  async deleteShare(
    teamId: string,
    shareId: string,
  ): Promise<ApiResponse<void>> {
    return this.request('DELETE', `/teams/${teamId}/shares/${shareId}`)
  }

  // ==================== Invites ====================

  async listInvites(teamId: string): Promise<
    ApiResponse<
      Array<{
        id: string
        type: string
        code?: string
        linkToken?: string
        email?: string
        role: string
        expiresAt: string
        usedAt?: string
      }>
    >
  > {
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

  // ==================== Audit ====================

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

  // ==================== Sync ====================

  async getChanges(since?: number): Promise<
    ApiResponse<{
      timestamp: number
      teams: unknown[]
      members: unknown[]
      shares: unknown[]
      auditLogs: unknown[]
    }>
  > {
    const query = since ? `?since=${since}` : ''
    return this.request('GET', `/sync${query}`)
  }

  async pushChanges(
    shares: Array<{
      id: string
      teamId: string
      type: string
      data: unknown
      permission: string
    }>,
  ): Promise<
    ApiResponse<{
      created: unknown[]
      updated: unknown[]
      errors: Array<{ id: string; error: string }>
    }>
  > {
    return this.request('POST', '/sync', { shares })
  }

  // Check for sync conflicts
  async checkConflicts(
    items: Array<{
      id: string
      updatedAt: number
      type: 'HOST' | 'SNIPPET_PACKAGE'
    }>,
  ): Promise<
    ApiResponse<
      Array<{
        shareId: string
        localVersion: { updatedAt: number; data: unknown }
        remoteVersion: { updatedAt: number; data: unknown; updatedBy: string }
      }>
    >
  > {
    return this.request('POST', '/sync/conflicts/check', { items })
  }

  // Resolve a sync conflict
  async resolveConflict(
    shareId: string,
    resolution: 'LOCAL' | 'REMOTE',
  ): Promise<ApiResponse<{ success: boolean; error?: string }>> {
    return this.request('POST', '/sync/conflicts/resolve', {
      shareId,
      resolution,
    })
  }

  // ==================== Health Check ====================

  async healthCheck(): Promise<boolean> {
    if (!this.endpoint) return false
    try {
      const response = await fetch(`${this.endpoint}/api/v1/health`, {
        method: 'GET',
        headers: this.apiToken
          ? {
              Authorization: `Bearer ${this.apiToken}`,
            }
          : {},
      })
      return response.ok
    } catch {
      return false
    }
  }
}

// 导出单例
export const teamApi = new TeamApiService()

// 类型转换辅助函数
export function convertApiTeam(apiTeam: {
  id: string
  name: string
  ownerId: string
  memberCount?: number
  role?: string
}): Team {
  return {
    id: apiTeam.id,
    name: apiTeam.name,
    ownerId: apiTeam.ownerId,
    mode: 'cloud',
    autoSync: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function convertApiMember(apiMember: {
  id: string
  userId: string
  userName?: string
  userEmail?: string
  role: string
}): TeamMember {
  return {
    id: apiMember.id,
    teamId: '', // 需要外部设置
    userId: apiMember.userId,
    userName: apiMember.userName,
    userEmail: apiMember.userEmail,
    role: apiMember.role.toLowerCase() as 'admin' | 'member',
    joinedAt: Date.now(),
  }
}

export function convertApiShare(apiShare: {
  id: string
  type: string
  data: unknown
  permission: string
  sharedBy: string
  createdAt: string
}): SharedHost | SharedSnippet {
  const base = {
    id: apiShare.id,
    teamId: '', // 需要外部设置
    sharedBy: apiShare.sharedBy,
    permission: apiShare.permission.toLowerCase() as 'readonly' | 'readwrite',
    createdAt: new Date(apiShare.createdAt).getTime(),
  }

  if (apiShare.type === 'SNIPPET_PACKAGE') {
    return {
      ...base,
      snippetData: apiShare.data as Record<string, unknown>,
    } as SharedSnippet
  }

  return {
    ...base,
    hostData: apiShare.data as Record<string, unknown>,
  } as SharedHost
}

export function convertApiInvite(apiInvite: {
  id: string
  type: string
  code?: string
  linkToken?: string
  email?: string
  role: string
  expiresAt: string
  usedAt?: string
}): TeamInvite {
  return {
    id: apiInvite.id,
    teamId: '', // 需要外部设置
    type: apiInvite.type.toLowerCase() as 'link' | 'code' | 'email',
    code: apiInvite.code,
    linkToken: apiInvite.linkToken,
    email: apiInvite.email,
    role: apiInvite.role.toLowerCase() as 'admin' | 'member',
    createdBy: '', // API 不返回此字段
    expiresAt: new Date(apiInvite.expiresAt).getTime(),
    usedAt: apiInvite.usedAt ? new Date(apiInvite.usedAt).getTime() : undefined,
    createdAt: Date.now(),
  }
}

export function convertApiAuditLog(apiLog: {
  id: string
  userId: string
  userName?: string
  hostName?: string
  action: string
  details?: unknown
  createdAt: string
}): AuditLog {
  return {
    id: apiLog.id,
    teamId: '', // 需要外部设置
    userId: apiLog.userId,
    userName: apiLog.userName,
    hostName: apiLog.hostName,
    action: apiLog.action,
    details: apiLog.details as Record<string, unknown>,
    createdAt: new Date(apiLog.createdAt).getTime(),
  }
}
