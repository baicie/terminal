import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { OfflineSyncService } from './offline-sync.service'

class TestOfflineSyncService extends OfflineSyncService {}

describe('OfflineSyncService authorization', () => {
  it('canonicalizes encrypted queue payloads without storing plaintext', async () => {
    const prisma = {
      teamMember: { findUnique: vi.fn().mockResolvedValue({ id: 'member-a' }) },
      syncQueue: {
        create: vi.fn().mockResolvedValue({ id: 'queue-a' }),
      },
    }
    const service = new TestOfflineSyncService(prisma as never)

    await service.enqueueOfflineOperation(
      'user-a',
      'team-a',
      'CREATE',
      'HOST',
      'share-a',
      {
        id: 'share-a',
        teamId: 'team-a',
        type: 'HOST',
        data: { password: 'plaintext-must-not-be-stored' },
        encryptedData: 'ciphertext',
        permission: 'READONLY',
      },
    )

    expect(prisma.syncQueue.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-a',
        teamId: 'team-a',
        operation: 'CREATE',
        shareType: 'HOST',
        shareId: 'share-a',
        data: {
          id: 'share-a',
          teamId: 'team-a',
          type: 'HOST',
          data: {},
          encryptedData: 'ciphertext',
          isSensitive: true,
          permission: 'READONLY',
        },
      },
    })
  })

  it('does not queue plaintext when an update inherits a sensitive state', async () => {
    const prisma = {
      teamMember: { findUnique: vi.fn().mockResolvedValue({ id: 'member-a' }) },
      share: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'share-a',
          teamId: 'team-a',
          sharedBy: 'user-a',
          data: {},
          encryptedData: 'existing-ciphertext',
          isSensitive: true,
          permission: 'READONLY',
          updatedAt: new Date(1),
        }),
      },
      syncQueue: {
        create: vi.fn().mockResolvedValue({ id: 'queue-a' }),
      },
    }
    const service = new TestOfflineSyncService(prisma as never)

    await service.enqueueOfflineOperation(
      'user-a',
      'team-a',
      'UPDATE',
      'HOST',
      'share-a',
      {
        id: 'share-a',
        teamId: 'team-a',
        type: 'HOST',
        data: { password: 'plaintext-must-not-be-stored' },
        baseVersion: 1,
        permission: 'READONLY',
      },
    )

    expect(prisma.syncQueue.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-a',
        teamId: 'team-a',
        operation: 'UPDATE',
        shareType: 'HOST',
        shareId: 'share-a',
        data: {
          id: 'share-a',
          teamId: 'team-a',
          type: 'HOST',
          data: {},
          encryptedData: 'existing-ciphertext',
          isSensitive: true,
          permission: 'READONLY',
          baseVersion: 1,
        },
      },
    })
  })

  it('rejects ambiguous or unversioned queued updates before persistence', async () => {
    const prisma = {
      teamMember: { findUnique: vi.fn().mockResolvedValue({ id: 'member-a' }) },
      syncQueue: { create: vi.fn() },
    }
    const service = new TestOfflineSyncService(prisma as never)
    const update = {
      id: 'share-a',
      teamId: 'team-a',
      type: 'HOST',
      data: {},
      permission: 'READONLY',
    }

    await expect(
      service.enqueueOfflineOperation(
        'user-a',
        'team-a',
        'UPDATE',
        'HOST',
        'share-a',
        { ...update, isSensitive: false },
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.enqueueOfflineOperation(
        'user-a',
        'team-a',
        'UPDATE',
        'HOST',
        'share-a',
        {
          ...update,
          baseVersion: 1,
          encryptedData: 'ciphertext',
          isSensitive: false,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.syncQueue.create).not.toHaveBeenCalled()
  })

  it('rejects queueing an operation for a team the caller does not belong to', async () => {
    const prisma = {
      teamMember: { findUnique: vi.fn().mockResolvedValue(null) },
      syncQueue: { create: vi.fn() },
    }
    const service = new TestOfflineSyncService(prisma as never)

    await expect(
      service.enqueueOfflineOperation(
        'user-a',
        'team-b',
        'UPDATE',
        'HOST',
        'share-b',
        { id: 'share-b', teamId: 'team-b' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(prisma.syncQueue.create).not.toHaveBeenCalled()
  })

  it('does not process a queued update against a share from another team', async () => {
    const prisma = {
      syncQueue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'queue-a',
            teamId: 'team-a',
            operation: 'UPDATE',
            shareType: 'HOST',
            shareId: 'share-b',
            data: {
              id: 'share-b',
              teamId: 'team-a',
              type: 'HOST',
              data: { hostname: 'attacker' },
              permission: 'READWRITE',
            },
            attempts: 0,
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
      share: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'share-b',
          teamId: 'team-b',
          sharedBy: 'owner-b',
        }),
        update: vi.fn(),
      },
    }
    const service = new TestOfflineSyncService(prisma as never)

    const result = await service.processOfflineQueue('user-a')

    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 })
    expect(prisma.share.update).not.toHaveBeenCalled()
  })

  it('does not process a queued update for a share created by another member', async () => {
    const prisma = {
      syncQueue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'queue-a',
            teamId: 'team-a',
            operation: 'UPDATE',
            shareType: 'HOST',
            shareId: 'share-a',
            data: {
              id: 'share-a',
              teamId: 'team-a',
              type: 'HOST',
              data: { hostname: 'attacker' },
              permission: 'READWRITE',
            },
            attempts: 0,
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
      share: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'share-a',
          teamId: 'team-a',
          sharedBy: 'owner-a',
        }),
        update: vi.fn(),
      },
    }
    const service = new TestOfflineSyncService(prisma as never)

    const result = await service.processOfflineQueue('user-a')

    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 })
    expect(prisma.share.update).not.toHaveBeenCalled()
  })

  it('does not create a share when the queued payload names another team', async () => {
    const prisma = {
      syncQueue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'queue-a',
            teamId: 'team-a',
            operation: 'CREATE',
            shareType: 'HOST',
            shareId: 'share-b',
            data: {
              id: 'share-b',
              teamId: 'team-b',
              type: 'HOST',
              data: { hostname: 'attacker' },
              permission: 'READWRITE',
            },
            attempts: 0,
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
      share: { findUnique: vi.fn(), create: vi.fn() },
    }
    const service = new TestOfflineSyncService(prisma as never)

    const result = await service.processOfflineQueue('user-a')

    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 })
    expect(prisma.share.findUnique).not.toHaveBeenCalled()
    expect(prisma.share.create).not.toHaveBeenCalled()
  })

  it('does not create a queued sensitive share without ciphertext', async () => {
    const prisma = {
      syncQueue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'queue-a',
            teamId: 'team-a',
            operation: 'CREATE',
            shareType: 'HOST',
            shareId: 'share-a',
            data: {
              id: 'share-a',
              teamId: 'team-a',
              type: 'HOST',
              data: {},
              isSensitive: true,
              permission: 'READONLY',
            },
            attempts: 0,
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
      share: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    }
    const service = new TestOfflineSyncService(prisma as never)

    const result = await service.processOfflineQueue('user-a')

    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 })
    expect(prisma.share.create).not.toHaveBeenCalled()
  })

  it('preserves ciphertext when a queued sensitive update omits isSensitive', async () => {
    const prisma = {
      syncQueue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'queue-a',
            teamId: 'team-a',
            operation: 'UPDATE',
            shareType: 'HOST',
            shareId: 'share-a',
            data: {
              id: 'share-a',
              teamId: 'team-a',
              type: 'HOST',
              data: { hostname: 'plaintext' },
              baseVersion: 1,
              permission: 'READONLY',
            },
            attempts: 0,
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
      share: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'share-a',
          teamId: 'team-a',
          sharedBy: 'user-a',
          isSensitive: true,
          encryptedData: 'ciphertext',
          data: {},
          updatedAt: new Date(1),
          permission: 'READONLY',
        }),
        update: vi.fn().mockResolvedValue({ id: 'share-a' }),
      },
    }
    const service = new TestOfflineSyncService(prisma as never)

    const result = await service.processOfflineQueue('user-a')

    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 })
    expect(prisma.share.update).toHaveBeenCalledWith({
      where: { id: 'share-a' },
      data: {
        data: {},
        encryptedData: 'ciphertext',
        isSensitive: true,
        permission: 'READONLY',
      },
    })
    expect(prisma.syncQueue.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'queue-a',
        userId: 'user-a',
        status: 'PROCESSING',
        processingToken: expect.any(String),
      },
      data: { status: 'COMPLETED', data: Prisma.DbNull, processingToken: null },
    })
  })

  it('rejects stale queued updates and does not automatically retry FAILED items', async () => {
    const prisma = {
      syncQueue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'queue-a',
            teamId: 'team-a',
            operation: 'UPDATE',
            shareType: 'HOST',
            shareId: 'share-a',
            data: {
              id: 'share-a',
              teamId: 'team-a',
              type: 'HOST',
              data: {},
              encryptedData: 'stale-ciphertext',
              isSensitive: true,
              permission: 'READONLY',
              baseVersion: 1,
            },
            attempts: 2,
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
        }),
      },
      share: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'share-a',
          teamId: 'team-a',
          sharedBy: 'user-a',
          isSensitive: true,
          encryptedData: 'newer-ciphertext',
          data: {},
          permission: 'READONLY',
          updatedAt: new Date(2),
        }),
        update: vi.fn(),
      },
    }
    const service = new TestOfflineSyncService(prisma as never)

    const result = await service.processOfflineQueue('user-a')

    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 })
    expect(prisma.share.update).not.toHaveBeenCalled()
    expect(prisma.syncQueue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a', status: 'PENDING' },
      }),
    )
    expect(prisma.syncQueue.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'queue-a',
        userId: 'user-a',
        status: 'PROCESSING',
        processingToken: expect.any(String),
      },
      data: {
        status: 'FAILED',
        lastError: 'SYNC_OPERATION_FAILED',
        processingToken: null,
      },
    })
  })

  it('stores and returns only a stable error code when queue processing fails', async () => {
    const loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined)
    const prisma = {
      syncQueue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'queue-a',
            teamId: 'team-a',
            operation: 'UPDATE',
            shareType: 'HOST',
            shareId: 'share-a',
            data: {
              id: 'share-a',
              teamId: 'team-a',
              type: 'HOST',
              data: {},
              permission: 'READONLY',
            },
            attempts: 0,
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
      share: {
        findUnique: vi
          .fn()
          .mockRejectedValue(
            new Error('Prisma failed: password=database-secret'),
          ),
      },
    }
    const service = new TestOfflineSyncService(prisma as never)

    const result = await service.processOfflineQueue('user-a')

    expect(result.errors).toEqual([
      { id: 'queue-a', error: 'SYNC_OPERATION_FAILED' },
    ])
    expect(prisma.syncQueue.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'queue-a',
        userId: 'user-a',
        status: 'PROCESSING',
        processingToken: expect.any(String),
      },
      data: {
        status: 'PENDING',
        lastError: 'SYNC_OPERATION_FAILED',
        processingToken: null,
      },
    })
    expect(JSON.stringify(result)).not.toContain('database-secret')
    expect(loggerError).toHaveBeenCalled()
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(
      'database-secret',
    )
  })

  it('does not expose raw errors stored by an older server version', async () => {
    const prisma = {
      syncQueue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'queue-a',
            teamId: 'team-a',
            operation: 'UPDATE',
            shareType: 'HOST',
            shareId: 'share-a',
            data: {},
            attempts: 1,
            lastError: 'Prisma failed: password=legacy-secret',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]),
      },
    }
    const service = new TestOfflineSyncService(prisma as never)

    const result = await service.getPendingOperations('user-a')

    expect(result[0]?.lastError).toBe('SYNC_OPERATION_FAILED')
    expect(JSON.stringify(result)).not.toContain('legacy-secret')
  })

  it('recovers stale processing items and claims work with a lease token', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
    const prisma = {
      syncQueue: {
        updateMany,
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'queue-a',
            userId: 'user-a',
            teamId: 'team-a',
            operation: 'DELETE',
            shareType: 'HOST',
            shareId: 'share-a',
            data: null,
            attempts: 0,
          },
        ]),
      },
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({ id: 'member-a' }),
      },
      share: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    }
    const service = new TestOfflineSyncService(prisma as never)

    const result = await service.processOfflineQueue('user-a')

    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 })
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        userId: 'user-a',
        status: 'PROCESSING',
        updatedAt: expect.objectContaining({ lt: expect.any(Date) }),
      }),
      data: { status: 'PENDING', processingToken: null },
    })
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'queue-a', userId: 'user-a', status: 'PENDING' },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        processingToken: expect.any(String),
      },
    })
    const claim = updateMany.mock.calls[1]?.[0]
    const token = claim?.data.processingToken
    expect(updateMany).toHaveBeenNthCalledWith(3, {
      where: {
        id: 'queue-a',
        userId: 'user-a',
        status: 'PROCESSING',
        processingToken: token,
      },
      data: { status: 'COMPLETED', data: Prisma.DbNull, processingToken: null },
    })
  })

  it('skips an item claimed by another processor', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
    const prisma = {
      syncQueue: {
        updateMany,
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'queue-a',
            userId: 'user-a',
            teamId: 'team-a',
            operation: 'DELETE',
            shareType: 'HOST',
            shareId: 'share-a',
            data: null,
            attempts: 0,
          },
        ]),
      },
      share: { findUnique: vi.fn() },
      teamMember: { findUnique: vi.fn() },
    }
    const service = new TestOfflineSyncService(prisma as never)

    const result = await service.processOfflineQueue('user-a')

    expect(result).toEqual({ processed: 0, succeeded: 0, failed: 0, errors: [] })
    expect(prisma.share.findUnique).not.toHaveBeenCalled()
  })
})
