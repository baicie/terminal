// RC05 — 真实 SQLite + Vault 的 Host 状态矩阵。
//
// ## 为什么要重做一遍
//
// `hosts-auth-switch.test.ts`、`hosts-partial-secret-update.test.ts`、
// `hosts-credential-versions.test.ts` 覆盖了这些路径，但**都在 mock 层**：`select`
// 返回一个对象、`executeQuery` 是 spy，vault 是 `vi.fn()`。那种测试能证明「调用了
// 哪个函数、传了什么参数」，证明不了「库里最终留下了什么」。
//
// 这个文件用真实 `node:sqlite` 与一个只复制「按 key 覆盖 / 按版本删除」的 vault 替身
// （替身由 RC01 起就在自证），逐条记录**行上的字段、`credential_ref`、vault 里实际
// 存在的键**三者是否一致。
//
// ## 每个场景断言什么
//
// 同一个不变量，对所有场景：**行指向的那个版本，其内容必须能被读出来，且只能有一个
// 代存在。** 换句话说 —— 行说它有密码，vault 就必须能交出那个密码；行说它什么也没
// 存，vault 里就不该留着这台主机的密文。
//
// 密码/密钥的**值**不属于断言范围（它们在 vault 里，不该进入行），断言的是它们能被
// 读回，以及 `password`/`private_key` 两列恒为 NULL。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { vaultKey } from '@/service/credential-boundary'

class VaultStandIn {
  readonly entries = new Map<string, string>()
  private key(r: { type: 'host' | 'ssh-key'; id: string }, v: number, k: string) {
    return vaultKey(r, v, k as never)
  }
  async write(r: { type: 'host' | 'ssh-key'; id: string }, v: number, k: string, value: string) {
    this.entries.set(this.key(r, v, k), value)
  }
  async read(r: { type: 'host' | 'ssh-key'; id: string }, v: number, k: string) {
    return this.entries.get(this.key(r, v, k))
  }
  async remove(r: { type: 'host' | 'ssh-key'; id: string }, v: number, k: string) {
    this.entries.delete(this.key(r, v, k))
  }
  async removeVersion(r: { type: 'host' | 'ssh-key'; id: string }, v: number, kinds: string[]) {
    for (const k of kinds) this.entries.delete(this.key(r, v, k))
    return []
  }
  keysFor(id: string) {
    return Object.keys(Object.fromEntries([...this.entries].sort())).filter(k =>
      k.startsWith(`host:${id}:`),
    )
  }
}

