import { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { LEGACY_FULL_DELIVERY_LIMIT } from './sync-delivery'
import { SyncService } from './sync.service'

/** Finished-run cursor at watermark 4242: bound 0, then the reached txid. */
const COMPLETE_CURSOR
  = '2.00000000000000000000.00000000000000004242.00000000000000000000'

const existingShare = {
  id: 'share-b',
  teamId: 'team-b',
  type: 'HOST',
  data: { hostname: 'private-b' },
  encryptedData: null,
  isSensitive: false,
  sharedBy: 'owner-b',
  permission: 'READONLY',
  /** Server-issued version: the only value the write condition may compare. */
  version: 1n,
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
          // 版本证明由服务端发放的 version 提供（Phase 9.0：无证明不写）
          operation: 'UPDATE',
          baseVersion: Number(sensitiveShare.version),
        },
      ],
    })

    expect(prisma.share.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'share-a',
        teamId: 'team-a',
        sharedBy: 'user-a',
        version: sensitiveShare.version,
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
      // 每个 create 都要先查墓碑日志（旧写入不得静默复活已删除的共享）
      syncChange: { findFirst: vi.fn().mockResolvedValue(null) },
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

    // The cursor is the frozen pg_snapshot_xmin watermark plus the composite
    // position of the last delivered row, never a wall clock.
    expect(result.cursor).toBe(COMPLETE_CURSOR)
    expect(result.timestamp).toBe(4_242)
    expect(result.hasMore).toBe(false)
    expect(result.resync).toBe(false)
    expect(result.upgradeRequired).toBe(false)
    expect(result.requiredCursorVersion).toBe(2)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.syncChange.findMany).toHaveBeenCalledWith({
      where: {
        teamId: { in: ['team-a'] },
        txid: { lt: safe },
        // Legacy numeric cursor 1000 resumes at "every row of txid >= 1000".
        OR: [{ txid: { gt: 1_000n } }, { txid: 1_000n, seq: { gt: -1n } }],
      },
      orderBy: [{ txid: 'asc' }, { seq: 'asc' }],
      // 协议 1 无法翻页：读满「上限 + 1」一次判定能否完整交付
      take: LEGACY_FULL_DELIVERY_LIMIT + 1,
    })
    // No incremental read may window Share or AuditLog by time.
    expect(prisma.share.findMany).not.toHaveBeenCalled()
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
    // A legacy epoch cursor is above the watermark, so it degrades to a full resnapshot.
    const resync = await service.getChanges('user-a', 1_760_000_000_000)
    expect(resync.resync).toBe(true)
    expect(resync.cursor).toBe(COMPLETE_CURSOR)
    expect(prisma.syncChange.findMany).toHaveBeenLastCalledWith({
      where: { teamId: { in: ['team-a'] }, txid: { lt: safe } },
      orderBy: [{ txid: 'asc' }, { seq: 'asc' }],
      take: LEGACY_FULL_DELIVERY_LIMIT + 1,
    })
    // 超过完整交付上限：不交付部分数据，水位不前进，明确要求升级协议
    prisma.syncChange.findMany.mockResolvedValue(
      Array.from(
        { length: LEGACY_FULL_DELIVERY_LIMIT + 1 },
        (_, index) => ({ shareId: `over-${index}`, seq: BigInt(index) }),
      ),
    )
    const refused = await service.getChanges('user-a', 1_000)
    expect(refused.upgradeRequired).toBe(true)
    expect(refused.shares).toEqual([])
    expect(refused.deletedShareIds).toEqual([])
    expect(refused.hasMore).toBe(false)
    // 水位回显旧游标（不前进），忽略提示的客户端只会原地重试，不会跳过数据
    expect(refused.timestamp).toBe(1_000)
  })

  it('refuses an undeclared legacy update instead of degrading to a blind write', async () => {
    const prisma = {
      teamMember: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-a',
          userId: 'user-a',
          role: 'MEMBER',
        }),
      },
      share: {
        findUnique: vi.fn().mockResolvedValue({
          ...existingShare,
          id: 'share-a',
          teamId: 'team-a',
          sharedBy: 'user-a',
        }),
        updateMany: vi.fn(),
      },
    }
    const service = new SyncService(prisma as never)

    const result = await service.pushChanges('user-a', {
      shares: [
        {
          id: 'share-a',
          teamId: 'team-a',
          type: 'HOST',
          data: { hostname: 'stale-copy' },
          permission: 'READONLY',
        },
      ],
    })

    // 没有 operation、没有 baseVersion：不能读一次版本就当成版本证明
    expect(prisma.share.updateMany).not.toHaveBeenCalled()
    expect(result.updated).toEqual([])
    expect(result.conflicts).toEqual(['share-a'])
    expect(result.upgradeRequired).toBe(true)
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
          operation: 'UPDATE',
          baseVersion: Number(writableShare.version),
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
        version: writableShare.version,
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
