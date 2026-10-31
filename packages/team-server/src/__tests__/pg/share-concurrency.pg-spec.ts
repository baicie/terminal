import type { PrismaService } from '../../prisma.service'
import type { SeededTeam } from './pg-harness'
import { ConflictException } from '@nestjs/common'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SharesService } from '../../shares/shares.service'
import { SyncService } from '../../sync/sync.service'
import {
  connectRaw,
  createPrisma,
  delay,
  resetDatabase,
  seedTeams,
  waitForBlockedWriters,
} from './pg-harness'

/**
 * 游标是不透明复合串：`V2.<bound>.<txid>.<seq>@，字段定宽补零，因此取 txid 字段
 * 即可得到单调的投递位置；旧式单一数字游标也接受。
 */
function cursorPosition(cursor: string | number): number {
  const parts = String(cursor).split('.')
  return parts.length === 4 ? Number(parts[2]) : Number(cursor)
}

// 真实 PostgreSQL 并发验证：不 mock Prisma，直接用生产 PrismaService + 两个独立连接池。
describe('team sync 并发语义（真实 PostgreSQL）', () => {
  let prismaA: PrismaService
  let prismaB: PrismaService
  let syncA: SyncService
  let syncB: SyncService
  let sharesA: SharesService
  let sharesB: SharesService
  let ctx: SeededTeam

  beforeAll(() => {
    prismaA = createPrisma()
    prismaB = createPrisma()
    syncA = new SyncService(prismaA)
    syncB = new SyncService(prismaB)
    sharesA = new SharesService(prismaA)
    sharesB = new SharesService(prismaB)
  })

  afterAll(async () => {
    await prismaA.onModuleDestroy()
    await prismaB.onModuleDestroy()
  })

  beforeEach(async () => {
    await resetDatabase(prismaA)
    ctx = await seedTeams(prismaA)
  })

  function hostPayload(overrides: Record<string, unknown> = {}) {
    return {
      id: 'share-concurrency-1',
      teamId: ctx.teamId,
      type: 'HOST' as const,
      data: { host: 'a.example.com' },
      permission: 'READONLY' as const,
      ...overrides,
    }
  }

  it('A1 相同 id 的 CREATE 重放：第二次落为幂等更新，不产生第二行', async () => {
    const payload = hostPayload()
    const first = await syncA.pushChanges(ctx.creatorId, { shares: [payload] })
    // 客户端在收到响应前断线，随即用完全相同的请求重发
    const replay = await syncB.pushChanges(ctx.creatorId, { shares: [payload] })
    const rows = await prismaA.share.findMany({ where: { id: payload.id } })

    console.log(
      `[A1] 首次 created=${JSON.stringify(first.created)} 重放 updated=${JSON.stringify(replay.updated)} 重放 errors=${JSON.stringify(replay.errors)} 行数=${rows.length}`,
    )
    expect(first.created).toEqual([payload.id])
    expect(replay.created).toEqual([])
    expect(replay.updated).toEqual([payload.id])
    expect(replay.errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0].sharedBy).toBe(ctx.creatorId)
  })

  it('A1b 两个客户端同时创建同一 id：只留一行、只有一个 created，失败方不二次写入', async () => {
    const payload = hostPayload({ id: 'share-concurrency-race' })
    const [first, second] = await Promise.all([
      syncA.pushChanges(ctx.creatorId, { shares: [payload] }),
      syncB.pushChanges(ctx.creatorId, { shares: [payload] }),
    ])
    const rows = await prismaA.share.findMany({ where: { id: payload.id } })
    const createdTotal = first.created.length + second.created.length
    const loser = first.created.length === 1 ? second : first

    console.log(
      `[A1b] created 合计=${createdTotal} 另一方 updated=${JSON.stringify(loser.updated)} errors=${JSON.stringify(loser.errors)} 行数=${rows.length}`,
    )
    expect(rows).toHaveLength(1)
    expect(createdTotal).toBe(1)
    // 另一方要么走幂等更新，要么被唯一约束拦下并落成稳定错误码；两者都不允许二次写入同一行
    const idempotent = loser.updated.length === 1 && loser.errors.length === 0
    const rejectedByUnique = loser.errors.length === 1
      && loser.errors[0].error === 'SYNC_OPERATION_FAILED'
    expect(idempotent || rejectedByUnique).toBe(true)
    expect(loser.created).toEqual([])
  })

  it('A2 双客户端并发 UPDATE 同一资源：条件写只放行一个写者', async () => {
    const created = await sharesA.create(ctx.teamId, ctx.creatorId, {
      type: 'HOST',
      data: { host: 'v1' },
      permission: 'READWRITE',
    })
    // 第三方连接先持行锁，保证两个写者都在读到同一 updatedAt 后才进入条件写
    const blocker = await connectRaw()
    await blocker.query('BEGIN')
    await blocker.query('SELECT 1 FROM "Share" WHERE id = $1 FOR UPDATE', [
      created.id,
    ])

    const writers = Promise.allSettled([
      sharesA.update(ctx.teamId, created.id, ctx.creatorId, {
        data: { host: 'v2' },
      }),
      sharesB.update(ctx.teamId, created.id, ctx.creatorId, {
        data: { host: 'v3' },
      }),
    ])
    const blocked = await waitForBlockedWriters(prismaA, 2)
    await blocker.query('COMMIT')
    await blocker.end()
    const settled = await writers

    const fulfilled = settled.filter(entry => entry.status === 'fulfilled')
    const rejected = settled.filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
    const finalRow = await prismaA.share.findUnique({
      where: { id: created.id },
    })

    console.log(
      `[A2] 同时阻塞的写者=${blocked} 成功=${fulfilled.length} 冲突=${rejected.length} 最终 data=${JSON.stringify(finalRow?.data)}`,
    )
    expect(blocked).toBeGreaterThanOrEqual(2)
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(ConflictException)
    expect((rejected[0].reason as Error).message).toBe(
      'Share was modified concurrently',
    )
    expect(['{"host":"v2"}', '{"host":"v3"}']).toContain(
      JSON.stringify(finalRow?.data),
    )
  })

  it('A3 过期 baseVersion 被拒绝为冲突，且不覆盖较新数据', async () => {
    const payload = hostPayload({ id: 'share-stale-version' })
    await syncA.pushChanges(ctx.creatorId, { shares: [payload] })
    const stale = await prismaA.share.findUnique({ where: { id: payload.id } })
    const staleVersion = stale!.updatedAt.getTime()
    await delay(5)
    await sharesA.update(ctx.teamId, payload.id, ctx.creatorId, {
      data: { host: 'server-newer' },
    })

    const result = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        { ...payload, data: { host: 'stale-write' }, baseVersion: staleVersion },
      ],
    })
    const after = await prismaA.share.findUnique({ where: { id: payload.id } })

    console.log(
      `[A3] baseVersion=${staleVersion} conflicts=${JSON.stringify(result.conflicts)} updated=${JSON.stringify(result.updated)} 最终 data=${JSON.stringify(after?.data)}`,
    )
    expect(result.conflicts).toEqual([payload.id])
    expect(result.updated).toEqual([])
    expect(result.errors).toEqual([])
    expect(after?.data).toEqual({ host: 'server-newer' })
  })

  it('A3b 响应丢失后的 UPDATE 重放：报冲突而非静默二次写入', async () => {
    const payload = hostPayload({ id: 'share-update-replay' })
    await syncA.pushChanges(ctx.creatorId, { shares: [payload] })
    const before = await prismaA.share.findUnique({ where: { id: payload.id } })
    const baseVersion = before!.updatedAt.getTime()
    await sharesA.update(ctx.teamId, payload.id, ctx.creatorId, {
      data: { host: 'first-write' },
    })

    const replay = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...payload,
          data: { host: 'first-write' },
          baseVersion,
        },
      ],
    })
    const after = await prismaA.share.findUnique({ where: { id: payload.id } })

    console.log(
      `[A3b] 重放 conflicts=${JSON.stringify(replay.conflicts)} 最终 data=${JSON.stringify(after?.data)}`,
    )
    expect(replay.conflicts).toEqual([payload.id])
    expect(after?.data).toEqual({ host: 'first-write' })
  })

  // 正向验证（原 it.fails 缺口已修复）：写入事务在取快照时仍在途（先分配后提交），
  // 下一轮必须补上。判据是事务 id 的安全水位 pg_snapshot_xmin，既不是 sequence 分配顺序，
  // 也不是任何时钟（docs/phase8/sync-protocol.md §3）。
  it('A4 增量游标窗口：查询后才提交的写入必须能被下一轮看到', async () => {
    const lateId = 'share-late-commit'
    const blocker = await connectRaw()
    await blocker.query('BEGIN')
    await blocker.query(
      `INSERT INTO "Share" (id, "teamId", type, data, "sharedBy", permission, "isSensitive", "createdAt", "updatedAt") VALUES ($1, $2, 'HOST', $3, $4, 'READONLY', false, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')`,
      [lateId, ctx.teamId, JSON.stringify({ host: 'late' }), ctx.creatorId],
    )
    await delay(10)
    const round1 = await syncA.getChanges(ctx.creatorId, 0)
    await blocker.query('COMMIT')
    await blocker.end()
    const round2 = await syncA.getChanges(ctx.creatorId, round1.cursor)

    console.log(
      `[A4] 第一轮可见=${round1.shares.some(share => share.id === lateId)} 第二轮可见=${round2.shares.some(share => share.id === lateId)} 游标=${round1.cursor}->${round2.cursor}`,
    )
    expect(round1.shares.map(share => share.id)).not.toContain(lateId)
    expect(round2.shares.map(share => share.id)).toContain(lateId)
    expect(cursorPosition(round2.cursor)).toBeGreaterThanOrEqual(
      cursorPosition(round1.cursor),
    )
  })
})

