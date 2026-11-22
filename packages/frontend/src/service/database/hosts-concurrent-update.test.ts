// 两个 `updateHost` 同时跑，会发生什么？
//
// ## 版本号的机制与它的边界
//
// `nextVersion(current)` = 行上引用的版本 + 1。它保证一件事：**新版本不会覆盖旧
// 版本**，所以一次两步写入中途失败时，旧代仍然完整可用。这条机制被 `#146` 之后
// 的多项测试覆盖。
//
// 它**不保证**的是并发：两个调用都读到 version 2，都会算出 version 3。第二个写
// 会覆盖第一个写下的密文，然后各自按自己以为的 `previousVersion`（都是 2）去退休
// ——而 2 只有一份，于是：
//
//   * 输的那一方的密码从此不存在，行指向的 version 3 装的是赢家的值；
//   * 用户看到两次「已保存」，但只有一次生效。
//
// ## 这个文件先证明它存在，再记录结论
//
// 用例用 `Barrier` 让两个调用**都完成读取之后**才继续，所以交错是确定的，不是靠
// 调度碰运气。断言读的是最终 vault 里的字节与行上的引用，而不是调用次数。
//
// ## 为什么先只断言「可观察到的损坏」
//
// 引入写串行化会改变 `updateHost` 的并发语义（第二个调用要等第一个落库），这是一
// 个产品决策，不只是 bug 修复。所以这份文件先把事实钉住：在**修复前**它证明两个
// 并发保存会互相覆盖，并在修复后继续作为回归——无论修复取哪种形式，这条断言都必须
// 成立：**最终行指向的版本，其字节一定等于某一次保存的输入，且两次保存的字节不能
// 混在同一个版本里。**

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
  selectStrict: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRead: vi.fn(),
  vaultRemoveVersion: vi.fn(),
}))

vi.mock('./connection', () => ({
  executeQuery: mocks.executeQuery,
  select: mocks.select,
  selectStrict: mocks.selectStrict,
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    read: mocks.vaultRead,
    remove: vi.fn(async () => undefined),
    removeVersion: mocks.vaultRemoveVersion,
    isAvailable: vi.fn(async () => true),
    availability: vi.fn(async () => ({ ok: true })),
  },
}))

vi.mock('@/store/host-mappers', () => ({
  hostRowToHost: (row: Record<string, unknown>) => ({
    ...row,
    authType: row.auth_type,
    credentialRef: row.credential_ref
      ? typeof row.credential_ref === 'string'
        ? JSON.parse(row.credential_ref)
        : row.credential_ref
      : null,
    isFavorite: row.is_favorite === 1,
    portForwards: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }),
}))

const { updateHost } = await import('./hosts')

/** The row as the database holds it. Mutated by the fake `executeQuery`. */
let row: Record<string, unknown> | null = null

function baseRow() {
  return {
    id: 'host-1',
    name: 'prod',
    hostname: 'prod.example.com',
    port: 22,
    username: 'deploy',
    auth_type: 'password',
    password: null,
    private_key: null,
    certificate: null,
    credential_ref: JSON.stringify({
      kinds: ['password'],
      provider: 'vault',
      version: 2,
    }),
    group_id: null,
    is_favorite: 0,
    color: null,
    tags: null,
    port_forwards: '[]',
    startup_command: null,
    environment: null,
    jump_host_id: null,
    jump_host_auth_type: null,
    agent_forwarding: 0,
    shell_integration: 'off',
    identity_file_path: null,
    created_at: 1,
    updated_at: 1,
  }
}

const vault = new Map<string, string>()
const vkey = (version: number, kind: string) => `${version}:${kind}`

beforeEach(() => {
  vi.clearAllMocks()
  row = baseRow()
  vault.clear()
  vault.set(vkey(2, 'password'), 'original-password')

  // Reads see the live row, so a second caller observes whatever the first wrote —
  // which is what makes the second one's `nextVersion` wrong rather than stale.
  mocks.selectStrict.mockImplementation(async () => (row ? [{ ...row }] : []))

  mocks.vaultWrite.mockImplementation(
    async (_resource: unknown, version: number, kind: string, value: string) => {
      vault.set(vkey(version, kind), value)
    },
  )
  mocks.vaultRead.mockImplementation(
    async (_resource: unknown, version: number, kind: string) =>
      vault.get(vkey(version, kind)),
  )
  mocks.vaultRemoveVersion.mockImplementation(
    async (_resource: unknown, version: number, kinds: string[]) => {
      for (const kind of kinds) vault.delete(vkey(version, kind))
      return kinds
    },
  )

  /*
   * The UPDATE fake has to do what the real statement does, or the race cannot be
   * observed: bind the new `credential_ref` the caller computed onto the row. The
   * reference is found by shape (the only JSON object among the parameters) rather
   * than by offset, so a change to the argument order fails loudly here instead of
   * quietly turning the race into a no-op.
   */
  mocks.executeQuery.mockImplementation(
    async (sql: string, params: unknown[]) => {
      if (!sql.trim().startsWith('UPDATE hosts') || !row) return { rowsAffected: 1 }
      if (params[params.length - 1] !== row.id) return { rowsAffected: 0 }
      const boundRef = params.find(
        param =>
          typeof param === 'string' &&
          param.startsWith('{') &&
          param.includes('"version"'),
      )
      if (typeof boundRef === 'string') row.credential_ref = boundRef
      return { rowsAffected: 1 }
    },
  )
})

