import type { BResult, CrossVersionBootstrap } from './support'
// Current client side of the cross-version acceptance.
//
// role=upgrade opens a copy of the database the historical client produced and
// runs today's schema migration plus today's sync engine on it. role=peer is a
// second identity on a fresh database: it has to see the old client's shares,
// push its own, and delete one so the tombstone path is exercised.
import { copyFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { readState, writeState } from './support'

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (command: string) => {
    if (command === 'runtime_instance_lock_held') return true
    if (command === 'backup_database_before_migration') {
      return {
        path: `${process.env.TEAM_SYNC_E2E_DB}.snapshot`,
        tables: 4,
        rows: 7,
        transactionId: 'cross-version-e2e',
      }
    }
    if (command === 'database_migration_completed') return true
    return true
  },
}))

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: async () => {
      const file = process.env.TEAM_SYNC_E2E_DB
      if (file === undefined || file === '') {
        throw new Error('TEAM_SYNC_E2E_DB is not set')
      }
      const database = new DatabaseSync(file, { enableDoubleQuotedStringLiterals: true })
      const bind = (params: unknown[]) =>
        params.map(value => (value === undefined ? null : value))
      return {
        execute: async (sql: string, params: unknown[] = []) => {
          const info = database.prepare(sql).run(...(bind(params) as never[]))
          return {
            rowsAffected: Number(info.changes),
            lastInsertId: Number(info.lastInsertRowid),
          }
        },
        select: async (sql: string, params: unknown[] = []) =>
          database.prepare(sql).all(...(bind(params) as never[])),
        close: async () => database.close(),
      }
    },
  },
}))

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

const EDITED_HOST = {
  name: 'cross-version-host-one',
  hostname: 'one.example.test',
  username: 'alice',
  port: 22,
  tags: ['cross-version', 'edited-by-current-client'],
  note: 'edited-by-current-client',
}

interface CurrentClient {
  database: typeof import('@/service/database')
  data: ReturnType<typeof import('@/store/team-actions-data').createDataActions>
  sync: ReturnType<typeof import('@/store/team-actions-sync').createSyncActions>
  api: typeof import('@/service/team-api').teamApi
  store: Record<string, unknown> & {
    sharedHosts: Array<{ id: string, hostData: Record<string, unknown> }>
    sharedSnippets: Array<{ id: string, snippetData: Record<string, unknown> }>
    syncConflicts: Array<{ shareId: string }>
    syncError: string | null
  }
  dbFile: string
}

async function createClient(
  bootstrap: CrossVersionBootstrap,
  dbFile: string,
  user: { id: string, token: string },
): Promise<CurrentClient> {
  process.env.TEAM_SYNC_E2E_DB = dbFile
  vi.resetModules()
  vi.stubGlobal('localStorage', new MemoryStorage())
  const database = await import('@/service/database')
  const { createDataActions } = await import('@/store/team-actions-data')
  const { createSyncActions } = await import('@/store/team-actions-sync')
  const { teamApi } = await import('@/service/team-api')
  await database.getDb()
  teamApi.configure(bootstrap.base, user.token, user.id)

  const store = {
    settings: {
      enabled: true,
      mode: 'cloud',
      endpoint: bootstrap.base,
      apiToken: user.token,
      syncInterval: 0,
      autoSync: false,
      currentTeamId: bootstrap.teamId,
    },
    currentTeam: { id: bootstrap.teamId, name: 'Cross-version team' },
    userProfile: { id: user.id, name: user.id, createdAt: 0, updatedAt: 0 },
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
  } as unknown as CurrentClient['store']

  function set(partial: unknown) {
    const patch = typeof partial === 'function'
      ? (partial as (current: typeof store) => Partial<typeof store>)(store)
      : (partial as Partial<typeof store>)
    Object.assign(store, patch)
  }
  const get = () => store
  const data = createDataActions(set as never, get)
  const sync = createSyncActions(set as never, get)
  Object.assign(store, {
    loadSharedHosts: data.loadSharedHosts,
    loadSharedSnippets: data.loadSharedSnippets,
  })
  return { database, data, sync, api: teamApi, store, dbFile }
}

function columns(file: string, table: string): string[] {
  const database = new DatabaseSync(file, { enableDoubleQuotedStringLiterals: true })
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  database.close()
  return rows.map(row => row.name)
}

function rowCount(file: string, table: string): number {
  const database = new DatabaseSync(file, { enableDoubleQuotedStringLiterals: true })
  const row = database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }
  database.close()
  return Number(row.total)
}

function dirty(file: string, id: string): number {
  const database = new DatabaseSync(file, { enableDoubleQuotedStringLiterals: true })
  const row = database.prepare('SELECT dirty FROM team_shared_hosts WHERE id = ?').get(id) as
    | { dirty: number }
    | undefined
  database.close()
  return row === undefined ? -1 : Number(row.dirty)
}

