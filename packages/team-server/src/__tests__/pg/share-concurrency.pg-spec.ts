import type { PrismaService } from '../../prisma.service'
import type { SeededTeam } from './pg-harness'
import { ConflictException } from '@nestjs/common'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

  // 已知缺口（it.fails 作为活体标记）：游标在查询前捕获，解决的是「查询期间被更新」的漏同步；
  // 但「本轮 SELECT 之后才提交、updatedAt 落在本轮窗口内」的写入，下一轮 since=上一轮 timestamp
  // 会把它排除——该写入永久漏同步。修复需要设计决策（DB 侧单调版本列或重叠窗口），不在 P8.5 范围内。
  it.fails(
    'A4 增量游标窗口：查询后才提交的写入必须能被下一轮看到（当前漏同步）',
    async () => {
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
      const round2 = await syncA.getChanges(ctx.creatorId, round1.timestamp)

      console.log(
        `[A4] 第一轮可见=${round1.shares.some(share => share.id === lateId)} 第二轮可见=${round2.shares.some(share => share.id === lateId)} 游标=${round1.timestamp}`,
      )
      expect(round1.shares.map(share => share.id)).not.toContain(lateId)
      expect(round2.shares.map(share => share.id)).toContain(lateId)
    },
  )
})

