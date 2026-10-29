import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, name: string) {
    // Create team and add creator as admin member
    const team = await this.prisma.team.create({
      data: {
        name,
        ownerId: userId,
        members: {
          create: {
            userId,
            role: 'ADMIN',
          },
        },
      },
      include: { members: true },
    })
    return team
  }

  async findAll(userId: string) {
    // Get teams where user is a member
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      include: {
        team: {
          include: {
            _count: { select: { members: true } },
          },
        },
      },
    })
    return memberships.map(m => ({
      ...m.team,
      memberCount: m.team._count.members,
      role: m.role,
    }))
  }

  async findOne(id: string, userId: string) {
    // Check if user is a member
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: id, userId } },
      include: { team: { include: { _count: { select: { members: true } } } } },
    })

    if (!membership) {
      throw new NotFoundException('Team not found or access denied')
    }

    return {
      ...membership.team,
      memberCount: membership.team._count.members,
      role: membership.role,
    }
  }

  async update(id: string, userId: string, name: string) {
    // Only admins can update
    await this.checkAdmin(id, userId)
    return this.prisma.team.update({
      where: { id },
      data: { name },
    })
  }

  async delete(id: string, userId: string) {
    // Only owner can delete
    const team = await this.prisma.team.findUnique({ where: { id } })
    if (!team) throw new NotFoundException('Team not found')
    if (team.ownerId !== userId) {
      throw new ForbiddenException('Only owner can delete team')
    }
    await this.prisma.team.delete({ where: { id } })
  }

  async checkAdmin(teamId: string, userId: string) {
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (!membership || membership.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required')
    }
    return true
  }
}
