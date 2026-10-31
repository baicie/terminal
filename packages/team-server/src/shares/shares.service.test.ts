import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { SharesService } from './shares.service'

describe('SharesService sensitive share updates', () => {
  it('infers a sensitive create from ciphertext and rejects an explicit plaintext flag', async () => {
    const prisma = {
      teamMember: { findUnique: vi.fn().mockResolvedValue({ id: 'member-a' }) },
      share: { create: vi.fn().mockResolvedValue({ id: 'share-a' }) },
    }
    const service = new SharesService(prisma as never)

    await service.create('team-a', 'creator-a', {
      type: 'HOST',
      data: { password: 'plaintext-must-not-be-stored' },
      encryptedData: 'ciphertext',
      permission: 'READONLY',
    })

    expect(prisma.share.create).toHaveBeenCalledWith({
      data: {
        teamId: 'team-a',
        type: 'HOST',
        data: {},
        encryptedData: 'ciphertext',
        sharedBy: 'creator-a',
        permission: 'READONLY',
        isSensitive: true,
      },
    })

    await expect(
      service.create('team-a', 'creator-a', {
        type: 'HOST',
        data: {},
        encryptedData: 'ciphertext',
        isSensitive: false,
        permission: 'READONLY',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('does not replace encrypted data with plaintext when a sensitive update omits isSensitive', async () => {
    const prisma = {
      teamMember: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ teamId: 'team-a', userId: 'creator-a' }),
      },
      share: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'share-a',
          teamId: 'team-a',
          sharedBy: 'creator-a',
          isSensitive: true,
          encryptedData: 'ciphertext',
          data: {},
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const service = new SharesService(prisma as never)

    await service.update('team-a', 'share-a', 'creator-a', {
      data: { hostname: 'plaintext' },
    })

    expect(prisma.share.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'share-a',
        teamId: 'team-a',
        sharedBy: 'creator-a',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      data: { data: {}, encryptedData: 'ciphertext', isSensitive: true },
    })
  })

  it('rejects downgrading a sensitive share without replacement plaintext', async () => {
    const prisma = {
      teamMember: { findUnique: vi.fn().mockResolvedValue({ id: 'member-a' }) },
      share: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'share-a',
          teamId: 'team-a',
          sharedBy: 'creator-a',
          isSensitive: true,
          encryptedData: 'ciphertext',
          data: {},
        }),
        updateMany: vi.fn(),
      },
    }
    const service = new SharesService(prisma as never)

    await expect(
      service.update('team-a', 'share-a', 'creator-a', {
        isSensitive: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.share.updateMany).not.toHaveBeenCalled()
  })

  it('lets a READWRITE member update another creator share without changing its permission', async () => {
    const share = {
      id: 'share-a',
      teamId: 'team-a',
      sharedBy: 'owner-a',
      isSensitive: false,
      encryptedData: null,
      data: {},
      permission: 'READWRITE',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    const prisma = {
      teamMember: { findUnique: vi.fn().mockResolvedValue({ id: 'member-a' }) },
      share: {
        findFirst: vi.fn().mockResolvedValue(share),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const service = new SharesService(prisma as never)

    await service.update('team-a', 'share-a', 'member-a', {
      permission: 'READONLY',
      data: { hostname: 'member-write' },
    })

    expect(prisma.share.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'share-a',
        teamId: 'team-a',
        sharedBy: 'owner-a',
        updatedAt: share.updatedAt,
      },
      data: {
        data: { hostname: 'member-write' },
        encryptedData: null,
        isSensitive: false,
        permission: 'READWRITE',
      },
    })
  })

  it('rejects a READONLY member update and surfaces a conditional write race as a conflict', async () => {
    const readOnlyPrisma = {
      teamMember: { findUnique: vi.fn().mockResolvedValue({ id: 'member-a' }) },
      share: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'share-a',
          teamId: 'team-a',
          sharedBy: 'owner-a',
          isSensitive: false,
          encryptedData: null,
          data: {},
          permission: 'READONLY',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        updateMany: vi.fn(),
      },
    }
    const readOnlyService = new SharesService(readOnlyPrisma as never)

    await expect(
      readOnlyService.update('team-a', 'share-a', 'member-a', {
        data: { hostname: 'member-write' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(readOnlyPrisma.share.updateMany).not.toHaveBeenCalled()

    const racedPrisma = {
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({ id: 'creator-a' }),
      },
      share: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'share-a',
          teamId: 'team-a',
          sharedBy: 'creator-a',
          isSensitive: false,
          encryptedData: null,
          data: {},
          permission: 'READWRITE',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    const racedService = new SharesService(racedPrisma as never)

    await expect(
      racedService.update('team-a', 'share-a', 'creator-a', {
        data: { hostname: 'raced' },
      }),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('does not let a READWRITE member downgrade a sensitive share to plaintext', async () => {
    const sensitiveShare = {
      id: 'share-a',
      teamId: 'team-a',
      sharedBy: 'owner-a',
      isSensitive: true,
      encryptedData: 'owner-ciphertext',
      data: {},
      permission: 'READWRITE',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    const prisma = {
      teamMember: { findUnique: vi.fn().mockResolvedValue({ id: 'member-a' }) },
      share: {
        findFirst: vi.fn().mockResolvedValue(sensitiveShare),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const service = new SharesService(prisma as never)

    await service.update('team-a', 'share-a', 'member-a', {
      isSensitive: false,
      data: { password: 'plaintext-must-not-be-stored' },
    })

    expect(prisma.share.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'share-a',
        teamId: 'team-a',
        sharedBy: 'owner-a',
        updatedAt: sensitiveShare.updatedAt,
      },
      data: {
        data: {},
        encryptedData: 'owner-ciphertext',
        isSensitive: true,
        permission: 'READWRITE',
      },
    })
  })

  it('does not let a READWRITE member turn a plaintext share into an encrypted shell', async () => {
    const plaintextShare = {
      id: 'share-a',
      teamId: 'team-a',
      sharedBy: 'owner-a',
      isSensitive: false,
      encryptedData: null,
      data: { hostname: 'owner-host' },
      permission: 'READWRITE',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    const prisma = {
      teamMember: { findUnique: vi.fn().mockResolvedValue({ id: 'member-a' }) },
      share: {
        findFirst: vi.fn().mockResolvedValue(plaintextShare),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const service = new SharesService(prisma as never)

    await service.update('team-a', 'share-a', 'member-a', {
      isSensitive: true,
      encryptedData: 'member-ciphertext',
      data: { hostname: 'member-host' },
    })

    expect(prisma.share.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'share-a',
        teamId: 'team-a',
        sharedBy: 'owner-a',
        updatedAt: plaintextShare.updatedAt,
      },
      data: {
        data: { hostname: 'member-host' },
        encryptedData: null,
        isSensitive: false,
        permission: 'READWRITE',
      },
    })
  })
})
