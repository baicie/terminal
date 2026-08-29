import { randomUUID } from 'node:crypto'
import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { deleteShareWithAudit } from '../shares/share-deletion'
import {
  resolveCreateSensitivity,
} from '../shares/share-security'
import { canonicalizeQueuedData, isRecord } from './offline-sync-data'
import { buildShareUpdateData } from './share-write-data'
import { SYNC_OPERATION_FAILED } from './sync-error'

const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000

export abstract class OfflineSyncService {
  private readonly offlineSyncLogger = new Logger(OfflineSyncService.name)

  constructor(protected readonly prisma: PrismaService) {}

  async enqueueOfflineOperation(
    userId: string,
    teamId: string,
    operation: 'CREATE' | 'UPDATE' | 'DELETE',
    shareType: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE',
    shareId: string,
    data?: unknown,
  ): Promise<{ id: string }> {
    await this.checkMembership(teamId, userId)
    let canonicalData = canonicalizeQueuedData(
      operation,
      teamId,
      shareId,
      data,
    )
    if (operation === 'UPDATE' && isRecord(data)) {
      const existing = await this.prisma.share.findUnique({
        where: { id: shareId },
      })
      if (existing) {
        if (existing.teamId !== teamId) {
          throw new ForbiddenException(
            'Share does not belong to the queued team',
          )
        }
        if (existing.sharedBy !== userId) {
          throw new ForbiddenException('Only creator can update share')
        }
        if (existing.updatedAt.getTime() > (data.baseVersion as number)) {
          throw new BadRequestException('Queued share update is stale')
        }
        canonicalData = canonicalizeQueuedData(
          operation,
          teamId,
          shareId,
          data,
          existing,
        )
      }
    }
    const item = await this.prisma.syncQueue.create({
      data: {
        userId,
        teamId,
        operation,
        shareType,
        shareId,
        data: canonicalData,
      },
    })
    return { id: item.id }
  }

  async getPendingOperations(userId: string): Promise<
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
    return items.map(item => ({
      id: item.id,
      teamId: item.teamId,
      operation: item.operation,
      shareType: item.shareType,
      shareId: item.shareId,
      data: item.data,
      attempts: item.attempts,
      lastError: item.lastError ? SYNC_OPERATION_FAILED : null,
      createdAt: item.createdAt.toISOString(),
    }))
  }

  async processOfflineQueue(userId: string): Promise<{
    processed: number
    succeeded: number
    failed: number
    errors: Array<{ id: string; error: string }>
  }> {
    await this.prisma.syncQueue.updateMany({
      where: {
        userId,
        status: 'PROCESSING',
        updatedAt: { lt: new Date(Date.now() - PROCESSING_TIMEOUT_MS) },
      },
      data: { status: 'PENDING', processingToken: null },
    })
    const pending = await this.prisma.syncQueue.findMany({
      where: { userId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 50,
    })
    if (pending.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0, errors: [] }
    }

    let succeeded = 0
    let failed = 0
    let processed = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const item of pending) {
      const processingToken = randomUUID()
      const claim = await this.prisma.syncQueue.updateMany({
        where: { id: item.id, userId, status: 'PENDING' },
        data: {
          status: 'PROCESSING',
          attempts: { increment: 1 },
          processingToken,
        },
      })
      if (claim.count !== 1) continue
      processed++
      const attempts = item.attempts + 1

      try {
        if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
          await this.upsertQueuedShare(userId, item)
        } else if (item.operation === 'DELETE') {
          await this.deleteQueuedShare(userId, item)
        } else {
          throw new BadRequestException('Unsupported queued operation')
        }
        const completed = await this.prisma.syncQueue.updateMany({
          where: { id: item.id, userId, status: 'PROCESSING', processingToken },
          data: {
            status: 'COMPLETED',
            data: Prisma.DbNull,
            processingToken: null,
          },
        })
        if (completed.count !== 1) {
          throw new Error('Queue processing lease expired')
        }
        succeeded++
      } catch {
        this.offlineSyncLogger.error('Failed to process offline sync operation')
        await this.prisma.syncQueue.updateMany({
          where: { id: item.id, userId, status: 'PROCESSING', processingToken },
          data: {
            status: attempts >= 3 ? 'FAILED' : 'PENDING',
            lastError: SYNC_OPERATION_FAILED,
            processingToken: null,
          },
        })
        failed++
        errors.push({ id: item.id, error: SYNC_OPERATION_FAILED })
      }
    }

    return { processed, succeeded, failed, errors }
  }

  async removeFromQueue(id: string, userId: string): Promise<void> {
    await this.prisma.syncQueue.deleteMany({ where: { id, userId } })
  }

  async clearTeamQueue(userId: string, teamId: string): Promise<void> {
    await this.prisma.syncQueue.deleteMany({ where: { userId, teamId } })
  }

  private async upsertQueuedShare(
    userId: string,
    item: { teamId: string; shareId: string; data: unknown },
  ) {
    await this.checkMembership(item.teamId, userId)
    const rawData = item.data
    const shareData = rawData as {
      id: string
      teamId: string
      type: string
      data: unknown
      encryptedData?: string
      isSensitive?: boolean
      permission: string
      baseVersion?: number
    }
    if (
      !shareData ||
      shareData.teamId !== item.teamId ||
      shareData.id !== item.shareId
    ) {
      throw new ForbiddenException('Queued share is outside team scope')
    }
    const existing = await this.prisma.share.findUnique({
      where: { id: shareData.id },
    })
    if (existing) {
      if (existing.teamId !== item.teamId) {
        throw new ForbiddenException('Share does not belong to the queued team')
      }
      if (existing.sharedBy !== userId) {
        throw new ForbiddenException('Only creator can update share')
      }
      if (
        shareData.baseVersion !== undefined &&
        existing.updatedAt.getTime() > shareData.baseVersion
      ) {
        throw new BadRequestException('Queued share update is stale')
      }
      await this.prisma.share.update({
        where: { id: shareData.id },
        data: buildShareUpdateData(shareData, existing),
      })
      return
    }

    const isSensitive = resolveCreateSensitivity(
      shareData.isSensitive,
      shareData.encryptedData,
    )
    const createData: Prisma.ShareCreateInput = {
      id: shareData.id,
      team: { connect: { id: item.teamId } },
      type: shareData.type as 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE',
      isSensitive,
      sharedBy: userId,
      permission: shareData.permission as 'READONLY' | 'READWRITE',
      data: (isSensitive ? {} : shareData.data) as Prisma.InputJsonValue,
      ...(isSensitive && {
        encryptedData: shareData.encryptedData,
      }),
    }
    await this.prisma.share.create({ data: createData })
  }

  private async deleteQueuedShare(
    userId: string,
    item: { shareId: string; shareType: string; teamId: string },
  ) {
    await this.checkMembership(item.teamId, userId)
    const existing = await this.prisma.share.findUnique({
      where: { id: item.shareId },
    })
    if (!existing) return
    if (existing.teamId !== item.teamId) {
      throw new ForbiddenException('Share does not belong to the queued team')
    }
    if (existing.sharedBy !== userId) {
      throw new ForbiddenException('Only creator can delete share')
    }
    await deleteShareWithAudit(this.prisma, {
      teamId: item.teamId,
      userId,
      shareId: item.shareId,
      shareType: item.shareType,
    })
  }

  private async checkMembership(teamId: string, userId: string) {
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (!membership) throw new ForbiddenException('Not a team member')
    return membership
  }

}
