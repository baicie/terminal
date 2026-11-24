// RC04 — 损坏的 CredentialRef 不能读成「从未保存过秘密」。
//
// ## 现状
//
// `parseCredentialRef` **已经**是三态的，而且文档写明理由：
//
//   ok: true,  ref: null   → 列是空的，这台主机什么都没存
//   ok: true,  ref: …      → 可用的引用
//   ok: false, problem: …  → 存了东西，这个构建读不懂
//
// 「把第三种折叠成第一种，就是损坏指针变成空密码、登录失败描述不出任何东西。」
//
// Host 侧完整保留了三态：`hostRowToHost` 交付 `credentialRef` **加**
// `credentialRefProblem`，连接层在 `credentialRefProblem` 非空时 fail-closed
//（Phase 10.1.1 的 WP4 就是补这个）。
//
// **SSH Key 侧把它折叠了**：`readKeyCredentialRef` 返回 `parsed.ok ? parsed.ref : null`。
// 于是四个消费方拿到的是同一个 `null`，而后缀行为各不相同：
//
//   - `getSSHKeySecret`：损坏 → 「没有秘密」→ 连接时静默使用空材料；
//   - `updateSSHKey`：损坏 → `nextKeyVersion(null) = 1` → **覆盖 version 1 的旧密文**，
//     而那份密文可能正是用户唯一还能手工恢复的东西；
//   - `clearSSHKeyCredential`：损坏 → 什么都不退休 → 静默留下密文；
//   - `deleteSSHKey`：损坏 → 同样不退休。
//
// 这份文件把三态与四个后果钉住，然后由修复给出可区分的结果。

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
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, key_type TEXT NOT NULL,
      private_key TEXT, public_key TEXT NOT NULL, certificate TEXT, passphrase TEXT,
      credential_ref TEXT, is_encrypted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
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
      remove: async () => undefined,
      removeVersion: (...a: Parameters<VaultStandIn['removeVersion']>) =>
        vault.removeVersion(...a),
    },
  }))
  vi.resetModules()
  const mod = await import('@/service/database/ssh-keys')
  const creds = await import('@/service/database/ssh-key-credentials')
  const refs = await import('@/service/credential-ref')
  return {
    ...mod,
    readKeyCredentialRefState: creds.readKeyCredentialRefState,
    parseCredentialRef: refs.parseCredentialRef,
  }
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

/** A row whose credential_ref exists but cannot be read by this build. */
function seedCorrupt(db: DatabaseSync, raw: string) {
  db.prepare(
    `INSERT INTO ssh_keys (id, name, key_type, private_key, public_key, certificate,
       passphrase, credential_ref, is_encrypted, created_at, updated_at)
     VALUES ('k1','deploy','ssh-ed25519',NULL,'ssh-ed25519 AAAA',NULL,NULL,?,1,0,0)`,
  ).run(raw)
}

describe('RC04 — parseCredentialRef already distinguishes three states', () => {
  it('reports empty, usable and damaged differently', async () => {
    // Not a new promise: this is the behaviour the module documents, asserted here so a
    // future collapse of the third state into the first fails somewhere named.
    const database = db()
    const { parseCredentialRef } = await install(database)

    expect(parseCredentialRef(null)).toMatchObject({ ok: true, ref: null, problem: null })
    expect(parseCredentialRef('')).toMatchObject({ ok: true, ref: null })

    const usable = parseCredentialRef(
      JSON.stringify({ kinds: ['privateKey'], provider: 'vault', version: 3 }),
    )
    expect(usable.ok).toBe(true)
    expect(usable.ok && usable.ref?.version).toBe(3)

    for (const damaged of [
      'not json at all',
      '{"kinds":["privateKey"]}',                    // no provider
      '{"provider":"vault","kinds":[]}',             // empty kinds
      '{"provider":"vault","kinds":["x"],"version":9999999999}', // future version
      '{"provider":"elsewhere","kinds":["privateKey"],"version":1}',
    ]) {
      const parsed = parseCredentialRef(damaged)
      expect(parsed.ok, `${damaged} must not parse as usable`).toBe(false)
      expect(parsed.ok === false && parsed.problem.kind).toBeTruthy()
    }
  })
})

describe('RC04 — the SSH key path must not collapse damaged into absent', () => {
  it('exposes the three states to callers instead of a bare null', async () => {
    /*
     * `readKeyCredentialRef` returns `null` for both "the column is empty" and "the
     * column is unreadable". Four call sites then act on that single `null`, and the
     * update path is the dangerous one: `nextKeyVersion(null)` is 1, so a save overwrites
     * version 1 — possibly the only generation still recoverable by hand.
     *
     * The fix is a state-returning reader; the old name keeps working for callers that
     * genuinely only need "usable or not".
     */
    const database = db()
    const { readKeyCredentialRefState } = (await install(database)) as {
      readKeyCredentialRefState: (raw: string | null | undefined) => {
        state: 'ABSENT' | 'VALID' | 'CORRUPT_OR_UNSUPPORTED'
        ref: { version?: number } | null
        problem: { kind: string } | null
      }
    }

    expect(readKeyCredentialRefState(null).state).toBe('ABSENT')
    expect(readKeyCredentialRefState('').state).toBe('ABSENT')
    expect(
      readKeyCredentialRefState(
        JSON.stringify({ kinds: ['privateKey'], provider: 'vault', version: 2 }),
      ).state,
    ).toBe('VALID')
    const corrupt = readKeyCredentialRefState('{ not json')
    expect(corrupt.state).toBe('CORRUPT_OR_UNSUPPORTED')
    expect(corrupt.ref).toBeNull()
    expect(corrupt.problem?.kind).toBeTruthy()
  })

  it('refuses to overwrite version 1 when the stored reference is damaged', async () => {
    /*
     * The measured consequence. A key row points at an unreadable reference; the user
     * edits the key. Collapsing the reference to `null` makes the next version 1, and
     * the write lands on top of whatever version 1 held.
     *
     * Correct behaviour: refuse, and say the stored reference cannot be read. Silently
     * starting over destroys the last copy the user might recover by hand.
     */
    const database = db()
    const { updateSSHKey } = await install(database)

    seedCorrupt(database, '{"provider":"vault","kinds":') // truncated JSON
    // A generation the user might still recover manually.
    await vault.write({ type: 'ssh-key', id: 'k1' }, 1, 'privateKey', 'RECOVERABLE')

    await expect(
      updateSSHKey('k1', { private_key: 'NEW-KEY' } as never),
    ).rejects.toThrow(/reference|credential/i)

    expect(
      await vault.read({ type: 'ssh-key', id: 'k1' }, 1, 'privateKey'),
      'the unreadable reference must not be overwritten by a fresh version 1',
    ).toBe('RECOVERABLE')
  })

  it('does not report a damaged reference as "no secret stored"', async () => {
    /*
     * `getSSHKeySecret` answering `undefined` for a damaged reference is what turns a
     * broken pointer into an empty password at connect time. It must surface the problem
     * instead — the connection layer then refuses rather than authenticating with nothing.
     */
    const database = db()
    const { getSSHKeyCredentials } = await install(database)

    seedCorrupt(database, '{"provider":"vault","kinds":') // truncated JSON

    await expect(getSSHKeyCredentials('k1')).rejects.toThrow(/reference|credential/i)
  })
})
