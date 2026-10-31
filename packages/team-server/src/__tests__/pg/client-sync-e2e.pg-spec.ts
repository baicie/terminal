/* eslint-disable ts/ban-ts-comment -- the client sources resolve through the vitest alias declared in vitest.pg.config.ts */
// @ts-nocheck
// The client under test lives in the front-end package and reaches its own
// sources through that alias, which the server tsconfig does not know about.

import type { DatabaseSync } from 'node:sqlite'
import type { Client } from 'pg'
import type { PrismaService } from '../../prisma.service'
import type { SharedHost, TeamState } from '@/store/team-types'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SyncService } from '../../sync/sync.service'
import { connectRaw, createPrisma, resetDatabase } from './pg-harness'

// Phase 8.9 Task 3：客户端同步端到端闭环（真实 PostgreSQL + 真实客户端 store）。
// 唯一的接缝是网络：fetch 被换成把请求直接投给真实 SyncService 的桥，客户端
// store/actions、本地 SQLite 读写与游标持久化全部走生产代码路径。
const ENDPOINT_A = 'http://team-server-a.test'
const ENDPOINT_B = 'http://team-server-b.test'
const USER_A = 'e2e-user-a'
const USER_B = 'e2e-user-b'
const TOKEN_A = 'token-a'
const TOKEN_B = 'token-b'
const CURSOR_PATTERN = /^\d{1,20}(?:\.\d{1,20})*$/

const sqlite = vi.hoisted(() => ({ databases: [] as unknown[] }))

/** Minimal Web Storage for the node environment; the client uses it for cursors. */
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
  invoke: async () => ({ path: '/tmp/e2e-snapshot.db', tables: 0, rows: 0 }),
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
}

interface ClientHandle {
  name: string
  userId: string
  db: DatabaseSync
  state: () => TeamState
  key: () => string
  cursor: () => string | null
  sync: () => Promise<void>
  shareHost: (
    teamId: string,
    data: Record<string, unknown>,
    permission: 'readonly' | 'readwrite',
  ) => Promise<void>
  updateSharedHost: (
    shareId: string,
    data: Record<string, unknown>,
  ) => Promise<void>
  resolve: (
    resolution: 'LOCAL' | 'REMOTE',
    shareId: string,
    localData?: unknown,
  ) => Promise<void>
  row: (shareId: string) => LocalRow | undefined
  hosts: () => SharedHost[]
}

