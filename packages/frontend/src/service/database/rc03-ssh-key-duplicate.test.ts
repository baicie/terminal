// RC03 — SSH Key 是否有 RC01/RC02 的同形缺陷。
//
// ## 为什么要单独测，而不是「Host 修好了所以 Key 也好了」
//
// 两条路径是**两份实现**：`host-credentials.ts` 与 `ssh-key-credentials.ts`，
// `host-create-guard.ts` 与 `ssh-keys.ts` 的 catch。它们共享 `CredentialRef` 的形状与
// vault 的语义，但不共享代码 —— 所以 Host 侧修好的守卫不会自动出现在 Key 侧。
//
// 任务书要求：发现同形缺陷就单独提交，不把所有 Credential 模块一次性重写。
//
// ## 预期会看到什么
//
// `createSSHKey` 与 `createHost` 结构相同：先 `persistKeySecrets(id, …, null)` 写
// Vault，再 INSERT，失败时 `discardKeyVersion`。`nextKeyVersion(null)` 同样是 1，所以
// 重复 ID 会写进原 Key 正在读的键，然后被删掉。
//
// 这份文件先**测出来**，再决定修法 —— 如果行为与 Host 不同，那就不是同形缺陷，
// 记录差异而不是照搬修复。

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
  snapshot() {
    return Object.fromEntries([...this.entries].sort())
  }
}

const vault = new VaultStandIn()

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE ssh_keys (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      key_type TEXT NOT NULL,
      private_key TEXT,
      public_key TEXT NOT NULL,
      certificate TEXT,
      passphrase TEXT,
      credential_ref TEXT,
      is_encrypted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  return db
}

async function install(db: DatabaseSync) {
  vi.doMock('@/service/database/connection', () => ({
    executeQuery: async (sql: string, params: unknown[] = []) => {
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
  return import('@/service/database/ssh-keys')
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
  vi.resetModules()
})

const keyOf = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  name: 'deploy',
  key_type: 'ssh-ed25519',
  private_key: 'KEY-S1',
  public_key: 'ssh-ed25519 AAAA comment',
  certificate: null,
  passphrase: null,
  is_encrypted: 0,
  ...over,
})

describe('RC03 — createSSHKey must not destroy a live key on a duplicate id', () => {
  it('reports what happens to the original private key when the INSERT conflicts', async () => {
    /*
     * Same scenario as RC01, one layer over: create key `k1` with private key KEY-S1,
     * then create `k1` again with KEY-S2 and let the primary key constraint reject it.
     *
     * The question is not whether the second create throws — it should. It is whether the
     * first key can still read its own private key afterwards.
     */
    const database = db()
    const { createSSHKey } = await install(database)

    await createSSHKey(keyOf() as never)

    const before = database
      .prepare('SELECT credential_ref FROM ssh_keys WHERE id = ?')
      .get('k1') as { credential_ref: string }
    const refBefore = JSON.parse(before.credential_ref)
    expect(await vault.read({ type: 'ssh-key', id: 'k1' }, refBefore.version, 'privateKey'))
      .toBe('KEY-S1')

    await expect(createSSHKey(keyOf({ private_key: 'KEY-S2' }) as never)).rejects.toBeTruthy()

    const after = database
      .prepare('SELECT credential_ref FROM ssh_keys WHERE id = ?')
      .get('k1') as { credential_ref: string }
    const refAfter = JSON.parse(after.credential_ref)
    const stillReadable = await vault.read(
      { type: 'ssh-key', id: 'k1' },
      refAfter.version,
      'privateKey',
    )

    expect({
      rowSurvived: Boolean(after),
      refUnchanged: JSON.stringify(refBefore) === JSON.stringify(refAfter),
      privateKeyStillReadable: stillReadable,
      vaultAfter: vault.snapshot(),
    }).toEqual({
      rowSurvived: true,
      refUnchanged: true,
      privateKeyStillReadable: 'KEY-S1',
      vaultAfter: { 'ssh-key:k1:1:privateKey': 'KEY-S1' },
    })
  })
})

describe('RC03 — concurrent key writes', () => {
  it('two creates on one id leave exactly one key with a readable private key', async () => {
    /*
     * Same invariant as RC02's create/create case, one layer over. Without the per-key
     * lock both creates write version 1 and the loser's cleanup removes the winner's
     * generation.
     */
    const database = db()
    const { createSSHKey } = await install(database)

    await Promise.allSettled([
      createSSHKey(keyOf({ private_key: 'KEY-S1' }) as never),
      createSSHKey(keyOf({ private_key: 'KEY-S2' }) as never),
    ])

    const rows = database.prepare('SELECT credential_ref FROM ssh_keys').all() as Array<{
      credential_ref: string
    }>
    expect(rows).toHaveLength(1)
    const ref = JSON.parse(rows[0].credential_ref)
    const secret = await vault.read({ type: 'ssh-key', id: 'k1' }, ref.version, 'privateKey')

    expect({
      survivorReadable: secret === 'KEY-S1' || secret === 'KEY-S2',
      vaultKeys: Object.keys(vault.snapshot()),
    }).toEqual({
      survivorReadable: true,
      vaultKeys: [`ssh-key:k1:${ref.version}:privateKey`],
    })
  })

  it('a delete racing a recreate does not retire the new key', async () => {
    const database = db()
    const { createSSHKey, deleteSSHKey } = await install(database)
    await createSSHKey(keyOf({ private_key: 'OLD' }) as never)

    await Promise.allSettled([
      deleteSSHKey('k1'),
      createSSHKey(keyOf({ private_key: 'NEW' }) as never),
    ])

    const rows = database.prepare('SELECT credential_ref FROM ssh_keys').all() as Array<{
      credential_ref: string
    }>
    if (rows.length === 1) {
      const ref = JSON.parse(rows[0].credential_ref)
      const secret = await vault.read({ type: 'ssh-key', id: 'k1' }, ref.version, 'privateKey')
      expect(secret, 'the surviving key must read its own private key').toBe('NEW')
    } else {
      expect(Object.keys(vault.snapshot()), 'a deleted key leaves no ciphertext').toEqual([])
    }
  })
})
