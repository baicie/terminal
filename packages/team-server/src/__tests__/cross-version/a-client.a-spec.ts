import type { CrossVersionBootstrap, SeedResult, VerifyResult } from './support'
// Historical client side of the cross-version acceptance.
//
// Everything imported through '@/...' here is the released `v0.0.1-dev.2`
// front-end tree prepared into .tmp/team-sync-a (see
// scripts/verify-install/prepare-team-sync-a.mjs). The current client is never
// on this module graph, so a PASS cannot be produced by today's code standing
// in for yesterday's.
//
// Two invocations share one on-disk SQLite database:
//   seed   - A creates two hosts and a snippet through its own store actions,
//            then syncs: its push and pull paths both run over real HTTP.
//   verify - a new A process hydrates from that database and syncs again,
//            which is where the current server's changes and tombstones have
//            to reach an old client.
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { readState, writeState } from './support'

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (command: string) =>
    command === 'runtime_instance_lock_held' ? true : null,
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

const HOST_ONE = {
  name: 'cross-version-host-one',
  hostname: 'one.example.test',
  username: 'alice',
  port: 22,
  tags: ['cross-version'],
}
const HOST_TWO = {
  name: 'cross-version-host-two',
  hostname: 'two.example.test',
  username: 'bob',
  port: 2202,
  tags: ['cross-version'],
}
const SNIPPET = {
  name: 'cross-version-snippet',
  content: 'echo cross-version',
  tags: ['cross-version'],
}

interface HistoricalClient {
  database: typeof import('@/service/database')
  data: ReturnType<typeof import('@/store/team-actions-data').createDataActions>
  sync: ReturnType<typeof import('@/store/team-actions-sync').createSyncActions>
  api: typeof import('@/service/team-api').teamApi
  store: Record<string, unknown> & {
    syncConflicts: Array<{ shareId: string }>
    syncError: string | null
  }
  db: DatabaseSync
}

async function createClient(
  bootstrap: CrossVersionBootstrap,
  dbPath: string,
): Promise<HistoricalClient> {
  process.env.TEAM_SYNC_E2E_DB = dbPath
  vi.resetModules()
  const database = await import('@/service/database')
  const { createDataActions } = await import('@/store/team-actions-data')
  const { createSyncActions } = await import('@/store/team-actions-sync')
  const { teamApi } = await import('@/service/team-api')

  await database.getDb()
  teamApi.configure(bootstrap.base, bootstrap.userA.token, bootstrap.userA.id)

  const store = {
    settings: {
      enabled: true,
      mode: 'cloud',
      endpoint: bootstrap.base,
      apiToken: bootstrap.userA.token,
      syncInterval: 0,
      autoSync: false,
      currentTeamId: bootstrap.teamId,
    },
    currentTeam: { id: bootstrap.teamId, name: 'Cross-version team' },
    userProfile: { id: bootstrap.userA.id, name: 'user-a', createdAt: 0, updatedAt: 0 },
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
  } as unknown as HistoricalClient['store']

  function set(partial: unknown) {
    const patch = typeof partial === 'function'
      ? (partial as (current: typeof store) => Partial<typeof store>)(store)
      : (partial as Partial<typeof store>)
    Object.assign(store, patch)
  }
  const get = () => store
  const data = createDataActions(set as never, get)
  const sync = createSyncActions(set as never, get)
  // The historical store keeps loadSharedHosts/loadSharedSnippets in the same
  // object it reads from; wire them before the first sync call.
  Object.assign(store, {
    loadSharedHosts: data.loadSharedHosts,
    loadSharedSnippets: data.loadSharedSnippets,
  })

  return { database, data, sync, api: teamApi, store, db: new DatabaseSync(dbPath) }
}

