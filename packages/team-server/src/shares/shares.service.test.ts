import { BadRequestException } from '@nestjs/common'
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
        }),
        update: vi.fn().mockResolvedValue({ id: 'share-a' }),
      },
    }
    const service = new SharesService(prisma as never)

    await service.update('team-a', 'share-a', 'creator-a', {
      data: { hostname: 'plaintext' },
    })

    expect(prisma.share.update).toHaveBeenCalledWith({
      where: { id: 'share-a' },
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
        update: vi.fn(),
      },
    }
    const service = new SharesService(prisma as never)

    await expect(
      service.update('team-a', 'share-a', 'creator-a', {
        isSensitive: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.share.update).not.toHaveBeenCalled()
  })
})
