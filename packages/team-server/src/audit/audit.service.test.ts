import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { AuditService } from './audit.service'

describe('AuditService authorization', () => {
  it('rejects a non-admin member with a forbidden response', async () => {
    const prisma = {
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
      auditLog: { findMany: vi.fn() },
    }
    const service = new AuditService(prisma as never)

    await expect(service.findAll('team-a', 'user-a')).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
  })
})