// Phase 8.8 Task A 故障注入：真实 PostgreSQL、真实 Prisma 客户端，不 mock。
describe('team sync 协议故障注入（真实 PostgreSQL）', () => {
  let prismaA: PrismaService
  let prismaB: PrismaService
  let syncA: SyncService
  let syncB: SyncService
  let ctx: SeededTeam

  beforeAll(() => {
    prismaA = createPrisma()
    prismaB = createPrisma()
    syncA = new SyncService(prismaA)
    syncB = new SyncService(prismaB)
  })

  afterAll(async () => {
    await prismaA.onModuleDestroy()
    await prismaB.onModuleDestroy()
  })

  beforeEach(async () => {
    await resetDatabase(prismaA)
    ctx = await seedTeams(prismaA)
  })

  function hostPayload(overrides: Record<string, unknown> = {}) {
    return {
      id: 'share-protocol',
      teamId: ctx.teamId,
      type: 'HOST' as const,
      data: { host: 'v1' },
      permission: 'READONLY' as const,
      ...overrides,
    }
  }

  async function versionOf(id: string): Promise<number | null> {
    const row = await prismaA.share.findUnique({ where: { id } })
    return row ? Number(row.version) : null
  }

  it('S1 响应丢失后 A 重放 V1：不得覆盖 B 写入的 V2', async () => {
    const v1 = hostPayload()
    const created = await syncA.pushChanges(ctx.creatorId, {
      shares: [{ ...v1, operation: 'CREATE' }],
    })
    const versionV1 = (await versionOf(v1.id))!
    const updated = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...v1,
          data: { host: 'v2' },
          baseVersion: versionV1,
          operation: 'UPDATE',
        },
      ],
    })
    const versionV2 = (await versionOf(v1.id))!
    const replayCreate = await syncA.pushChanges(ctx.creatorId, {
      shares: [{ ...v1, operation: 'CREATE' }],
    })
    const replayUpdate = await syncA.pushChanges(ctx.creatorId, {
      shares: [{ ...v1, baseVersion: versionV1, operation: 'UPDATE' }],
    })
    const row = await prismaA.share.findUnique({ where: { id: v1.id } })

    console.log(
      `[S1] created=${  JSON.stringify(created.created)
       } v1=${  versionV1
       } updated=${  JSON.stringify(updated.updated)
       } v2=${  versionV2
       } 重放CREATE conflicts=${  JSON.stringify(replayCreate.conflicts)
       } 重放UPDATE conflicts=${  JSON.stringify(replayUpdate.conflicts)
       } 最终data=${  JSON.stringify(row?.data)
       } 最终version=${  Number(row?.version)}`,
    )
    expect(created.created).toEqual([v1.id])
    expect(updated.updated).toEqual([v1.id])
    expect(replayCreate.conflicts).toEqual([v1.id])
    expect(replayCreate.updated).toEqual([])
    expect(replayUpdate.conflicts).toEqual([v1.id])
    expect(row?.data).toEqual({ host: 'v2' })
    expect(Number(row?.version)).toBe(versionV2)
  })

  it('S2 乱序提交：seq 更小的事务晚提交，不得被游标跳过', async () => {
    const earlyId = 'share-seq-early-commit-late'
    const lateId = 'share-seq-late-commit-first'
    const blocker = await connectRaw()
    await blocker.query('BEGIN')
    await blocker.query(
      `INSERT INTO "Share" (id, "teamId", type, data, "sharedBy", permission, "isSensitive", "createdAt", "updatedAt") VALUES ($1, $2, 'HOST', $3, $4, 'READONLY', false, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')`,
      [earlyId, ctx.teamId, JSON.stringify({ host: 'early-seq' }), ctx.creatorId],
    )
    await syncA.pushChanges(ctx.creatorId, {
      shares: [
        { ...hostPayload({ id: lateId, data: { host: 'late-seq' } }), operation: 'CREATE' },
      ],
    })
    const round1 = await syncA.getChanges(ctx.creatorId, 0)
    await blocker.query('COMMIT')
    await blocker.end()
    const round2 = await syncA.getChanges(ctx.creatorId, round1.cursor)
    const seqs = await prismaA.syncChange.findMany({
      where: { shareId: { in: [earlyId, lateId] } },
      select: { shareId: true, seq: true },
    })
    const earlySeq = Number(seqs.find(row => row.shareId === earlyId)!.seq)
    const lateSeq = Number(seqs.find(row => row.shareId === lateId)!.seq)

    console.log(
      `[S2] seq(晚提交)=${  earlySeq
       } seq(先提交)=${  lateSeq
       } 第一轮可见=${  JSON.stringify(round1.shares.map(share => share.id))
       } 第二轮可见=${  JSON.stringify(round2.shares.map(share => share.id))
       } 游标=${  round1.cursor  }->${  round2.cursor}`,
    )
    // 分配顺序与提交顺序相反，这正是旧实现漏同步的成因
    expect(earlySeq).toBeLessThan(lateSeq)
    // 第一轮：safe 被「最老的在途写事务」钉住，晚提交者一定不可见
    expect(round1.shares.map(share => share.id)).not.toContain(earlyId)
    // 第二轮：两个事务都已结束，谁也不许被跳过
    expect(round2.shares.map(share => share.id)).toContain(earlyId)
    expect(round2.shares.map(share => share.id)).toContain(lateId)
    expect(cursorPosition(round2.cursor)).toBeGreaterThan(
      cursorPosition(round1.cursor),
    )
  })

  it('S3 删除与更新交错：不复活、不丢删除', async () => {
    const item = hostPayload({ id: 'share-delete-race' })
    await syncA.pushChanges(ctx.creatorId, {
      shares: [{ ...item, operation: 'CREATE' }],
    })
    const versionV1 = (await versionOf(item.id))!
    const before = await syncA.getChanges(ctx.creatorId, 0)
    const removed = await syncA.pushChanges(ctx.creatorId, {
      deleteShares: [item.id],
    })
    const updateAfterDelete = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...item,
          data: { host: 'resurrect' },
          baseVersion: versionV1,
          operation: 'UPDATE',
        },
      ],
    })
    const createAfterDelete = await syncB.pushChanges(ctx.creatorId, {
      shares: [{ ...item, operation: 'CREATE' }],
    })
    const pull = await syncA.getChanges(ctx.creatorId, before.cursor)
    const row = await prismaA.share.findUnique({ where: { id: item.id } })
    const tombstones = await prismaA.syncChange.count({
      where: { shareId: item.id, op: 'DELETE' },
    })

    console.log(
      `[S3] deleted=${  JSON.stringify(removed.deleted)
       } 删除后UPDATE conflicts=${  JSON.stringify(updateAfterDelete.conflicts)
       } 删除后CREATE conflicts=${  JSON.stringify(createAfterDelete.conflicts)
       } 行存在=${  row !== null
       } 拉取 deletedShareIds=${  JSON.stringify(pull.deletedShareIds)
       } 拉取 shares=${  JSON.stringify(pull.shares.map(share => share.id))
       } 墓碑数=${  tombstones}`,
    )
    expect(removed.deleted).toEqual([item.id])
    expect(updateAfterDelete.conflicts).toEqual([item.id])
    expect(createAfterDelete.conflicts).toEqual([item.id])
    expect(row).toBeNull()
    expect(pull.deletedShareIds).toContain(item.id)
    expect(pull.shares.map(share => share.id)).not.toContain(item.id)
    expect(tombstones).toBe(1)
  })

  it('S4 客户端时钟提前或落后：不影响同步正确性', async () => {
    const item = hostPayload({ id: 'share-clock-skew' })
    await syncA.pushChanges(ctx.creatorId, {
      shares: [{ ...item, operation: 'CREATE' }],
    })
    const versionV1 = (await versionOf(item.id))!
    const realNow = Date.now()
    const decade = 10 * 365 * 24 * 60 * 60 * 1000

    const clockAhead = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        { ...item, data: { host: 'clock-ahead' }, baseVersion: realNow + decade },
      ],
    })
    const clockBehind = await syncB.pushChanges(ctx.creatorId, {
      shares: [{ ...item, data: { host: 'clock-behind' }, baseVersion: 0 }],
    })
    const row = await prismaA.share.findUnique({ where: { id: item.id } })

    const probe = await syncA.getChanges(ctx.creatorId, 0)
    const aheadSpy = vi.spyOn(Date, 'now').mockReturnValue(realNow + decade)
    const aheadPull = await syncA.getChanges(ctx.creatorId, 0)
    aheadSpy.mockRestore()
    const behindSpy = vi.spyOn(Date, 'now').mockReturnValue(0)
    const behindPull = await syncA.getChanges(ctx.creatorId, 0)
    behindSpy.mockRestore()

    console.log(
      `[S4] 时钟提前 conflicts=${  JSON.stringify(clockAhead.conflicts)
       } 时钟落后 conflicts=${  JSON.stringify(clockBehind.conflicts)
       } 最终data=${  JSON.stringify(row?.data)
       } 游标=${  probe.cursor  }/${  aheadPull.cursor  }/${  behindPull.cursor
       } 记录数=${  probe.shares.length  }/${  aheadPull.shares.length
       }/${  behindPull.shares.length}`,
    )
    expect(clockAhead.conflicts).toEqual([item.id])
    expect(clockBehind.conflicts).toEqual([item.id])
    expect(row?.data).toEqual({ host: 'v1' })
    expect(Number(row?.version)).toBe(versionV1)
    expect(aheadPull.shares.map(share => share.id))
      .toEqual(probe.shares.map(share => share.id))
    expect(behindPull.shares.map(share => share.id))
      .toEqual(probe.shares.map(share => share.id))
    expect(cursorPosition(aheadPull.cursor)).toBeGreaterThanOrEqual(
      cursorPosition(probe.cursor),
    )
  })

  it('S5 网络中断后的多次重试：幂等，不产生重复行', async () => {
    const item = hostPayload({ id: 'share-retry' })
    const createAttempts = []
    for (let attempt = 0; attempt < 5; attempt++) {
      createAttempts.push(
        await syncA.pushChanges(ctx.creatorId, {
          shares: [{ ...item, operation: 'CREATE' }],
        }),
      )
    }
    const rows = await prismaA.share.count({ where: { id: item.id } })
    const upsertsAfterCreate = await prismaA.syncChange.count({
      where: { shareId: item.id, op: 'UPSERT' },
    })
    const versionV1 = (await versionOf(item.id))!
    const firstUpdate = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...item,
          data: { host: 'v2' },
          baseVersion: versionV1,
          operation: 'UPDATE',
        },
      ],
    })
    const staleReplays = []
    for (let attempt = 0; attempt < 3; attempt++) {
      staleReplays.push(
        await syncB.pushChanges(ctx.creatorId, {
          shares: [
            {
              ...item,
              data: { host: 'v2' },
              baseVersion: versionV1,
              operation: 'UPDATE',
            },
          ],
        }),
      )
    }
    const versionV2 = (await versionOf(item.id))!
    const ackReplays = []
    for (let attempt = 0; attempt < 3; attempt++) {
      ackReplays.push(
        await syncB.pushChanges(ctx.creatorId, {
          shares: [
            {
              ...item,
              data: { host: 'v2' },
              baseVersion: versionV2,
              operation: 'UPDATE',
            },
          ],
        }),
      )
    }
    const versionAfterAcks = (await versionOf(item.id))!
    const upsertsFinal = await prismaA.syncChange.count({
      where: { shareId: item.id, op: 'UPSERT' },
    })

    console.log(
      `[S5] 5 次 CREATE created=${
       createAttempts.map(attempt => attempt.created.length).join('/')
       } updated=${  createAttempts.map(attempt => attempt.updated.length).join('/')
       } 行数=${  rows
       } 首次 UPDATE=${  JSON.stringify(firstUpdate.updated)
       } 过期重放 conflicts=${  staleReplays.map(replay => replay.conflicts.length).join('/')
       } 幂等 ack updated=${  ackReplays.map(replay => replay.updated.length).join('/')
       } 版本=${  versionV1  }->${  versionV2  }（ack 后 ${  versionAfterAcks  }）`
      + ` 变更行=${  upsertsAfterCreate  }->${  upsertsFinal}`,
    )
    expect(rows).toBe(1)
    expect(createAttempts.filter(attempt => attempt.created.length === 1)).toHaveLength(1)
    expect(createAttempts.every(attempt => attempt.errors.length === 0)).toBe(true)
    expect(
      createAttempts.slice(1).every(attempt => attempt.updated.length === 1),
    ).toBe(true)
    expect(upsertsAfterCreate).toBe(1)
    expect(firstUpdate.updated).toEqual([item.id])
    expect(staleReplays.every(replay => replay.conflicts.length === 1)).toBe(true)
    expect(ackReplays.every(replay => replay.updated.length === 1)).toBe(true)
    expect(versionAfterAcks).toBe(versionV2)
    expect(upsertsFinal).toBe(2)
  })

  it('S6 多客户端并发拉取与推送：每个客户端最终都看到全部变更', async () => {
    const total = 20
    const ids = Array.from({ length: total }, (_, index) => `share-fanout-${  index}`)
    const readers = [0, 1, 2].map(async () => {
      const seen = new Set<string>()
      let cursor: number | string = 0
      for (let round = 0; round < 10; round++) {
        const result = await syncA.getChanges(ctx.creatorId, cursor)
        for (const share of result.shares) seen.add(share.id)
        for (const id of result.deletedShareIds) seen.delete(id)
        cursor = result.cursor
        await delay(5)
      }
      return { seen, cursor }
    })
    const writers = [0, 1, 2, 3].map(async offset => {
      for (let round = 0; round < 5; round++) {
        const id = ids[offset * 5 + round]
        const service = offset % 2 === 0 ? syncA : syncB
        await service.pushChanges(ctx.creatorId, {
          shares: [
            {
              ...hostPayload({ id, data: { host: `t${  offset  }-${  round}` } }),
              operation: 'CREATE',
            },
          ],
        })
      }
    })
    const readerResults = await Promise.all(readers)
    await Promise.all(writers)

    for (const reader of readerResults) {
      let cursor = reader.cursor
      for (let round = 0; round < 6; round++) {
        const result = await syncA.getChanges(ctx.creatorId, cursor)
        for (const share of result.shares) reader.seen.add(share.id)
        for (const id of result.deletedShareIds) reader.seen.delete(id)
        cursor = result.cursor
        if (result.shares.length === 0 && result.deletedShareIds.length === 0) break
      }
    }
    const rowCount = await prismaA.share.count({
      where: { teamId: ctx.teamId, id: { in: ids } },
    })
    const seenCounts = readerResults.map(reader => reader.seen.size)

    console.log(
      `[S6] 写入=${  total  } 行数=${  rowCount
       } 各客户端最终看到=${  seenCounts.join('/')
       } 游标=${  readerResults.map(reader => reader.cursor).join('/')}`,
    )
    expect(rowCount).toBe(total)
    for (const reader of readerResults) {
      expect(ids.filter(id => !reader.seen.has(id))).toEqual([])
      expect(reader.seen.size).toBe(total)
    }
  })

  it('F0 变更日志与 Share 表一致性自检必须为空集', async () => {
    const base = hostPayload({ id: 'share-consistency' })
    await syncA.pushChanges(ctx.creatorId, {
      shares: [{ ...base, operation: 'CREATE' }],
    })
    const versionV1 = (await versionOf(base.id))!
    await syncA.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...base,
          data: { host: 'v2' },
          baseVersion: versionV1,
          operation: 'UPDATE',
        },
      ],
    })
    const doomed = hostPayload({ id: 'share-consistency-doomed' })
    await syncA.pushChanges(ctx.creatorId, {
      shares: [{ ...doomed, operation: 'CREATE' }],
    })
    await syncA.pushChanges(ctx.creatorId, { deleteShares: [doomed.id] })

    const versionMismatch = await prismaA.$queryRaw<Array<{ id: string }>>`
      SELECT s.id FROM "Share" s
      LEFT JOIN LATERAL (
        SELECT "version" FROM "SyncChange" c
        WHERE c."shareId" = s.id AND c.op = 'UPSERT'
        ORDER BY c.seq DESC LIMIT 1
      ) c ON TRUE
      WHERE c."version" IS DISTINCT FROM s."version"`
    const orphanUpserts = await prismaA.$queryRaw<Array<{ shareId: string }>>`
      SELECT u."shareId" FROM "SyncChange" u
      WHERE u.op = 'UPSERT'
        AND NOT EXISTS (
          SELECT 1 FROM "SyncChange" d
          WHERE d."shareId" = u."shareId" AND d.op = 'DELETE' AND d.seq > u.seq
        )
        AND NOT EXISTS (SELECT 1 FROM "Share" s WHERE s.id = u."shareId")`
    const finalRow = await prismaA.share.findUnique({ where: { id: base.id } })

    console.log(
      `[F0] 版本不一致=${  versionMismatch.length
       } 无主 UPSERT=${  orphanUpserts.length
       } 最终data=${  JSON.stringify(finalRow?.data)
       } 最终version=${  Number(finalRow?.version)  }（v1=${  versionV1  }）`,
    )
    expect(versionMismatch).toEqual([])
    expect(orphanUpserts).toEqual([])
    expect(finalRow?.data).toEqual({ host: 'v2' })
    expect(Number(finalRow?.version)).toBeGreaterThan(versionV1)
  })
})


