import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { Prisma } from '@prisma/client'

export interface ConflictInfo {
  shareId: string
  localVersion: { updatedAt: number; data: unknown }
  remoteVersion: { updatedAt: number; data: unknown; updatedBy: string }
}

export interface IncrementalSyncResult {
  timestamp: number
  shares: {
    id: string
    teamId: string
    type: string
    data: unknown
    encryptedData: string | null
    isSensitive: boolean
    sharedBy: string
    permission: string
    createdAt: string
    updatedAt: string
  }[]
  deletedShareIds: string[]
}

@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService) {}

  async getChanges(userId: string, since?: number): Promise<IncrementalSyncResult> {
    const sinceDate = since ? new Date(since) : new Date(0)

    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    })
    const teamIds = memberships.map((m) => m.teamId)

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
      shares: shares.map((s) => ({
        id: s.id,
        teamId: s.teamId,
        type: s.type,
        data: s.data,
        encryptedData: s.encryptedData,
        isSensitive: s.isSensitive,
        sharedBy: s.sharedBy,
        permission: s.permission,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      deletedShareIds: deleteLogs
        .map((log) => (log.details as { shareId?: string })?.shareId)
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
      errors: [] as { id: string; error: string }[],
    }

    if (changes.shares) {
      for (const share of changes.shares) {
        try {
          const membership = await this.prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId: share.teamId, userId } },
          })
          if (!membership) {
            result.errors.push({ id: share.id, error: 'Not a team member' })
            continue
          }

          const existing = await this.prisma.share.findUnique({
            where: { id: share.id },
          })

          if (existing) {
            if (share.baseVersion && existing.updatedAt.getTime() > share.baseVersion) {
              result.conflicts.push(share.id)
              continue
            }

            const updateData: Prisma.ShareUpdateInput = {
              isSensitive: share.isSensitive ?? false,
              permission: share.permission as 'READONLY' | 'READWRITE',
            }
            if (share.isSensitive) {
              updateData.encryptedData = share.encryptedData ?? null
              updateData.data = {}
            } else {
              updateData.data = share.data as Prisma.InputJsonValue
              updateData.encryptedData = null
            }

            const updated = await this.prisma.share.update({
              where: { id: share.id },
              data: updateData,
            })
            result.updated.push(updated.id)
          } else {
            const createData: Prisma.ShareCreateInput = {
              id: share.id,
              team: { connect: { id: share.teamId } },
              type: share.type as 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE',
              isSensitive: share.isSensitive ?? false,
              sharedBy: userId,
              permission: share.permission as 'READONLY' | 'READWRITE',
              data: (share.isSensitive
                  ? {}
                  : share.data) as Prisma.InputJsonValue,
              ...(share.isSensitive && { encryptedData: share.encryptedData ?? null }),
            }

            const created = await this.prisma.share.create({ data: createData })
            result.created.push(created.id)
          }
        } catch (error) {
          result.errors.push({ id: share.id, error: String(error) })
        }
      }
    }

    if (changes.deleteShares) {
      for (const shareId of changes.deleteShares) {
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

          await this.prisma.share.delete({ where: { id: shareId } })
          await this.prisma.auditLog.create({
            data: {
              teamId: existing.teamId,
              userId,
              action: 'SHARE_DELETED',
              details: { shareId, shareType: existing.type },
            },
          })
          result.deleted.push(shareId)
        } catch (error) {
          result.errors.push({ id: shareId, error: String(error) })
        }
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
      const share = await this.prisma.share.findUnique({ where: { id: item.id } })
      if (!share) continue
      if (share.updatedAt.getTime() > item.updatedAt) {
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

    if (resolution === 'LOCAL' && clientData) {
      const updateData: Prisma.ShareUpdateInput = {
        isSensitive: clientData.isSensitive ?? false,
        permission: (clientData.permission as 'READONLY' | 'READWRITE') ?? share.permission,
        sharedBy: userId,
      }
      if (clientData.isSensitive) {
        updateData.encryptedData = clientData.encryptedData ?? null
        updateData.data = {}
      } else {
        updateData.data = clientData.data as Prisma.InputJsonValue
        updateData.encryptedData = null
      }

      await this.prisma.share.update({
        where: { id: shareId },
        data: updateData,
      })
    }

    return { success: true }
  }

  // ==================== Offline Queue ====================

  async enqueueOfflineOperation(
    userId: string,
    teamId: string,
    operation: 'CREATE' | 'UPDATE' | 'DELETE',
    shareType: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE',
    shareId: string,
    data?: unknown,
  ): Promise<{ id: string }> {
    const item = await this.prisma.syncQueue.create({
      data: {
        userId,
        teamId,
        operation,
        shareType,
        shareId,
        data: data as Prisma.InputJsonValue | undefined,
      },
    })
    return { id: item.id }
  }

  async getPendingOperations(
    userId: string,
  ): Promise<
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
  > {
    const items = await this.prisma.syncQueue.findMany({
      where: { userId, status: { in: ['PENDING', 'FAILED'] } },
      orderBy: { createdAt: 'asc' },
    })
    return items.map((i) => ({
      id: i.id,
      teamId: i.teamId,
      operation: i.operation,
      shareType: i.shareType,
      shareId: i.shareId,
      data: i.data,
      attempts: i.attempts,
      lastError: i.lastError,
      createdAt: i.createdAt.toISOString(),
    }))
  }

  async processOfflineQueue(userId: string): Promise<{
    processed: number
    succeeded: number
    failed: number
    errors: Array<{ id: string; error: string }>
  }> {
    const pending = await this.prisma.syncQueue.findMany({
      where: { userId, status: { in: ['PENDING', 'FAILED'] } },
      orderBy: { createdAt: 'asc' },
      take: 50,
    })

    if (pending.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0, errors: [] }
    }

    let succeeded = 0
    let failed = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const item of pending) {
      await this.prisma.syncQueue.update({
        where: { id: item.id },
        data: { status: 'PROCESSING', attempts: item.attempts + 1 },
      })

      try {
        switch (item.operation) {
          case 'CREATE':
          case 'UPDATE': {
            const shareData = item.data as {
              id: string
              teamId: string
              type: string
              data: unknown
              encryptedData?: string
              isSensitive?: boolean
              permission: string
            }

            const existing = await this.prisma.share.findUnique({
              where: { id: shareData.id },
            })

            if (existing) {
              const updateData: Prisma.ShareUpdateInput = {
                isSensitive: shareData.isSensitive ?? false,
                permission: shareData.permission as 'READONLY' | 'READWRITE',
                sharedBy: userId,
              }
              if (shareData.isSensitive) {
                updateData.encryptedData = shareData.encryptedData ?? null
                updateData.data = {}
              } else {
                updateData.data = shareData.data as Prisma.InputJsonValue
                updateData.encryptedData = null
              }
              await this.prisma.share.update({
                where: { id: shareData.id },
                data: updateData,
              })
            } else {
              const createData: Prisma.ShareCreateInput = {
                id: shareData.id,
                team: { connect: { id: shareData.teamId } },
                type: shareData.type as 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE',
                isSensitive: shareData.isSensitive ?? false,
                sharedBy: userId,
                permission: shareData.permission as 'READONLY' | 'READWRITE',
                data: (shareData.isSensitive
                  ? {}
                  : shareData.data) as Prisma.InputJsonValue,
                ...(shareData.isSensitive && { encryptedData: shareData.encryptedData ?? null }),
              }
              await this.prisma.share.create({ data: createData })
            }
            break
          }
          case 'DELETE': {
            const existing = await this.prisma.share.findUnique({
              where: { id: item.shareId },
            })
            if (existing) {
              await this.prisma.share.delete({ where: { id: item.shareId } })
              await this.prisma.auditLog.create({
                data: {
                  teamId: item.teamId,
                  userId,
                  action: 'SHARE_DELETED',
                  details: { shareId: item.shareId, shareType: item.shareType },
                },
              })
            }
            break
          }
        }

        await this.prisma.syncQueue.update({
          where: { id: item.id },
          data: { status: 'COMPLETED' },
        })
        succeeded++
      } catch (error) {
        const errorMsg = String(error)
        await this.prisma.syncQueue.update({
          where: { id: item.id },
          data: {
            status: item.attempts >= 3 ? 'FAILED' : 'PENDING',
            lastError: errorMsg,
          },
        })
        failed++
        errors.push({ id: item.id, error: errorMsg })
      }
    }

    return { processed: pending.length, succeeded, failed, errors }
  }

  async removeFromQueue(id: string, userId: string): Promise<void> {
    await this.prisma.syncQueue.deleteMany({ where: { id, userId } })
  }

  async clearTeamQueue(userId: string, teamId: string): Promise<void> {
    await this.prisma.syncQueue.deleteMany({ where: { userId, teamId } })
  }
}
