import type { Client } from 'pg'
import type { PrismaService } from '../../prisma.service'
import type { SeededTeam } from './pg-harness'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SyncService } from '../../sync/sync.service'
import { connectRaw, createPrisma, resetDatabase, seedTeams } from './pg-harness'

// Phase 8.9 Task 1：分页正确性（真实 PostgreSQL，不 mock Prisma）。
// 游标在用例里被当作不透明值：回传给 getChanges 时原样透传，因此同一份用例
// 既能跑出旧实现的反例，也能验证新实现。
const PAGE = 200

describe('sync 增量分页正确性（真实 PostgreSQL）', () => {
  let prismaA: PrismaService
  let prismaB: PrismaService
  let syncA: SyncService
  let ctx: SeededTeam

  beforeAll(() => {
    prismaA = createPrisma()
    prismaB = createPrisma()
    syncA = new SyncService(prismaA)
  })

  afterAll(async () => {
    await prismaA.onModuleDestroy()
    await prismaB.onModuleDestroy()
  })

  beforeEach(async () => {
    await resetDatabase(prismaA)
    ctx = await seedTeams(prismaA)
  })

  async function insertShare(
    client: Client,
    id: string,
    data: Record<string, unknown> = { host: id },
  ): Promise<void> {
    await client.query(
      `INSERT INTO "Share" (id, "teamId", type, data, "sharedBy", permission, "isSensitive", "createdAt", "updatedAt")
       VALUES ($1, $2, 'HOST', $3, $4, 'READONLY', false, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')`,
      [id, ctx.teamId, JSON.stringify(data), ctx.creatorId],
    )
  }

  type PullCursor = Parameters<SyncService['getChanges']>[1]
  interface Page {
    cursor: unknown
    hasMore: boolean | undefined
    shares: string[]
    deleted: string[]
  }

  async function pull(cursor: unknown): Promise<Page> {
    const result = await syncA.getChanges(ctx.creatorId, cursor as PullCursor)
    return {
      cursor: result.cursor,
      hasMore: (result as { hasMore?: boolean }).hasMore,
      shares: result.shares.map(share => share.id),
      deleted: result.deletedShareIds,
    }
  }

  /** 从游标开始连续分页，直到服务端表示「已到终点」或游标不再前进。 */
  async function pullAll(start: unknown, maxPages = 8): Promise<Page[]> {
    const pages: Page[] = []
    let cursor: unknown = start
    let previous: string | null = null
    for (let round = 0; round < maxPages; round++) {
      const page = await pull(cursor)
      pages.push(page)
      if (page.hasMore === false) break
      const stamp = String(page.cursor)
      if (stamp === previous) break
      previous = stamp
      cursor = page.cursor
    }
    return pages
  }

  function delivered(pages: Page[]): string[] {
    return [...new Set(pages.flatMap(page => page.shares))]
  }

  it('P1 反例 A：txid 与 seq 逆序时，页边界之后的记录不得被永久跳过', async () => {
    // 事务 A 先分配 txid 与最小 seq，但最后提交；事务 B 的 txid 更大、seq 全在中间。
    // 于是按 seq 排序时 A 的记录分布在页边界两侧，按 txid 过滤会永久漏掉 A 的尾部。
    const late = await connectRaw()
    const bulk = await connectRaw()
    await late.query('BEGIN')
    await insertShare(late, 'order-late-head')
    await bulk.query('BEGIN')
    for (let i = 0; i < PAGE; i++) await insertShare(bulk, `order-bulk-${i}`)
    await bulk.query('COMMIT')
    await bulk.end()
    for (let i = 0; i < PAGE - 1; i++) await insertShare(late, `order-late-tail-${i}`)
    await late.query('COMMIT')
    await late.end()

    const rows = await prismaA.syncChange.findMany({
      where: { shareId: { in: ['order-late-head', 'order-bulk-0', 'order-late-tail-0'] } },
      select: { shareId: true, seq: true, txid: true },
    })
    const pick = (id: string) => rows.find(row => row.shareId === id)!
    const head = pick('order-late-head')
    const bulkFirst = pick('order-bulk-0')
    const tail = pick('order-late-tail-0')
    console.log(
      `[P1] seq(head)=${head.seq} seq(bulk)=${bulkFirst.seq} seq(tail)=${tail.seq} txid(late)=${head.txid} txid(bulk)=${bulkFirst.txid}`,
    )
    // 前置条件：seq 顺序与 txid 顺序相反
    expect(head.seq).toBeLessThan(bulkFirst.seq)
    expect(bulkFirst.seq).toBeLessThan(tail.seq)
    expect(head.txid).toBe(tail.txid)
    expect(head.txid).toBeLessThan(bulkFirst.txid)

    const pages = await pullAll(0)
    const ids = delivered(pages)
    console.log(
      `[P1] 页数=${pages.length} 每页条数=${JSON.stringify(pages.map(page => page.shares.length))} 去重后交付=${ids.length}`,
    )
    expect(ids).toHaveLength(2 * PAGE)
    expect(ids).toContain('order-late-tail-0')
    // 无无限重复页：相邻两页不得是同一批 id
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i].shares).not.toEqual(pages[i - 1].shares)
    }
    expect(pages.length).toBeLessThanOrEqual(3)
  })

  it('P2 反例 B：单事务写入 250 条时必须能从第一页推进到后续页并交付全部', async () => {
    const bulk = await connectRaw()
    await bulk.query('BEGIN')
    for (let i = 0; i < 250; i++) await insertShare(bulk, `single-tx-${i}`)
    await bulk.query('COMMIT')
    await bulk.end()

    const txids = await prismaA.syncChange.findMany({
      where: { shareId: { startsWith: 'single-tx-' } },
      select: { txid: true },
    })
    expect(new Set(txids.map(row => row.txid.toString())).size).toBe(1)

    const pages = await pullAll(0)
    const ids = delivered(pages)
    console.log(
      `[P2] 同一事务变更行=${txids.length} 页数=${pages.length} 每页条数=${JSON.stringify(pages.map(page => page.shares.length))} 去重后交付=${ids.length}`,
    )
    expect(ids).toHaveLength(250)
    expect(pages.map(page => page.shares.length)).toEqual([200, 50])
    expect(pages[pages.length - 1].hasMore).toBe(false)
  })

  it('P3 提交顺序与 seq 不同：晚提交的事务不得被游标跳过', async () => {
    const late = await connectRaw()
    const early = await connectRaw()
    await late.query('BEGIN')
    for (let i = 0; i < 120; i++) await insertShare(late, `commit-late-${i}`)
    await early.query('BEGIN')
    for (let i = 0; i < 130; i++) await insertShare(early, `commit-early-${i}`)
    await early.query('COMMIT')
    await early.end()

    const round1 = await pull(0)
    await late.query('COMMIT')
    await late.end()
    const later = await pullAll(round1.cursor)
    const both = [
      ...new Set([...round1.shares, ...later.flatMap(page => page.shares)]),
    ]

    console.log(
      `[P3] 第一轮=${round1.shares.length} 后续=${JSON.stringify(later.map(page => page.shares.length))} 合计去重=${both.length} 首轮游标=${String(round1.cursor)}`,
    )
    expect(round1.shares).not.toContain('commit-late-0')
    expect(both).toContain('commit-late-0')
    expect(both).toContain('commit-early-0')
    expect(both).toHaveLength(250)
  })

  it('P4 客户端中断后重放：重放较早游标不得漏，收敛后仍交付全部', async () => {
    const bulk = await connectRaw()
    await bulk.query('BEGIN')
    for (let i = 0; i < 450; i++) await insertShare(bulk, `replay-${i}`)
    await bulk.query('COMMIT')
    await bulk.end()

    // 客户端拿到第一页后崩溃，游标没有落盘，重放时又从头开始
    const first = await pull(0)
    const replay = await pullAll(0)
    const ids = delivered(replay)

    console.log(
      `[P4] 首页=${first.shares.length} 重放页数=${replay.length} 去重后交付=${ids.length}`,
    )
    expect(first.shares).toHaveLength(PAGE)
    expect(ids).toHaveLength(450)
    expect(ids).toContain('replay-449')
  })

  it('P5 同一 share 多次更新与删除：交付顺序给出最终状态，不复活', async () => {
    const create = await connectRaw()
    await create.query('BEGIN')
    await insertShare(create, 'lifecycle-1', { host: 'v1' })
    await create.query('COMMIT')
    await create.end()
    const beforeDelete = await pull(0)

    const update = await connectRaw()
    await update.query('BEGIN')
    await update.query(`UPDATE "Share" SET data = $1 WHERE id = $2`, [
      JSON.stringify({ host: 'v2' }),
      'lifecycle-1',
    ])
    await update.query('COMMIT')
    await update.end()

    const remove = await connectRaw()
    await remove.query('BEGIN')
    await remove.query(`DELETE FROM "Share" WHERE id = $1`, ['lifecycle-1'])
    await remove.query('COMMIT')
    await remove.end()

    const after = await pullAll(0)
    const operations = await prismaA.syncChange.findMany({
      where: { shareId: 'lifecycle-1' },
      orderBy: { seq: 'asc' },
      select: { op: true },
    })
    console.log(
      `[P5] 变更序列=${operations.map(row => row.op).join(',')} 删除前=${JSON.stringify(beforeDelete.shares)} 最终 shares=${JSON.stringify(after.flatMap(page => page.shares))} 最终 deleted=${JSON.stringify(after.flatMap(page => page.deleted))}`,
    )
    expect(operations.map(row => row.op)).toEqual(['UPSERT', 'UPSERT', 'DELETE'])
    expect(beforeDelete.shares).toEqual(['lifecycle-1'])
    expect(delivered(after)).not.toContain('lifecycle-1')
    expect(after.flatMap(page => page.deleted)).toContain('lifecycle-1')
  })

  it('P6 每次分页前进或明确到达终点', async () => {
    const bulk = await connectRaw()
    await bulk.query('BEGIN')
    for (let i = 0; i < 450; i++) await insertShare(bulk, `progress-${i}`)
    await bulk.query('COMMIT')
    await bulk.end()

    const pages = await pullAll(0)
    const stamps = pages.map(page => String(page.cursor))
    console.log(
      `[P6] 页数=${pages.length} 每页条数=${JSON.stringify(pages.map(page => page.shares.length))} hasMore=${JSON.stringify(pages.map(page => page.hasMore))}`,
    )
    expect(pages.map(page => page.shares.length)).toEqual([200, 200, 50])
    // 每页都严格前进，且最后一页明确表示终点
    expect(new Set(stamps).size).toBe(pages.length)
    expect(pages.slice(0, -1).every(page => page.hasMore !== false)).toBe(true)
    expect(pages[pages.length - 1].hasMore).toBe(false)
  })

  it('P7 旧数字游标（单一水位）仍然兼容：不触发重同步也不跳过', async () => {
    const bulk = await connectRaw()
    await bulk.query('BEGIN')
    for (let i = 0; i < 210; i++) await insertShare(bulk, `legacy-${i}`)
    await bulk.query('COMMIT')
    await bulk.end()

    const first = await syncA.getChanges(ctx.creatorId, 0)
    const watermark = first.timestamp
    const resumed = await syncA.getChanges(ctx.creatorId, watermark)

    console.log(
      `[P7] 首页=${first.shares.length} hasMore=${first.hasMore} 水位游标=${watermark} resync=${resumed.resync} 增量条数=${resumed.shares.length}`,
    )
    expect(first.shares).toHaveLength(PAGE)
    expect(first.hasMore).toBe(true)
    expect(typeof watermark).toBe('number')
    expect(resumed.resync).toBe(false)
    expect(resumed.shares).toHaveLength(0)
  })
})