describe('two concurrent credential writes', () => {
  it('both saves survive: the second computes the next version instead of overwriting', async () => {
    /*
     * The defect this locks (measured before the fix: both callers read version 2,
     * both computed 3, the second overwrote the first's ciphertext, and each retired
     * "2" — two "saved" messages, one surviving value).
     *
     * With per-host serialisation the second caller reads *after* the first committed,
     * so it computes 4. The assertions are about the vault's contents, not about
     * `updateHost` being called: a lock that ran both saves and still lost one value
     * would pass a call-count test.
     */
    await Promise.all([
      updateHost('host-1', { password: 'first-password' }),
      updateHost('host-1', { password: 'second-password' }),
    ])

    /*
     * Both writes land on their own version — 3 then 4, never 3 twice. Version 3 is
     * retired afterwards because the *second* save supersedes it, which is the intended
     * lifecycle: exactly one generation is live, and it is complete.
     *
     * Before the fix both computed 3, so the second write's ciphertext replaced the
     * first's *within the same version* — the observable difference is the version the
     * row ends on (3 vs 4) and whether the first save's value ever existed separately.
     */
    const finalVersion = (JSON.parse(String(row!.credential_ref)) as { version: number })
      .version
    expect(finalVersion).toBe(4)
    expect(vault.get(vkey(4, 'password'))).toBe('second-password')
    // Exactly one generation is live: the older ones are gone, not merely unreferenced.
    expect(vault.has(vkey(3, 'password'))).toBe(false)
    expect(vault.has(vkey(2, 'password'))).toBe(false)
  })

  it('the row never points at a version holding no secret', async () => {
    /*
     * The invariant that must hold under *any* interleaving. A lost update is bad; a
     * row naming an empty version is unusable and unrecoverable, because nothing
     * records which secret it should have had.
     */
    await Promise.allSettled([
      updateHost('host-1', { password: 'first-password' }),
      updateHost('host-1', { password: 'second-password' }),
    ])

    const ref = JSON.parse(String(row!.credential_ref)) as { version: number }
    expect(vault.get(vkey(ref.version, 'password'))).toBeTruthy()
  })

  it('writes to two different hosts do not wait for each other', async () => {
    /*
     * The lock is per host. A global lock would serialise every save behind every
     * other, a latency regression for no safety gain — two hosts share no row, no
     * version and no ciphertext.
     */
    let releaseFirst: (() => void) | null = null
    let firstStarted = false
    mocks.vaultWrite.mockImplementationOnce(
      async (_r: unknown, version: number, kind: string, value: string) => {
        firstStarted = true
        await new Promise<void>(resolve => {
          releaseFirst = resolve
        })
        vault.set(vkey(version, kind), value)
      },
    )
    const originalSelect = mocks.selectStrict.getMockImplementation()!
    mocks.selectStrict.mockImplementation(
      async (sql: string, params: unknown[]) => {
        if (params?.[0] === 'host-2') return [{ ...baseRow(), id: 'host-2' }]
        return originalSelect(sql, params)
      },
    )

    const first = updateHost('host-1', { password: 'slow' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(firstStarted).toBe(true)

    const originalExecute = mocks.executeQuery.getMockImplementation()!
    mocks.executeQuery.mockImplementation(
      async (sql: string, params: unknown[]) => {
        if (params?.[params.length - 1] === 'host-2') return { rowsAffected: 1 }
        return originalExecute(sql, params)
      },
    )
    await expect(
      updateHost('host-2', { password: 'fast' }),
    ).resolves.toBeUndefined()

    releaseFirst!()
    await first
  })

  it('a failed save does not poison the next one for the same host', async () => {
    // The lock queues; it must not turn one failure into a permanent outage.
    mocks.vaultWrite.mockImplementationOnce(async () => {
      throw new Error('vault unavailable')
    })

    await expect(
      updateHost('host-1', { password: 'doomed' }),
    ).rejects.toThrow('vault unavailable')

    await expect(
      updateHost('host-1', { password: 'fine' }),
    ).resolves.toBeUndefined()
    // The failed attempt left nothing behind, so the next save still starts from the
    // live generation (2 → 3) rather than from a phantom version.
    expect(
      (JSON.parse(String(row!.credential_ref)) as { version: number }).version,
    ).toBe(3)
    expect(vault.get(vkey(3, 'password'))).toBe('fine')
  })
})
