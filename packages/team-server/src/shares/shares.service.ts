import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class SharesService {
  constructor(private prisma: PrismaService) {}

  async findAll(teamId: string, userId: string) {
    await this.checkMembership(teamId, userId)
    return this.prisma.share.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(
    teamId: string,
    userId: string,
    data: {
      type: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE'
      data: unknown
      encryptedData?: string
      isSensitive?: boolean
      permission: 'READONLY' | 'READWRITE'
    },
  ) {
    await this.checkMembership(teamId, userId)
    return this.prisma.share.create({
      data: {
        teamId,
        type: data.type,
        ...(data.isSensitive
          ? { encryptedData: data.encryptedData, data: {}, isSensitive: true }
          : { data: data.data as object }),
        sharedBy: userId,
        permission: data.permission,
        isSensitive: data.isSensitive ?? false,
      },
    })
  }

  async findOne(teamId: string, shareId: string, userId: string) {
    await this.checkMembership(teamId, userId)
    const share = await this.prisma.share.findFirst({
      where: { id: shareId, teamId },
    })
    if (!share) throw new NotFoundException('Share not found')
    return share
  }

  async update(
    teamId: string,
    shareId: string,
    userId: string,
    data: {
      permission?: 'READONLY' | 'READWRITE'
      data?: unknown
      encryptedData?: string
      isSensitive?: boolean
    },
  ) {
    await this.checkMembership(teamId, userId)
    const share = await this.prisma.share.findFirst({
      where: { id: shareId, teamId },
    })
    if (!share) throw new NotFoundException('Share not found')
    if (share.sharedBy !== userId) {
      throw new ForbiddenException('Only creator can update share')
    }

    return this.prisma.share.update({
      where: { id: shareId },
      data: {
        ...(data.permission !== undefined && { permission: data.permission }),
        ...(data.data !== undefined && !data.isSensitive && {
          data: data.data as object,
          encryptedData: null,
        }),
        ...(data.encryptedData !== undefined && {
          encryptedData: data.encryptedData,
          data: {},
        }),
        ...(data.isSensitive !== undefined && { isSensitive: data.isSensitive }),
      },
    })
  }

  async delete(teamId: string, shareId: string, userId: string) {
    await this.checkMembership(teamId, userId)
    const share = await this.prisma.share.findFirst({
      where: { id: shareId, teamId },
    })
    if (!share) throw new NotFoundException('Share not found')
    if (share.sharedBy !== userId) {
      throw new ForbiddenException('Only creator can delete share')
    }

    // Record deletion in audit log before deleting
    await this.prisma.auditLog.create({
      data: {
        teamId,
        userId,
        action: 'SHARE_DELETED',
        details: { shareId, shareType: share.type },
      },
    })

    await this.prisma.share.delete({ where: { id: shareId } })
  }

  private async checkMembership(teamId: string, userId: string) {
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (!membership) {
      throw new ForbiddenException('Not a team member')
    }
    return membership
  }
}