function count(db: DatabaseSync, table: string, teamId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE team_id = ?`)
    .get(teamId) as { total: number }
  return Number(row.total)
}

function hostData(db: DatabaseSync, id: string): unknown {
  const row = db
    .prepare('SELECT host_data FROM team_shared_hosts WHERE id = ?')
    .get(id) as { host_data: string } | undefined
  return row === undefined ? null : JSON.parse(row.host_data)
}

function serverShareIds(api: HistoricalClient['api']): Promise<string[]> {
  return api.getChanges().then(response =>
    response.error ? [] : (response.data?.shares ?? []).map(share => share.id),
  )
}

async function runSeed(bootstrap: CrossVersionBootstrap): Promise<SeedResult> {
  const client = await createClient(bootstrap, bootstrap.dbA)
  const failures: string[] = []
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
  await client.data.shareHost(bootstrap.teamId, HOST_ONE, 'readwrite')
  await client.data.shareHost(bootstrap.teamId, HOST_TWO, 'readonly')
  await client.data.shareSnippet(bootstrap.teamId, SNIPPET, 'readonly')
  await client.data.loadSharedHosts(bootstrap.teamId)
  await client.data.loadSharedSnippets(bootstrap.teamId)
  const seededAt = Date.now()
  client.store.lastSyncAt = null
  await client.sync.sync()

  const hostIds = client.store.sharedHosts
    .filter((item: { hostData: { name?: string } }) => item.hostData.name !== undefined)
    .map((item: { id: string }) => item.id)
  const snippetIds = client.store.sharedSnippets.map((item: { id: string }) => item.id)
  if (client.store.syncError !== null) failures.push(`sync error: ${client.store.syncError}`)
  if (count(client.db, 'team_shared_hosts', bootstrap.teamId) !== 2) {
    failures.push('the historical client did not store both hosts')
  }
  if (count(client.db, 'team_shared_snippets', bootstrap.teamId) !== 1) {
    failures.push('the historical client did not store the snippet')
  }
  const remoteIds = await serverShareIds(client.api)
  for (const id of [...hostIds, ...snippetIds]) {
    if (!remoteIds.includes(id)) failures.push(`share ${id} never reached the current server`)
  }
  // What A's own push does on its *next* sync: an existing share is submitted
  // with `baseVersion: createdAt` (a millisecond timestamp). Recording the
  // server's verdict here proves the refusal without waiting for a sync that
  // cannot get past its pull.
  const firstHost = client.store.sharedHosts.find(item =>
    item.hostData.name === HOST_ONE.name)
  const legacyUpdateProbe = firstHost === undefined
    ? null
    : await client.api.pushChanges([{
        id: firstHost.id,
        teamId: bootstrap.teamId,
        type: 'HOST',
        data: { ...HOST_ONE, note: 'legacy-timestamp-update-probe' },
        permission: 'READWRITE',
        baseVersion: firstHost.createdAt,
      }])
  client.db.close()
  return {
    ok: failures.length === 0,
    seededAt,
    teamId: bootstrap.teamId,
    hostIds,
    snippetIds,
    serverShareIds: remoteIds,
    syncError: client.store.syncError,
    pushConflicts: client.store.syncConflicts.map(conflict => conflict.shareId),
    legacyUpdateProbe: legacyUpdateProbe === null
      ? null
      : {
          conflictIds: legacyUpdateProbe.data?.conflicts ?? [],
          errorIds: (legacyUpdateProbe.data?.errors ?? []).map(entry => entry.id),
          requestError: legacyUpdateProbe.error ?? null,
        },
    failedAssertions: failures,
  }
}

async function runVerify(
  bootstrap: CrossVersionBootstrap,
  seed: SeedResult,
): Promise<VerifyResult> {
  const client = await createClient(bootstrap, bootstrap.dbA)
  const failures: string[] = []
  // The app hydrates the team's shares before it syncs; starting from an empty
  // state would hide what the historical push does with the pre-pull snapshot.
  await client.data.loadSharedHosts(bootstrap.teamId)
  await client.data.loadSharedSnippets(bootstrap.teamId)
  client.store.lastSyncAt = seed.seededAt
  await client.sync.sync()

  const upgrade = readUpgradeResult()
  const expectedHostOne = upgrade?.details?.editedHostData ?? null
  const deletedSnippetId = readState<{ deletedSnippetId?: string }>('tombstone.json')
    .deletedSnippetId
  const storedHosts = [seed.hostIds[0], seed.hostIds[1]].map(id => hostData(client.db, id))
  if (expectedHostOne !== null) {
    const first = storedHosts[0] as { name?: string, note?: string } | null
    if (first === null || first.name !== (expectedHostOne as { name?: string }).name) {
      failures.push('the historical client did not keep the edited host')
    }
    if ((expectedHostOne as { note?: string }).note !== undefined
      && first?.note !== (expectedHostOne as { note?: string }).note) {
      failures.push('the historical client did not apply the newer host content')
    }
  }
  const tombstoneRow = deletedSnippetId === undefined
    ? undefined
    : client.db
        .prepare('SELECT id FROM team_shared_snippets WHERE id = ?')
        .get(deletedSnippetId)
  if (deletedSnippetId !== undefined && tombstoneRow !== undefined) {
    failures.push('the historical client kept a share the server deleted')
  }
  const remoteAfterPush = await serverShareIds(client.api)
  const resurrected = deletedSnippetId === undefined
    ? false
    : remoteAfterPush.includes(deletedSnippetId)
  if (client.store.syncError !== null) failures.push(`sync error: ${client.store.syncError}`)

  const result: VerifyResult = {
    ok: failures.length === 0,
    failedAssertions: failures,
    details: {
      storedHostNames: storedHosts.map(value =>
        value === null ? null : (value as { name?: string }).name),
      deletedSnippetId: deletedSnippetId ?? null,
      deletedSnippetStillOnServerAfterHistoricalPush: resurrected,
      pushConflicts: client.store.syncConflicts.map(conflict => conflict.shareId),
      syncError: client.store.syncError,
      serverShareIds: remoteAfterPush,
    },
  }
  client.db.close()
  return result
}

function readUpgradeResult(): { details?: { editedHostData?: unknown } } | null {
  try {
    return readState<{ details?: { editedHostData?: unknown } }>('b-upgrade.json')
  } catch {
    return null
  }
}

describe('historical client (v0.0.1-dev.2) against the current server', () => {
  it('runs its own seed or verify phase', async () => {
    const bootstrap = readState<CrossVersionBootstrap>('bootstrap.json')
    const phase = process.env.TEAM_SYNC_E2E_PHASE ?? 'seed'
    if (phase === 'seed') {
      const result = await runSeed(bootstrap)
      writeState('a-seed.json', result)
      expect(result.failedAssertions).toEqual([])
      return
    }
    const seed = readState<SeedResult>('a-seed.json')
    const result = await runVerify(bootstrap, seed)
    writeState('a-verify.json', result)
    expect(result.failedAssertions).toEqual([])
  })
})
