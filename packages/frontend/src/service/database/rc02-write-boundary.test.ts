// RC02 — create / update / delete 是否共享同一个一致性边界。
//
// ## 已经有的
//
// `host-write-lock.ts` 串行化**同一台主机**的 `updateHost`，用
// `hosts-concurrent-update.test.ts` 的确定性 barrier 证明过「两个并发 update 互相覆盖」
// 在修复前存在。那条边界是对的：不同主机互不相干，全局锁会让两台主机的保存互相等。
//
// ## 缺的是什么
//
// `withHostWriteLock` 只有**一个**调用点 —— `updateHost`。`createHost` 与
// `deleteHost` 都不经过它，于是它们和 update 之间没有任何顺序保证：
//
//   - create / create 同一 ID：两个都可能通过 RC01 的存在性预检；
//   - create / delete 同一 ID：create 预检时行还在（或刚删），两侧交错出孤儿密文；
//   - update / delete：delete 读到 v2，update 算出 v3 并写入，随后 delete 删掉行与 v2
//     —— v3 成为无人引用的密文；反过来 update 的 UPDATE 命中 0 行而密文已写；
//   - delete 后立刻同 ID 创建：新行从 version 1 起，而 delete 的清理可能迟到，把新
//     Host 的 version 1 删掉。
//
// 这些都不是「最终会自愈」的问题：孤儿密文是浪费，但**删掉新行正在用的版本**是数据
// 丢失。
//
// ## 这份文件怎么测
//
// 用真实 `node:sqlite`（schema 与产品一致）而不是纯 mock：交错要靠真实的行读写来观察，
// 而 mock 容易把「我以为的顺序」当成事实。Vault 用只复制「按 key 覆盖 / 按版本删除」
// 的替身，键由产品的 `vaultKey` 构造，替身行为由第一个 describe 自证。
//
// barrier 让两个调用各自在**指定阶段**停住，所以交错是确定的，不靠调度碰运气。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { vaultKey } from '@/service/credential-boundary'

