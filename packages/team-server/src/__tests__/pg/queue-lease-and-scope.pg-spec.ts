import type { PrismaService } from '../../prisma.service'
import type { SeededTeam } from './pg-harness'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SharesService } from '../../shares/shares.service'
import { SyncService } from '../../sync/sync.service'
import { createPrisma, resetDatabase, seedTeams } from './pg-harness'

// 离线队列租约（processingToken）与写入边界：真实 PostgreSQL，不 mock Prisma。
describe('SyncQueue 租约与写入边界（真实 PostgreSQL）', () => {
  let prismaA: PrismaService
  let prismaB: PrismaService
  let syncA: SyncService
  let syncB: SyncService
  let sharesB: SharesService
  let ctx: SeededTeam

  beforeAll(() => {
    prismaA = createPrisma()
    prismaB = createPrisma()
    syncA = new SyncService(prismaA)
    syncB = new SyncService(prismaB)
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

  function queuedHost(shareId: string) {
    return {
      id: shareId,
      teamId: ctx.teamId,
      type: 'HOST',
      data: { host: shareId },
      permission: 'READONLY',
    }
  }

  async function enqueue(shareId: string) {
    return syncA.enqueueOfflineOperation(
      ctx.creatorId,
      ctx.teamId,
      'CREATE',
      'HOST',
      shareId,
      queuedHost(shareId),
    )
  }

  async function parkQueueRow(
    queueId: string,
    token: string,
    minutesAgo: number,
  ) {
    await prismaA.$executeRawUnsafe(
      // Prisma 把 timestamp without time zone 当作 UTC 读取，这里必须写 UTC 墙钟时间
      `UPDATE "SyncQueue" SET "status" = 'PROCESSING', "processingToken" = $1, "updatedAt" = (NOW() AT TIME ZONE 'UTC') - ($2 || ' minutes')::interval WHERE "id" = $3`,
      token,
      String(minutesAgo),
      queueId,
    )
  }

  it('B1 过期租约（>15 分钟）被回收并重新认领完成', async () => {
    const enqueued = await enqueue('queue-lease-expired')
    await parkQueueRow(enqueued.id, 'dead-lease', 16)

    // 另一个进程（prismaB）接手处理，它并不知道 'dead-lease' 是谁的
    const result = await syncB.processOfflineQueue(ctx.creatorId)
    const row = await prismaA.syncQueue.findUnique({
      where: { id: enqueued.id },
    })
    const share = await prismaA.share.findUnique({
      where: { id: 'queue-lease-expired' },
    })

    console.log(
      `[B1] processed=${result.processed} succeeded=${result.succeeded} status=${row?.status} attempts=${row?.attempts} token=${row?.processingToken} share=${share !== null}`,
    )
    expect(result.processed).toBe(1)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(row?.status).toBe('COMPLETED')
    expect(row?.attempts).toBe(1)
    expect(row?.processingToken).toBeNull()
    expect(share).not.toBeNull()
  })

  it('B1b 未过期的租约不被抢占：其它处理器空转', async () => {
    const enqueued = await enqueue('queue-lease-live')
    await parkQueueRow(enqueued.id, 'live-lease', 5)

    const result = await syncB.processOfflineQueue(ctx.creatorId)
    const row = await prismaA.syncQueue.findUnique({
      where: { id: enqueued.id },
    })
    const share = await prismaA.share.findUnique({
      where: { id: 'queue-lease-live' },
    })

    console.log(
      `[B1b] processed=${result.processed} status=${row?.status} token=${row?.processingToken} share=${share !== null}`,
    )
    expect(result.processed).toBe(0)
    expect(row?.status).toBe('PROCESSING')
    expect(row?.processingToken).toBe('live-lease')
    expect(share).toBeNull()
  })

  it('B2 两个处理器并发跑同一队列：每个任务只被认领一次', async () => {
    const shareIds = ['queue-c1', 'queue-c2', 'queue-c3', 'queue-c4']
    const queueIds: string[] = []
    for (const shareId of shareIds) {
      queueIds.push((await enqueue(shareId)).id)
    }

    const [first, second] = await Promise.all([
      syncA.processOfflineQueue(ctx.creatorId),
      syncB.processOfflineQueue(ctx.creatorId),
    ])
    const rows = await prismaA.syncQueue.findMany({
      where: { id: { in: queueIds } },
    })
    const shares = await prismaA.share.count({
      where: { id: { in: shareIds } },
    })
    const processedTotal = first.processed + second.processed
    const succeededTotal = first.succeeded + second.succeeded

    console.log(
      `[B2] processed 合计=${processedTotal} succeeded 合计=${succeededTotal} failed 合计=${first.failed + second.failed} 共享行=${shares} 全部 attempts=1 且 COMPLETED=${rows.every(row => row.attempts === 1 && row.status === 'COMPLETED')}`,
    )
    expect(processedTotal).toBe(4)
    expect(succeededTotal).toBe(4)
    expect(first.failed + second.failed).toBe(0)
    expect(shares).toBe(4)
    expect(
      rows.every(row => row.attempts === 1 && row.status === 'COMPLETED'),
    ).toBe(true)
  })

  it('B3 被取消（移出队列）的任务不会再被处理', async () => {
    const cancelled = await enqueue('queue-cancelled')
    await enqueue('queue-kept')
    await syncA.removeFromQueue(cancelled.id, ctx.creatorId)

    const result = await syncA.processOfflineQueue(ctx.creatorId)
    const cancelledShare = await prismaA.share.findUnique({
      where: { id: 'queue-cancelled' },
    })
    const keptShare = await prismaA.share.findUnique({
      where: { id: 'queue-kept' },
    })
    const cancelledRow = await prismaA.syncQueue.findUnique({
      where: { id: cancelled.id },
    })

    console.log(
      `[B3] processed=${result.processed} 取消项共享=${cancelledShare !== null} 取消项队列行=${cancelledRow === null ? 'null' : 'present'} 保留项共享=${keptShare !== null}`,
    )
    expect(result.processed).toBe(1)
    expect(result.succeeded).toBe(1)
    expect(cancelledShare).toBeNull()
    expect(cancelledRow).toBeNull()
    expect(keptShare).not.toBeNull()
  })

  it('B4 第三次失败进入终态 FAILED 后不再被处理器占用', async () => {
    // 队列里的 CREATE 与服务端已存在的同 id 共享冲突
    await prismaA.share.create({
      data: {
        id: 'queue-terminal',
        teamId: ctx.teamId,
        type: 'HOST',
        data: { host: 'existing-server-copy' },
        sharedBy: ctx.creatorId,
        permission: 'READONLY',
      },
    })
    const enqueued = await enqueue('queue-terminal')

    const runs: number[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      runs.push((await syncA.processOfflineQueue(ctx.creatorId)).failed)
    }
    const terminal = await prismaA.syncQueue.findUnique({
      where: { id: enqueued.id },
    })
    const afterTerminal = await syncA.processOfflineQueue(ctx.creatorId)
    const untouched = await prismaA.share.findUnique({
      where: { id: 'queue-terminal' },
    })

    console.log(
      `[B4] 三次 failed=${JSON.stringify(runs)} status=${terminal?.status} attempts=${terminal?.attempts} lastError=${terminal?.lastError} 再跑 processed=${afterTerminal.processed} 既有共享 data=${JSON.stringify(untouched?.data)}`,
    )
    expect(runs).toEqual([1, 1, 1])
    expect(terminal?.status).toBe('FAILED')
    expect(terminal?.attempts).toBe(3)
    expect(terminal?.lastError).toBe('SYNC_OPERATION_FAILED')
    expect(afterTerminal.processed).toBe(0)
    expect(untouched?.data).toEqual({ host: 'existing-server-copy' })
  })

  it('B5 非 creator 无法改写 permission / isSensitive，READONLY 共享直接拒绝', async () => {
    await prismaA.share.create({
      data: {
        id: 'share-frozen',
        teamId: ctx.teamId,
        type: 'HOST',
        data: { host: 'creator-v1' },
        sharedBy: ctx.creatorId,
        permission: 'READWRITE',
        isSensitive: false,
      },
    })
    // Phase 9.0：写入必须携带版本证明，否则会被 fail-closed 拒绝（#63）。
    // 这里要验证的是「成员改不了 permission / isSensitive」，因此按协议 2 声明意图。
    const frozenVersion = Number(
      (await prismaA.share.findUnique({
        where: { id: 'share-frozen' },
        select: { version: true },
      }))?.version,
    )
    const frozenResult = await syncA.pushChanges(ctx.memberId, {
      shares: [
        {
          id: 'share-frozen',
          teamId: ctx.teamId,
          type: 'HOST',
          data: { host: 'member-write' },
          permission: 'READONLY',
          isSensitive: true,
          encryptedData: 'cipher-from-member',
          operation: 'UPDATE',
          baseVersion: frozenVersion,
        },
      ],
    })
    const frozen = await prismaA.share.findUnique({
      where: { id: 'share-frozen' },
    })

    await prismaA.share.create({
      data: {
        id: 'share-readonly',
        teamId: ctx.teamId,
        type: 'HOST',
        data: { host: 'readonly-v1' },
        sharedBy: ctx.creatorId,
        permission: 'READONLY',
      },
    })
    const readonlyPush = await syncA.pushChanges(ctx.memberId, {
      shares: [
        {
          id: 'share-readonly',
          teamId: ctx.teamId,
          type: 'HOST',
          data: { host: 'member-hijack' },
          permission: 'READONLY',
        },
      ],
    })
    await expect(
      sharesB.update(ctx.teamId, 'share-readonly', ctx.memberId, {
        data: { host: 'member-rest-hijack' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    const readonlyShare = await prismaA.share.findUnique({
      where: { id: 'share-readonly' },
    })

    console.log(
      `[B5] READWRITE 成员写入后 permission=${frozen?.permission} isSensitive=${frozen?.isSensitive} encryptedData=${frozen?.encryptedData} data=${JSON.stringify(frozen?.data)}；READONLY 推送 errors=${JSON.stringify(readonlyPush.errors)} data=${JSON.stringify(readonlyShare?.data)}`,
    )
    expect(frozenResult.updated).toEqual(['share-frozen'])
    expect(frozen?.permission).toBe('READWRITE')
    expect(frozen?.isSensitive).toBe(false)
    expect(frozen?.encryptedData).toBeNull()
    expect(frozen?.data).toEqual({ host: 'member-write' })
    expect(readonlyPush.errors).toEqual([
      { id: 'share-readonly', error: 'Only creator can update share' },
    ])
    expect(readonlyShare?.data).toEqual({ host: 'readonly-v1' })
  })

  it('B6 跨 team 读取返回 404 而不是 403，跨 team 推送不得改动资源', async () => {
    await prismaA.share.create({
      data: {
        id: 'share-team-a',
        teamId: ctx.teamId,
        type: 'HOST',
        data: { host: 'team-a-only' },
        sharedBy: ctx.creatorId,
        permission: 'READONLY',
      },
    })

    // 团队内成员越 team 访问：先过成员校验，再按 (id, teamId) 查不到 → 404，不泄露存在性
    await expect(
      sharesB.findOne(ctx.otherTeamId, 'share-team-a', ctx.outsiderId),
    ).rejects.toBeInstanceOf(NotFoundException)
    // 非成员访问 team A：403，资源信息无从谈起
    await expect(
      sharesB.findOne(ctx.teamId, 'share-team-a', ctx.outsiderId),
    ).rejects.toBeInstanceOf(ForbiddenException)

    const crossPush = await syncB.pushChanges(ctx.outsiderId, {
      shares: [
        {
          id: 'share-team-a',
          teamId: ctx.otherTeamId,
          type: 'HOST',
          data: { host: 'hijack' },
          permission: 'READWRITE',
        },
      ],
    })
    const after = await prismaA.share.findUnique({
      where: { id: 'share-team-a' },
    })

    console.log(
      `[B6] 跨团队成员读取=404 非成员读取=403 跨 team 推送 errors=${JSON.stringify(crossPush.errors)} 资源 teamId 未变=${after?.teamId === ctx.teamId} data=${JSON.stringify(after?.data)}`,
    )
    expect(crossPush.created).toEqual([])
    expect(crossPush.updated).toEqual([])
    expect(crossPush.errors).toEqual([
      { id: 'share-team-a', error: 'Share does not belong to the requested team' },
    ])
    expect(after?.teamId).toBe(ctx.teamId)
    expect(after?.data).toEqual({ host: 'team-a-only' })
  })
})
