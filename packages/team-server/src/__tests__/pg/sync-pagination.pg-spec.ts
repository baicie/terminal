import type { Client } from 'pg'
import type { PrismaService } from '../../prisma.service'
import type { SeededTeam } from './pg-harness'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_FULL_DELIVERY_LIMIT } from '../../sync/sync-delivery'
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

  /** 一条 INSERT ... generate_series 即一个事务：全部行共享同一个 txid。 */
  async function bulkInsert(prefix: string, count: number): Promise<void> {
    const bulk = await connectRaw()
    await bulk.query('BEGIN')
    await bulk.query(
      `INSERT INTO "Share" (id, "teamId", type, data, "sharedBy", permission, "isSensitive", "createdAt", "updatedAt")
       SELECT $1 || g, $2, 'HOST', jsonb_build_object('host', $1 || g), $3, 'READONLY', false, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
         FROM generate_series(1, $4::int) AS g`,
      [prefix, ctx.teamId, ctx.creatorId, count],
    )
    await bulk.query('COMMIT')
    await bulk.end()
  }

  /** 手工构造协议 2 复合游标，用于伪造「库从备份恢复」后的越界游标。 */
  function v2Cursor(bound: bigint, txid: bigint, seq: bigint): string {
    return [
      '2',
      ...[bound, txid, seq].map(field => field.toString().padStart(20, '0')),
    ].join('.')
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

    const pages = await pullAll(undefined)
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

    const pages = await pullAll(undefined)
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

    const round1 = await pull(undefined)
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
    const first = await pull(undefined)
    const replay = await pullAll(undefined)
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
    const beforeDelete = await pull(undefined)

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

    const after = await pullAll(undefined)
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

    const pages = await pullAll(undefined)
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

  // Phase 9.0 P9.0-1：这条用例原本断言「首页 200 条 + 水位续拉 0 条」，
  // 等于把「剩下 10 条永久丢失」当成兼容成功。协议 1 的客户端只认数字 timestamp
  // 作为下一轮 since，无法翻页，所以它必须拿到完整窗口，或拿到明确的升级要求。
  it('P7 旧数字游标（协议 1）必须完整交付：210 条不得变成 200 条 + 空页', async () => {
    await bulkInsert('legacy-', 210)

    const first = await syncA.getChanges(ctx.creatorId, 0)
    const watermark = first.timestamp
    const resumed = await syncA.getChanges(ctx.creatorId, watermark)
    const firstIds = new Set(first.shares.map(share => share.id))

    console.log(
      `[P7] 旧游标完整交付=${firstIds.size} hasMore=${first.hasMore} upgradeRequired=${first.upgradeRequired} 水位游标=${watermark} 续拉条数=${resumed.shares.length} resync=${resumed.resync}`,
    )
    // 210 条必须一次交付完：既不是 200 条 + 空页，也不得截断后宣称还有更多。
    expect(firstIds.size).toBe(210)
    expect(first.hasMore).toBe(false)
    expect(first.upgradeRequired).toBe(false)
    expect(typeof watermark).toBe('number')
    // 完整交付之后，用同一水位续拉才允许是 0 条（此时确实没有遗漏）。
    expect(resumed.resync).toBe(false)
    expect(resumed.shares).toHaveLength(0)
  })

  // ---- Phase 9.0 P9.0-1：协议 1 的完整交付边界 ----

  it('L1 协议 1 边界扫描：199/200/201/210/5000 条都必须完整交付', async () => {
    const report: string[] = []
    for (const count of [199, 200, 201, 210, LEGACY_FULL_DELIVERY_LIMIT]) {
      await resetDatabase(prismaA)
      ctx = await seedTeams(prismaA)
      await bulkInsert(`boundary-${count}-`, count)
      const page = await syncA.getChanges(ctx.creatorId, 0)
      const ids = new Set(page.shares.map(share => share.id))
      report.push(
        `${count}->交付${ids.size}/hasMore=${page.hasMore}/upgradeRequired=${page.upgradeRequired}`,
      )
      expect(ids.size).toBe(count)
      expect(page.hasMore).toBe(false)
      expect(page.upgradeRequired).toBe(false)
      // 完整交付后同一水位续拉为空，才是「没有剩余」而不是「被截断」
      const resumed = await syncA.getChanges(ctx.creatorId, page.timestamp)
      expect(resumed.shares).toHaveLength(0)
    }
    console.log(`[L1] ${report.join(' | ')}`)
  })

  it('L2 超过完整交付上限：返回 upgradeRequired，不交付部分数据，水位不前进', async () => {
    const total = LEGACY_FULL_DELIVERY_LIMIT + 1
    await bulkInsert('over-limit-', total)

    const refused = await syncA.getChanges(ctx.creatorId, 0)
    console.log(
      `[L2] 记录数=${total} upgradeRequired=${refused.upgradeRequired} 交付条数=${refused.shares.length} hasMore=${refused.hasMore} 水位=${refused.timestamp} 需要协议=${refused.requiredCursorVersion}`,
    )
    expect(refused.upgradeRequired).toBe(true)
    expect(refused.shares).toHaveLength(0)
    expect(refused.deletedShareIds).toHaveLength(0)
    expect(refused.hasMore).toBe(false)
    expect(refused.requiredCursorVersion).toBe(2)
    // 水位不前进：忽略升级提示的旧客户端重放同一 since 只会拿到同一份拒绝，
    // 而不是「跳过这一万条、只看之后的增量」。
    expect(refused.timestamp).toBe(0)
    const replayed = await syncA.getChanges(ctx.creatorId, refused.timestamp)
    expect(replayed.upgradeRequired).toBe(true)
    expect(replayed.shares).toHaveLength(0)
    // 但数据一条没丢：协议 2 客户端可以翻页拿全。
    const pages = await pullAll(undefined, 40)
    expect(delivered(pages)).toHaveLength(total)
    expect(pages[pages.length - 1].hasMore).toBe(false)
  })

  it('L3 旧 epoch-ms 游标：降级为全量重同步，并在上限内一次完整交付', async () => {
    await bulkInsert('epoch-', 210)
    const epoch = Date.now()
    const resynced = await syncA.getChanges(ctx.creatorId, epoch)
    const ids = new Set(resynced.shares.map(share => share.id))

    console.log(
      `[L3] epoch游标=${epoch} 当前水位=${resynced.timestamp} resync=${resynced.resync} upgradeRequired=${resynced.upgradeRequired} 一次交付=${ids.size} hasMore=${resynced.hasMore}`,
    )
    expect(epoch).toBeGreaterThan(resynced.timestamp)
    expect(resynced.resync).toBe(true)
    expect(resynced.upgradeRequired).toBe(false)
    expect(ids.size).toBe(210)
    expect(resynced.hasMore).toBe(false)
  })

  it('L4 数据库从备份恢复：游标水位高于当前 safe 时一律全量重同步，且完整交付', async () => {
    await bulkInsert('restore-', 3)
    const probe = await syncA.getChanges(ctx.creatorId, undefined)
    expect(probe.shares).toHaveLength(3)
    const safe = BigInt(probe.timestamp)

    const composite = await syncA.getChanges(
      ctx.creatorId,
      v2Cursor(safe + 1_000_000n, safe, 0n),
    )
    const legacy = await syncA.getChanges(
      ctx.creatorId,
      Number(safe) + 1_000_000,
    )

    console.log(
      `[L4] safe=${safe} 复合越界: resync=${composite.resync} 交付=${composite.shares.length} | 数字越界: resync=${legacy.resync} 交付=${legacy.shares.length} upgradeRequired=${legacy.upgradeRequired}`,
    )
    for (const result of [composite, legacy]) {
      expect(result.resync).toBe(true)
      expect(new Set(result.shares.map(share => share.id)).size).toBe(3)
      expect(result.hasMore).toBe(false)
      expect(result.upgradeRequired).toBe(false)
    }
  })

  it('L5 历史客户端升级：协议 1 完整交付后切到复合游标只拿新增量', async () => {
    await bulkInsert('upgrade-', 210)
    const legacy = await syncA.getChanges(ctx.creatorId, 0)
    expect(new Set(legacy.shares.map(share => share.id)).size).toBe(210)

    await bulkInsert('upgrade-new-', 5)
    // 升级后的客户端改用响应里的不透明游标，不再用数字 timestamp
    const upgraded = await syncA.getChanges(ctx.creatorId, legacy.cursor)
    const fresh = upgraded.shares.map(share => share.id).sort()

    console.log(
      `[L5] 协议1一次交付=${legacy.shares.length} 升级后续拉=${fresh.length} 内容=${fresh.join(',')} resync=${upgraded.resync}`,
    )
    expect(upgraded.resync).toBe(false)
    expect(upgraded.hasMore).toBe(false)
    expect(fresh).toEqual([
      'upgrade-new-1',
      'upgrade-new-2',
      'upgrade-new-3',
      'upgrade-new-4',
      'upgrade-new-5',
    ])
  })

  // ---- Phase 9.0 P9.0-3：旧客户端危险写入（docs/issue.md #63） ----

  function sharePayload(overrides: Record<string, unknown> = {}) {
    return {
      id: 'legacy-write-1',
      teamId: ctx.teamId,
      type: 'HOST' as const,
      data: { host: 'v1' },
      permission: 'READONLY' as const,
      ...overrides,
    }
  }

  async function dataOf(id: string) {
    return prismaA.share.findUnique({ where: { id } })
  }

  it('W1 旧客户端串行覆盖新版客户端：没有版本证明的写入必须被拒绝', async () => {
    const id = 'legacy-serial-overwrite'
    await syncA.pushChanges(ctx.creatorId, {
      shares: [{ ...sharePayload({ id }), operation: 'CREATE' }],
    })
    const readVersion = Number((await dataOf(id))?.version)
    // 新版客户端用服务端版本证明写入较新内容
    const newer = await syncA.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...sharePayload({ id, data: { host: 'a-newer' } }),
          operation: 'UPDATE',
          baseVersion: readVersion,
        },
      ],
    })
    expect(newer.updated).toEqual([id])
    const afterNewer = Number((await dataOf(id))?.version)

    // 旧客户端随后推送它那份更旧的副本：没有 operation，也没有 baseVersion
    const legacy = await syncA.pushChanges(ctx.creatorId, {
      shares: [sharePayload({ id, data: { host: 'b-stale' } })],
    })
    const row = await dataOf(id)

    console.log(
      `[W1] 新版updated=${JSON.stringify(newer.updated)} 版本${readVersion}->${afterNewer} 旧写入updated=${JSON.stringify(legacy.updated)} conflicts=${JSON.stringify(legacy.conflicts)} upgradeRequired=${legacy.upgradeRequired} 最终data=${JSON.stringify(row?.data)} 最终version=${Number(row?.version)}`,
    )
    expect(legacy.updated).toEqual([])
    expect(legacy.conflicts).toEqual([id])
    expect(legacy.upgradeRequired).toBe(true)
    expect(row?.data).toEqual({ host: 'a-newer' })
    expect(Number(row?.version)).toBe(afterNewer)
  })

  it('W2 旧客户端 CREATE 重放：内容一致才是幂等确认，内容不同一律拒绝', async () => {
    const id = 'legacy-create-replay'
    const created = await syncA.pushChanges(ctx.creatorId, {
      shares: [sharePayload({ id })],
    })
    expect(created.created).toEqual([id])
    const before = Number((await dataOf(id))?.version)

    const replay = await syncA.pushChanges(ctx.creatorId, {
      shares: [sharePayload({ id })],
    })
    const divergent = await syncA.pushChanges(ctx.creatorId, {
      shares: [sharePayload({ id, data: { host: 'overwrite' } })],
    })
    const row = await dataOf(id)

    console.log(
      `[W2] 创建updated=${JSON.stringify(created.created)} 重放updated=${JSON.stringify(replay.updated)} conflicts=${JSON.stringify(replay.conflicts)} 版本${before}->${Number(row?.version)} 内容不同conflicts=${JSON.stringify(divergent.conflicts)} upgradeRequired=${divergent.upgradeRequired} 最终data=${JSON.stringify(row?.data)}`,
    )
    expect(replay.updated).toEqual([id])
    expect(replay.conflicts).toEqual([])
    expect(Number(row?.version)).toBe(before)
    expect(divergent.updated).toEqual([])
    expect(divergent.conflicts).toEqual([id])
    expect(divergent.upgradeRequired).toBe(true)
    expect(row?.data).toEqual({ host: 'v1' })
  })

  it('W3 旧客户端写入不得静默复活已删除共享（墓碑需要版本证明）', async () => {
    const id = 'legacy-resurrect'
    await syncA.pushChanges(ctx.creatorId, {
      shares: [{ ...sharePayload({ id }), operation: 'CREATE' }],
    })
    const removed = await syncA.pushChanges(ctx.creatorId, {
      deleteShares: [id],
    })
    expect(removed.deleted).toEqual([id])

    const legacy = await syncA.pushChanges(ctx.creatorId, {
      shares: [sharePayload({ id, data: { host: 'zombie' } })],
    })
    const row = await dataOf(id)

    console.log(
      `[W3] 墓碑写入deleted=${JSON.stringify(removed.deleted)} 旧写入created=${JSON.stringify(legacy.created)} conflicts=${JSON.stringify(legacy.conflicts)} upgradeRequired=${legacy.upgradeRequired} 行存在=${row !== null}`,
    )
    expect(legacy.created).toEqual([])
    expect(legacy.conflicts).toEqual([id])
    expect(legacy.upgradeRequired).toBe(true)
    expect(row).toBeNull()
  })

  it('W4 冲突解决 LOCAL：携带的版本证明过期时必须拒绝，不得无条件覆盖', async () => {
    const id = 'resolve-version-proof'
    await syncA.pushChanges(ctx.creatorId, {
      shares: [{ ...sharePayload({ id }), operation: 'CREATE' }],
    })
    const stale = Number((await dataOf(id))?.version)
    await syncA.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...sharePayload({ id, data: { host: 'a-newer' } }),
          operation: 'UPDATE',
          baseVersion: stale,
        },
      ],
    })
    const current = Number((await dataOf(id))?.version)

    const refused = await syncA.resolveConflict(id, ctx.creatorId, 'LOCAL', {
      data: { host: 'local-stale' },
      isSensitive: false,
      baseVersion: stale,
    })
    const row = await dataOf(id)

    console.log(
      `[W4] 提交版本=${stale} 当前版本=${current} success=${refused.success} error=${String(refused.error)} 最终data=${JSON.stringify(row?.data)} 最终version=${Number(row?.version)}`,
    )
    expect(refused.success).toBe(false)
    expect(refused.error).toBe('CONFLICT_STALE_VERSION')
    expect(row?.data).toEqual({ host: 'a-newer' })
    expect(Number(row?.version)).toBe(current)
  })
})
