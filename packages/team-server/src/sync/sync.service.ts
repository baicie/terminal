import type { ConflictInfo, IncrementalSyncResult } from './sync-results'
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { deleteShareWithAudit } from '../shares/share-deletion'
import { OfflineSyncService } from './offline-sync.service'
import { buildShareCreateData, buildShareUpdateData } from './share-write-data'
import { SYNC_OPERATION_FAILED } from './sync-error'

export type { ConflictInfo, IncrementalSyncResult } from './sync-results'

@Injectable()
export class SyncService extends OfflineSyncService {
  private readonly syncLogger = new Logger(SyncService.name)

  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async getChanges(
    userId: string,
    since?: number,
  ): Promise<IncrementalSyncResult> {
    const sinceDate = since ? new Date(since) : new Date(0)
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    })
    const teamIds = memberships.map(membership => membership.teamId)
    if (teamIds.length === 0) {
      return { timestamp: Date.now(), shares: [], deletedShareIds: [] }
    }

    const shares = await this.prisma.share.findMany({
      where: { teamId: { in: teamIds }, updatedAt: { gte: sinceDate } },
      orderBy: { updatedAt: 'asc' },
    })
    const deleteLogs = await this.prisma.auditLog.findMany({
      where: {
        teamId: { in: teamIds },
        action: 'SHARE_DELETED',
        createdAt: { gte: sinceDate },
      },
    })

    return {
      timestamp: Date.now(),
      shares: shares.map(share => ({
        id: share.id,
        teamId: share.teamId,
        type: share.type,
        data: share.data,
        encryptedData: share.encryptedData,
        isSensitive: share.isSensitive,
        sharedBy: share.sharedBy,
        permission: share.permission,
        createdAt: share.createdAt.toISOString(),
        updatedAt: share.updatedAt.toISOString(),
      })),
      deletedShareIds: deleteLogs
        .map(log => (log.details as { shareId?: string })?.shareId)
        .filter(Boolean) as string[],
    }
  }

  async pushChanges(
    userId: string,
    changes: {
      shares?: Array<{
        id: string
        teamId: string
        type: string
        data: unknown
        encryptedData?: string
        isSensitive?: boolean
        permission: string
        baseVersion?: number
      }>
      deleteShares?: string[]
    },
  ): Promise<{
    created: string[]
    updated: string[]
    deleted: string[]
    conflicts: string[]
    errors: Array<{ id: string; error: string }>
  }> {
    const result = {
      created: [] as string[],
      updated: [] as string[],
      deleted: [] as string[],
      conflicts: [] as string[],
      errors: [] as Array<{ id: string; error: string }>,
    }

    for (const share of changes.shares ?? []) {
      try {
        const existing = await this.prisma.share.findUnique({
          where: { id: share.id },
        })
        if (existing) {
          if (existing.teamId !== share.teamId) {
            result.errors.push({
              id: share.id,
              error: 'Share does not belong to the requested team',
            })
            continue
          }
          const membership = await this.prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId: existing.teamId, userId } },
          })
          if (!membership) {
            result.errors.push({ id: share.id, error: 'Not a team member' })
            continue
          }
          if (existing.sharedBy !== userId) {
            result.errors.push({
              id: share.id,
              error: 'Only creator can update share',
            })
            continue
          }
          if (
            share.baseVersion !== undefined &&
            existing.updatedAt.getTime() > share.baseVersion
          ) {
            result.conflicts.push(share.id)
            continue
          }
          const updateData = buildShareUpdateData(share, existing)
          const updated = await this.prisma.share.update({
            where: { id: share.id },
            data: updateData,
          })
          result.updated.push(updated.id)
        } else {
          const membership = await this.prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId: share.teamId, userId } },
          })
          if (!membership) {
            result.errors.push({ id: share.id, error: 'Not a team member' })
            continue
          }
          const created = await this.prisma.share.create({
            data: buildShareCreateData(share, userId),
          })
          result.created.push(created.id)
        }
      } catch {
        this.syncLogger.error('Failed to process pushed share operation')
        result.errors.push({ id: share.id, error: SYNC_OPERATION_FAILED })
      }
    }

    for (const shareId of changes.deleteShares ?? []) {
      try {
        const existing = await this.prisma.share.findUnique({
          where: { id: shareId },
          include: { team: true },
        })
        if (!existing) {
          result.deleted.push(shareId)
          continue
        }
        const membership = await this.prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: existing.teamId, userId } },
        })
        if (!membership) {
          result.errors.push({ id: shareId, error: 'Not a team member' })
          continue
        }
        if (existing.sharedBy !== userId) {
          result.errors.push({
            id: shareId,
            error: 'Only creator can delete share',
          })
          continue
        }
        await deleteShareWithAudit(this.prisma, {
          teamId: existing.teamId,
          userId,
          shareId,
          shareType: existing.type,
        })
        result.deleted.push(shareId)
      } catch {
        this.syncLogger.error('Failed to process pushed share deletion')
        result.errors.push({ id: shareId, error: SYNC_OPERATION_FAILED })
      }
    }
    return result
  }

  async checkConflicts(
    userId: string,
    items: Array<{
      id: string
      updatedAt: number
      type: 'HOST' | 'SNIPPET_PACKAGE'
    }>,
  ): Promise<ConflictInfo[]> {
    const conflicts: ConflictInfo[] = []
    for (const item of items) {
      const share = await this.prisma.share.findUnique({
        where: { id: item.id },
      })
      if (!share) continue
      const membership = await this.prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: share.teamId, userId } },
      })
      if (membership && share.updatedAt.getTime() > item.updatedAt) {
        conflicts.push({
          shareId: item.id,
          localVersion: { updatedAt: item.updatedAt, data: item },
          remoteVersion: {
            updatedAt: share.updatedAt.getTime(),
            data: share.isSensitive ? { encrypted: true } : share.data,
            updatedBy: share.sharedBy,
          },
        })
      }
    }
    return conflicts
  }

  async resolveConflict(
    shareId: string,
    userId: string,
    resolution: 'LOCAL' | 'REMOTE',
    clientData?: {
      data: unknown
      encryptedData?: string
      isSensitive?: boolean
      permission?: string
    },
  ): Promise<{ success: boolean; error?: string }> {
    const share = await this.prisma.share.findUnique({ where: { id: shareId } })
    if (!share) return { success: false, error: 'Share not found' }
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: share.teamId, userId } },
    })
    if (!membership) return { success: false, error: 'Not a team member' }
    if (share.sharedBy !== userId) {
      return {
        success: false,
        error: 'Only creator can resolve share conflicts',
      }
    }

    if (resolution === 'LOCAL' && clientData?.isSensitive === undefined) {
      return {
        success: false,
        error: 'Local conflict data must include an explicit sensitive state',
      }
    }
    if (
      resolution === 'LOCAL' &&
      clientData?.isSensitive === true &&
      !clientData.encryptedData
    ) {
      return {
        success: false,
        error: 'Local sensitive conflict data must include encryptedData',
      }
    }
    if (resolution === 'LOCAL' && clientData) {
      await this.prisma.share.update({
        where: { id: shareId },
        data: buildShareUpdateData(clientData, share, true),
      })
    }
    return { success: true }
  }
}
