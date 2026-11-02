/* eslint-disable ts/ban-ts-comment -- the client sources reachable only through the alias below */

// Phase 9.2 P9.2-6：两客户端同步完整性的真机级端到端验证。
//
// 唯一的接缝是网络：`fetch` 被换成一个把请求投给真实 SyncService 的桥，客户端
// store、本地 SQLite、游标持久化和冲突解决全部走生产代码路径。与
// client-sync-e2e.pg-spec.ts 的分工：那个文件验证「一条主链路走通」，这个文件
// 专门验证规范点名的失败路径 —— 敏感共享、法定失败注入、REMOTE 必须真正落库。
//
// 与 client-sync-e2e 一样，客户端源码通过 vitest.pg.config.ts 的 '@' 别名加载，
// TypeScript 无法解析（TS6059），因此逐个 import 抑制而不是整文件 @ts-nocheck。

import type { DatabaseSync } from 'node:sqlite'
import type { PrismaService } from '../../prisma.service'
import type { SeededTeam } from './pg-harness'
// @ts-expect-error -- alias owned by vitest.pg.config.ts; see the note above
import type { SharedHost, TeamState } from '@/store/team-types'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SharesService } from '../../shares/shares.service'
import { SyncService } from '../../sync/sync.service'
import { createPrisma, resetDatabase, seedTeams } from './pg-harness'

const ENDPOINT = 'http://team-server.test'
const USER_A = 'dual-user-a'
const USER_B = 'dual-user-b'
const TOKEN_A = 'dual-token-a'
const TOKEN_B = 'dual-token-b'
const CIPHER_V1 = 'ciphertext-version-1'
const CIPHER_V2 = 'ciphertext-version-2'
const CURSOR_PATTERN = /^\d{1,20}(?:\.\d{1,20})*$/

const sqlite = vi.hoisted(() => ({ databases: [] as unknown[] }))

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>()
  get length(): number {
    return this.items.size
  }

  clear(): void {
    this.items.clear()
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }

  setItem(key: string, value: string): void {
    this.items.set(key, String(value))
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async () => ({ path: '/tmp/dual-snapshot.db', tables: 0, rows: 0 }),
}))

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: async () => {
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(':memory:')
      sqlite.databases.push(db)
      const bind = (params: unknown[]) =>
        params.map(value => (value === undefined ? null : value))
      return {
        execute: async (sql: string, params: unknown[] = []) => {
          const info = db.prepare(sql).run(...(bind(params) as never[]))
          return {
            rowsAffected: Number(info.changes),
            lastInsertId: Number(info.lastInsertRowid),
          }
        },
        select: async (sql: string, params: unknown[] = []) =>
          db.prepare(sql).all(...(bind(params) as never[])),
      }
    },
  },
}))

interface LocalRow {
  id: string
  team_id: string
  host_data: string
  version: number | null
  dirty: number
  is_sensitive: number
  encrypted_data: string | null
  permission: string
}

interface ClientHandle {
  name: string
  userId: string
  db: DatabaseSync
  state: () => TeamState
  cursor: () => string | null
  sync: () => Promise<void>
  resolve: (
    resolution: 'LOCAL' | 'REMOTE',
    shareId: string,
    localData?: unknown,
  ) => Promise<void>
  row: (shareId: string) => LocalRow | undefined
  hosts: () => SharedHost[]
  count: () => number
}

/** `/teams/<teamId>/shares/<shareId>` — the single-share read a REMOTE resolution uses. */
function shareRead(path: string): { teamId: string, shareId: string } | null {
  const match = /^\/teams\/([^/]+)\/shares\/([^/]+)$/.exec(path)
  return match === null ? null : { teamId: match[1], shareId: match[2] }
}

