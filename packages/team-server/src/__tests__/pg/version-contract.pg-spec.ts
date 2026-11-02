import type { PrismaService } from '../../prisma.service'
import type { SeededTeam } from './pg-harness'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncService } from '../../sync/sync.service'
import { connectRaw, createPrisma, delay, resetDatabase, seedTeams } from './pg-harness'

// Phase 8.9 Task 2：严格乐观并发版本契约（真实 PostgreSQL，不 mock Prisma）。
// 关键断言：同一毫秒内的两次 UPDATE 只能成功一次，版本由服务端 version 裁决，
// 与 updatedAt（毫秒精度）无关。
const FROZEN_MS = new Date('2026-03-01T00:00:00.000Z')

describe('share 版本契约与同毫秒并发（真实 PostgreSQL）', () => {
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
      id: 'version-contract-1',
      teamId: ctx.teamId,
      type: 'HOST' as const,
      data: { host: 'v1' },
      permission: 'READONLY' as const,
      ...overrides,
    }
  }

  async function versionOf(id: string): Promise<number> {
    const row = await prismaA.share.findUnique({ where: { id } })
    return Number(row?.version)
  }

  /** 只冻结 Date（保留真实定时器），让所有写入落在同一毫秒。 */
  async function withFrozenClock<T>(run: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FROZEN_MS)
    try {
      return await run()
    } finally {
      vi.useRealTimers()
    }
  }

  /** 不读时钟的阻塞等待，冻结 Date 时仍可工作。 */
  async function waitForBlocked(expected: number): Promise<number> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const rows = await prismaA.$queryRawUnsafe<Array<{ blocked: number }>>(
        'SELECT count(*)::int AS blocked FROM pg_locks WHERE NOT granted',
      )
      const blocked = rows[0]?.blocked ?? 0
      if (blocked >= expected) return blocked
      await delay(20)
    }
    return 0
  }

  it('V1 同一毫秒：两个客户端读到同一版本后并发 UPDATE，只有一个成功', async () => {
    await withFrozenClock(async () => {
      const id = 'same-millisecond'
      await syncA.pushChanges(ctx.creatorId, {
        shares: [{ ...hostPayload({ id }), operation: 'CREATE' }],
      })
      const before = await prismaA.share.findUnique({ where: { id } })
      const versionV = Number(before!.version)
      // 前置条件：冻结时钟生效，行上的 updatedAt 就是这一毫秒
      expect(before!.updatedAt.getTime()).toBe(FROZEN_MS.getTime())

      const blocker = await connectRaw()
      await blocker.query('BEGIN')
      await blocker.query('SELECT 1 FROM "Share" WHERE id = $1 FOR UPDATE', [id])

      const attempt = (host: string, service: SyncService) => () =>
        service.pushChanges(ctx.creatorId, {
          shares: [
            {
              ...hostPayload({ id, data: { host } }),
              operation: 'UPDATE',
              baseVersion: versionV,
            },
          ],
        })
      const pending = Promise.all([
        attempt('client-one', syncA)(),
        attempt('client-two', syncB)(),
      ])
      const blocked = await waitForBlocked(2)
      await blocker.query('COMMIT')
      await blocker.end()
      const [first, second] = await pending

      const winners = [first, second].filter(result => result.updated.length === 1)
      const losers = [first, second].filter(result => result.conflicts.length === 1)
      const final = await prismaA.share.findUnique({ where: { id } })
      // 「稳定返回 conflict」：失败方用同一 baseVersion 重试仍然是 conflict
      const retry = await syncA.pushChanges(ctx.creatorId, {
        shares: [
          {
            ...hostPayload({ id, data: { host: 'client-two' } }),
            operation: 'UPDATE',
            baseVersion: versionV,
          },
        ],
      })

      console.log(
        `[V1] 阻塞写者=${blocked} 成功=${winners.length} 冲突=${losers.length} 最终version=${Number(final?.version)}（读到的版本=${versionV}）最终data=${JSON.stringify(final?.data)} 重试冲突=${JSON.stringify(retry.conflicts)} 最终updatedAt=${final?.updatedAt.toISOString()}`,
      )
      expect(blocked).toBeGreaterThanOrEqual(2)
      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)
      expect(losers[0].updated).toEqual([])
      expect(losers[0].errors).toEqual([])
      // 只有一次写入：版本只前进一格
      expect(Number(final?.version)).toBe(versionV + 1)
      expect(['{"host":"client-one"}', '{"host":"client-two"}']).toContain(
        JSON.stringify(final?.data),
      )
      expect(retry.conflicts).toEqual([id])
      expect(final?.updatedAt.getTime()).toBe(FROZEN_MS.getTime())
    })
  })

  it('V2 未来版本：baseVersion 大于当前版本必须拒绝', async () => {
    await withFrozenClock(async () => {
      const id = 'future-version'
      await syncA.pushChanges(ctx.creatorId, { shares: [{ ...hostPayload({ id }) }] })
      const versionV = await versionOf(id)

      const result = await syncB.pushChanges(ctx.creatorId, {
        shares: [
          {
            ...hostPayload({ id, data: { host: 'from-the-future' } }),
            operation: 'UPDATE',
            baseVersion: versionV + 100,
          },
        ],
      })
      const after = await prismaA.share.findUnique({ where: { id } })

      console.log(
        `[V2] 当前version=${versionV} 提交baseVersion=${versionV + 100} conflicts=${JSON.stringify(result.conflicts)} updated=${JSON.stringify(result.updated)} 最终version=${Number(after?.version)} 最终data=${JSON.stringify(after?.data)}`,
      )
      expect(result.conflicts).toEqual([id])
      expect(result.updated).toEqual([])
      expect(Number(after?.version)).toBe(versionV)
      expect(after?.data).toEqual({ host: 'v1' })
    })
  })

  it('V3 负数与非法 baseVersion：无法证明新鲜度，拒绝危险写入', async () => {
    const id = 'invalid-version'
    await syncA.pushChanges(ctx.creatorId, { shares: [{ ...hostPayload({ id }) }] })
    const versionV = await versionOf(id)

    const negative = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...hostPayload({ id, data: { host: 'negative' } }),
          operation: 'UPDATE',
          baseVersion: -1,
        },
      ],
    })
    const fractional = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...hostPayload({ id, data: { host: 'fractional' } }),
          operation: 'UPDATE',
          baseVersion: versionV + 0.5,
        },
      ],
    })
    const after = await prismaA.share.findUnique({ where: { id } })

    console.log(
      `[V3] 负数conflicts=${JSON.stringify(negative.conflicts)} 小数conflicts=${JSON.stringify(fractional.conflicts)} 最终data=${JSON.stringify(after?.data)}`,
    )
    expect(negative.conflicts).toEqual([id])
    expect(fractional.conflicts).toEqual([id])
    expect(after?.data).toEqual({ host: 'v1' })
  })

  it('V4 声明 UPDATE 但缺少 baseVersion：拒绝', async () => {
    const id = 'missing-version'
    await syncA.pushChanges(ctx.creatorId, { shares: [{ ...hostPayload({ id }) }] })
    const versionV = await versionOf(id)

    const result = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        { ...hostPayload({ id, data: { host: 'no-proof' } }), operation: 'UPDATE' },
      ],
    })
    const after = await prismaA.share.findUnique({ where: { id } })

    console.log(
      `[V4] conflicts=${JSON.stringify(result.conflicts)} 最终version=${Number(after?.version)}（原=${versionV}）最终data=${JSON.stringify(after?.data)}`,
    )
    expect(result.conflicts).toEqual([id])
    expect(Number(after?.version)).toBe(versionV)
    expect(after?.data).toEqual({ host: 'v1' })
  })

  it('V5 旧客户端时间戳作为 baseVersion：拒绝而不是比较毫秒', async () => {
    const id = 'legacy-timestamp'
    await syncA.pushChanges(ctx.creatorId, { shares: [{ ...hostPayload({ id })}] })
    const versionV = await versionOf(id)
    const row = await prismaA.share.findUnique({ where: { id } })

    const result = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...hostPayload({ id, data: { host: 'legacy' } }),
          operation: 'UPDATE',
          baseVersion: row!.updatedAt.getTime(),
        },
      ],
    })
    const after = await prismaA.share.findUnique({ where: { id } })

    console.log(
      `[V5] 时间戳baseVersion=${row!.updatedAt.getTime()} 服务端version=${versionV} conflicts=${JSON.stringify(result.conflicts)} 最终data=${JSON.stringify(after?.data)}`,
    )
    expect(result.conflicts).toEqual([id])
    expect(after?.data).toEqual({ host: 'v1' })
  })

  it('V6 重放版本：内容相同是幂等确认，不 bump 版本', async () => {
    const id = 'replay-version'
    await syncA.pushChanges(ctx.creatorId, { shares: [{ ...hostPayload({ id }) }] })
    const versionV = await versionOf(id)

    const replay = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...hostPayload({ id, data: { host: 'v1' } }),
          operation: 'UPDATE',
          baseVersion: versionV,
        },
      ],
    })
    const after = await prismaA.share.findUnique({ where: { id } })

    console.log(
      `[V6] 重放 updated=${JSON.stringify(replay.updated)} conflicts=${JSON.stringify(replay.conflicts)} 最终version=${Number(after?.version)}（原=${versionV}）`,
    )
    expect(replay.updated).toEqual([id])
    expect(Number(after?.version)).toBe(versionV)
  })

  it('V7 CREATE 命中已有 id 且内容不同：拒绝覆盖', async () => {
    const id = 'create-collision'
    await syncA.pushChanges(ctx.creatorId, {
      shares: [{ ...hostPayload({ id }), operation: 'CREATE' }],
    })
    const versionV = await versionOf(id)

    const collision = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...hostPayload({ id, data: { host: 'overwrite-attempt' } }),
          operation: 'CREATE',
        },
      ],
    })
    const idempotent = await syncB.pushChanges(ctx.creatorId, {
      shares: [{ ...hostPayload({ id }), operation: 'CREATE' }],
    })
    const after = await prismaA.share.findUnique({ where: { id } })

    console.log(
      `[V7] 内容不同 conflicts=${JSON.stringify(collision.conflicts)} 幂等确认 updated=${JSON.stringify(idempotent.updated)} 最终version=${Number(after?.version)}（原=${versionV}）最终data=${JSON.stringify(after?.data)}`,
    )
    expect(collision.conflicts).toEqual([id])
    expect(collision.updated).toEqual([])
    expect(idempotent.updated).toEqual([id])
    expect(Number(after?.version)).toBe(versionV)
    expect(after?.data).toEqual({ host: 'v1' })
  })

  it('V8 同一毫秒内连续 UPDATE：版本严格递增，充当唯一的次序判据', async () => {
    await withFrozenClock(async () => {
      const id = 'monotonic-version'
      await syncA.pushChanges(ctx.creatorId, { shares: [{ ...hostPayload({ id }) }] })
      const versions: number[] = [await versionOf(id)]
      for (const host of ['v2', 'v3', 'v4']) {
        const current = versions[versions.length - 1]
        const result = await syncB.pushChanges(ctx.creatorId, {
          shares: [
            {
              ...hostPayload({ id, data: { host } }),
              operation: 'UPDATE',
              baseVersion: current,
            },
          ],
        })
        expect(result.updated).toEqual([id])
        versions.push(await versionOf(id))
      }
      const row = await prismaA.share.findUnique({ where: { id } })

      console.log(
        `[V8] 版本序列=${JSON.stringify(versions)} 全部写入落在同一毫秒=${row!.updatedAt.getTime() === FROZEN_MS.getTime()} 最终data=${JSON.stringify(row?.data)}`,
      )
      expect(row!.updatedAt.getTime()).toBe(FROZEN_MS.getTime())
      expect(new Set(versions).size).toBe(versions.length)
      expect([...versions].sort((left, right) => left - right)).toEqual(versions)
      expect(row?.data).toEqual({ host: 'v4' })
    })
  })

  it('V9 DELETE 幂等且不可静默复活', async () => {
    const id = 'delete-contract'
    await syncA.pushChanges(ctx.creatorId, { shares: [{ ...hostPayload({ id }) }] })
    const versionV = await versionOf(id)

    const first = await syncB.pushChanges(ctx.creatorId, { deleteShares: [id] })
    const again = await syncB.pushChanges(ctx.creatorId, { deleteShares: [id] })
    const tombstones = await prismaA.syncChange.count({
      where: { shareId: id, op: 'DELETE' },
    })
    const resurrectStale = await syncB.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...hostPayload({ id, data: { host: 'resurrect' } }),
          operation: 'CREATE',
          baseVersion: versionV,
        },
      ],
    })
    const row = await prismaA.share.findUnique({ where: { id } })

    console.log(
      `[V9] 首次deleted=${JSON.stringify(first.deleted)} 重复deleted=${JSON.stringify(again.deleted)} 墓碑数=${tombstones} 旧版本复活conflicts=${JSON.stringify(resurrectStale.conflicts)} 行存在=${row !== null}`,
    )
    expect(first.deleted).toEqual([id])
    expect(again.deleted).toEqual([id])
    expect(tombstones).toBe(1)
    expect(resurrectStale.conflicts).toEqual([id])
    expect(row).toBeNull()
  })
})
