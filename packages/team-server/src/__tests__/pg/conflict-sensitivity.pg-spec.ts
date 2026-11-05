import type { PrismaService } from '../../prisma.service'
import type { SeededTeam } from './pg-harness'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SyncService } from '../../sync/sync.service'
import { createPrisma, resetDatabase, seedTeams } from './pg-harness'

// Phase 9.2 P9.2-2：LOCAL 冲突解决会破坏敏感共享的安全状态。
//
// 服务端在这条路径上调用 buildShareUpdateData(clientData, share, true)：
// 第三个参数 preservePermission=true，第四个 preserveSensitivity 缺省为 false。
// 于是 resolveUpdateSecurity 会采用 payload.isSensitive，把敏感记录降级成明文。
// 前端又固定提交 { isSensitive: false, permission: 'READONLY' }，两个缺陷叠加。
//
// 本文件全部使用真实 PostgreSQL 与真实 SyncService，不 mock Prisma。

describe('P9.2-2 敏感共享在冲突解决中的不变量（真实 PostgreSQL）', () => {
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

  const CIPHER = 'ciphertext-v1-base64'

  async function serverRow(id: string) {
    return prisma.share.findUnique({ where: { id } })
  }

  /** 由创建者写入一条敏感记录，返回其服务端版本。 */
  async function createSensitive(id: string): Promise<number> {
    const result = await service.pushChanges(ctx.creatorId, {
      shares: [
        {
          id,
          teamId: ctx.teamId,
          type: 'HOST',
          data: {},
          encryptedData: CIPHER,
          isSensitive: true,
          permission: 'READWRITE',
          operation: 'CREATE',
        },
      ],
    })
    expect(result.created).toEqual([id])
    const row = await serverRow(id)
    expect(row?.isSensitive).toBe(true)
    expect(row?.encryptedData).toBe(CIPHER)
    return Number(row?.version)
  }

  it('复现：前端旧载荷（isSensitive=false 且无 baseVersion）把敏感记录降级为明文', async () => {
    const id = 'sensitive-downgrade'
    const v1 = await createSensitive(id)

    // 期间发生一次并发写入，制造冲突场景。
    const pushed = await service.pushChanges(ctx.creatorId, {
      shares: [
        {
          id,
          teamId: ctx.teamId,
          type: 'HOST',
          data: {},
          encryptedData: 'ciphertext-remote',
          isSensitive: true,
          permission: 'READWRITE',
          operation: 'UPDATE',
          baseVersion: v1,
        },
      ],
    })
    expect(pushed.updated).toEqual([id])
    const before = await serverRow(id)

    // 前端旧实现固定提交的载荷：不传 baseVersion，isSensitive 固定 false，
    // permission 固定 READONLY（team-actions-sync.ts 原样）。
    const resolved = await service.resolveConflict(id, ctx.creatorId, 'LOCAL', {
      data: { host: 'plaintext-leak' },
      isSensitive: false,
      permission: 'READONLY',
    })
    const after = await serverRow(id)
    console.log(
      `[P9.2-2/downgrade] 改前={isSensitive:${String(before?.isSensitive)},cipher:${String(before?.encryptedData)},perm:${String(before?.permission)},v:${String(before?.version)}} 结果=${JSON.stringify(resolved)} 改后={isSensitive:${String(after?.isSensitive)},cipher:${String(after?.encryptedData)},data:${JSON.stringify(after?.data)},perm:${String(after?.permission)},v:${String(after?.version)}}`,
    )

    // 不变量：敏感记录不得被意外降级，密文不得被清空。
    expect(after?.isSensitive).toBe(true)
    expect(after?.encryptedData).toBe('ciphertext-remote')
    expect(after?.data).toEqual({})
  })

  it('复现：LOCAL 未显式声明 isSensitive 时不得推断为明文', async () => {
    const id = 'sensitive-undeclared'
    const v1 = await createSensitive(id)

    const resolved = await service.resolveConflict(id, ctx.creatorId, 'LOCAL', {
      data: { host: 'plaintext-leak' },
      baseVersion: v1,
    } as never)
    const after = await serverRow(id)
    console.log(
      `[P9.2-2/undeclared] 结果=${JSON.stringify(resolved)} isSensitive=${String(after?.isSensitive)} data=${JSON.stringify(after?.data)}`,
    )

    // 旧代码用 `payload.isSensitive ?? (encryptedData !== undefined || existing.isSensitive)`
    // 推断，encryptedData 缺省时会退回 existing.isSensitive —— 若上游没传，
    // 仍然不能把明文写进 data。
    expect(after?.isSensitive).toBe(true)
    expect(after?.data).toEqual({})
  })

  it('敏感记录 LOCAL 更新必须提供合法密文，否则拒绝且保持原状', async () => {
    const id = 'sensitive-requires-cipher'
    const v1 = await createSensitive(id)

    const resolved = await service.resolveConflict(id, ctx.creatorId, 'LOCAL', {
      data: {},
      isSensitive: true,
      baseVersion: v1,
    })
    const after = await serverRow(id)
    console.log(
      `[P9.2-2/no-cipher] 结果=${JSON.stringify(resolved)} encryptedData=${String(after?.encryptedData)} version=${String(after?.version)}`,
    )
    expect(resolved.success).toBe(false)
    expect(resolved.error).toBe('SENSITIVE_CIPHERTEXT_REQUIRED')
    expect(after?.encryptedData).toBe(CIPHER)
    expect(Number(after?.version)).toBe(v1)
  })

  it('权限：LOCAL 冲突解决不得改变共享 permission', async () => {
    const id = 'sensitive-permission'
    const v1 = await createSensitive(id)
    expect((await serverRow(id))?.permission).toBe('READWRITE')

    await service.resolveConflict(id, ctx.creatorId, 'LOCAL', {
      data: {},
      isSensitive: true,
      encryptedData: 'ciphertext-v2',
      permission: 'READONLY',
      baseVersion: v1,
    })
    const after = await serverRow(id)
    console.log(
      `[P9.2-2/permission] 提交READONLY后 permission=${String(after?.permission)} version=${String(after?.version)}`,
    )
    // 冲突解决保留本地编辑，不代表同意更改共享权限。
    expect(after?.permission).toBe('READWRITE')
  })

  it('权限：非创建者仍不能借冲突解决写入', async () => {
    const id = 'sensitive-unauthorized'
    const v1 = await createSensitive(id)

    const resolved = await service.resolveConflict(id, ctx.memberId, 'LOCAL', {
      data: {},
      isSensitive: true,
      encryptedData: 'ciphertext-member',
      baseVersion: v1,
    })
    const after = await serverRow(id)
    console.log(
      `[P9.2-2/member] 结果=${JSON.stringify(resolved)} encryptedData=${String(after?.encryptedData)}`,
    )
    expect(resolved.success).toBe(false)
    expect(after?.encryptedData).toBe(CIPHER)
  })

  it('任一校验失败都必须保持数据库原状', async () => {
    const id = 'sensitive-atomic'
    await createSensitive(id)
    const before = await serverRow(id)

    // 冲突已发生（远端版本已推进），所以下面的失败只能来自载荷校验或 CAS。
    await service.pushChanges(ctx.creatorId, {
      shares: [
        {
          id,
          teamId: ctx.teamId,
          type: 'HOST',
          data: {},
          encryptedData: 'ciphertext-remote',
          isSensitive: true,
          permission: 'READWRITE',
          operation: 'UPDATE',
          baseVersion: Number(before?.version),
        },
      ],
    })
    const baseline = await serverRow(id)

    const attempts = [
      // 声明敏感但没有密文。
      { data: {}, isSensitive: true, encryptedData: '', baseVersion: Number(baseline?.version) },
      // 声明明文却带着密文。
      { data: { plain: 'x' }, isSensitive: false, encryptedData: 'c1', baseVersion: Number(baseline?.version) },
      // 敏感标记缺省（DTO 要求必填，服务层也要拒绝）。
      { data: {}, baseVersion: Number(baseline?.version) },
      // 过期 baseVersion。
      { data: {}, isSensitive: true, encryptedData: 'c2', baseVersion: Number(baseline?.version) - 1 },
    ]
    for (const clientData of attempts) {
      const result = await service.resolveConflict(id, ctx.creatorId, 'LOCAL', clientData as never)
      const now = await serverRow(id)
      console.log(
        `[P9.2-2/atomic] payload=${JSON.stringify(clientData)} 结果=${JSON.stringify(result)} 版本=${String(now?.version)} isSensitive=${String(now?.isSensitive)} cipher=${String(now?.encryptedData)}`,
      )
      expect(now?.isSensitive).toBe(baseline?.isSensitive)
      expect(now?.encryptedData).toBe(baseline?.encryptedData)
      expect(now?.data).toEqual(baseline?.data)
      expect(now?.permission).toBe(baseline?.permission)
      expect(Number(now?.version)).toBe(Number(baseline?.version))
    }
  })
})