describe('P9.2-6 两客户端同步完整性（真实 PostgreSQL + 真实客户端 store）', () => {
  let prisma: PrismaService
  let service: SyncService
  let sharesService: SharesService
  let ctx: SeededTeam
  let teamId: string
  // Rebuilt per test: one module instance (and one SQLite database) per client,
  // so nothing a test writes can be read by the next one.
  let clientA: ClientHandle
  let clientB: ClientHandle
  const realFetch = globalThis.fetch
  /** Failure injection the tests drive; null means "behave normally". */
  let inject: ((path: string, body: unknown) => Response | null) | null = null

  async function createClient(
    name: string,
    userId: string,
    token: string,
  ): Promise<ClientHandle> {
    vi.resetModules()
    // @ts-expect-error -- alias owned by vitest.pg.config.ts
    const { createSyncActions } = await import('@/store/team-actions-sync')
    // @ts-expect-error -- alias owned by vitest.pg.config.ts
    const { createDataActions } = await import('@/store/team-actions-data')
    // @ts-expect-error -- alias owned by vitest.pg.config.ts
    const { createTeam, getDb, getSharedHosts, getSharedSnippets } = await import('@/service/database')
    // @ts-expect-error -- alias owned by vitest.pg.config.ts
    const { toSharedHost, toSharedSnippet } = await import('@/store/team-types')
    // Forces this client's own connection: one SQLite database per module instance.
    await getDb()
    const db = sqlite.databases[sqlite.databases.length - 1] as DatabaseSync
    await createTeam({
      id: teamId,
      name: 'Dual Team',
      owner_id: userId,
      mode: 'cloud',
      auto_sync: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    })

    let state = {
      settings: {
        enabled: true,
        mode: 'cloud',
        endpoint: ENDPOINT,
        apiToken: token,
        syncInterval: 0,
        autoSync: false,
        currentTeamId: teamId,
      },
      currentTeam: { id: teamId, name: 'Dual Team' },
      userProfile: { id: userId, name, createdAt: 0, updatedAt: 0 },
      teams: [],
      sharedHosts: [],
      sharedSnippets: [],
      isSyncing: false,
      lastSyncAt: null,
      syncError: null,
      syncConflicts: [],
      offlineQueueCount: 0,
      isProcessingQueue: false,
      autoSyncInterval: null,
      loadSharedHosts: async (id: string) => {
        set({ sharedHosts: (await getSharedHosts(id)).map(toSharedHost) })
      },
      loadSharedSnippets: async (id: string) => {
        set({ sharedSnippets: (await getSharedSnippets(id)).map(toSharedSnippet) })
      },
    } as unknown as TeamState

    function set(partial: unknown) {
      const patch = typeof partial === 'function'
        ? (partial as (current: TeamState) => Partial<TeamState>)(state)
        : (partial as Partial<TeamState>)
      state = { ...state, ...patch }
    }

    const get = () => state
    // The data actions are built for their side effects on this client's store:
    // `shareHost`/`updateSharedHost` reach them through `state`, so the returned
    // object itself is not needed here.
    createDataActions(set as never, get)
    const sync = createSyncActions(set as never, get)

    return {
      name,
      userId,
      db,
      state: () => state,
      cursor: () => {
        const store = globalThis.localStorage
        for (let index = 0; index < store.length; index += 1) {
          const key = store.key(index)
          if (key !== null && key.startsWith('terminal.team.syncCursor')) {
            return store.getItem(key)
          }
        }
        return null
      },
      sync: () => sync.sync(),
      resolve: (resolution, shareId, localData) =>
        sync.syncWithConflictResolution(resolution, shareId, localData),
      row: shareId => db
        .prepare(
          `SELECT id, team_id, host_data, version, dirty, is_sensitive, encrypted_data, permission
             FROM team_shared_hosts WHERE id = ?`,
        )
        // node:sqlite types a row as Record<string, SQLOutputValue>, which does not
        // overlap the interface it is read into; the assertion goes through unknown
        // rather than being disabled, so the shape stays checked at the use site.
        .get(shareId) as unknown as LocalRow | undefined,
      hosts: () => get().sharedHosts,
      count: () => Number(
        (db.prepare('SELECT count(*) AS n FROM team_shared_hosts').get() as
          | { n: number }
          | undefined)?.n ?? 0,
      ),
    }
  }

  async function serverRow(id: string) {
    return prisma.share.findUnique({ where: { id } })
  }

  beforeAll(() => {
    prisma = createPrisma()
    service = new SyncService(prisma)
    sharesService = new SharesService(prisma)
  })

  afterAll(async () => {
    await prisma.onModuleDestroy()
  })

  beforeEach(async () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    inject = null
    // Fresh module instances: each client owns its own SQLite database, so a
    // previous test's rows and cursor can never be read here.
    clientA = undefined as never
    clientB = undefined as never
    await resetDatabase(prisma)
    ctx = await seedTeams(prisma)
    teamId = ctx.teamId
    await prisma.user.createMany({
      data: [{ id: USER_A }, { id: USER_B }],
    })
    await prisma.teamMember.createMany({
      data: [
        { teamId, userId: USER_A, role: 'ADMIN' },
        { teamId, userId: USER_B, role: 'MEMBER' },
      ],
    })
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      const headers = (init?.headers ?? {}) as Record<string, string>
      const token = String(headers.Authorization ?? '').replace('Bearer ', '')
      const userId = token === TOKEN_A ? USER_A : token === TOKEN_B ? USER_B : ''
      const path = url.pathname.replace(/^\/api\/v1/, '')
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      const response = inject?.(path, body)
      if (response !== null && response !== undefined) return response
      if (userId === '') {
        return new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
        })
      }
      try {
        let result: unknown
        if (path === '/sync' && (init?.method ?? 'GET') === 'GET') {
          result = await service.getChanges(
            userId,
            url.searchParams.get('since') ?? undefined,
          )
        } else if (path === '/sync' && init?.method === 'POST') {
          result = await service.pushChanges(userId, body)
        } else if (path === '/sync/conflicts/resolve') {
          result = await service.resolveConflict(
            body.shareId,
            userId,
            body.resolution,
            body.clientData,
          )
        } else if (shareRead(path) !== null) {
          const { teamId: readTeamId, shareId } = shareRead(path)!
          result = await sharesService.findOne(readTeamId, shareId, userId)
        } else {
          return new Response(JSON.stringify({ message: `Unhandled ${path}` }), {
            status: 404,
          })
        }
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        // Nest maps its own HTTP exceptions; anything else is a 500.
        const status = (error as { status?: number }).status ?? 500
        return new Response(
          JSON.stringify({ message: (error as Error).message }),
          { status },
        )
      }
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.unstubAllGlobals()
    inject = null
  })

  /** A 创建一条共享并同步到两端，返回服务端分配的第一个版本。 */
  async function seedShared(
    id: string,
    data: Record<string, unknown>,
    sensitive?: { encryptedData: string },
  ): Promise<number> {
    clientA = clientA ?? (await createClient('A', USER_A, TOKEN_A))
    const tx = clientA.db.prepare(
      `INSERT INTO team_shared_hosts
         (id, team_id, host_data, shared_by, permission, created_at, version, updated_at, dirty, is_sensitive, encrypted_data)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)`,
    )
    tx.run(
      id,
      teamId,
      JSON.stringify(sensitive === undefined ? data : {}),
      USER_A,
      'readwrite',
      Date.now(),
      Date.now(),
      sensitive === undefined ? 0 : 1,
      sensitive?.encryptedData ?? null,
    )
    await clientA.state().loadSharedHosts(teamId)
    await clientA.sync()
    await clientA.sync()
    const row = await serverRow(id)
    expect(row).not.toBeNull()
    return Number(row?.version)
  }

  /** One client sees the row at a known version; used by most cases. */
  async function bothClientsSee(id: string): Promise<void> {
    clientA = clientA ?? (await createClient('A', USER_A, TOKEN_A))
    clientB = clientB ?? (await createClient('B', USER_B, TOKEN_B))
    await clientA.sync()
    await clientB.sync()
    expect(clientA.row(id)?.dirty).toBe(0)
    expect(clientB.row(id)?.dirty).toBe(0)
  }

  it('C1 两客户端并发编辑同一条共享：后写者得到冲突，先写者数据不被覆盖', async () => {
    const id = 'dual-concurrent-edit'
    const v1 = await seedShared(id, { name: 'web-1' })
    await bothClientsSee(id)

    // 两边都从 v1 出发改。
    await clientA.state().loadSharedHosts(teamId)
    await clientB.state().loadSharedHosts(teamId)
    await clientA.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'web-1-by-a' }), id)
    await clientB.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'web-1-by-b' }), id)
    await clientA.state().loadSharedHosts(teamId)
    await clientB.state().loadSharedHosts(teamId)

    await clientA.sync()
    const afterA = await serverRow(id)
    expect(Number(afterA?.version)).toBe(v1 + 1)
    expect(afterA?.data).toEqual({ name: 'web-1-by-a' })

    await clientB.sync()
    const afterB = await serverRow(id)
    console.log(
      `[C1] v1=${v1} A后=${String(afterA?.version)} B后=${String(afterB?.version)} data=${JSON.stringify(afterB?.data)} 冲突=${JSON.stringify(clientB.state().syncConflicts.map(c => c.shareId))}`,
    )

    // B 的写入被拒绝成冲突，服务端仍是 A 的内容。
    expect(Number(afterB?.version)).toBe(v1 + 1)
    expect(afterB?.data).toEqual({ name: 'web-1-by-a' })
    expect(clientB.state().syncConflicts.map(item => item.shareId)).toEqual([id])
    // B 的本地编辑仍在，没有被远端覆盖掉，也没有被删除。
    expect(JSON.parse(String(clientB.row(id)?.host_data))).toEqual({
      name: 'web-1-by-b',
    })
    expect(clientB.row(id)?.dirty).toBe(1)
  })

  it('C2 敏感共享：远端更新后本地 LOCAL 解决必须保留密文，不得把明文写进 data', async () => {
    const id = 'dual-sensitive-local'
    const v1 = await seedShared(id, {}, { encryptedData: CIPHER_V1 })
    const created = await serverRow(id)
    expect(created?.isSensitive).toBe(true)
    expect(created?.data).toEqual({})
    await bothClientsSee(id)

    // 本地行必须带着服务端的敏感状态，否则它无法证明自己在保护什么。
    expect(clientA.row(id)).toMatchObject({
      is_sensitive: 1,
      encrypted_data: CIPHER_V1,
    })

    // Both sides move through the production edit path, which keeps the base
    // version and marks the row dirty: A's write lands first and B's loses.
    await clientA.state().loadSharedHosts(teamId)
    await clientB.state().loadSharedHosts(teamId)
    // A sensitive row's local edit is a new ciphertext, so the store-level call
    // that carries `isSensitive`/`encryptedData` is what has to be exercised.
    await clientA.db
      .prepare('UPDATE team_shared_hosts SET encrypted_data = ?, dirty = 1 WHERE id = ?')
      .run(CIPHER_V2, id)
    await clientA.state().loadSharedHosts(teamId)
    await clientA.sync()
    // B reads the *stale* version it still holds, so its push is refused as a
    // conflict rather than silently overwriting A.
    await clientB.state().loadSharedHosts(teamId)
    expect(clientB.row(id)?.version).toBe(v1)
    await clientB.db
      .prepare('UPDATE team_shared_hosts SET encrypted_data = ?, dirty = 1 WHERE id = ?')
      .run('ciphertext-by-b', id)
    await clientB.state().loadSharedHosts(teamId)
    await clientB.sync()
    expect(clientB.state().syncConflicts.map(item => item.shareId)).toEqual([id])

    // B 选 LOCAL。B 不是创建者，所以服务端必须拒绝这次覆盖（权限模型），
    // 但拒绝的方式必须是"什么都没变"，而不是降级或清空密文。
    await clientB.resolve('LOCAL', id)
    const after = await serverRow(id)
    console.log(
      `[C2] v1=${v1} 结果 data=${JSON.stringify(after?.data)} cipher=${String(after?.encryptedData)} isSensitive=${String(after?.isSensitive)} syncError=${String(clientB.state().syncError)}`,
    )

    expect(clientB.state().syncError).toContain('Only creator')
    // 服务端保持原状：仍是敏感、仍是 A 的密文、明文 data 为空。
    expect(after?.isSensitive).toBe(true)
    expect(after?.data).toEqual({})
    expect(after?.encryptedData).toBe(CIPHER_V2)
    // 冲突仍在，B 的本地密文没有被覆盖或丢失。
    expect(clientB.state().syncConflicts).toHaveLength(1)
    expect(clientB.row(id)?.encrypted_data).toBe('ciphertext-by-b')
    expect(clientB.row(id)?.dirty).toBe(1)
  })

  it('C2b 敏感共享：创建者 LOCAL 解决写回自己的密文且不留明文', async () => {
    const id = 'dual-sensitive-owner'
    const v1 = await seedShared(id, {}, { encryptedData: CIPHER_V1 })
    await bothClientsSee(id)

    // A 是创建者。远端先被 A 自己推进一次，然后 B 侧制造一份待解决的冲突副本。
    await clientA.db
      .prepare('UPDATE team_shared_hosts SET encrypted_data = ?, dirty = 1 WHERE id = ?')
      .run(CIPHER_V2, id)
    await clientA.state().loadSharedHosts(teamId)
    await clientA.sync()
    await clientB.sync()
    expect(Number(clientB.row(id)?.version)).toBeGreaterThan(v1)

    // 制造冲突：B 用旧版本写一次，服务端拒绝，B 得到冲突。
    await clientB.db
      .prepare('UPDATE team_shared_hosts SET encrypted_data = ?, version = ?, dirty = 1 WHERE id = ?')
      .run('ciphertext-by-b', v1, id)
    await clientB.state().loadSharedHosts(teamId)
    await clientB.sync()
    expect(clientB.state().syncConflicts).toHaveLength(1)

    // A 作为创建者解决自己这边的冲突：A 持有的密文写回，data 保持为空。
    await clientA.db
      .prepare('UPDATE team_shared_hosts SET encrypted_data = ?, version = ?, dirty = 1 WHERE id = ?')
      .run(CIPHER_V1, v1, id)
    await clientA.state().loadSharedHosts(teamId)
    await clientA.sync()
    const conflict = clientA
      .state()
      .syncConflicts.find(item => item.shareId === id)
    if (conflict !== undefined) {
      await clientA.resolve('LOCAL', id)
    }
    const after = await serverRow(id)
    console.log(
      `[C2b] 创建者解决后 data=${JSON.stringify(after?.data)} cipher=${String(after?.encryptedData)} isSensitive=${String(after?.isSensitive)} syncError=${String(clientA.state().syncError)}`,
    )

    expect(after?.isSensitive).toBe(true)
    expect(after?.data).toEqual({})
    expect(typeof after?.encryptedData).toBe('string')
    expect(String(after?.encryptedData).length).toBeGreaterThan(0)
  })

  it('C3 REMOTE 必须真正落库并只推进到服务端版本，然后才删除冲突', async () => {
    const id = 'dual-remote-persist'
    await seedShared(id, { name: 'base' })
    await bothClientsSee(id)

    await clientA.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-a' }), id)
    await clientA.state().loadSharedHosts(teamId)
    await clientA.sync()
    await clientB.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-b' }), id)
    await clientB.state().loadSharedHosts(teamId)
    await clientB.sync()
    expect(clientB.state().syncConflicts).toHaveLength(1)

    await clientB.resolve('REMOTE', id)
    const local = clientB.row(id)
    const remote = await serverRow(id)
    console.log(
      `[C3] 本地=${JSON.stringify({ v: local?.version, dirty: local?.dirty, data: local?.host_data })} 服务端=${JSON.stringify({ v: Number(remote?.version), data: remote?.data })}`,
    )

    expect(clientB.state().syncError).toBeNull()
    // 落库：内容与服务端一致，版本一致，脏标记清除。
    expect(JSON.parse(String(local?.host_data))).toEqual({ name: 'by-a' })
    expect(Number(local?.version)).toBe(Number(remote?.version))
    expect(local?.dirty).toBe(0)
    expect(remote?.data).toEqual({ name: 'by-a' })
    // 只有在这之后冲突才消失。
    expect(clientB.state().syncConflicts).toEqual([])
  })

  it('C4 REMOTE 读不到服务端快照时冲突必须保留（网络失败不得伪造成功）', async () => {
    const id = 'dual-remote-unreachable'
    await seedShared(id, { name: 'base' })
    await bothClientsSee(id)

    await clientA.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-a' }), id)
    await clientA.state().loadSharedHosts(teamId)
    await clientA.sync()
    await clientB.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-b' }), id)
    await clientB.state().loadSharedHosts(teamId)
    await clientB.sync()
    expect(clientB.state().syncConflicts).toHaveLength(1)

    // A push-only conflict is the shape that reaches the fetch: it carries no
    // remote snapshot, so only the server can say what to adopt. Drop the version
    // from the recorded conflict to reproduce that shape here.
    const only = clientB.state().syncConflicts[0]
    delete only.remoteVersion.version

    // 让单条共享读取失败，但解决请求本身成功。
    inject = (path) => {
      if (shareRead(path) === null) return null
      return new Response(JSON.stringify({ message: 'boom' }), { status: 503 })
    }
    await clientB.resolve('REMOTE', id)
    console.log(
      `[C4] syncError=${String(clientB.state().syncError)} 冲突数=${clientB.state().syncConflicts.length} 本地data=${String(clientB.row(id)?.host_data)}`,
    )

    // 冲突仍在，本地编辑仍在，错误被明确报告。
    expect(clientB.state().syncConflicts).toHaveLength(1)
    expect(clientB.state().syncError).not.toBeNull()
    expect(JSON.parse(String(clientB.row(id)?.host_data))).toEqual({
      name: 'by-b',
    })
  })

  it('C5 服务端拒绝解决请求（http/operation-failed）时冲突必须保留', async () => {
    const id = 'dual-resolve-refused'
    await seedShared(id, { name: 'base' })
    await bothClientsSee(id)

    await clientA.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-a' }), id)
    await clientA.state().loadSharedHosts(teamId)
    await clientA.sync()
    await clientB.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-b' }), id)
    await clientB.state().loadSharedHosts(teamId)
    await clientB.sync()
    const before = await serverRow(id)

    // HTTP 200 carrying success:false — the shape that used to be read as "done".
    inject = (path) => {
      if (path !== '/sync/conflicts/resolve') return null
      return new Response(
        JSON.stringify({ success: false, error: 'CONFLICT_STALE_VERSION' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    await clientB.resolve('LOCAL', id)
    const after = await serverRow(id)
    console.log(
      `[C5] syncError=${String(clientB.state().syncError)} 冲突数=${clientB.state().syncConflicts.length} 服务端版本=${String(before?.version)}->${String(after?.version)}`,
    )

    expect(clientB.state().syncConflicts).toHaveLength(1)
    expect(clientB.state().syncError).toContain('CONFLICT_STALE_VERSION')
    // 服务端一个字节都没变。
    expect(Number(after?.version)).toBe(Number(before?.version))
    expect(after?.data).toEqual(before?.data)
  })

  it('C6 空响应体与非法 JSON 都必须被视为失败，不得删除冲突', async () => {
    const id = 'dual-bad-body'
    await seedShared(id, { name: 'base' })
    await bothClientsSee(id)
    await clientA.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-a' }), id)
    await clientA.state().loadSharedHosts(teamId)
    await clientA.sync()
    await clientB.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-b' }), id)
    await clientB.state().loadSharedHosts(teamId)
    await clientB.sync()
    expect(clientB.state().syncConflicts).toHaveLength(1)

    for (const body of ['', 'not json at all']) {
      inject = (path) =>
        path === '/sync/conflicts/resolve'
          ? new Response(body, {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          : null
      await clientB.resolve('LOCAL', id)
      console.log(
        `[C6] body=${JSON.stringify(body)} syncError=${String(clientB.state().syncError)} 冲突数=${clientB.state().syncConflicts.length}`,
      )
      expect(clientB.state().syncConflicts).toHaveLength(1)
      expect(clientB.state().syncError).not.toBeNull()
    }
  })

  it('C7 冲突解决期间服务端又有人写入：LOCAL 必须被拒绝为过期版本', async () => {
    const id = 'dual-resolve-race'
    const v1 = await seedShared(id, { name: 'base' })
    await bothClientsSee(id)
    // 两边都从同一版本出发改，B 写完时 A 已抢先落地，于是 B 得到冲突。
    await clientA.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-a' }), id)
    await clientB.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-b' }), id)
    await clientA.state().loadSharedHosts(teamId)
    await clientB.state().loadSharedHosts(teamId)
    await clientA.sync()
    await clientB.sync()
    expect(clientB.state().syncConflicts).toHaveLength(1)

    // 用户还在看冲突时，第三个写入落地：服务端版本再推进一次。
    const seen = clientB.state().syncConflicts[0].remoteVersion.version!
    await service.pushChanges(USER_A, {
      shares: [
        {
          id,
          teamId,
          type: 'HOST',
          data: { name: 'by-a-again' },
          permission: 'READWRITE',
          operation: 'UPDATE',
          baseVersion: seen,
        },
      ],
    })
    const advanced = await serverRow(id)
    expect(Number(advanced?.version)).toBeGreaterThan(seen)

    await clientB.resolve('LOCAL', id)
    const after = await serverRow(id)
    console.log(
      `[C7] 用户看到的版本=${seen} 服务端=${String(advanced?.version)} 结果 syncError=${String(clientB.state().syncError)} 最终data=${JSON.stringify(after?.data)} 冲突数=${clientB.state().syncConflicts.length}`,
    )

    // 用户同意的版本已经不是当前版本，写入被拒绝，服务端保持第三方的数据。
    expect(after?.data).toEqual({ name: 'by-a-again' })
    expect(clientB.state().syncConflicts).toHaveLength(1)
    expect(clientB.state().syncError).not.toBeNull()
    expect(Number(after?.version)).toBeGreaterThanOrEqual(v1)
  })

  it('C8 冲突解决后两端重新收敛：内容、版本与脏标记都对上', async () => {
    const id = 'dual-converge'
    await seedShared(id, { name: 'base' })
    await bothClientsSee(id)
    await clientA.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-a' }), id)
    await clientA.state().loadSharedHosts(teamId)
    await clientA.sync()
    await clientB.db
      .prepare('UPDATE team_shared_hosts SET host_data = ?, dirty = 1 WHERE id = ?')
      .run(JSON.stringify({ name: 'by-b' }), id)
    await clientB.state().loadSharedHosts(teamId)
    await clientB.sync()

    // B 选 REMOTE（保留服务端），然后两端各同步一次。
    await clientB.resolve('REMOTE', id)
    await clientA.sync()
    await clientB.sync()

    const rowA = clientA.row(id)
    const rowB = clientB.row(id)
    const server = await serverRow(id)
    console.log(
      `[C8] A=${JSON.stringify({ v: rowA?.version, d: rowA?.dirty, data: rowA?.host_data })} B=${JSON.stringify({ v: rowB?.version, d: rowB?.dirty, data: rowB?.host_data })} 服务端v=${String(server?.version)}`,
    )

    expect(rowA?.host_data).toBe(rowB?.host_data)
    expect(Number(rowA?.version)).toBe(Number(server?.version))
    expect(Number(rowB?.version)).toBe(Number(server?.version))
    expect(rowA?.dirty).toBe(0)
    expect(rowB?.dirty).toBe(0)
    expect(clientA.state().syncConflicts).toEqual([])
    expect(clientB.state().syncConflicts).toEqual([])
  })

  it('C9 未同步成功的本地创建不得被后续拉取丢弃', async () => {
    clientA = await createClient('A', USER_A, TOKEN_A)
    clientB = await createClient('B', USER_B, TOKEN_B)
    const id = 'dual-offline-create'
    clientA.db
      .prepare(
        `INSERT INTO team_shared_hosts
           (id, team_id, host_data, shared_by, permission, created_at, version, updated_at, dirty, is_sensitive, encrypted_data)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, 0, NULL)`,
      )
      .run(
        id,
        teamId,
        JSON.stringify({ name: 'offline' }),
        USER_A,
        'readwrite',
        Date.now(),
        Date.now(),
      )
    await clientA.state().loadSharedHosts(teamId)

    // 推送失败：这条本地创建既不能丢，也不能被当成已同步。
    inject = (path) =>
      path === '/sync' ? new Response('', { status: 502 }) : null
    await clientA.sync()
    console.log(
      `[C9] 失败后 syncError=${String(clientA.state().syncError)} 本地行=${JSON.stringify(clientA.row(id))}`,
    )
    expect(clientA.row(id)).toMatchObject({ dirty: 1 })
    expect(clientA.state().syncError).not.toBeNull()

    // 恢复网络后必须被正常推上去。
    inject = null
    await clientA.sync()
    await clientA.sync()
    const server = await serverRow(id)
    console.log(
      `[C9] 恢复后服务端=${JSON.stringify({ v: Number(server?.version), data: server?.data })} 本地dirty=${String(clientA.row(id)?.dirty)}`,
    )
    expect(server).not.toBeNull()
    expect(server?.data).toEqual({ name: 'offline' })
    expect(clientA.row(id)?.dirty).toBe(0)
    expect(clientA.state().syncError).toBeNull()
  })

  it('C10 同一记录先被删除后被远端重建：本地不得复活旧内容', async () => {
    const id = 'dual-delete-recreate'
    await seedShared(id, { name: 'original' })
    await bothClientsSee(id)

    await service.pushChanges(USER_A, { deleteShares: [id] })
    expect(await serverRow(id)).toBeNull()

    // 客户端拉取后必须删掉本地行。
    await clientB.sync()
    console.log(`[C10] 删除后本地行=${JSON.stringify(clientB.row(id))}`)
    expect(clientB.row(id)).toBeUndefined()

    // 用新内容重建。墓碑还在，所以创建必须带上删除版本作为证明 —— 这正是
    // 服务端拒绝"没看见删除就复活"的地方，客户端拿到墓碑版本后才允许重建。
    const tombstone = await prisma.syncChange.findFirst({
      where: { shareId: id, op: 'DELETE' },
      orderBy: { seq: 'desc' },
      select: { version: true },
    })
    expect(tombstone).not.toBeNull()
    const recreate = await service.pushChanges(USER_A, {
      shares: [
        {
          id,
          teamId,
          type: 'HOST',
          data: { name: 'recreated' },
          permission: 'READWRITE',
          operation: 'CREATE',
          baseVersion: Number(tombstone?.version),
        },
      ],
    })
    expect(recreate.created).toEqual([id])
    console.log(`[C10] 重建结果=${JSON.stringify(recreate)}`)
    await clientB.sync()
    const server = await serverRow(id)
    console.log(
      `[C10] 重建后服务端=${JSON.stringify({ v: Number(server?.version), data: server?.data })} 本地=${String(clientB.row(id)?.host_data)}`,
    )
    expect(JSON.parse(String(clientB.row(id)?.host_data))).toEqual({
      name: 'recreated',
    })
    expect(Number(clientB.row(id)?.version)).toBe(Number(server?.version))
  })

  it('C10b 未证明见过删除的 CREATE 必须被拒绝，服务端不得被复活', async () => {
    const id = 'dual-delete-blind-recreate'
    await seedShared(id, { name: 'original' })
    await bothClientsSee(id)
    await service.pushChanges(USER_A, { deleteShares: [id] })
    expect(await serverRow(id)).toBeNull()

    const blind = await service.pushChanges(USER_A, {
      shares: [
        {
          id,
          teamId,
          type: 'HOST',
          data: { name: 'blind' },
          permission: 'READWRITE',
          operation: 'CREATE',
        },
      ],
    })
    console.log(
      `[C10b] 无版本证明重建=${JSON.stringify(blind)} 服务端行=${String(await serverRow(id))}`,
    )
    expect(blind.created).toEqual([])
    expect(blind.conflicts).toEqual([id])
    expect(await serverRow(id)).toBeNull()
  })

  it('C11 两端各持有不同记录时，一次同步必须同时保留两边的数据', async () => {
    clientA = await createClient('A', USER_A, TOKEN_A)
    clientB = await createClient('B', USER_B, TOKEN_B)
    const aId = 'dual-a-only'
    const bId = 'dual-b-only'
    for (const [client, id, name] of [
      [clientA, aId, 'a-host'],
      [clientB, bId, 'b-host'],
    ] as const) {
      client.db
        .prepare(
          `INSERT INTO team_shared_hosts
             (id, team_id, host_data, shared_by, permission, created_at, version, updated_at, dirty, is_sensitive, encrypted_data)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, 0, NULL)`,
        )
        .run(
          id,
          teamId,
          JSON.stringify({ name }),
          client.userId,
          'readwrite',
          Date.now(),
          Date.now(),
        )
      await client.state().loadSharedHosts(teamId)
      await client.sync()
      await client.sync()
    }
    await clientA.sync()
    await clientB.sync()

    console.log(
      `[C11] A行=${JSON.stringify([...clientA.db.prepare('SELECT id FROM team_shared_hosts').all()])} B行=${JSON.stringify([...clientB.db.prepare('SELECT id FROM team_shared_hosts').all()])}`,
    )
    for (const client of [clientA, clientB]) {
      expect(client.row(aId)).toBeDefined()
      expect(client.row(bId)).toBeDefined()
      expect(client.count()).toBe(2)
    }
    expect(await serverRow(aId)).not.toBeNull()
    expect(await serverRow(bId)).not.toBeNull()
  })

  it('C12 拉取被截断时不得声称同步完成，也不得在半个窗口上推送', async () => {
    clientA = await createClient('A', USER_A, TOKEN_A)
    // 600 条历史共享全部由一个事务提交，远超一页。
    await prisma.$transaction(async (tx) => {
      await tx.share.createMany({
        data: Array.from({ length: 600 }, (_, index) => ({
          id: `dual-bulk-${index}`,
          teamId,
          type: 'HOST' as const,
          data: { name: `bulk-${index}` },
          sharedBy: USER_A,
          permission: 'READONLY' as const,
        })),
      })
    })

    await clientA.sync()
    const pages = await service.getChanges(USER_A)
    console.log(
      `[C12] hasMore=${String(pages.hasMore)} 首页条数=${pages.shares.length} 游标=${pages.cursor} 本地行数=${clientA.count()} lastSyncAt=${String(clientA.state().lastSyncAt)}`,
    )

    // 拿到的必须是完整的一页而不是全部，且本地没有声称"已同步"。
    expect(pages.shares.length).toBeLessThanOrEqual(200)
    expect(clientA.state().syncError).toBeNull()
    // 同步会持续到窗口结束（每次调用续拉一页），所以最终必须全部到位。
    let guard = 0
    while (clientA.count() < 600 && guard < 10) {
      await clientA.sync()
      guard += 1
    }
    console.log(`[C12] 收敛用轮次=${guard + 1} 本地行数=${clientA.count()}`)
    expect(clientA.count()).toBe(600)
    expect(clientA.cursor()).toMatch(CURSOR_PATTERN)
    expect(clientA.state().syncError).toBeNull()
  })
})
