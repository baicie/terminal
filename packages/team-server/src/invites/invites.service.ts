import type { Invite, Prisma } from '@prisma/client'
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { nanoid } from 'nanoid'
import { PrismaService } from '../prisma.service'
import { generateInviteCode } from './invite-code'

@Injectable()
export class InvitesService {
  constructor(private prisma: PrismaService) {}

  async findAll(teamId: string, userId: string) {
    await this.checkAdmin(teamId, userId)
    return this.prisma.invite.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(
    teamId: string,
    userId: string,
    data: {
      type: 'LINK' | 'CODE' | 'EMAIL'
      email?: string
      role?: 'ADMIN' | 'MEMBER'
    },
  ) {
    await this.checkAdmin(teamId, userId)

    const role = data.role || 'MEMBER'
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const inviteData: Prisma.InviteUncheckedCreateInput = {
      teamId,
      type: data.type,
      role,
      createdBy: userId,
      expiresAt,
    }

    if (data.type === 'CODE') {
      inviteData.code = generateInviteCode()
    } else if (data.type === 'LINK') {
      inviteData.linkToken = nanoid(24)
    } else if (data.type === 'EMAIL') {
      if (!data.email)
        throw new BadRequestException('Email required for email invite')
      inviteData.email = data.email
    }

    return this.prisma.invite.create({ data: inviteData })
  }

  async joinByCode(code: string, userId: string, userName?: string) {
    const invite = await this.prisma.invite.findUnique({ where: { code } })
    if (!invite) throw new NotFoundException('Invalid invite code')
    return this.claimInvite(invite, userId, userName)
  }

  async joinByLink(linkToken: string, userId: string, userName?: string) {
    const invite = await this.prisma.invite.findUnique({ where: { linkToken } })
    if (!invite) throw new NotFoundException('Invalid invite link')
    return this.claimInvite(invite, userId, userName)
  }

  async delete(teamId: string, inviteId: string, userId: string) {
    await this.checkAdmin(teamId, userId)
    const result = await this.prisma.invite.deleteMany({
      where: { id: inviteId, teamId },
    })
    if (result.count === 0) throw new NotFoundException('Invite not found')
  }

  async getInviteByCode(code: string) {
    const invite = await this.prisma.invite.findUnique({ where: { code } })
    if (!invite) return null
    const team = await this.prisma.team.findUnique({
      where: { id: invite.teamId },
    })
    return { invite, team }
  }

  async getInviteByLink(linkToken: string) {
    const invite = await this.prisma.invite.findUnique({ where: { linkToken } })
    if (!invite) return null
    const team = await this.prisma.team.findUnique({
      where: { id: invite.teamId },
    })
    return { invite, team }
  }

  private async claimInvite(invite: Invite, userId: string, userName?: string) {
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Invite expired')
    }
    if (invite.usedAt) throw new BadRequestException('Invite already used')

    return this.prisma.$transaction(async transaction => {
      const now = new Date()
      const claim = await transaction.invite.updateMany({
        where: {
          id: invite.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      })
      if (claim.count !== 1) {
        throw new BadRequestException('Invite already used or expired')
      }

      await transaction.teamMember.create({
        data: {
          teamId: invite.teamId,
          userId,
          userName,
          role: invite.role,
        },
      })
      return { teamId: invite.teamId, role: invite.role }
    })
  }

  private async checkMembership(teamId: string, userId: string) {
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (!membership) throw new ForbiddenException('Not a team member')
    return membership
  }

  private async checkAdmin(teamId: string, userId: string) {
    const membership = await this.checkMembership(teamId, userId)
    if (membership.role !== 'ADMIN')
      throw new ForbiddenException('Admin access required')
  }
}
