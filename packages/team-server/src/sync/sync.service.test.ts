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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

    expect(prisma.share.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'share-a',
        teamId: 'team-a',
        sharedBy: 'user-a',
        updatedAt: sensitiveShare.updatedAt,
      },
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

  it('anchors the incremental cursor on the database safe watermark instead of any clock', async () => {
    const safe = 4_242n
    const prisma = {
      teamMember: {
        findMany: vi.fn().mockResolvedValue([{ teamId: 'team-a' }]),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ safe: safe.toString() }]),
      syncChange: { findMany: vi.fn().mockResolvedValue([]) },
      share: { findMany: vi.fn() },
      auditLog: { findMany: vi.fn() },
    }
    const service = new SyncService(prisma as never)
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_760_000_000_000)
    let result
    try {
      result = await service.getChanges('user-a', 1_000)
    } finally {
      nowSpy.mockRestore()
    }

    // The cursor is the pg_snapshot_xmin watermark, never a wall clock.
    expect(result.cursor).toBe(4_242)
    expect(result.timestamp).toBe(4_242)
    expect(result.resync).toBe(false)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.syncChange.findMany).toHaveBeenCalledWith({
      where: { teamId: { in: ['team-a'] }, txid: { gte: 1_000n, lt: safe } },
      orderBy: { seq: 'asc' },
      take: 200,
    })
    // No incremental read may window Share or AuditLog by time.
    expect(prisma.share.findMany).not.toHaveBeenCalled()
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
    // A legacy epoch cursor is above the watermark, so it degrades to a full resnapshot.
    const resync = await service.getChanges('user-a', 1_760_000_000_000)
    expect(resync.resync).toBe(true)
    expect(resync.cursor).toBe(4_242)
  })

  it('lets a READWRITE member update another creator share without changing its permission', async () => {
    const writableShare = {
      ...existingShare,
      id: 'share-a',
      teamId: 'team-a',
      sharedBy: 'owner-a',
      permission: 'READWRITE',
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
        findUnique: vi.fn().mockResolvedValue(writableShare),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const service = new SyncService(prisma as never)

    const result = await service.pushChanges('user-a', {
      shares: [
        {
          id: 'share-a',
          teamId: 'team-a',
          type: 'HOST',
          data: { hostname: 'member-write' },
          permission: 'READONLY',
        },
      ],
    })

    expect(result.updated).toEqual(['share-a'])
    expect(result.errors).toEqual([])
    expect(prisma.share.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'share-a',
        teamId: 'team-a',
        sharedBy: 'owner-a',
        updatedAt: writableShare.updatedAt,
      },
      data: {
        data: { hostname: 'member-write' },
        encryptedData: null,
        isSensitive: false,
        permission: 'READWRITE',
      },
    })
  })

  it('reports a conflict instead of overwriting when a pushed update loses the write race', async () => {
    const share = {
      ...existingShare,
      id: 'share-a',
      teamId: 'team-a',
      sharedBy: 'user-a',
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
        findUnique: vi.fn().mockResolvedValue(share),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    const service = new SyncService(prisma as never)

    const result = await service.pushChanges('user-a', {
      shares: [
        {
          id: 'share-a',
          teamId: 'team-a',
          type: 'HOST',
          data: { hostname: 'raced' },
          permission: 'READONLY',
        },
      ],
    })

    expect(result.updated).toEqual([])
    expect(result.conflicts).toEqual(['share-a'])
  })

  it('logs only an enumerable error code when a pushed operation fails', async () => {
    const loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined)
    const prisma = {
      share: {
        findUnique: vi
          .fn()
          .mockRejectedValue(new Error('Prisma failed: password=database-secret')),
      },
    }
    const service = new SyncService(prisma as never)

    const result = await service.pushChanges('user-a', {
      deleteShares: ['share-a'],
    })

    expect(result.errors).toEqual([
      { id: 'share-a', error: 'SYNC_OPERATION_FAILED' },
    ])
    const logged = JSON.stringify(loggerError.mock.calls)
    expect(logged).toContain('code=Error')
    expect(logged).not.toContain('database-secret')
  })
})
