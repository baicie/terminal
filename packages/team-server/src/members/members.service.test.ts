import { ConflictException, NotFoundException } from '@nestjs/common'
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

  it('reports a duplicate member insert as a conflict instead of a server error', async () => {
    const prisma = {
      teamMember: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            teamId: 'team-a',
            userId: 'admin-a',
            role: 'ADMIN',
          })
          .mockResolvedValueOnce(null),
        create: vi.fn().mockRejectedValue(
          Object.assign(new Error('Unique constraint failed on the fields'), {
            code: 'P2002',
          }),
        ),
      },
    }
    const service = new MembersService(prisma as never)

    await expect(
      service.addMember('team-a', 'admin-a', 'user-b'),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.teamMember.create).toHaveBeenCalledTimes(1)
  })
})
