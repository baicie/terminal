import type { PushedShare } from './sync-protocol'
import type {
  ConflictInfo,
  IncrementalSyncResult,
  PushResult,
} from './sync-results'
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { deleteShareWithAudit } from '../shares/share-deletion'
import { OfflineSyncService } from './offline-sync.service'
import { buildShareCreateData, buildShareUpdateData } from './share-write-data'
import { describeSyncError, SYNC_OPERATION_FAILED } from './sync-error'
import {
  isStaleWrite,
  parseVersion,
  readChangeWindow,
  shareContentDigest,
} from './sync-protocol'

export type {
  ConflictInfo,
  IncrementalSyncResult,
  PushResult,
} from './sync-results'

@Injectable()
export class SyncService extends OfflineSyncService {
  private readonly syncLogger = new Logger(SyncService.name)

  constructor(prisma: PrismaService) {
    super(prisma)
  }

  /**
   * Incremental pull driven by a server cursor, never by a clock.
   * The window is [since, safe) over transaction ids, so a transaction that
   * allocated its id before the read but committed after it is delivered by the
   * next round instead of being skipped forever (docs/phase8/sync-protocol.md §3).
   */
  async getChanges(
    userId: string,
    since?: number,
  ): Promise<IncrementalSyncResult> {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    })
    const window = await readChangeWindow(
      this.prisma,
      memberships.map(membership => membership.teamId),
      since,
    )
    return {
      cursor: window.cursor, timestamp: window.cursor, resync: window.resync,
      shares: window.shares, deletedShareIds: window.deletedShareIds,
    }
  }

  async pushChanges(
    userId: string,
    changes: { shares?: PushedShare[], deleteShares?: string[] },
  ): Promise<PushResult> {
    const result: PushResult = {
      created: [], updated: [], deleted: [], conflicts: [], errors: [],
    }
    for (const share of changes.shares ?? []) {
      try {
        await this.applyPushedShare(userId, share, result)
      } catch (error) {
        this.syncLogger.error(
          `Failed to process pushed share operation (code=${describeSyncError(error)})`,
        )
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
          result.errors.push({ id: shareId, error: 'Only creator can delete share' })
          continue
        }
        await deleteShareWithAudit(this.prisma, {
          teamId: existing.teamId,
          userId,
          shareId,
          shareType: existing.type,
        })
        result.deleted.push(shareId)
      } catch (error) {
        this.syncLogger.error(
          `Failed to process pushed share deletion (code=${describeSyncError(error)})`,
        )
        result.errors.push({ id: shareId, error: SYNC_OPERATION_FAILED })
      }
    }
    return result
  }

  /**
   * Writes one pushed share honouring the declared operation. Every branch
   * either writes exactly one versioned change or reports a conflict, so a
   * replay can never overwrite newer data (docs/phase8/sync-protocol.md §1).
   */
  private async applyPushedShare(
    userId: string,
    share: PushedShare,
    result: PushResult,
  ): Promise<void> {
    const existing = await this.prisma.share.findUnique({
      where: { id: share.id },
    })
    if (existing) {
      // Team scope is checked before membership so a cross-team push never
      // reveals whether the caller is a member.
      if (existing.teamId !== share.teamId) {
        result.errors.push({
          id: share.id,
          error: 'Share does not belong to the requested team',
        })
        return
      }
      const membership = await this.prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: existing.teamId, userId } },
      })
      if (!membership) {
        result.errors.push({ id: share.id, error: 'Not a team member' })
        return
      }
      const isCreator = existing.sharedBy === userId
      if (!isCreator && existing.permission !== 'READWRITE') {
        result.errors.push({
          id: share.id,
          error: 'Only creator can update share',
        })
        return
      }
      if (isStaleWrite(existing, share.baseVersion)) {
        result.conflicts.push(share.id)
        return
      }
      if (shareContentDigest(existing) === shareContentDigest(share)) {
        // Replay of a request that already landed: acknowledge without writing.
        result.updated.push(share.id)
        return
      }
      const declared = share.operation !== undefined
        || share.baseVersion !== undefined
      if (declared && share.baseVersion === undefined) {
        result.conflicts.push(share.id)
        return
      }
      const written = await this.prisma.share.updateMany({
        where: {
          id: share.id,
          teamId: share.teamId,
          sharedBy: existing.sharedBy,
          updatedAt: existing.updatedAt,
        },
        data: buildShareUpdateData(share, existing, !isCreator, !isCreator),
      })
      if (written.count !== 1) {
        result.conflicts.push(share.id)
        return
      }
      result.updated.push(share.id)
      return
    }

    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: share.teamId, userId } },
    })
    if (!membership) {
      result.errors.push({ id: share.id, error: 'Not a team member' })
      return
    }
    if (share.operation === 'UPDATE') {
      // The row was deleted after the client read it: never resurrect silently.
      result.conflicts.push(share.id)
      return
    }
    // Only a client that states its intent (or carries a version) is checked
    // against the tombstone log; an undeclared write keeps the legacy
    // "force write" semantics documented in docs/phase8/sync-protocol.md §6.
    if (share.operation !== undefined || share.baseVersion !== undefined) {
      const tombstone = await this.prisma.syncChange.findFirst({
        where: { shareId: share.id, op: 'DELETE' },
        orderBy: { seq: 'desc' },
        select: { version: true },
      })
      const reborn = tombstone !== null
        && (share.baseVersion === undefined
          || parseVersion(tombstone.version) > share.baseVersion)
      if (reborn) {
        result.conflicts.push(share.id)
        return
      }
    }
    const created = await this.prisma.share.create({
      data: buildShareCreateData(share, userId),
    })
    result.created.push(created.id)
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
  ): Promise<{ success: boolean, error?: string }> {
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
      resolution === 'LOCAL'
      && clientData?.isSensitive === true
      && !clientData.encryptedData
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