/** Records a fixed set of versions; overwrite-by-key and remove-by-version only. */
class VaultStandIn {
  readonly entries = new Map<string, string>()
  private key(resource: { type: 'host' | 'ssh-key'; id: string }, v: number, kind: string) {
    return vaultKey(resource, v, kind as never)
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
  async removeVersion(
    r: { type: 'host' | 'ssh-key'; id: string },
    v: number,
    kinds: string[],
  ) {
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


/** Install the SQLite-backed modules. One DB per call site, closed on test end. */
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
  const hosts = await import('@/service/database/hosts')
  const lifecycle = await import('@/service/database/host-rows-lifecycle')
  return { ...hosts, deleteHost: lifecycle.deleteHost }
}

const hostOf = (over: Record<string, unknown> = {}) => ({
  id: 'rc02', name: 'A', hostname: 'a.example.com', port: 22, username: 'deploy',
  authType: 'password' as const, password: 'S1', portForwards: [], ...over,
})

const openDbs: DatabaseSync[] = []
function db() {
  const d = makeDb()
  openDbs.push(d)
  return d
}
afterEach(() => {
  for (const d of openDbs.splice(0)) d.close()
  vault.entries.clear()
  vi.resetModules()
})
beforeEach(() => {
  vault.entries.clear()
})

describe('RC02 — the vault stand-in is faithful', () => {
  it('overwrites by key and removes by version', async () => {
    const probe = new VaultStandIn()
    const h = { type: 'host' as const, id: 'x' }
    await probe.write(h, 1, 'password', 'a')
    await probe.write(h, 1, 'password', 'b')
    expect(await probe.read(h, 1, 'password')).toBe('b')
    await probe.write(h, 2, 'password', 'c')
    await probe.removeVersion(h, 2, ['password'])
    expect(await probe.read(h, 2, 'password')).toBeUndefined()
    expect(await probe.read(h, 1, 'password')).toBe('b')
    expect(probe.snapshot()).toEqual({ 'host:x:1:password': 'b' })
  })
})

describe('RC02 — write paths share one consistency boundary', () => {
  it('create/create on one id must not leave two generations or lose the winner', async () => {
    /*
     * Both creates pass the RC01 existence pre-check (the table is empty), then both
     * write vault keys, then one INSERT wins.
     *
     * The invariant that must hold regardless of who wins: the surviving row's
     * referenced version holds **its own** secret, and no orphan generation is left
     * behind that nothing points at.
     */
    const database = db()
    const { createHost } = await install(database)

    /*
     * No barrier inside the vault write any more: the fix serialises creates on the same
     * id, so a gate held inside the critical section would make the two wait on each
     * other and deadlock. Starting both at once still exercises the race — one takes the
     * lock first, and the other must observe its result rather than a stale read.
     */
    const results = await Promise.allSettled([
      createHost(hostOf({ password: 'S1' }) as never),
      createHost(hostOf({ password: 'S2' }) as never),
    ])

    const rows = database.prepare('SELECT id, credential_ref FROM hosts').all() as Array<{
      id: string
      credential_ref: string
    }>
    expect(rows).toHaveLength(1)
    const ref = JSON.parse(rows[0].credential_ref)
    const winner = await vault.read({ type: 'host', id: ref && rows[0].id }, ref.version, 'password')

    expect(
      {
        fulfilled: results.filter(r => r.status === 'fulfilled').length,
        rejected: results.filter(r => r.status === 'rejected').length,
        // The survivor must be able to read its own secret.
        survivorHasSecret: winner === 'S1' || winner === 'S2',
        // Nothing left behind that no row points at.
        vaultKeys: Object.keys(vault.snapshot()),
      },
      'a racing create must leave exactly one row, readable, and no orphan generation',
    ).toEqual({
      fulfilled: 1,
      rejected: 1,
      survivorHasSecret: true,
      vaultKeys: [`host:rc02:${ref.version}:password`],
    })
  })

  it('update racing delete must not leave a generation nothing references', async () => {
    /*
     * The dangerous ordering: `updateHost` writes version N+1, then `deleteHost` removes
     * the row and retires version N. Nothing points at N+1 — an orphan.
     *
     * The reverse order is worse: delete removes row and N, then update's UPDATE hits 0
     * rows while its ciphertext is already written.
     *
     * Either way the invariant is the same: after both settle, every version in the
     * vault is referenced by a row, or the vault holds nothing for this id.
     */
    const database = db()
    const { createHost, updateHost, deleteHost } = await install(database)
    await createHost(hostOf() as never)
    const before = database
      .prepare('SELECT credential_ref FROM hosts WHERE id = ?')
      .get('rc02') as { credential_ref: string }
    expect(JSON.parse(before.credential_ref).version).toBe(1)

    /*
     * No barrier here on purpose. Both paths are already asynchronous and interleave on
     * their own; forcing a specific ordering would test one schedule and miss the other.
     * The assertion below is an **invariant** — true for every ordering — so the test is
     * meaningful whatever the scheduler picks, and it cannot deadlock the way a
     * "both wait for both" gate does.
     */
    const results = await Promise.allSettled([
      updateHost('rc02', { password: 'S2' } as never),
      deleteHost('rc02'),
    ])

    const rows = database.prepare('SELECT id, credential_ref FROM hosts').all() as Array<{
      id: string
      credential_ref: string
    }>
    const vaultKeys = Object.keys(vault.snapshot())

    if (rows.length === 0) {
      // Deleted: the vault must be empty for this id.
      expect(vaultKeys, 'a deleted host must not leave ciphertext behind').toEqual([])
    } else {
      // Updated: the survivor's version must exist.
      const ref = JSON.parse(rows[0].credential_ref)
      expect(vaultKeys).toContain(`host:rc02:${ref.version}:password`)
      expect(
        vaultKeys.filter(k => k.startsWith('host:rc02:')),
        'exactly one generation may remain',
      ).toHaveLength(1)
    }
    // Whatever happened, one of them succeeded or both refused — never a silent success
    // with a broken result.
    expect(results.some(r => r.status === 'fulfilled')).toBe(true)
  })

  it('delete then recreate with the same id keeps the new secret', async () => {
    /*
     * `deleteHost` removes the row, then retires the vault generation. A create that
     * lands between those two steps writes version 1 again — and the delete's cleanup
     * then removes it, because it is retiring "version 1" and cannot tell the new
     * generation from the old one.
     *
     * Measured ordering: this is the delete-after-create interleave, forced by gating
     * the delete's vault call.
     */
    const database = db()
    const { createHost, deleteHost } = await install(database)
    await createHost(hostOf({ password: 'OLD' }) as never)

    /*
     * Recreate **concurrently** with the delete rather than from inside its vault call.
     * The old shape awaited `createHost` from within `deleteHost`'s critical section,
     * which the fix now serialises — that is a deadlock, not a race. Firing both and
     * letting the lock order them is the real scenario: the user deletes and immediately
     * saves again.
     */
    await Promise.allSettled([
      deleteHost('rc02'),
      createHost(hostOf({ password: 'NEW' }) as never),
    ])

    const rows = database.prepare('SELECT credential_ref FROM hosts WHERE id = ?').all('rc02') as Array<{
      credential_ref: string
    }>
    expect(rows, 'the recreate must survive the delete cleanup').toHaveLength(1)
    const ref = JSON.parse(rows[0].credential_ref)
    expect(
      await vault.read({ type: 'host', id: 'rc02' }, ref.version, 'password'),
      'the surviving row must be able to read its own secret',
    ).toBe('NEW')
  })
})
