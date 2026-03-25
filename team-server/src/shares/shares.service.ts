import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
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

  async create(teamId: string, userId: string, data: { type: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE'; data: any; permission: 'READONLY' | 'READWRITE' }) {
    await this.checkMembership(teamId, userId)
    return this.prisma.share.create({
      data: {
        teamId,
        type: data.type,
        data: data.data,
        sharedBy: userId,
        permission: data.permission,
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

  async update(teamId: string, shareId: string, userId: string, permission: 'READONLY' | 'READWRITE') {
    await this.checkMembership(teamId, userId)
    const share = await this.prisma.share.findFirst({
      where: { id: shareId, teamId },
    })
    if (!share) throw new NotFoundException('Share not found')
    // Only creator can update
    if (share.sharedBy !== userId) {
      throw new ForbiddenException('Only creator can update share')
    }
    return this.prisma.share.update({
      where: { id: shareId },
      data: { permission },
    })
  }

  async delete(teamId: string, shareId: string, userId: string) {
    await this.checkMembership(teamId, userId)
    const share = await this.prisma.share.findFirst({
      where: { id: shareId, teamId },
    })
    if (!share) throw new NotFoundException('Share not found')
    // Only creator can delete
    if (share.sharedBy !== userId) {
      throw new ForbiddenException('Only creator can delete share')
    }
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