describe('客户端同步端到端闭环（真实 PostgreSQL + 真实客户端 store）', () => {
  let prisma: PrismaService
  let service: SyncService
  let raw: Client
  let teamId: string
  let clientA: ClientHandle
  let clientB: ClientHandle
  const requests: Array<{ method: string, path: string, since: string | null }> = []
  const realFetch = globalThis.fetch

  async function createClient(
    name: string,
    userId: string,
    token: string,
    endpoint = ENDPOINT_A,
  ): Promise<ClientHandle> {
    vi.resetModules()
    const { createSyncActions } = await import('@/store/team-actions-sync')
    const { createDataActions } = await import('@/store/team-actions-data')
    const { createTeam, getDb, getSharedHosts, getSharedSnippets } = await import('@/service/database')
    const { toSharedHost, toSharedSnippet } = await import('@/store/team-types')
    const { syncCursorStorageKey } = await import('@/store/team-sync-engine')
    // Forces this client's own connection: one SQLite database per module instance.
    await getDb()
    const db = sqlite.databases[sqlite.databases.length - 1] as DatabaseSync
    // The local team row is what the share foreign key points at.
    await createTeam({
      id: teamId,
      name: 'E2E Team',
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
        endpoint,
        apiToken: token,
        syncInterval: 0,
        autoSync: false,
        currentTeamId: teamId,
      },
      currentTeam: { id: teamId, name: 'E2E Team' },
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
    const data = createDataActions(set as never, get)
    const sync = createSyncActions(set as never, get)
    // The cursor scope is one server and one identity: teams are decided by the
    // server on every request, so no team takes part in the storage key.
    const key = () => syncCursorStorageKey({ endpoint, userId })

    return {
      name,
      userId,
      db,
      state: () => state,
      key,
      cursor: () => globalThis.localStorage.getItem(key()),
      sync: () => sync.sync(),
      shareHost: (id, hostData, permission) =>
        data.shareHost(id, hostData, permission),
      updateSharedHost: (shareId, hostData) =>
        data.updateSharedHost(shareId, hostData),
      resolve: (resolution, shareId, localData) =>
        sync.syncWithConflictResolution(resolution, shareId, localData),
      row: shareId => db
        .prepare(
          'SELECT id, team_id, host_data, version, dirty FROM team_shared_hosts WHERE id = ?',
        )
        .get(shareId) as LocalRow | undefined,
      hosts: () => get().sharedHosts,
    }
  }

  async function serverShare(shareId: string) {
    const result = await raw.query(
      'SELECT id, "teamId", "sharedBy", version, data FROM "Share" WHERE id = $1',
      [shareId],
    )
    const row = result.rows[0]
    return row === undefined
      ? undefined
      : {
          id: row.id as string,
          teamId: row.teamId as string,
          sharedBy: row.sharedBy as string,
          version: Number(row.version),
          data: row.data as Record<string, unknown>,
        }
  }

  function snapshot(label: string, shareId: string, extra: Record<string, unknown> = {}) {
    console.info(
      `[e2e] ${  label}`,
      JSON.stringify({
        rowA: clientA?.row(shareId) ?? null,
        rowB: clientB?.row(shareId) ?? null,
        cursorA: clientA?.cursor() ?? null,
        cursorB: clientB?.cursor() ?? null,
        ...extra,
      }),
    )
  }

  beforeAll(async () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    prisma = createPrisma()
    service = new SyncService(prisma)
    raw = await connectRaw()
    await resetDatabase(prisma)
    await prisma.user.createMany({ data: [{ id: USER_A }, { id: USER_B }] })
    const team = await prisma.team.create({
      data: { name: 'E2E Team', ownerId: USER_A },
    })
    teamId = team.id
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
      requests.push({
        method: init?.method ?? 'GET',
        path,
        since: url.searchParams.get('since'),
      })
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (userId === '') {
        return new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
        })
      }
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
      } else {
        return new Response(JSON.stringify({ message: `Unhandled ${  path}` }), {
          status: 404,
        })
      }
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterAll(async () => {
    globalThis.fetch = realFetch
    vi.unstubAllGlobals()
    await raw.end()
    await prisma.onModuleDestroy()
  })

  it('runs create, pull, edit, conflict, resolution and rejoin without losing data', async () => {
    clientA = await createClient('A', USER_A, TOKEN_A)
    clientB = await createClient('B', USER_B, TOKEN_B)
    expect(clientA.db).not.toBe(clientB.db)

    // 1. A creates a host and pushes it: CREATE, because no server version exists.
    await clientA.shareHost(
      teamId,
      { name: 'web-1', hostname: '10.0.0.5' },
      'readwrite',
    )
    const created = clientA.hosts()[0]
    expect(created.version ?? null).toBeNull()
    expect(clientA.row(created.id)?.version).toBeNull()
    await clientA.sync()
    expect(clientA.state().syncError).toBeNull()
    const afterCreate = await serverShare(created.id)
    expect(afterCreate).toMatchObject({
      teamId,
      sharedBy: USER_A,
      data: { name: 'web-1', hostname: '10.0.0.5' },
    })
    const v1 = Number(afterCreate?.version)
    expect(v1).toBeGreaterThanOrEqual(1)
    snapshot('A pushed CREATE', created.id, { server: afterCreate })
    expect(clientA.cursor()).toMatch(CURSOR_PATTERN)
    expect(clientA.cursor()?.startsWith('2.')).toBe(true)

    // 2. A pulls its own change: the server version is stored, the row is clean.
    await clientA.sync()
    expect(clientA.row(created.id)?.version).toBe(v1)
    expect(clientA.row(created.id)?.dirty).toBe(0)
    expect(clientA.cursor()).toMatch(CURSOR_PATTERN)
    snapshot('A converged after CREATE', created.id)

    // 3. B pulls it: the row lands under the team the server reported.
    await clientB.sync()
    expect(clientB.row(created.id)).toMatchObject({
      team_id: teamId,
      version: v1,
      dirty: 0,
    })
    expect(JSON.parse(String(clientB.row(created.id)?.host_data))).toEqual({
      name: 'web-1',
      hostname: '10.0.0.5',
    })
    const cursorAfterFirstPull = clientB.cursor()
    expect(cursorAfterFirstPull).toMatch(CURSOR_PATTERN)
    snapshot('B pulled', created.id)

    // 4. B edits locally: the base version is kept and the row is dirty.
    await clientB.updateSharedHost(created.id, {
      name: 'web-1-by-b',
      hostname: '10.0.0.5',
    })
    expect(clientB.row(created.id)).toMatchObject({ version: v1, dirty: 1 })
    expect(JSON.parse(String(clientB.row(created.id)?.host_data)).name).toBe(
      'web-1-by-b',
    )

    // 5. A pulls, edits and pushes UPDATE with the stored base version.
    await clientA.sync()
    await clientA.updateSharedHost(created.id, {
      name: 'web-1-by-a',
      hostname: '10.0.0.5',
    })
    await clientA.sync()
    expect(await serverShare(created.id)).toMatchObject({
      version: v1 + 1,
      data: { name: 'web-1-by-a', hostname: '10.0.0.5' },
    })
    await clientA.sync()
    expect(clientA.row(created.id)).toMatchObject({ version: v1 + 1, dirty: 0 })
    snapshot('A pushed UPDATE', created.id, { server: await serverShare(created.id) })

    // 6. B syncs: the pull must not overwrite the local edit, the push conflicts.
    await clientB.sync()
    expect(await serverShare(created.id)).toMatchObject({
      version: v1 + 1,
      data: { name: 'web-1-by-a', hostname: '10.0.0.5' },
    })
    expect(clientB.row(created.id)).toMatchObject({ version: v1, dirty: 1 })
    expect(JSON.parse(String(clientB.row(created.id)?.host_data)).name).toBe(
      'web-1-by-b',
    )
    const conflict = clientB
      .state()
      .syncConflicts.find(item => item.shareId === created.id)
    expect(conflict).toBeDefined()
    expect(conflict?.remoteVersion.version).toBe(v1 + 1)
    expect(conflict?.remoteVersion.data).toEqual({
      name: 'web-1-by-a',
      hostname: '10.0.0.5',
    })
    expect(clientB.cursor()).not.toBe(cursorAfterFirstPull)
    expect(clientB.cursor()).toMatch(CURSOR_PATTERN)
    snapshot('B reported a conflict', created.id, {
      conflicts: clientB.state().syncConflicts,
    })

    // 7. The user resolves it on B by keeping the server copy.
    await clientB.resolve('REMOTE', created.id)
    expect(clientB.state().syncConflicts).toEqual([])
    expect(clientB.row(created.id)).toMatchObject({ version: v1 + 1, dirty: 0 })
    expect(JSON.parse(String(clientB.row(created.id)?.host_data)).name).toBe(
      'web-1-by-a',
    )

    // 8. Both ends converge on the same rows and versions.
    await clientA.sync()
    await clientB.sync()
    expect(clientA.row(created.id)).toMatchObject({ version: v1 + 1 })
    expect(clientB.row(created.id)).toMatchObject({ version: v1 + 1 })
    expect(clientA.row(created.id)?.host_data).toBe(
      clientB.row(created.id)?.host_data,
    )
    expect(await serverShare(created.id)).toMatchObject({ version: v1 + 1 })
    snapshot('both ends converged', created.id)

    // 9. Second round: B creates, A edits, B keeps its own copy (LOCAL resolution).
    await clientB.shareHost(
      teamId,
      { name: 'db-1', hostname: '10.0.0.9' },
      'readwrite',
    )
    const second = clientB.hosts().find(item => item.id !== created.id)
    expect(second).toBeDefined()
    const secondId = String(second?.id)
    await clientB.sync()
    await clientB.sync()
    expect(clientB.state().syncError).toBeNull()
    const afterSecondCreate = await serverShare(secondId)
    expect(afterSecondCreate).toMatchObject({ sharedBy: USER_B })
    const w1 = Number(afterSecondCreate?.version)
    expect(w1).toBeGreaterThanOrEqual(1)

    await clientA.sync()
    expect(clientA.row(secondId)).toMatchObject({ version: w1 })
    await clientA.updateSharedHost(secondId, {
      name: 'db-1-by-a',
      hostname: '10.0.0.9',
    })
    await clientA.sync()
    expect(await serverShare(secondId)).toMatchObject({
      version: w1 + 1,
      data: { name: 'db-1-by-a', hostname: '10.0.0.9' },
    })
    snapshot('A pushed UPDATE on second share', secondId, {
      server: await serverShare(secondId),
    })

    await clientB.updateSharedHost(secondId, {
      name: 'db-1-by-b',
      hostname: '10.0.0.9',
    })
    await clientB.sync()
    const secondConflict = clientB
      .state()
      .syncConflicts.find(item => item.shareId === secondId)
    expect(secondConflict?.remoteVersion.version).toBe(w1 + 1)
    expect(await serverShare(secondId)).toMatchObject({ version: w1 + 1 })
    snapshot('B reported the second conflict', secondId)

    await clientB.resolve('LOCAL', secondId, {
      name: 'db-1-by-b',
      hostname: '10.0.0.9',
    })
    expect(clientB.state().syncConflicts).toEqual([])
    expect(await serverShare(secondId)).toMatchObject({
      version: w1 + 2,
      data: { name: 'db-1-by-b', hostname: '10.0.0.9' },
    })

    await clientA.sync()
    await clientB.sync()
    expect(clientA.row(secondId)?.version).toBe(w1 + 2)
    expect(clientB.row(secondId)?.version).toBe(w1 + 2)
    expect(clientA.row(secondId)?.host_data).toBe(
      clientB.row(secondId)?.host_data,
    )
    expect(JSON.parse(String(clientA.row(secondId)?.host_data)).name).toBe(
      'db-1-by-b',
    )
    snapshot('both ends converged after LOCAL resolution', secondId)

    // 10. Rejoin/crash: a lost cursor means a full resnapshot, and the replay
    //     converges on the same rows instead of duplicating or dropping any.
    const rows = 'SELECT id, team_id, host_data, version FROM team_shared_hosts ORDER BY id'
    const beforeRows = clientB.db.prepare(rows).all()
    globalThis.localStorage.removeItem(clientB.key())
    requests.length = 0
    await clientB.sync()
    expect(requests[0]).toMatchObject({ method: 'GET', path: '/sync', since: null })
    expect(clientB.db.prepare(rows).all()).toEqual(beforeRows)
    expect(clientB.cursor()).toMatch(CURSOR_PATTERN)
    snapshot('B resynced from no cursor', secondId, { rows: beforeRows.length })

    // 11. Switching the server does not reuse another server's cursor.
    clientB.state().settings.endpoint = ENDPOINT_B
    requests.length = 0
    await clientB.sync()
    expect(requests[0]).toMatchObject({ path: '/sync', since: null })
    clientB.state().settings.endpoint = ENDPOINT_A
    expect(clientB.cursor()).toMatch(CURSOR_PATTERN)
    requests.length = 0
    await clientB.sync()
    expect(requests[0].since).toMatch(CURSOR_PATTERN)
    snapshot('server switch isolated the cursor', secondId)
  })

  // ---- Phase 9.0 P9.0-2：同步作用域与成员关系变化（真实 PostgreSQL + 真实客户端 store）----
  // 作用域由服务端在每次请求时决定：该用户当前的**完整成员集合**。游标只是这个集合
  // 内部的位置，因此「加入 / 退出 / 换身份」都必须体现为作用域变化，而不是沿用旧位置。
  describe('同步作用域与成员关系变化（P9.0-2）', () => {
    const LEGACY_GLOBAL_KEY = 'terminal.team.syncCursor'
    let scopeClient: ClientHandle
    let historyTeamId = ''

    function localRows(client: ClientHandle, team?: string): number {
      const row = (team === undefined
        ? client.db.prepare('SELECT count(*) AS n FROM team_shared_hosts').get()
        : client.db
            .prepare(
              'SELECT count(*) AS n FROM team_shared_hosts WHERE team_id = ?',
            )
            .get(team)) as { n: number } | undefined
      return Number(row?.n ?? 0)
    }

    /** 客户端本地也要有 teams 行，才和真实流程一致（团队列表先落库）。 */
    function addLocalTeam(client: ClientHandle, id: string, name: string): void {
      client.db
        .prepare(
          `INSERT OR IGNORE INTO teams (id, name, owner_id, mode, auto_sync, created_at, updated_at)
           VALUES (?, ?, ?, 'cloud', 0, ?, ?)`,
        )
        .run(id, name, client.userId, Date.now(), Date.now())
    }

    /** 该用户当前全部团队都先落到本地，模拟「团队列表同步后拉共享」。 */
    async function seedLocalTeams(client: ClientHandle): Promise<void> {
      const memberships = await prisma.teamMember.findMany({
        where: { userId: client.userId },
        select: { teamId: true },
      })
      for (const membership of memberships) {
        addLocalTeam(client, membership.teamId, membership.teamId)
      }
    }

    /** 一个团队 + count 条历史共享，全部在同一个事务里提交。 */
    async function createHistoryTeam(prefix: string, count: number): Promise<string> {
      const team = await prisma.team.create({
        data: { name: `${prefix} Team`, ownerId: USER_B },
      })
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: USER_B, role: 'ADMIN' },
      })
      await raw.query('BEGIN')
      try {
        await raw.query(
          `INSERT INTO "Share" (id, "teamId", type, data, "sharedBy", permission, "isSensitive", "createdAt", "updatedAt")
           SELECT $1 || g, $2, 'HOST', jsonb_build_object('host', $1 || g), $3, 'READONLY', false, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
             FROM generate_series(1, $4::int) AS g`,
          [prefix, team.id, USER_B, count],
        )
        await raw.query('COMMIT')
      } catch (error) {
        await raw.query('ROLLBACK')
        throw error
      }
      return team.id
    }

    /** 游标是服务端位置 (bound, txid, seq)：这里只取续拉会用到的 txid。 */
    function cursorPosition(cursor: string | null): bigint {
      const parts = String(cursor).split('.')
      expect(parts).toHaveLength(4)
      return BigInt(parts[2])
    }

    it('A 加入拥有 500 条历史记录的团队后必须拿到该团队的全部历史', async () => {
      globalThis.localStorage.clear()
      // 500 条历史先提交，客户端随后才第一次同步：于是它们的 txid 全部早于游标。
      historyTeamId = await createHistoryTeam('scope-history-', 500)
      scopeClient = await createClient('scope-A', USER_A, TOKEN_A)
      await scopeClient.sync()
      expect(scopeClient.state().syncError).toBeNull()
      const stored = scopeClient.cursor()
      expect(stored).toMatch(CURSOR_PATTERN)
      const position = cursorPosition(stored)
      // 改前行为的证据：这 500 条变更全部早于游标位置，因此「沿用游标续拉」的窗口
      // (txid > position) 里一条都没有 —— 旧实现就是这样把新团队的历史永久跳过的。
      const below = await raw.query(
        'SELECT count(*)::int AS n FROM "SyncChange" WHERE "teamId" = $1 AND "txid" < $2',
        [historyTeamId, position.toString()],
      )
      const beforeJoin = localRows(scopeClient, historyTeamId)
      console.log(
        `[A] 游标位置=${position} 早于游标的该团队变更=${below.rows[0].n} 加入前本地行数=${beforeJoin}`,
      )
      expect(below.rows[0].n).toBe(500)
      expect(beforeJoin).toBe(0)
      expect(scopeClient.state().currentTeam.id).toBe(teamId)

      // 加入：成员行的事务号晚于游标位置，服务端据此判定位置不可信。
      const membership = await prisma.teamMember.create({
        data: { teamId: historyTeamId, userId: USER_A, role: 'MEMBER' },
      })
      // 加入事务号不早于游标位置：xid 分配可能正好等于冻结的水位（游标 bound 就是
      // 下次分配的第一个 xid），所以判定必须是 >=，相等同样不可信。
      expect(membership.joinedTxid).toBeGreaterThanOrEqual(position)
      addLocalTeam(scopeClient, historyTeamId, 'History Team')

      await scopeClient.sync()
      expect(scopeClient.state().syncError).toBeNull()
      const afterJoin = localRows(scopeClient, historyTeamId)
      console.log(
        `[A] 加入后本地该团队行数=${afterJoin} 总行数=${localRows(scopeClient)}`,
      )
      expect(afterJoin).toBe(500)
    })

    it('E 落库以服务端 teamId 与授权作用域为准，不归入 currentTeam', async () => {
      expect(scopeClient.state().currentTeam.id).toBe(teamId)
      const distinct = (
        scopeClient.db
          .prepare('SELECT DISTINCT team_id AS id FROM team_shared_hosts')
          .all() as Array<{ id: string }>
      ).map(row => row.id)
      const authorized = (await service.getChanges(USER_A)).teams
      console.log(
        `[E] currentTeam=${scopeClient.state().currentTeam.id} 本地团队=${distinct.join(',')} 服务端授权=${authorized.join(',')}`,
      )
      // 新团队的数据只能落在它自己的 team_id 下，不能被 currentTeam 吸收。
      expect(distinct).toContain(historyTeamId)
      expect(distinct).toContain(teamId)
      expect(new Set(distinct).size).toBe(2)
      for (const id of distinct) expect(authorized).toContain(id)
    })

    it('B 退出或被移出团队后不得继续保留或读取该团队的数据', async () => {
      const position = cursorPosition(scopeClient.cursor())
      await prisma.teamMember.delete({
        where: {
          teamId_userId: { teamId: historyTeamId, userId: USER_A },
        },
      })

      // 服务端侧：即便拿着同一个游标，也不再返回该团队的授权数据。
      const direct = await service.getChanges(USER_A, scopeClient.cursor() ?? undefined)
      const leaked = direct.shares.filter(share => share.teamId === historyTeamId)
      console.log(
        `[B] 授权团队=${direct.teams.join(',')} 越权返回条数=${leaked.length} 游标位置=${position}`,
      )
      expect(direct.teams).not.toContain(historyTeamId)
      expect(leaked).toHaveLength(0)

      // 客户端侧：授权集合缩小后，本地该团队的数据必须被清除。
      await scopeClient.sync()
      expect(scopeClient.state().syncError).toBeNull()
      const remaining = localRows(scopeClient, historyTeamId)
      console.log(`[B] 退出后本地该团队行数=${remaining}`)
      expect(remaining).toBe(0)
      const stillAuthorized = localRows(scopeClient, teamId)
      expect(stillAuthorized).toBeGreaterThan(0)
    })

    it('C 切换账户 / API Token 后不得继承另一身份的游标或数据', async () => {
      globalThis.localStorage.clear()
      // 同一个 endpoint、同一个本地 profile id，但 token 属于另一个账户。
      const switched = await createClient('scope-C-switch', USER_A, TOKEN_B)
      await switched.sync()
      console.log(
        `[C] 串号后 syncError=${String(switched.state().syncError)} 已落库行数=${localRows(switched)} 游标=${String(switched.cursor())}`,
      )
      expect(String(switched.state().syncError)).toContain('Sync identity mismatch')
      expect(localRows(switched)).toBe(0)
      expect(switched.cursor()).toBeNull()

      // 正常的账户切换：另一个 profile 有另一个键，不会继承 user A 的游标。
      const other = await createClient('scope-C-other', USER_B, TOKEN_B)
      await seedLocalTeams(other)
      requests.length = 0
      await other.sync()
      expect(requests[0]).toMatchObject({ path: '/sync', since: null })
      expect(other.state().syncError).toBeNull()
    })

    it('D 旧全局游标来源不可证明，只能重新完整同步', async () => {
      globalThis.localStorage.clear()
      // 形状合法、但没有任何服务器或身份归属的旧全局键。
      const legacyCursor
        = '2.00000000000000000000.00000000000000000001.00000000000000000000'
      globalThis.localStorage.setItem(LEGACY_GLOBAL_KEY, legacyCursor)
      const fresh = await createClient('scope-D', USER_A, TOKEN_A)
      requests.length = 0
      await fresh.sync()
      console.log(
        `[D] 首次请求 since=${String(requests[0]?.since)} 旧键=${String(globalThis.localStorage.getItem(LEGACY_GLOBAL_KEY))} 新键游标=${String(fresh.cursor())}`,
      )
      expect(requests[0]).toMatchObject({ path: '/sync', since: null })
      expect(globalThis.localStorage.getItem(LEGACY_GLOBAL_KEY)).toBeNull()
      expect(fresh.cursor()).toMatch(CURSOR_PATTERN)
      expect(fresh.state().syncError).toBeNull()
    })
  })
})