async function fetchWindow(base: string, token: string): Promise<{
  shares: Array<{ id: string, data: unknown }>
  deletedShareIds: string[]
}> {
  const response = await fetch(`${base}/api/v1/sync`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const body = await response.json() as {
    shares?: Array<{ id: string, data: unknown }>
    deletedShareIds?: string[]
  }
  return { shares: body.shares ?? [], deletedShareIds: body.deletedShareIds ?? [] }
}

async function runUpgrade(bootstrap: CrossVersionBootstrap): Promise<BResult> {
  const failures: string[] = []
  // The historical process has exited, but its writes can still sit in the WAL:
  // copying only the main file produced an empty database the first time this
  // ran. Checkpoint first, then copy, so the upgrade starts from every row A
  // actually wrote.
  const source = new DatabaseSync(bootstrap.dbA, { enableDoubleQuotedStringLiterals: true })
  source.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  source.close()
  copyFileSync(bootstrap.dbA, bootstrap.upgradedDb)
  const before = columns(bootstrap.upgradedDb, 'team_shared_hosts')
  const client = await createClient(bootstrap, bootstrap.upgradedDb, bootstrap.userA)
  const after = columns(bootstrap.upgradedDb, 'team_shared_hosts')
  for (const column of ['version', 'updated_at', 'dirty', 'is_sensitive'])
    if (!after.includes(column)) failures.push(`upgrade did not add column ${column}`)

  await client.sync.sync()
  const rowTotal = rowCount(bootstrap.upgradedDb, 'team_shared_hosts')
  if (rowTotal !== 2) failures.push(`upgrade lost hosts: ${rowTotal} rows`)
  if (rowCount(bootstrap.upgradedDb, 'team_shared_snippets') !== 1)
    failures.push('upgrade lost the snippet')
  if (client.store.syncError !== null) failures.push(`sync error: ${client.store.syncError}`)

  const host = client.store.sharedHosts.find(item =>
    item.hostData.name === EDITED_HOST.name)
  if (host === undefined) {
    failures.push('the current client did not see the old client\'s host')
    return finish(failures, { before, after, rowTotal })
  }
  await client.data.updateSharedHost(host.id, EDITED_HOST)
  const dirtyBefore = dirty(bootstrap.upgradedDb, host.id)
  if (dirtyBefore !== 1) failures.push(`the edit was not marked dirty (${dirtyBefore})`)
  await client.sync.sync()
  const dirtyAfter = dirty(bootstrap.upgradedDb, host.id)
  if (dirtyAfter !== 0) failures.push(`the pushed edit stayed dirty (${dirtyAfter})`)

  const window = await fetchWindow(bootstrap.base, bootstrap.userA.token)
  const remote = window.shares.find(share => share.id === host.id)
  const remoteData = remote?.data as { note?: string } | undefined
  if (remoteData?.note !== EDITED_HOST.note)
    failures.push('the current client\'s edit did not reach the server')
  return finish(failures, {
    before,
    after,
    rowTotal,
    editedShareId: host.id,
    editedHostData: EDITED_HOST,
    dirtyBefore,
    dirtyAfter,
    syncConflicts: client.store.syncConflicts.map(conflict => conflict.shareId),
    syncError: client.store.syncError,
  })
}

async function runPeer(bootstrap: CrossVersionBootstrap): Promise<BResult> {
  const failures: string[] = []
  const client = await createClient(bootstrap, bootstrap.dbB, bootstrap.userB)
  const now = Date.now()
  await client.database.createTeam({
    id: bootstrap.teamId,
    name: 'Cross-version team',
    owner_id: bootstrap.userA.id,
    mode: 'cloud',
    auto_sync: 0,
    created_at: now,
    updated_at: now,
  })
  await client.sync.sync()
  if (client.store.sharedHosts.length !== 2) {
    failures.push(`the peer saw ${client.store.sharedHosts.length} hosts, expected 2`)
  }
  if (client.store.sharedSnippets.length !== 1) {
    failures.push(`the peer saw ${client.store.sharedSnippets.length} snippets, expected 1`)
  }
  await client.data.shareSnippet(bootstrap.teamId, {
    name: 'peer-snippet',
    content: 'created-by-current-peer',
  }, 'readonly')
  await client.sync.sync()
  const peerSnippet = client.store.sharedSnippets.find(item =>
    item.snippetData.name === 'peer-snippet')
  if (peerSnippet === undefined) failures.push('the peer snippet never became visible')

  let deleted = false
  if (peerSnippet !== undefined) {
    const response = await client.api.pushChanges([], [peerSnippet.id])
    deleted = response.data?.deleted?.includes(peerSnippet.id) === true
    if (!deleted) failures.push('the server refused the peer\'s own delete')
    const window = await fetchWindow(bootstrap.base, bootstrap.userB.token)
    if (window.shares.some(share => share.id === peerSnippet.id))
      failures.push('the deleted peer snippet is still served')
  }
  return finish(failures, {
    visibleHosts: client.store.sharedHosts.length,
    visibleSnippets: client.store.sharedSnippets.length,
    peerSnippetId: peerSnippet?.id ?? null,
    deleted,
    syncError: client.store.syncError,
  })
}

function finish(failures: string[], details: Record<string, unknown>): BResult {
  return {
    ok: failures.length === 0,
    role: process.env.TEAM_SYNC_E2E_ROLE ?? '',
    failedAssertions: failures,
    details,
  }
}

describe('current client on a historical database / as a peer', () => {
  it('runs its assigned role', async () => {
    const bootstrap = readState<CrossVersionBootstrap>('bootstrap.json')
    const role = process.env.TEAM_SYNC_E2E_ROLE ?? 'peer'
    const result = role === 'upgrade'
      ? await runUpgrade(bootstrap)
      : await runPeer(bootstrap)
    writeState(`b-${role}.json`, result)
    expect(result.failedAssertions).toEqual([])
  })
})
