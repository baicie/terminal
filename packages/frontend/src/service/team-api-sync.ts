import { TeamApiResources } from './team-api-resources'
import type { ApiResponse } from './team-api-types'

export class TeamApiSync extends TeamApiResources {
  async getChanges(since?: number): Promise<
    ApiResponse<{
      timestamp: number
      teams: unknown[]
      members: unknown[]
      shares: Array<{
        id: string
        teamId: string
        type: string
        data: unknown
        encryptedData: string | null
        isSensitive: boolean
        permission: string
        sharedBy: string
        createdAt: string
        updatedAt: string
      }>
      deletedShareIds: string[]
      auditLogs: unknown[]
    }>
  > {
    return this.request('GET', `/sync${since ? `?since=${since}` : ''}`)
  }

  async pushChanges(
    shares: Array<{
      id: string
      teamId: string
      type: string
      data: unknown
      encryptedData?: string
      isSensitive?: boolean
      permission: string
      baseVersion?: number
    }>,
    deleteShares?: string[],
  ): Promise<
    ApiResponse<{
      created: string[]
      updated: string[]
      deleted: string[]
      conflicts: string[]
      errors: Array<{ id: string; error: string }>
    }>
  > {
    return this.request('POST', '/sync', { shares, deleteShares })
  }

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

  async resolveConflict(
    shareId: string,
    resolution: 'LOCAL' | 'REMOTE',
    clientData?: {
      data: unknown
      encryptedData?: string
      isSensitive?: boolean
      permission?: string
    },
  ): Promise<ApiResponse<{ success: boolean; error?: string }>> {
    return this.request('POST', '/sync/conflicts/resolve', {
      shareId,
      resolution,
      clientData,
    })
  }

  async getPendingOperations(): Promise<
    ApiResponse<
      Array<{
        id: string
        teamId: string
        operation: string
        shareType: string
        shareId: string
        data: unknown
        attempts: number
        lastError: string | null
        createdAt: string
      }>
    >
  > {
    return this.request('GET', '/sync/queue')
  }
  async processOfflineQueue(): Promise<
    ApiResponse<{
      processed: number
      succeeded: number
      failed: number
      errors: Array<{ id: string; error: string }>
    }>
  > {
    return this.request('POST', '/sync/queue/process', {})
  }
  async enqueueOfflineOperation(
    teamId: string,
    operation: 'CREATE' | 'UPDATE' | 'DELETE',
    shareType: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE',
    shareId: string,
    data?: unknown,
  ): Promise<ApiResponse<{ id: string }>> {
    return this.request('POST', '/sync/queue/enqueue', {
      teamId,
      operation,
      shareType,
      shareId,
      data,
    })
  }
  async removeFromQueue(
    id: string,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return this.request('DELETE', `/sync/queue/${id}`)
  }
  async clearTeamQueue(
    teamId: string,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return this.request('DELETE', `/sync/queue/team/${teamId}`)
  }

  async healthCheck(): Promise<boolean> {
    if (!this.endpoint) return false
    try {
      const response = await fetch(`${this.endpoint}/api/v1/health`, {
        method: 'GET',
        headers: this.apiToken
          ? { Authorization: `Bearer ${this.apiToken}` }
          : {},
      })
      return response.ok
    } catch {
      return false
    }
  }
}
