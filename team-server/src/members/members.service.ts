import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class MembersService {
  constructor(private prisma: PrismaService) {}

  async findAll(teamId: string, userId: string) {
    // Verify user is a member
    await this.checkMembership(teamId, userId)

    return this.prisma.teamMember.findMany({
      where: { teamId },
      include: { user: { select: { id: true } } },
    })
  }

  async addMember(
    teamId: string,
    userId: string,
    newUserId: string,
    userName?: string,
    userEmail?: string,
    role: 'ADMIN' | 'MEMBER' = 'MEMBER',
  ) {
    // Only admins can add members
    await this.checkAdmin(teamId, userId)

    // Check if already a member
    const existing = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: newUserId } },
    })
    if (existing) {
      throw new ForbiddenException('User is already a member')
    }

    return this.prisma.teamMember.create({
      data: {
        teamId,
        userId: newUserId,
        userName,
        userEmail,
        role,
      },
    })
  }

  async updateRole(
    teamId: string,
    userId: string,
    memberId: string,
    role: 'ADMIN' | 'MEMBER',
  ) {
    // Only admins can update roles
    await this.checkAdmin(teamId, userId)

    // Cannot change owner's role
    const team = await this.prisma.team.findUnique({ where: { id: teamId } })
    const member = await this.prisma.teamMember.findUnique({
      where: { id: memberId },
    })
    if (team?.ownerId === member?.userId) {
      throw new ForbiddenException('Cannot change owner role')
    }

    return this.prisma.teamMember.update({
      where: { id: memberId },
      data: { role },
    })
  }

  async removeMember(teamId: string, userId: string, memberId: string) {
    // Only admins can remove members
    await this.checkAdmin(teamId, userId)

    const member = await this.prisma.teamMember.findUnique({
      where: { id: memberId },
    })
    if (!member) throw new NotFoundException('Member not found')

    // Cannot remove owner
    const team = await this.prisma.team.findUnique({ where: { id: teamId } })
    if (team?.ownerId === member.userId) {
      throw new ForbiddenException('Cannot remove team owner')
    }

    await this.prisma.teamMember.delete({ where: { id: memberId } })
  }

  async checkMembership(teamId: string, userId: string) {
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (!membership) {
      throw new ForbiddenException('Not a team member')
    }
    return membership
  }

  async checkAdmin(teamId: string, userId: string) {
    const membership = await this.checkMembership(teamId, userId)
    if (membership.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required')
    }
    return true
  }
}
