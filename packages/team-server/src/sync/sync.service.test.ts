import { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { SyncService } from './sync.service'

const existingShare = {
  id: 'share-b',
  teamId: 'team-b',
  type: 'HOST',
  data: { hostname: 'private-b' },
  encryptedData: null,
  isSensitive: false,
  sharedBy: 'owner-b',
  permission: 'READONLY',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('SyncService authorization', () => {
  it('does not update another team share when the client supplies an authorized team id', async () => {
    const prisma = {
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
      share: {
        findUnique: vi.fn().mockResolvedValue(existingShare),
        update: vi.fn(),
      },
    }
    const service = new SyncService(prisma as never)

    const result = await service.pushChanges('user-a', {
      shares: [
        {
          id: 'share-b',
          teamId: 'team-a',
          type: 'HOST',
          data: { hostname: 'attacker' },
          permission: 'READWRITE',
        },
      ],
    })

    expect(result.errors).toEqual([
      { id: 'share-b', error: 'Share does not belong to the requested team' },
    ])
    expect(prisma.share.update).not.toHaveBeenCalled()
  })

  it('does not return conflicts for shares outside the caller teams', async () => {
    const prisma = {
      share: { findUnique: vi.fn().mockResolvedValue(existingShare) },
      teamMember: { findUnique: vi.fn().mockResolvedValue(null) },
    }
    const service = new SyncService(prisma as never)

    await expect(
      service.checkConflicts('user-a', [
        { id: 'share-b', updatedAt: 0, type: 'HOST' },
      ]),
    ).resolves.toEqual([])
  })

  it('does not let a team member overwrite a share created by another member', async () => {
    const prisma = {
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-b',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
      share: {
        findUnique: vi.fn().mockResolvedValue(existingShare),
        update: vi.fn(),
      },
    }
    const service = new SyncService(prisma as never)

    const result = await service.pushChanges('user-a', {
      shares: [
        {
          id: 'share-b',
          teamId: 'team-b',
          type: 'HOST',
          data: { hostname: 'attacker' },
          permission: 'READWRITE',
        },
      ],
    })

    expect(result.errors).toEqual([
      { id: 'share-b', error: 'Only creator can update share' },
    ])
    expect(prisma.share.update).not.toHaveBeenCalled()
  })

  it('does not let a team member resolve another creator share conflict', async () => {
    const prisma = {
      share: {
        findUnique: vi.fn().mockResolvedValue(existingShare),
        update: vi.fn(),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-b',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
    }
    const service = new SyncService(prisma as never)

    await expect(
      service.resolveConflict('share-b', 'user-a', 'LOCAL', {
        data: { hostname: 'attacker' },
        isSensitive: false,
        permission: 'READWRITE',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'Only creator can resolve share conflicts',
    })

    expect(prisma.share.update).not.toHaveBeenCalled()
  })

  it('preserves ciphertext when a sensitive update omits isSensitive', async () => {
    const sensitiveShare = {
      ...existingShare,
      id: 'share-a',
      teamId: 'team-a',
      sharedBy: 'user-a',
      isSensitive: true,
      encryptedData: 'ciphertext',
      data: {},
    }
    const prisma = {
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
      share: {
        findUnique: vi.fn().mockResolvedValue(sensitiveShare),
        update: vi.fn().mockResolvedValue({ id: 'share-a' }),
      },
    }
    const service = new SyncService(prisma as never)

    await service.pushChanges('user-a', {
      shares: [
        {
          id: 'share-a',
          teamId: 'team-a',
          type: 'HOST',
          data: { hostname: 'plaintext' },
          permission: 'READONLY',
        },
      ],
    })

    expect(prisma.share.update).toHaveBeenCalledWith({
      where: { id: 'share-a' },
      data: {
        data: {},
        encryptedData: 'ciphertext',
        isSensitive: true,
        permission: 'READONLY',
      },
    })
  })

  it('does not create a sensitive share without ciphertext', async () => {
    const prisma = {
      share: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
    }
    const service = new SyncService(prisma as never)

    const result = await service.pushChanges('user-a', {
      shares: [
        {
          id: 'share-a',
          teamId: 'team-a',
          type: 'HOST',
          data: {},
          isSensitive: true,
          permission: 'READONLY',
        },
      ],
    })

    expect(result.errors).toEqual([
      { id: 'share-a', error: 'SYNC_OPERATION_FAILED' },
    ])
    expect(prisma.share.create).not.toHaveBeenCalled()
  })

  it('infers sensitive creates from ciphertext and rejects an explicit plaintext flag', async () => {
    const prisma = {
      share: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => ({ id: data.id })),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
    }
    const service = new SyncService(prisma as never)

    const result = await service.pushChanges('user-a', {
      shares: [
        {
          id: 'share-a',
          teamId: 'team-a',
          type: 'HOST',
          data: { password: 'plaintext-must-not-be-stored' },
          encryptedData: 'ciphertext',
          permission: 'READONLY',
        },
        {
          id: 'share-b',
          teamId: 'team-a',
          type: 'HOST',
          data: {},
          encryptedData: 'ciphertext',
          isSensitive: false,
          permission: 'READONLY',
        },
      ],
    })

    expect(result).toMatchObject({
      created: ['share-a'],
      errors: [{ id: 'share-b', error: 'SYNC_OPERATION_FAILED' }],
    })
    expect(prisma.share.create).toHaveBeenCalledOnce()
    expect(prisma.share.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'share-a',
        data: {},
        encryptedData: 'ciphertext',
        isSensitive: true,
      }),
    })
  })

  it('does not report LOCAL conflict resolution success without explicit security state', async () => {
    const prisma = {
      share: {
        findUnique: vi.fn().mockResolvedValue({
          ...existingShare,
          sharedBy: 'user-a',
          isSensitive: true,
          encryptedData: 'remote-ciphertext',
          data: {},
        }),
        update: vi.fn(),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-b',
          userId: 'user-a',
        }),
      },
    }
    const service = new SyncService(prisma as never)

    await expect(
      service.resolveConflict('share-b', 'user-a', 'LOCAL', {
        data: { hostname: 'local' },
      }),
    ).resolves.toEqual({
      success: false,
      error: 'Local conflict data must include an explicit sensitive state',
    })
    expect(prisma.share.update).not.toHaveBeenCalled()
  })

  it('does not expose database errors from a pushed share operation', async () => {
    const loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined)
    const prisma = {
      share: {
        findUnique: vi
          .fn()
          .mockRejectedValue(
            new Error('Prisma failed: password=database-secret'),
          ),
      },
    }
    const service = new SyncService(prisma as never)

    const result = await service.pushChanges('user-a', {
      shares: [
        {
          id: 'share-a',
          teamId: 'team-a',
          type: 'HOST',
          data: {},
          permission: 'READONLY',
        },
      ],
    })

    expect(result.errors).toEqual([
      { id: 'share-a', error: 'SYNC_OPERATION_FAILED' },
    ])
    expect(JSON.stringify(result)).not.toContain('database-secret')
    expect(loggerError).toHaveBeenCalled()
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(
      'database-secret',
    )
  })

  it('does not expose database errors from a pushed delete operation', async () => {
    const loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined)
    const prisma = {
      share: {
        findUnique: vi
          .fn()
          .mockRejectedValue(
            new Error('Prisma failed: password=database-secret'),
          ),
      },
    }
    const service = new SyncService(prisma as never)

    const result = await service.pushChanges('user-a', {
      deleteShares: ['share-a'],
    })

    expect(result.errors).toEqual([
      { id: 'share-a', error: 'SYNC_OPERATION_FAILED' },
    ])
    expect(JSON.stringify(result)).not.toContain('database-secret')
    expect(loggerError).toHaveBeenCalled()
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(
      'database-secret',
    )
  })
})
