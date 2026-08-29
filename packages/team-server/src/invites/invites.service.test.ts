import type { PrismaService } from '../prisma.service'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvitesService } from './invites.service'

function createPrismaMock() {
  const mock = {
    teamMember: { findUnique: vi.fn(), create: vi.fn() },
    invite: {
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    team: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  }
  mock.$transaction.mockImplementation(
    async (callback: (client: unknown) => Promise<unknown>) => callback(mock),
  )
  return mock
}

let prisma: ReturnType<typeof createPrismaMock>
let service: InvitesService

beforeEach(() => {
  prisma = createPrismaMock()
  service = new InvitesService(prisma as unknown as PrismaService)
})

describe('InvitesService.create', () => {
  it('requires an admin before creating an invite', async () => {
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' })

    await expect(
      service.create('team-1', 'user-1', { type: 'CODE' }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.invite.create).not.toHaveBeenCalled()
  })
})

describe('InvitesService.getInviteByLink', () => {
  it('looks up link previews by linkToken rather than invite code', async () => {
    const invite = { teamId: 'team-1', role: 'MEMBER' }
    prisma.invite.findUnique.mockResolvedValue(invite)
    prisma.team.findUnique.mockResolvedValue({ id: 'team-1', name: 'Ops' })

    const linkLookup = service as unknown as {
      getInviteByLink: (token: string) => Promise<unknown>
    }
    await expect(linkLookup.getInviteByLink('link-token')).resolves.toEqual({
      invite,
      team: { id: 'team-1', name: 'Ops' },
    })
    expect(prisma.invite.findUnique).toHaveBeenCalledWith({
      where: { linkToken: 'link-token' },
    })
  })
})

describe('InvitesService invite lifecycle', () => {
  it('claims an invite atomically before adding the member', async () => {
    const invite = {
      id: 'invite-1',
      teamId: 'team-1',
      role: 'MEMBER',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    }
    prisma.invite.findUnique.mockResolvedValue(invite)
    prisma.invite.updateMany.mockResolvedValue({ count: 1 })
    prisma.teamMember.create.mockResolvedValue({})

    await expect(
      service.joinByCode('TEAM-ABCD-EFGH', 'user-2', 'User'),
    ).resolves.toEqual({ teamId: 'team-1', role: 'MEMBER' })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.invite.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'invite-1',
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { usedAt: expect.any(Date) },
    })
  })

  it('cannot delete an invite that belongs to another team', async () => {
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'ADMIN' })
    prisma.invite.deleteMany.mockResolvedValue({ count: 0 })

    await expect(
      service.delete('team-1', 'foreign-invite', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.invite.deleteMany).toHaveBeenCalledWith({
      where: { id: 'foreign-invite', teamId: 'team-1' },
    })
  })
})
