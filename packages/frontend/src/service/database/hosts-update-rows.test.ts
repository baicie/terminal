// 一次 UPDATE 影响 0 行时，产品会做什么？
//
// ## 这个文件存在的理由
//
// `host-update-args.test.ts` 的头部已经记下了这条链：参数错位让 `WHERE id = ?`
// 收到 `agent_forwarding`（0 或 1），UPDATE 匹配不到任何行 —— 而 `hosts.ts`
// 随后照样把 vault 里的旧版本删掉了，因为 `retirePreviousVersion` 不看
// `rowsAffected`。
//
// 参数错位本身已在 #146 修好，并有占位符计数门禁。但**第二半没有修**：任何
// 让 UPDATE 落空的原因（行被并发删除、id 拼错、另一个连接先删了它、sqlx 绑定
// 行为变化）都会走到同一个结果 —— 用户点「清除凭据」，秘密从 Vault 消失，而
// 数据库行还在，仍然指向一个不存在的引用。
//
// 所以这里断言的不是「参数对齐」（那已被覆盖），而是**顺序的守卫**：
//
//   - 清除 / 切到 agent / 正常写入，三条路径都必须在删除旧版本之前确认行真的
//     切到了预期的引用；
//   - 落空必须是**可见的失败**，不是「保存成功」；
//   - 失败时旧秘密必须还在。
//
// ## 为什么不能只读 mock 调用次数
//
// 每条用例都读回 FakeVault 里**实际存在的密文**：`has(...)` 为 true 才是「秘密
// 还在」。只断言 `removeVersion` 没被调用，会在「调用被挪到别处」时继续通过。

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRead: vi.fn(),
  vaultRemoveVersion: vi.fn(),
}))

vi.mock('./connection', () => ({
  executeQuery: mocks.executeQuery,
  // The credential paths read strictly; the same mock answers both so an expectation
  // written against `select` still describes the behaviour.
  select: mocks.select,
  selectStrict: mocks.select,
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

/** A host row pointing at version 3, with both kinds stored. */
function storedHost(overrides: Record<string, unknown> = {}) {
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
      version: 3,
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
    ...overrides,
  }
}

/**
 * A vault whose reads see what was written, per (version, kind).
 *
 * `persistHostSecrets` reads every kind back before the row is allowed to point at
 * the new version, so a stub that answers a constant would fail the save for a reason
 * unrelated to what these cases are about.
 */
const store = new Map<string, string>()

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  // Version 3 is the live generation, with the kind the stored row claims.
  store.set('3:password', 'old-password')
  mocks.vaultWrite.mockImplementation(
    async (_resource: unknown, version: number, kind: string, value: string) => {
      store.set(`${version}:${kind}`, value)
    },
  )
  mocks.vaultRead.mockImplementation(
    async (_resource: unknown, version: number, kind: string) =>
      store.get(`${version}:${kind}`),
  )
  mocks.vaultRemoveVersion.mockImplementation(
    async (_resource: unknown, version: number, kinds: string[]) => {
      for (const kind of kinds) store.delete(`${version}:${kind}`)
      return kinds
    },
  )
})

describe('an UPDATE that matched no row is a failure, not a save', () => {
  it('clearing a credential keeps the old version when the UPDATE hit nothing', async () => {
    /*
     * The exact chain from `host-update-args.test.ts`, minus the argument bug: the
     * statement is well-formed and binds the right values, and still matches no row
     * (the row was deleted by another window, or the id belongs to nothing).
     *
     * Before the guard: `removeVersion` ran anyway, the vault lost the secret, and the
     * caller was told nothing. The user's credential is gone and the next connect fails
     * with "no credential" on a host that visibly has one.
     */
    mocks.select.mockResolvedValue([storedHost()])
    mocks.executeQuery.mockResolvedValue({ rowsAffected: 0 })

    await expect(
      updateHost('host-1', { clearCredential: true }),
    ).rejects.toThrow(/no longer exists|matched no row|not found/i)

    // The secret must still be there — this is the assertion that matters.
    expect(store.has('3:password')).toBe(true)
  })

  it('switching to agent keeps the old version when the UPDATE hit nothing', async () => {
    mocks.select.mockResolvedValue([storedHost()])
    mocks.executeQuery.mockResolvedValue({ rowsAffected: 0 })

    await expect(
      updateHost('host-1', { authType: 'agent' }),
    ).rejects.toThrow(/no longer exists|matched no row|not found/i)

    expect(store.has('3:password')).toBe(true)
  })

  it('a normal credential write retires nothing when the UPDATE hit nothing', async () => {
    /*
     * The third path. The new generation is written (it must be — the row may still
     * land), the UPDATE matches nothing, so the row still points at version 3. Retiring
     * version 3 here would leave the row pointing at nothing while version 4 exists
     * unreferenced.
     */
    mocks.select.mockResolvedValue([storedHost()])
    mocks.executeQuery.mockResolvedValue({ rowsAffected: 0 })

    await expect(
      updateHost('host-1', { password: 'brand-new-password' }),
    ).rejects.toThrow(/no longer exists|matched no row|not found/i)

    // Version 3 is what the untouched row still points at, so it must survive.
    expect(store.has('3:password')).toBe(true)
  })

  it('a matched UPDATE still retires the previous version', async () => {
    // The guard must not stop the ordinary path from cleaning up.
    mocks.select.mockResolvedValue([storedHost()])
    mocks.executeQuery.mockResolvedValue({ rowsAffected: 1 })

    await updateHost('host-1', { password: 'brand-new-password' })

    expect(store.has('3:password')).toBe(false)
    expect(store.get('4:password')).toBe('brand-new-password')
  })

  it('a rename that matched no row is reported too, but never touches the vault', async () => {
    /*
     * The same statement serves renames and favourite toggles. Reporting the no-op is
     * not scope creep: "saved" over a row that was deleted in another window is a lie
     * the user acts on, and the honest error is already what `select` just above
     * throws for the same condition.
     */
    mocks.select.mockResolvedValue([storedHost()])
    mocks.executeQuery.mockResolvedValue({ rowsAffected: 0 })

    await expect(updateHost('host-1', { name: 'renamed' })).rejects.toThrow(
      /no longer exists/,
    )
    expect(store.has('3:password')).toBe(true)
  })
})

describe('what counts as a matched row', () => {
  it('treats a result without rowsAffected as matched, not as zero', async () => {
    /*
     * The sql plugin's `execute` returns `{ rowsAffected, lastInsertId }`, but a mock,
     * a future plugin version, or a wrapper may return nothing. Reading a missing
     * field as 0 would turn every successful save into a thrown error.
     */
    mocks.select.mockResolvedValue([storedHost()])
    mocks.executeQuery.mockResolvedValue(undefined)

    await updateHost('host-1', { password: 'brand-new-password' })

    expect(store.get('4:password')).toBe('brand-new-password')
    expect(store.has('3:password')).toBe(false)
  })

  it('discards the new generation when the UPDATE threw', async () => {
    // Existing behaviour, kept: a throw means the row still points at the old version,
    // so the generation this attempt wrote is unreachable data.
    mocks.select.mockResolvedValue([storedHost()])
    mocks.executeQuery.mockRejectedValue(new Error('database is locked'))

    await expect(
      updateHost('host-1', { password: 'brand-new-password' }),
    ).rejects.toThrow('database is locked')

    // The generation this attempt wrote (4) is gone; the live one (3) is untouched.
    expect(store.has('4:password')).toBe(false)
    expect(store.has('3:password')).toBe(true)
  })
})
