import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { buildShareUpdateData } from '../sync/share-write-data'
import { deleteShareWithAudit } from './share-deletion'
import { resolveCreateSensitivity } from './share-security'

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
      data?: unknown
      encryptedData?: string
      isSensitive?: boolean
      permission: 'READONLY' | 'READWRITE'
    },
  ) {
    await this.checkMembership(teamId, userId)
    const isSensitive = resolveCreateSensitivity(
      data.isSensitive,
      data.encryptedData,
    )
    return this.prisma.share.create({
      data: {
        teamId,
        type: data.type,
        ...(isSensitive
          ? { encryptedData: data.encryptedData, data: {}, isSensitive: true }
          : { data: data.data as object }),
        sharedBy: userId,
        permission: data.permission,
        isSensitive,
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
    const isCreator = share.sharedBy === userId
    if (!isCreator && share.permission !== 'READWRITE') {
      throw new ForbiddenException('Only creator can update share')
    }

    const written = await this.prisma.share.updateMany({
      where: {
        id: shareId,
        teamId,
        sharedBy: share.sharedBy,
        updatedAt: share.updatedAt,
      },
      data: isCreator
        ? buildShareUpdateData(data, share)
        : buildShareUpdateData(data, share, true, true),
    })
    if (written.count !== 1) {
      throw new ConflictException('Share was modified concurrently')
    }
    return this.prisma.share.findFirst({ where: { id: shareId, teamId } })
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

    await deleteShareWithAudit(this.prisma, {
      teamId,
      userId,
      shareId,
      shareType: share.type,
    })
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
