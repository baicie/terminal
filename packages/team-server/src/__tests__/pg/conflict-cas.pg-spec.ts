import type { PrismaService } from '../../prisma.service'
import type { SeededTeam } from './pg-harness'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SyncService } from '../../sync/sync.service'
import { createPrisma, resetDatabase, seedTeams } from './pg-harness'

// Phase 9.2 P9.2-1：LOCAL 冲突解决的 CAS 绕过。
//
// 服务端旧实现在 resolveConflict(LOCAL) 里用
//     where: { id: shareId, version: clientData.baseVersion ?? share.version }
// 当客户端不提交 baseVersion 时，它拿**本次请求刚读到的 share.version** 当条件。
// 那不是用户作出选择时看到的版本，而是一个永远成立的条件：任何不认识 baseVersion
// 的客户端都能无条件覆盖别人在这期间提交的更新，且版本仍然递增，看起来"成功"。
//
// 本文件全部使用真实 PostgreSQL 与真实 SyncService，不 mock Prisma。

describe('P9.2-1 LOCAL 冲突解决的 CAS 绕过（真实 PostgreSQL）', () => {
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

  function hostPayload(overrides: Record<string, unknown> = {}) {
    return {
      id: 'cas-bypass-1',
      teamId: ctx.teamId,
      type: 'HOST' as const,
      data: { host: 'v1' },
      permission: 'READONLY' as const,
      ...overrides,
    }
  }

  async function serverRow(id: string) {
    return prisma.share.findUnique({ where: { id } })
  }

  async function versionOf(id: string): Promise<number> {
    return Number((await serverRow(id))?.version)
  }

  /** 客户端 A 创建并让服务端分配版本，返回 A 看到的版本。 */
  async function createAt(id: string, data: unknown): Promise<number> {
    const result = await service.pushChanges(ctx.creatorId, {
      shares: [{ ...hostPayload({ id, data }), operation: 'CREATE' }],
    })
    expect(result.created).toEqual([id])
    return versionOf(id)
  }

  it('回归：不提交 baseVersion 时，LOCAL 不得覆盖期间发生的远端更新', async () => {
    const id = 'cas-bypass-repro'
    const vA = await createAt(id, { host: 'A-original' })

    // 客户端 A 在此时读到 vA（用户作出选择时所依据的版本）。
    const seenByA = vA

    // 客户端 B 修改同一条记录：服务端版本推进到 vA + 1。
    const pushByB = await service.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...hostPayload({ id, data: { host: 'B-updated' } }),
          operation: 'UPDATE',
          baseVersion: vA,
        },
      ],
    })
    expect(pushByB.updated).toEqual([id])
    const vB = await versionOf(id)
    expect(vB).toBeGreaterThan(seenByA)

    // 客户端 A 基于它看到的 seenByA 选择 LOCAL，但**不提交 baseVersion**。
    const resolved = await service.resolveConflict(
      id,
      ctx.creatorId,
      'LOCAL',
      { data: { host: 'A-local-wins' }, isSensitive: false },
    )

    const after = await serverRow(id)
    console.log(
      `[P9.2-1] A看到=${seenByA} B写入后=${vB} resolve结果=${JSON.stringify(resolved)} 最终version=${after?.version} 最终data=${JSON.stringify(after?.data)}`,
    )

    // 修复后的契约：无 baseVersion 即拒绝，B 的更新与版本都不变。
    // 修复前这里返回 success=true 并把 B 的更新覆盖成 A-local-wins。
    expect(resolved.success).toBe(false)
    expect(resolved.error).toBe('BASE_VERSION_REQUIRED')
    expect(Number(after?.version)).toBe(vB)
    expect(after?.data).toEqual({ host: 'B-updated' })
  })

  it('回归：缺少 baseVersion 时服务端不得自行用本次读取的版本代替', async () => {
    const id = 'cas-bypass-missing-base'
    const vA = await createAt(id, { host: 'A-original' })
    await service.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...hostPayload({ id, data: { host: 'B-updated' } }),
          operation: 'UPDATE',
          baseVersion: vA,
        },
      ],
    })
    const vB = await versionOf(id)

    const resolved = await service.resolveConflict(
      id,
      ctx.creatorId,
      'LOCAL',
      { data: { host: 'A-no-base' }, isSensitive: false },
    )
    const after = await serverRow(id)

    console.log(
      `[P9.2-1/missing] 无baseVersion时=${JSON.stringify(resolved)} 版本 ${vB} -> ${after?.version} data=${JSON.stringify(after?.data)}`,
    )
    // 契约：无有效 baseVersion 必须拒绝写入，且远端版本、内容、密文均不变。
    expect(resolved.success).toBe(false)
    expect(resolved.error).toBe('BASE_VERSION_REQUIRED')
    expect(Number(after?.version)).toBe(vB)
    expect(after?.data).toEqual({ host: 'B-updated' })
  })

  it('提交过期 baseVersion 时必须返回 CONFLICT_STALE_VERSION 且不改动数据', async () => {
    const id = 'cas-stale'
    const vA = await createAt(id, { host: 'A-original' })
    await service.pushChanges(ctx.creatorId, {
      shares: [
        {
          ...hostPayload({ id, data: { host: 'B-updated' } }),
          operation: 'UPDATE',
          baseVersion: vA,
        },
      ],
    })
    const before = await serverRow(id)

    const resolved = await service.resolveConflict(
      id,
      ctx.creatorId,
      'LOCAL',
      { data: { host: 'A-stale-write' }, isSensitive: false, baseVersion: vA },
    )
    const after = await serverRow(id)

    console.log(
      `[P9.2-1/stale] 过期baseVersion=${vA} 当前=${before?.version} 结果=${JSON.stringify(resolved)}`,
    )
    expect(resolved.success).toBe(false)
    expect(resolved.error).toBe('CONFLICT_STALE_VERSION')
    expect(Number(after?.version)).toBe(Number(before?.version))
    expect(after?.data).toEqual(before?.data)
    expect(after?.encryptedData).toBe(before?.encryptedData)
  })

  it('提交正确 baseVersion 时写入成功且版本恰好推进一次', async () => {
    const id = 'cas-happy'
    const vA = await createAt(id, { host: 'A-original' })

    const resolved = await service.resolveConflict(
      id,
      ctx.creatorId,
      'LOCAL',
      { data: { host: 'A-wins' }, isSensitive: false, baseVersion: vA },
    )
    const after = await serverRow(id)

    console.log(
      `[P9.2-1/happy] baseVersion=${vA} 结果=${JSON.stringify(resolved)} 最终version=${after?.version} data=${JSON.stringify(after?.data)}`,
    )
    expect(resolved.success).toBe(true)
    expect(after?.data).toEqual({ host: 'A-wins' })
    expect(Number(after?.version)).toBeGreaterThan(vA)
  })
})
