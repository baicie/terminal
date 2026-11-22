// 查询失败与「没有这台主机」是两个事实，而其中一个是会删数据的。
//
// ## 缺陷形状
//
// `select()` 捕获所有异常、打一行日志、返回 `[]`。对列表视图这是对的（显示空
// 状态）。对**基于答案做决定**的路径是错的：
//
//   * `getHostById` 在数据库锁住时返回 `null`，读起来就是「没有这台主机」；
//   * `updateHost` 的存在性检查接着抛 `Host … does not exist` —— 一个错误诊断，
//     会把用户推去重建一台还在的主机；
//   * `deleteHost` 用同一个 helper 读 `credential_ref`，拿到空，于是删掉行却把
//     Vault 密文永久留下；
//   * 连接路径把「查不到」当成「没有凭据」—— 最危险的方向，它静默降级成空凭据。
//
// 所以敏感路径改用 `selectStrict`：读失败就是失败，真正的空结果仍然是空。
// 列表视图保留宽松版本，这是有意的，不是遗漏。
//
// ## 断言方式
//
// 每个用例都让底层的 `select` **抛错**，再断言调用方**抛错**而不是返回
// `null` / `[]` / 执行删除。另有一条正常路径用例，防止把「严格」做成「总是抛」。

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
  selectStrict: vi.fn(),
  removeVersion: vi.fn(),
}))

vi.mock('./connection', () => ({
  executeQuery: mocks.executeQuery,
  select: mocks.select,
  selectStrict: mocks.selectStrict,
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: vi.fn(async () => undefined),
    read: vi.fn(async () => 'stored'),
    remove: vi.fn(async () => undefined),
    removeVersion: mocks.removeVersion,
    isAvailable: vi.fn(async () => true),
    availability: vi.fn(async () => ({ ok: true })),
  },
}))

vi.mock('@/store/host-mappers', () => ({
  hostRowToHost: (row: Record<string, unknown>) => ({
    ...row,
    authType: row.auth_type,
    credentialRef: row.credential_ref
      ? JSON.parse(String(row.credential_ref))
      : null,
    isFavorite: row.is_favorite === 1,
    portForwards: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }),
}))

const { deleteHost, getHostById, getHosts, updateHost } = await import('./hosts')

const hostRow = {
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

/** A database that cannot answer: busy, locked, read-only, handle gone. */
const unavailable = () => {
  throw new Error('database is locked')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.executeQuery.mockResolvedValue({ rowsAffected: 1 })
})

describe('a failed read is never reported as "no such host"', () => {
  it('getHostById throws instead of answering null', async () => {
    mocks.selectStrict.mockImplementation(unavailable)

    await expect(getHostById('host-1')).rejects.toThrow(/database is locked/)
  })

  it('a real absence is still null, not an error', async () => {
    // The strict helper must not turn "no rows" into a failure — otherwise every
    // lookup for a deleted host would look like a database fault.
    mocks.selectStrict.mockResolvedValue([])

    await expect(getHostById('gone')).resolves.toBeNull()
  })

  it('updateHost reports the database fault, not "this host does not exist"', async () => {
    /*
     * The wrong diagnosis matters: "does not exist" tells the user to re-create a host
     * that is still there, and the host dialog's retry path treats it as a permanent
     * condition.
     */
    mocks.selectStrict.mockImplementation(unavailable)

    await expect(updateHost('host-1', { name: 'renamed' })).rejects.toThrow(
      /database is locked/,
    )
    expect(mocks.executeQuery).not.toHaveBeenCalled()
  })

  it('deleteHost does not delete when the reference could not be read', async () => {
    /*
     * The dangerous direction: the SELECT that learns which credential to retire fails,
     * the DELETE succeeds, and the ciphertext is orphaned forever with nothing naming
     * it — unrecoverable in practice, since no row records that it existed.
     */
    mocks.selectStrict.mockImplementation(unavailable)

    await expect(deleteHost('host-1')).rejects.toThrow(/database is locked/)
    expect(mocks.executeQuery).not.toHaveBeenCalled()
    expect(mocks.removeVersion).not.toHaveBeenCalled()
  })

  it('deleteHost still removes the row and the secret on the normal path', async () => {
    mocks.selectStrict.mockResolvedValue([hostRow])

    await deleteHost('host-1')

    expect(mocks.executeQuery).toHaveBeenCalledWith(
      'DELETE FROM hosts WHERE id = ?',
      ['host-1'],
    )
    expect(mocks.removeVersion).toHaveBeenCalledWith(
      { type: 'host', id: 'host-1' },
      2,
      ['password'],
    )
  })

  it('the list view keeps reading through the tolerant helper', async () => {
    /*
     * A sidebar that cannot reach the database shows an empty state rather than an
     * error page. That is a product decision, recorded here so nobody "fixes" it into
     * a throw by accident — and recorded as *which helper it calls*, because the
     * tolerant behaviour itself is `select()`'s and is covered in
     * `connection.test.ts`. What this pins is the routing decision: list views stay
     * tolerant, credential paths do not.
     */
    mocks.select.mockResolvedValue([])
    mocks.selectStrict.mockResolvedValue([])

    await getHosts()

    expect(mocks.select).toHaveBeenCalledTimes(1)
    expect(mocks.selectStrict).not.toHaveBeenCalled()
  })
})
