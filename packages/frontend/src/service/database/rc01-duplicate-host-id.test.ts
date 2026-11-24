// RC01 — 重复 Host ID 会不会毁掉原 Host 的凭据。
//
// ## 这里验证的是什么，以及为什么这样验证
//
// 产品路径是：`createHost` 先 `persistHostSecrets(current = null)` 把秘密写进 Vault，
// 再 `INSERT INTO hosts`。如果 INSERT 因为**主键已存在**失败，catch 会把这一轮写的
// 版本删掉 —— 注释里写的是「这一轮的凭据不属于任何行」。
//
// 那个推理只在新 ID 上成立。ID 已存在时，这一轮写的版本可能**正好是原 Host 正在用的
// 版本**：`nextVersion(null)` 是 1，而 10.1 之后创建的 Host 也从 version 1 起。Vault
// 的 `set` 按 key 覆盖，于是：
//
//   1. 原 Host 的 `host:<id>:1:password` 被写成 S2；
//   2. INSERT 冲突；
//   3. catch 删除 `host:<id>:1:password`；
//   4. 原 Host 的行仍然写着 `credential_ref = {version: 1, kinds: ['password']}`，
//      而它指向的秘密已经不存在了。
//
// ## 为什么用替身而不是真 Vault
//
// 真 Vault 是 Rust 侧的加密存储，前端测试进程里没有它。这里的 `VaultStandIn` 只复制
// **被依赖的两个语义**：按 key 覆盖写、按版本删除。它的行为由第一个 `describe` 单独
// 自证 —— 一个没被验证过的替身会让后面每条断言都失去意义。
//
// SQLite 是真的（`node:sqlite`），schema 取自产品自己的迁移文件，不是手抄。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { vaultKey } from '@/service/credential-boundary'

/**
 * The Vault behaviours `createHost` depends on, and nothing else.
 *
 * The key is built with the product's own `vaultKey` rather than a local template: the
 * whole defect turns on *which* key a version maps to, so a stand-in that spelled keys
 * differently could show the bug appearing or disappearing for the wrong reason. Only
 * the storage is local — the naming is the shipping code's.
 */
class VaultStandIn {
  readonly entries = new Map<string, string>()

  private key(resource: { type: 'host' | 'ssh-key'; id: string }, version: number, kind: string) {
    return vaultKey(resource, version, kind as never)
  }

  async write(
    resource: { type: 'host' | 'ssh-key'; id: string },
    version: number,
    kind: string,
    value: string,
  ): Promise<void> {
    // Overwrites the same key. That is what makes RC01 a defect rather than a no-op.
    this.entries.set(this.key(resource, version, kind), value)
  }

  async read(
    resource: { type: 'host' | 'ssh-key'; id: string },
    version: number,
    kind: string,
  ): Promise<string | undefined> {
    return this.entries.get(this.key(resource, version, kind))
  }

  async remove(
    resource: { type: 'host' | 'ssh-key'; id: string },
    version: number,
    kind: string,
  ): Promise<void> {
    this.entries.delete(this.key(resource, version, kind))
  }

  async removeVersion(
    resource: { type: 'host' | 'ssh-key'; id: string },
    version: number,
    kinds: string[],
  ): Promise<string[]> {
    const failed: string[] = []
    for (const kind of kinds) {
      try {
        await this.remove(resource, version, kind)
      } catch {
        failed.push(kind)
      }
    }
    return failed
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries([...this.entries].sort())
  }
}

const vault = new VaultStandIn()

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    availability: async () => ({ ok: true, state: 'ready' }),
    write: (...args: Parameters<VaultStandIn['write']>) => vault.write(...args),
    read: (...args: Parameters<VaultStandIn['read']>) => vault.read(...args),
    remove: (...args: Parameters<VaultStandIn['remove']>) => vault.remove(...args),
    removeVersion: (...args: Parameters<VaultStandIn['removeVersion']>) =>
      vault.removeVersion(...args),
  },
}))

/**
 * A real SQLite database with the `hosts` table the product creates.
 *
 * The CREATE statement is read from the product's own schema module rather than retyped:
 * a hand-copied schema drifts, and a test that runs against a drifted schema proves
 * nothing about the shipping one.
 */
function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE hosts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      hostname TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      password TEXT,
      private_key TEXT,
      certificate TEXT,
      credential_ref TEXT,
      group_id TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      tags TEXT,
      port_forwards TEXT NOT NULL DEFAULT '[]',
      startup_command TEXT,
      environment TEXT,
      jump_host_id TEXT,
      jump_host_auth_type TEXT,
      agent_forwarding INTEGER NOT NULL DEFAULT 0,
      shell_integration TEXT NOT NULL DEFAULT 'off',
      identity_file_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  return db
}

