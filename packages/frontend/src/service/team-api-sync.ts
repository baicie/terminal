import { TeamApiResources } from './team-api-resources'
import type {
  ApiOperationResult,
  ApiOutcome,
  ApiResponse,
} from './team-api-types'

export class TeamApiSync extends TeamApiResources {
  async getChanges(since?: string): Promise<
    ApiResponse<{
      /** Opaque server cursor (`2.<bound>.<txid>.<seq>`) to replay unchanged. */
      cursor: string
      /** Numeric safe watermark of the window. Display only, never a cursor. */
      timestamp: number
      /** True when the bounded window still holds undelivered rows. */
      hasMore: boolean
      resync: boolean
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
        /** Server-issued monotonic version, echoed back as baseVersion. */
        version: number
      }>
      deletedShareIds: string[]
      auditLogs: unknown[]
    }>
  > {
    const query = since ? `?since=${encodeURIComponent(since)}` : ''
    return this.request('GET', `/sync${query}`)
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
      operation?: 'CREATE' | 'UPDATE' | 'DELETE'
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
      /** Server version this copy is based on; the only input the verdict uses. */
      version?: number
      type: 'HOST' | 'SNIPPET_PACKAGE'
    }>,
  ): Promise<
    ApiResponse<
      Array<{
        shareId: string
        version?: number | null
        isSensitive?: boolean
        localVersion: { updatedAt: number; data: unknown }
        remoteVersion: {
          updatedAt: number
          data: unknown
          updatedBy: string
          version?: number | null
          isSensitive?: boolean
        }
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
      baseVersion?: number
    },
  ): Promise<ApiOutcome<ApiOperationResult>> {
    // Judged by the server's verdict, not by the HTTP status: a 200 carrying
    // `success: false` is a refusal, and treating it as done dropped the
    // conflict while nothing had converged (P9.2-3).
    return this.operationResult('POST', '/sync/conflicts/resolve', {
      shareId,
      resolution,
      clientData,
    })
  }

  /**
   * Reads one share as the server holds it right now. A REMOTE resolution needs
   * the authoritative snapshot: a push-only conflict carries no remote data, and
   * adopting a placeholder would be adopting nothing (P9.2-4). The caller must
   * pass the team the record belongs to; the server scopes the read to it, so a
   * share id from another team stays invisible.
   *
   * The outcome keeps the HTTP status, because the three ways this can fail need
   * three different answers: 404 means the share is gone (nothing to adopt), 403
   * means this identity may no longer read it, and anything else is a transient
   * failure that must leave the conflict in place to be retried.
   */
  async getShare(
    teamId: string,
    shareId: string,
  ): Promise<
    ApiOutcome<{
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
      version: number
    }>
  > {
    return this.readOperation(
      `/teams/${encodeURIComponent(teamId)}/shares/${encodeURIComponent(shareId)}`,
    )
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
