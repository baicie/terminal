import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

export interface ConflictInfo {
  shareId: string
  localVersion: {
    updatedAt: number
    data: any
  }
  remoteVersion: {
    updatedAt: number
    data: any
    updatedBy: string
  }
}

@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get all changes since a given timestamp for a user's teams
   */
  async getChanges(userId: string, since?: number) {
    const sinceDate = since ? new Date(since) : new Date(0)

    // Get user's teams
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    })
    const teamIds = memberships.map(m => m.teamId)

    // Get all changes since timestamp
    const [teams, members, shares, auditLogs] = await Promise.all([
      this.prisma.team.findMany({
        where: { id: { in: teamIds }, updatedAt: { gte: sinceDate } },
      }),
      this.prisma.teamMember.findMany({
        where: { teamId: { in: teamIds }, joinedAt: { gte: sinceDate } },
      }),
      this.prisma.share.findMany({
        where: { teamId: { in: teamIds }, updatedAt: { gte: sinceDate } },
      }),
      this.prisma.auditLog.findMany({
        where: { teamId: { in: teamIds }, createdAt: { gte: sinceDate } },
      }),
    ])

    return {
      timestamp: Date.now(),
      teams,
      members,
      shares,
      auditLogs,
    }
  }

  /**
   * Check for conflicts between local and remote versions
   */
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

      if (share && share.updatedAt.getTime() > item.updatedAt) {
        // Remote version is newer - conflict detected
        conflicts.push({
          shareId: item.id,
          localVersion: {
            updatedAt: item.updatedAt,
            data: item,
          },
          remoteVersion: {
            updatedAt: share.updatedAt.getTime(),
            data: share.data,
            updatedBy: share.sharedBy,
          },
        })
      }
    }

    return conflicts
  }

  /**
   * Resolve conflict by choosing local or remote version
   */
  async resolveConflict(
    shareId: string,
    userId: string,
    resolution: 'LOCAL' | 'REMOTE',
  ): Promise<{ success: boolean; error?: string }> {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
    })

    if (!share) {
      return { success: false, error: 'Share not found' }
    }

    // Verify user is team member
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: share.teamId, userId } },
    })

    if (!membership) {
      return { success: false, error: 'Not a team member' }
    }

    if (resolution === 'REMOTE') {
      // Keep remote version - no change needed
      return { success: true }
    } else {
      // Push local version to server
      await this.prisma.share.update({
        where: { id: shareId },
        data: {
          sharedBy: userId,
          updatedAt: new Date(),
        },
      })
      return { success: true }
    }
  }

  /**
   * Push local changes to server
   */
  async pushChanges(
    userId: string,
    changes: {
      shares?: Array<{
        id: string
        teamId: string
        type: string
        data: any
        permission: string
      }>
    },
  ) {
    const results: any = { created: [], updated: [], errors: [] }

    // Process share creations/updates
    if (changes.shares) {
      for (const share of changes.shares) {
        try {
          // Check membership
          const membership = await this.prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId: share.teamId, userId } },
          })
          if (!membership) {
            results.errors.push({ id: share.id, error: 'Not a team member' })
            continue
          }

          // Upsert share
          const existing = await this.prisma.share.findUnique({
            where: { id: share.id },
          })
          if (existing) {
            const updated = await this.prisma.share.update({
              where: { id: share.id },
              data: { data: share.data, permission: share.permission as any },
            })
            results.updated.push(updated)
          } else {
            const created = await this.prisma.share.create({
              data: {
                id: share.id,
                teamId: share.teamId,
                type: share.type as any,
                data: share.data,
                sharedBy: userId,
                permission: share.permission as any,
              },
            })
            results.created.push(created)
          }
        } catch (error) {
          results.errors.push({ id: share.id, error: String(error) })
        }
      }
    }

    return results
  }
}