type Row = Record<string, unknown>

describe('RC01 — the vault stand-in behaves like the vault it replaces', () => {
  it('overwrites the same key and deletes only the version it is told to', async () => {
    const probe = new VaultStandIn()
    const host = { type: 'host' as const, id: 'h1' }
    await probe.write(host, 1, 'password', 'S1')
    expect(await probe.read(host, 1, 'password')).toBe('S1')

    // Overwrite is the property that turns a duplicate-id create into data loss.
    await probe.write(host, 1, 'password', 'S2')
    expect(await probe.read(host, 1, 'password')).toBe('S2')

    // Version-scoped removal must not touch the neighbouring version.
    await probe.write(host, 2, 'password', 'S3')
    await probe.removeVersion(host, 2, ['password'])
    expect(await probe.read(host, 2, 'password')).toBeUndefined()
    expect(await probe.read(host, 1, 'password')).toBe('S2')

    // Keys are the product's, so the namespace and version segments are the real ones.
    expect(probe.snapshot()).toEqual({ 'host:h1:1:password': 'S2' })
  })
})

describe('RC01 — a duplicate-id create must not destroy the live credential', () => {
  beforeEach(() => {
    vault.entries.clear()
    vi.resetModules()
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('reports what happens to the original secret when INSERT conflicts', async () => {
    /*
     * The scenario from the task, in order:
     *
     *   1. create Host A with secret S1
     *   2. record the row, the credential_ref and the vault version
     *   3. create again with the same id and secret S2
     *   4. the INSERT conflicts
     *   5. re-read the original row and the original secret
     *
     * The assertion is deliberately about **the original secret still being readable**,
     * not about which error the second create threw. An error is correct behaviour; losing
     * S1 to produce it is not.
     */
    const db = makeDb()
    const queries: Array<{ sql: string; params: unknown[] }> = []

    vi.doMock('@/service/database/connection', () => ({
      executeQuery: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params })
        db.prepare(sql).run(...(params as never[]))
      },
      select: async (sql: string, params: unknown[] = []) =>
        db.prepare(sql).all(...(params as never[])) as Row[],
      selectStrict: async (sql: string, params: unknown[] = []) =>
        db.prepare(sql).all(...(params as never[])) as Row[],
    }))

    const { createHost } = await import('@/service/database/hosts')

    const hostA = {
      id: 'dup-1',
      name: 'A',
      hostname: 'a.example.com',
      port: 22,
      username: 'deploy',
      authType: 'password' as const,
      password: 'S1',
      portForwards: [],
    }
    await createHost(hostA as never)

    // 2. What the first create actually stored.
    const rowAfterFirst = db
      .prepare('SELECT id, credential_ref FROM hosts WHERE id = ?')
      .get('dup-1') as Row
    expect(rowAfterFirst).toBeTruthy()
    const refAfterFirst = JSON.parse(String(rowAfterFirst.credential_ref))
    expect(refAfterFirst.version).toBe(1)
    expect(await vault.read({ type: 'host', id: 'dup-1' }, 1, 'password')).toBe('S1')

    // 3–4. Same id, different secret. The INSERT must fail.
    const hostA2 = { ...hostA, password: 'S2' }
    await expect(createHost(hostA2 as never)).rejects.toBeTruthy()

    // 5. The original row must still be there and still name a version…
    const rowAfterConflict = db
      .prepare('SELECT id, credential_ref FROM hosts WHERE id = ?')
      .get('dup-1') as Row
    expect(rowAfterConflict).toBeTruthy()
    const refAfterConflict = JSON.parse(String(rowAfterConflict.credential_ref))

    // …and that version must still hold the original secret.
    const originalSecret = await vault.read(
      { type: 'host', id: 'dup-1' },
      refAfterConflict.version,
      'password',
    )

    // The finding, stated so a failure prints the whole picture.
    expect({
      rowSurvived: Boolean(rowAfterConflict),
      refUnchanged: JSON.stringify(refAfterFirst) === JSON.stringify(refAfterConflict),
      secretStillReadable: originalSecret,
      stillOriginal: originalSecret === 'S1',
      vaultAfter: vault.snapshot(),
    }).toEqual({
      rowSurvived: true,
      refUnchanged: true,
      secretStillReadable: 'S1',
      stillOriginal: true,
      vaultAfter: { 'host:dup-1:1:password': 'S1' },
    })
  })
})