const vault = new VaultStandIn()

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE hosts (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, hostname TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22, username TEXT NOT NULL, auth_type TEXT NOT NULL,
      password TEXT, private_key TEXT, certificate TEXT, credential_ref TEXT,
      group_id TEXT, is_favorite INTEGER NOT NULL DEFAULT 0, color TEXT, tags TEXT,
      port_forwards TEXT NOT NULL DEFAULT '[]', startup_command TEXT, environment TEXT,
      jump_host_id TEXT, jump_host_auth_type TEXT, agent_forwarding INTEGER NOT NULL DEFAULT 0,
      shell_integration TEXT NOT NULL DEFAULT 'off', identity_file_path TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )
  `)
  return db
}

let failNextUpdate = false

async function install(db: DatabaseSync) {
  vi.doMock('@/service/database/connection', () => ({
    executeQuery: async (sql: string, params: unknown[] = []) => {
      if (failNextUpdate && /^\s*UPDATE hosts/i.test(sql)) {
        failNextUpdate = false
        throw new Error('database is locked')
      }
      const info = db.prepare(sql).run(...(params as never[]))
      return { rowsAffected: Number(info.changes) }
    },
    select: async (sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...(params as never[])),
    selectStrict: async (sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...(params as never[])),
  }))
  vi.doMock('@/service/vault-secret-provider', () => ({
    vaultSecretProvider: {
      availability: async () => ({ ok: true, state: 'ready' }),
      write: (...a: Parameters<VaultStandIn['write']>) => vault.write(...a),
      read: (...a: Parameters<VaultStandIn['read']>) => vault.read(...a),
      remove: (...a: Parameters<VaultStandIn['remove']>) => vault.remove(...a),
      removeVersion: (...a: Parameters<VaultStandIn['removeVersion']>) =>
        vault.removeVersion(...a),
    },
  }))
  vi.resetModules()
  return import('@/service/database/hosts')
}

const open: DatabaseSync[] = []
function db() {
  const d = makeDb()
  open.push(d)
  return d
}
afterEach(() => {
  for (const d of open.splice(0)) d.close()
  vault.entries.clear()
  failNextUpdate = false
  vi.resetModules()
})

const HOST = 'rc05'

function row(database: DatabaseSync) {
  return database.prepare('SELECT * FROM hosts WHERE id = ?').get(HOST) as
    | Record<string, unknown>
    | undefined
}

/**
 * The invariant every scenario must end in.
 *
 * Returns a plain object so a failure prints the whole picture instead of one boolean.
 */
async function consistency(database: DatabaseSync) {
  const r = row(database)
  if (!r) {
    return { row: null, keys: vault.keysFor(HOST) }
  }
  const rawRef = r.credential_ref as string | null
  const ref = rawRef ? JSON.parse(rawRef) : null
  const secrets: Record<string, string | undefined> = {}
  for (const kind of ref?.kinds ?? []) {
    secrets[kind] = await vault.read({ type: 'host', id: HOST }, ref.version, kind)
  }
  return {
    authType: r.auth_type as string,
    // Secrets never live on the row.
    rowPassword: r.password,
    rowPrivateKey: r.private_key,
    ref,
    secrets,
    keys: vault.keysFor(HOST),
  }
}

describe('RC05 — the host credential matrix, against a real database', () => {
  it('password → key drops the account password from the new generation', async () => {
    /*
     * The Phase 10.3 defect: switching auth method carried the old password into the new
     * generation, where the SSH layer treated it as the **key's passphrase**. The old
     * test asserted the reference's kinds; this one asserts what the vault can actually
     * deliver.
     */
    const database = db()
    const { createHost, updateHost } = await install(database)
    await createHost({
      id: HOST, name: 'a', hostname: 'a.test', port: 22, username: 'u',
      authType: 'password', password: 'ACCOUNT-PASSWORD', portForwards: [],
    } as never)

    await updateHost(HOST, {
      authType: 'key',
      privateKey: 'PRIVATE-KEY-PEM',
    } as never)

    const state = await consistency(database)
    expect(state.authType).toBe('key')
    expect(state.rowPassword).toBeNull()
    expect(state.rowPrivateKey).toBeNull()
    expect(state.secrets).toEqual({ privateKey: 'PRIVATE-KEY-PEM' })
    // Exactly one generation, and no leftover of the password generation.
    expect(state.keys).toEqual([`host:${HOST}:${state.ref.version}:privateKey`])
  })

  it('key → password drops the stored key', async () => {
    const database = db()
    const { createHost, updateHost } = await install(database)
    await createHost({
      id: HOST, name: 'a', hostname: 'a.test', port: 22, username: 'u',
      authType: 'key', privateKey: 'PRIVATE-KEY-PEM', portForwards: [],
    } as never)

    await updateHost(HOST, { authType: 'password', password: 'NEW-PASSWORD' } as never)

    const state = await consistency(database)
    expect(state.authType).toBe('password')
    expect(state.secrets).toEqual({ password: 'NEW-PASSWORD' })
    expect(state.keys).toEqual([`host:${HOST}:${state.ref.version}:password`])
  })

  it('password → agent stores nothing and leaves no ciphertext', async () => {
    /*
     * Agent auth has no secret of its own, so the row must end with no reference and the
     * vault must not keep the retired password generation around.
     */
    const database = db()
    const { createHost, updateHost } = await install(database)
    await createHost({
      id: HOST, name: 'a', hostname: 'a.test', port: 22, username: 'u',
      authType: 'password', password: 'ACCOUNT-PASSWORD', portForwards: [],
    } as never)

    await updateHost(HOST, { authType: 'agent' } as never)

    const state = await consistency(database)
    expect(state.authType).toBe('agent')
    expect(state.ref).toBeNull()
    expect(state.keys, 'an agent host keeps no ciphertext').toEqual([])
  })

  it('a metadata-only edit keeps the stored secret', async () => {
    /*
     * The edit dialog starts empty for every secret field, so "the user retyped the
     * secret" and "the user left it alone" arrive as different facts on the same call.
     * Building the new reference from the submitted fields alone would list nothing and
     * retiring the previous version would then delete the secret entirely.
     *
     * Scoped to what a **host** can hold: `Host` has no `passphrase` field (that belongs
     * to an SSH key row), so the partial-update surface here is metadata-only versus
     * secret-supplied. The key/passphrase half is RC03's matrix.
     */
    const database = db()
    const { createHost, updateHost } = await install(database)
    await createHost({
      id: HOST, name: 'a', hostname: 'a.test', port: 22, username: 'u',
      authType: 'key', privateKey: 'KEY-PEM', portForwards: [],
    } as never)

    await updateHost(HOST, { username: 'someone-else' } as never)

    const state = await consistency(database)
    expect(state.secrets).toEqual({ privateKey: 'KEY-PEM' })
  })

  it('editing only the hostname leaves the credential generation untouched', async () => {
    const database = db()
    const { createHost, updateHost } = await install(database)
    await createHost({
      id: HOST, name: 'a', hostname: 'a.test', port: 22, username: 'u',
      authType: 'password', password: 'SECRET', portForwards: [],
    } as never)
    const before = await consistency(database)

    await updateHost(HOST, { hostname: 'b.test', port: 2222 } as never)

    const after = await consistency(database)
    expect(after.ref).toEqual(before.ref)
    expect(after.secrets).toEqual({ password: 'SECRET' })
  })

  it('a failed database write leaves the old generation readable', async () => {
    /*
     * The vault write happens first, so a failed UPDATE must not have retired anything and
     * must not have replaced the row's reference. The user sees an error and keeps a
     * working credential — the alternative is an error plus a broken host.
     */
    const database = db()
    const { createHost, updateHost } = await install(database)
    await createHost({
      id: HOST, name: 'a', hostname: 'a.test', port: 22, username: 'u',
      authType: 'password', password: 'OLD', portForwards: [],
    } as never)
    const before = await consistency(database)

    failNextUpdate = true
    await expect(updateHost(HOST, { password: 'NEW' } as never)).rejects.toThrow()

    const after = await consistency(database)
    expect(after.ref, 'a failed write must not repoint the row').toEqual(before.ref)
    expect(after.secrets, 'the old generation must still be readable').toEqual({
      password: 'OLD',
    })
  })

  it('clearing the credential removes the reference and the ciphertext', async () => {
    const database = db()
    const { createHost, updateHost } = await install(database)
    await createHost({
      id: HOST, name: 'a', hostname: 'a.test', port: 22, username: 'u',
      authType: 'password', password: 'SECRET', portForwards: [],
    } as never)

    await updateHost(HOST, { clearCredential: true } as never)

    const state = await consistency(database)
    expect(state.ref).toBeNull()
    expect(state.keys, 'clearing must not leave ciphertext behind').toEqual([])
  })

  it('a value read back after the whole matrix is the value last written', async () => {
    /*
     * End-to-end sanity for the sequence a user actually performs: create with a
     * password, switch to a key, retype the passphrase, rename the host, then read the
     * credential as a connection would.
     */
    const database = db()
    const { createHost, updateHost } = await install(database)
    await createHost({
      id: HOST, name: 'a', hostname: 'a.test', port: 22, username: 'u',
      authType: 'password', password: 'FIRST', portForwards: [],
    } as never)
    await updateHost(HOST, { authType: 'key', privateKey: 'PEM-1' } as never)
    await updateHost(HOST, { name: 'renamed' } as never)
    await updateHost(HOST, { privateKey: 'PEM-2' } as never)

    const state = await consistency(database)
    expect(state.secrets).toEqual({ privateKey: 'PEM-2' })
    expect(state.keys, 'exactly one generation survives the whole sequence').toHaveLength(1)
  })
})
