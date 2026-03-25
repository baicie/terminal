import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async findAll(teamId: string, userId: string, limit = 100) {
    // Only admins can view audit logs
    await this.checkAdmin(teamId, userId)
    
    return this.prisma.auditLog.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async create(teamId: string, userId: string, userName: string, action: string, hostName?: string, details?: any) {
    return this.prisma.auditLog.create({
      data: {
        teamId,
        userId,
        userName,
        action,
        hostName,
        details: details || undefined,
      },
    })
  }

  private async checkAdmin(teamId: string, userId: string) {
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (!membership || membership.role !== 'ADMIN') {
      throw new Error('Admin access required')
    }
  }
}
