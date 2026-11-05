import type { PrismaService } from '../../prisma.service'
import type { SeededTeam } from './pg-harness'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SyncService } from '../../sync/sync.service'
import { createPrisma, resetDatabase, seedTeams } from './pg-harness'

// Phase 9.2 P9.2-5：冲突判定必须用同一套版本协议。
//
// 三个入口都可以判定"是否存在冲突"：
//   - pushChanges            → classifyBaseVersion(baseVersion)
//   - resolveConflict(LOCAL) → classifyBaseVersion(baseVersion)
//   - checkConflicts         → share.updatedAt.getTime() > item.updatedAt  ← 例外
//
// 第三条用毫秒墙钟。同一毫秒内的两次写入比较结果相等，于是最新的一次远端更新
// 会被判成"没有冲突"，而 push 侧对同一状态会判成冲突。两个入口对同一份数据给出
// 相反答案，这正是"静默覆盖"的入口。
//
// 本文件全部使用真实 PostgreSQL 与真实 SyncService，不 mock Prisma。

describe('P9.2-5 版本协议一致性（真实 PostgreSQL）', () => {
  let prisma: PrismaService
  let service: SyncService
  let ctx: SeededTeam

  beforeAll(() => {
    prisma = createPrisma()
    service = new SyncService(prisma)
  })

  afterAll(async () => {
    await prisma.onModuleDestroy()
  })

  beforeEach(async () => {
    await resetDatabase(prisma)
    ctx = await seedTeams(prisma)
  })

  async function serverRow(id: string) {
    return prisma.share.findUnique({ where: { id } })
  }

  async function createAt(id: string, data: unknown): Promise<number> {
    const result = await service.pushChanges(ctx.creatorId, {
      shares: [
        {
          id,
          teamId: ctx.teamId,
          type: 'HOST',
          data,
          permission: 'READWRITE',
          operation: 'CREATE',
        },
      ],
    })
    expect(result.created).toEqual([id])
    return Number((await serverRow(id))?.version)
  }

  /** 把服务端的 updatedAt 压回到同一毫秒，重现"墙钟无法区分先后"的状态。 */
  async function freezeUpdatedAt(id: string, millis: number): Promise<void> {
    await prisma.$executeRawUnsafe(
      'UPDATE "Share" SET "updatedAt" = to_timestamp($2 / 1000.0) WHERE id = $1',
      id,
      millis,
    )
  }

  it('同一毫秒内的更新仍必须被判为冲突（毫秒墙钟不是版本）', async () => {
    const id = 'version-same-millis'
    const v1 = await createAt(id, { host: 'v1' })
    const shared = await serverRow(id)
    const sameMilli = shared!.updatedAt.getTime()

    // 远端再写一次：版本推进，但把 updatedAt 压回同一毫秒。
    const pushed = await service.pushChanges(ctx.creatorId, {
      shares: [
        {
          id,
          teamId: ctx.teamId,
          type: 'HOST',
          data: { host: 'v2-remote' },
          permission: 'READWRITE',
          operation: 'UPDATE',
          baseVersion: v1,
        },
      ],
    })
    expect(pushed.updated).toEqual([id])
    const v2 = Number((await serverRow(id))?.version)
    expect(v2).toBeGreaterThan(v1)
    // The raw UPDATE below is itself a write on "Share", so the version tick
    // fires again; what matters is the wall clock, which this forces back.
    await freezeUpdatedAt(id, sameMilli)
    const vAfterFreeze = Number((await serverRow(id))?.version)

    // 客户端仍持有 v1，且本地时间戳恰好等于远端被压回的那一毫秒。
    const conflicts = await service.checkConflicts(ctx.creatorId, [
      { id, updatedAt: sameMilli, version: v1, type: 'HOST' },
    ])
    console.log(
      `[P9.2-5/same-ms] 客户端version=${v1} 远端version=${v2}->${vAfterFreeze} updatedAt同为${sameMilli} 冲突数=${conflicts.length}`,
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].version).toBe(vAfterFreeze)
    expect(conflicts[0].remoteVersion.version).toBe(vAfterFreeze)

    // 同一状态下 push 侧也必须判成冲突，两个入口不得给出相反答案。
    const pushAfter = await service.pushChanges(ctx.creatorId, {
      shares: [
        {
          id,
          teamId: ctx.teamId,
          type: 'HOST',
          data: { host: 'client-stale' },
          permission: 'READWRITE',
          operation: 'UPDATE',
          baseVersion: v1,
        },
      ],
    })
    expect(pushAfter.conflicts).toEqual([id])
    expect(pushAfter.updated).toEqual([])
    expect((await serverRow(id))?.data).toEqual({ host: 'v2-remote' })
  })

  it('版本一致时不得报告冲突，即使墙钟更晚', async () => {
    const id = 'version-match'
    const v1 = await createAt(id, { host: 'only-version' })
    const now = Date.now()

    const conflicts = await service.checkConflicts(ctx.creatorId, [
      { id, updatedAt: now, version: v1, type: 'HOST' },
    ])
    console.log(
      `[P9.2-5/match] 版本一致 冲突数=${conflicts.length}`,
    )

    expect(conflicts).toEqual([])
  })

  it('服务端版本领先时必须报告冲突，即使客户端墙钟更晚', async () => {
    const id = 'version-stale'
    const v1 = await createAt(id, { host: 'v1' })
    await service.pushChanges(ctx.creatorId, {
      shares: [
        {
          id,
          teamId: ctx.teamId,
          type: 'HOST',
          data: { host: 'v2' },
          permission: 'READWRITE',
          operation: 'UPDATE',
          baseVersion: v1,
        },
      ],
    })
    const current = Number((await serverRow(id))?.version)

    // 客户端时钟走快了一分钟：墙钟比较会说"客户端更新"，版本比较不会。
    const conflicts = await service.checkConflicts(ctx.creatorId, [
      { id, updatedAt: Date.now() + 60_000, version: v1, type: 'HOST' },
    ])
    console.log(
      `[P9.2-5/stale] 客户端version=${v1} 远端version=${current} 客户端时钟超前 冲突数=${conflicts.length}`,
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].version).toBe(current)
  })

  it('未证明版本时保留毫秒回退，但只有确实更晚才报冲突', async () => {
    const id = 'version-legacy'
    await createAt(id, { host: 'legacy' })
    const row = await serverRow(id)
    const remoteMillis = row!.updatedAt.getTime()

    // 旧客户端：不带 version，只能靠墙钟。远端更晚 → 冲突。
    const older = await service.checkConflicts(ctx.creatorId, [
      { id, updatedAt: remoteMillis - 5_000, type: 'HOST' },
    ])
    // 客户端记录的正是远端那一刻 → 不算冲突。
    const equal = await service.checkConflicts(ctx.creatorId, [
      { id, updatedAt: remoteMillis, type: 'HOST' },
    ])
    console.log(
      `[P9.2-5/legacy] 旧于远端冲突数=${older.length} 等于远端冲突数=${equal.length}`,
    )

    expect(older).toHaveLength(1)
    expect(equal).toEqual([])
  })

  it('敏感记录的冲突报告不得外泄明文', async () => {
    const id = 'version-sensitive'
    await service.pushChanges(ctx.creatorId, {
      shares: [
        {
          id,
          teamId: ctx.teamId,
          type: 'HOST',
          data: {},
          encryptedData: 'ciphertext-v1',
          isSensitive: true,
          permission: 'READWRITE',
          operation: 'CREATE',
        },
      ],
    })
    const row = await serverRow(id)

    const conflicts = await service.checkConflicts(ctx.creatorId, [
      { id, updatedAt: row!.updatedAt.getTime() - 1_000, type: 'HOST' },
    ])
    console.log(
      `[P9.2-5/sensitive] 冲突数=${conflicts.length} remoteData=${JSON.stringify(conflicts[0]?.remoteVersion.data)}`,
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].isSensitive).toBe(true)
    // 服务端只回占位，不回明文；密文由客户端自己持有的密钥解。
    expect(conflicts[0].remoteVersion.data).toEqual({})
    expect(conflicts[0].remoteVersion.isSensitive).toBe(true)
  })
})
