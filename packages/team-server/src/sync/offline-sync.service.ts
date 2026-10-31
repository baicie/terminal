import { randomUUID } from 'node:crypto'
import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { deleteShareWithAudit } from '../shares/share-deletion'
import { canonicalizeQueuedData, isRecord } from './offline-sync-data'
import {
  buildQueuedShareCreateData,
  requireQueuedShareScope,
} from './queued-share-write-data'
import { buildShareUpdateData } from './share-write-data'
import { describeSyncError, SYNC_OPERATION_FAILED } from './sync-error'
import { classifyBaseVersion } from './sync-protocol'

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
        this.assertQueuedVersion(existing, data.baseVersion as number)
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
      } catch (error) {
        this.offlineSyncLogger.error(
          `Failed to process offline sync operation (code=${describeSyncError(error)})`,
        )
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
    item: {
      operation: string
      teamId: string
      shareId: string
      data: unknown
    },
  ) {
    await this.checkMembership(item.teamId, userId)
    const shareData = requireQueuedShareScope(item.data, item)
    const existing = await this.prisma.share.findUnique({
      where: { id: shareData.id },
    })
    if (existing) {
      if (existing.teamId !== item.teamId) {
        throw new ForbiddenException('Share does not belong to the queued team')
      }
      if (item.operation === 'CREATE') {
        throw new BadRequestException(
          'Queued share create conflicts with an existing share',
        )
      }
      const isCreator = existing.sharedBy === userId
      if (!isCreator && existing.permission !== 'READWRITE') {
        throw new ForbiddenException('Only creator can update share')
      }
      this.assertQueuedVersion(existing, shareData.baseVersion)
      const written = await this.prisma.share.updateMany({
        where: {
          id: shareData.id,
          teamId: item.teamId,
          sharedBy: existing.sharedBy,
          version: existing.version,
        },
        data: buildShareUpdateData(shareData, existing, !isCreator, !isCreator),
      })
      if (written.count !== 1) {
        throw new BadRequestException('Queued share update is stale')
      }
      return
    }

    if (item.operation === 'UPDATE') {
      // A queued update must never resurrect a share that was deleted meanwhile.
      throw new BadRequestException('Queued share update targets a missing share')
    }
    await this.prisma.share.create({
      data: buildQueuedShareCreateData(shareData, item.teamId, userId),
    })
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

  /**
   * A queued write either proves the exact current version or is a legacy write
   * with no proof at all; the version CAS in the caller is the final authority.
   */
  private assertQueuedVersion(
    existing: { version: bigint },
    baseVersion: number | undefined,
  ): void {
    const verdict = classifyBaseVersion(existing.version, baseVersion)
    if (verdict === 'match' || verdict === 'unproven') return
    throw new BadRequestException('Queued share update is stale')
  }

  private async checkMembership(teamId: string, userId: string) {
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (!membership) throw new ForbiddenException('Not a team member')
    return membership
  }

}
