import { NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { MembersService } from './members.service'

describe('MembersService team scoping', () => {
  it('rejects role changes for a member from another team', async () => {
    const prisma = {
      teamMember: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            teamId: 'team-a',
            userId: 'admin-a',
            role: 'ADMIN',
          })
          .mockResolvedValueOnce({
            id: 'member-b',
            teamId: 'team-b',
            userId: 'member-b-user',
            role: 'MEMBER',
          }),
        update: vi.fn(),
      },
      team: { findUnique: vi.fn().mockResolvedValue({ ownerId: 'owner-a' }) },
    }
    const service = new MembersService(prisma as never)

    await expect(
      service.updateRole('team-a', 'admin-a', 'member-b', 'ADMIN'),
    ).rejects.toBeInstanceOf(NotFoundException)

    expect(prisma.teamMember.update).not.toHaveBeenCalled()
  })

  it('rejects removal of a member from another team', async () => {
    const prisma = {
      teamMember: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            teamId: 'team-a',
            userId: 'admin-a',
            role: 'ADMIN',
          })
          .mockResolvedValueOnce({
            id: 'member-b',
            teamId: 'team-b',
            userId: 'member-b-user',
            role: 'MEMBER',
          }),
        delete: vi.fn(),
      },
      team: { findUnique: vi.fn().mockResolvedValue({ ownerId: 'owner-a' }) },
    }
    const service = new MembersService(prisma as never)

    await expect(
      service.removeMember('team-a', 'admin-a', 'member-b'),
    ).rejects.toBeInstanceOf(NotFoundException)

    expect(prisma.teamMember.delete).not.toHaveBeenCalled()
  })
})
