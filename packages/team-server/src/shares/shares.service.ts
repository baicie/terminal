import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { deleteShareWithAudit } from './share-deletion'
import {
  resolveCreateSensitivity,
  resolveUpdateSecurity,
} from './share-security'

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
    if (share.sharedBy !== userId) {
      throw new ForbiddenException('Only creator can update share')
    }

    const security = resolveUpdateSecurity(data, share)
    return this.prisma.share.update({
      where: { id: shareId },
      data: {
        ...(data.permission !== undefined && { permission: data.permission }),
        ...(security.isSensitive
          ? {
              data: {},
              encryptedData: security.encryptedData,
              isSensitive: true,
            }
          : {
              ...(data.data !== undefined && { data: data.data as object }),
              encryptedData: null,
              isSensitive: false,
            }),
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
