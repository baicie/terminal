import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { nanoid } from 'nanoid'

@Injectable()
export class InvitesService {
  constructor(private prisma: PrismaService) {}

  async findAll(teamId: string, userId: string) {
    await this.checkMembership(teamId, userId)
    return this.prisma.invite.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(teamId: string, userId: string, data: { type: 'LINK' | 'CODE' | 'EMAIL'; email?: string; role?: 'ADMIN' | 'MEMBER' }) {
    await this.checkMembership(teamId, userId)
    
    const role = data.role || 'MEMBER'
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const inviteData: any = {
      teamId,
      type: data.type,
      role,
      createdBy: userId,
      expiresAt,
    }

    if (data.type === 'CODE') {
      // Generate invite code: TEAM-XXXX-XXXX
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      const code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
      inviteData.code = `TEAM-${code}-${nanoid(4).toUpperCase()}`
    } else if (data.type === 'LINK') {
      inviteData.linkToken = nanoid(24)
    } else if (data.type === 'EMAIL') {
      if (!data.email) throw new BadRequestException('Email required for email invite')
      inviteData.email = data.email
    }

    return this.prisma.invite.create({ data: inviteData })
  }

  async joinByCode(code: string, userId: string, userName?: string) {
    const invite = await this.prisma.invite.findUnique({ where: { code } })
    if (!invite) throw new NotFoundException('Invalid invite code')
    if (invite.expiresAt < new Date()) throw new BadRequestException('Invite expired')
    if (invite.usedAt) throw new BadRequestException('Invite already used')

    // Add user as member
    await this.prisma.teamMember.create({
      data: {
        teamId: invite.teamId,
        userId,
        userName,
        role: invite.role,
      },
    })

    // Mark invite as used
    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    })

    return { teamId: invite.teamId, role: invite.role }
  }

  async joinByLink(linkToken: string, userId: string, userName?: string) {
    const invite = await this.prisma.invite.findUnique({ where: { linkToken } })
    if (!invite) throw new NotFoundException('Invalid invite link')
    if (invite.expiresAt < new Date()) throw new BadRequestException('Invite expired')
    if (invite.usedAt) throw new BadRequestException('Invite already used')

    await this.prisma.teamMember.create({
      data: {
        teamId: invite.teamId,
        userId,
        userName,
        role: invite.role,
      },
    })

    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    })

    return { teamId: invite.teamId, role: invite.role }
  }

  async delete(teamId: string, inviteId: string, userId: string) {
    await this.checkAdmin(teamId, userId)
    await this.prisma.invite.delete({ where: { id: inviteId } })
  }

  async getInviteByCode(code: string) {
    const invite = await this.prisma.invite.findUnique({ where: { code } })
    if (!invite) return null
    const team = await this.prisma.team.findUnique({ where: { id: invite.teamId } })
    return { invite, team }
  }

  private async checkMembership(teamId: string, userId: string) {
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (!membership) throw new BadRequestException('Not a team member')
    return membership
  }

  private async checkAdmin(teamId: string, userId: string) {
    const membership = await this.checkMembership(teamId, userId)
    if (membership.role !== 'ADMIN') throw new BadRequestException('Admin access required')
  }
}
