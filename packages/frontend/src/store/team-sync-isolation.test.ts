// The sync round runs against two real HTTP servers, so "which server answered"
// is decided by the network, not by a mocked function returning a canned object.
//
// Two things are proven here:
//   1. a `configure()` on the shared singleton while a round is between pages
//      cannot redirect that round: it keeps its own endpoint, token and identity;
//   2. a real workspace / account switch makes the round stale — the rest of it
//      is never sent, never applied, and never marks the new scope as synced.

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createSyncActions } from './team-actions-sync'
import { readStoredCursor } from './team-sync-engine'
import { dropStoredCursor } from './team-sync-cursor'
import { teamApi } from '@/service/team-api'
import type { TeamState } from './team-types'

const mocks = vi.hoisted(() => ({
  addSharedHost: vi.fn(),
  addSharedSnippet: vi.fn(),
  removeSharedHost: vi.fn(),
  removeSharedSnippet: vi.fn(),
  removeSharesAbsentFromSnapshot: vi.fn(),
  removeUnauthorizedTeamShares: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  addSharedHost: mocks.addSharedHost,
  addSharedSnippet: mocks.addSharedSnippet,
  removeSharedHost: mocks.removeSharedHost,
  removeSharedSnippet: mocks.removeSharedSnippet,
  removeSharesAbsentFromSnapshot: mocks.removeSharesAbsentFromSnapshot,
  removeUnauthorizedTeamShares: mocks.removeUnauthorizedTeamShares,
}))

interface RecordedRequest {
  path: string
  authorization: string | undefined
}

interface TestServer {
  base: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}

type Reply = { body: unknown; waitFor?: Promise<void> }

function share(id: string, teamId: string, name: string) {
  return {
    id,
    teamId,
    type: 'HOST',
    data: { name, hostname: `${name}.example.test`, username: 'u', port: 22 },
    encryptedData: null,
    isSensitive: false,
    permission: 'READWRITE',
    sharedBy: 'user-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
  }
}

async function startServer(
  replies: Reply[],
  onRequest?: (index: number) => void,
): Promise<TestServer> {
  const requests: RecordedRequest[] = []
  const server = createServer((request, response) => {
    const index = requests.length
    requests.push({
      path: request.url ?? '',
      authorization: request.headers.authorization,
    })
    onRequest?.(index)
    const reply = replies[index]
    const send = () => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(reply?.body ?? { success: false }))
    }
    if (reply?.waitFor) {
      void reply.waitFor.then(send)
      return
    }
    send()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    base: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      ),
  }
}

interface Harness {
  actions: ReturnType<typeof createSyncActions>
  state: () => TeamState
  set: (partial: Partial<Record<keyof TeamState, unknown>>) => void
}

function createHarness(
  overrides: Partial<Record<keyof TeamState, unknown>> = {},
): Harness {
  let state = {
    settings: {
      enabled: true,
      mode: 'cloud',
      endpoint: '',
      apiToken: 'token-a',
      currentTeamId: 'team-1',
    },
    currentTeam: { id: 'team-1', name: 'Team' },
    userProfile: { id: 'user-a' },
    sharedHosts: [],
    sharedSnippets: [],
    isSyncing: false,
    syncError: null,
    syncConflicts: [],
    lastSyncAt: null,
    offlineQueueCount: 0,
    isProcessingQueue: false,
    loadSharedHosts: vi.fn(async () => undefined),
    loadSharedSnippets: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as TeamState
  const set = (partial: unknown) => {
    const patch =
      typeof partial === 'function'
        ? (partial as (current: TeamState) => Partial<TeamState>)(state)
        : (partial as Partial<TeamState>)
    state = { ...state, ...patch }
  }
  return {
    actions: createSyncActions(set as never, () => state),
    state: () => state,
    set: partial => {
      state = { ...state, ...partial } as TeamState
    },
  }
}

let servers: TestServer[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.addSharedHost.mockResolvedValue(true)
  mocks.addSharedSnippet.mockResolvedValue(true)
  mocks.removeSharesAbsentFromSnapshot.mockResolvedValue(0)
  mocks.removeUnauthorizedTeamShares.mockResolvedValue(0)
})

afterEach(async () => {
  for (const server of servers) await server.close()
  servers = []
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

it('keeps a running round on its own server when the singleton is reconfigured', async () => {
  const pageTwoGate = deferred()
  const pageTwoStarted = deferred()
  const serverA = await startServer(
    [
      {
        body: {
          cursor: '2.0.0.1',
          timestamp: 1,
          hasMore: true,
          resync: false,
          userId: 'user-a',
          teams: ['team-1'],
          shares: [share('share-1', 'team-1', 'one')],
          members: [],
          teams_list: [],
          deletedShareIds: [],
          auditLogs: [],
        },
      },
      {
        waitFor: pageTwoGate.promise,
        body: {
          cursor: '2.0.0.2',
          timestamp: 2,
          hasMore: false,
          resync: false,
          userId: 'user-a',
          teams: ['team-1'],
          shares: [share('share-2', 'team-1', 'two')],
          deletedShareIds: [],
        },
      },
    ],
    index => {
      if (index === 1) pageTwoStarted.resolve()
    },
  )
  const serverB = await startServer([{ body: { shares: [] } }])
  servers = [serverA, serverB]

  const harness = createHarness({
    settings: {
      enabled: true,
      mode: 'cloud',
      endpoint: serverA.base,
      apiToken: 'token-a',
      currentTeamId: 'team-1',
    },
  })

  const sync = harness.actions.sync()
  await pageTwoStarted.promise
  // Another feature reconfigures the shared singleton while page 2 is in flight.
  teamApi.configure(serverB.base, 'token-b', 'user-b')
  pageTwoGate.resolve()
  await sync

  expect(serverA.requests.map(request => request.path)).toEqual([
    '/api/v1/sync',
    '/api/v1/sync?since=2.0.0.1',
  ])
  expect(serverB.requests).toEqual([])
  expect(serverA.requests.every(
    request => request.authorization === 'Bearer token-a',
  )).toBe(true)
  expect(mocks.addSharedHost).toHaveBeenCalledTimes(2)
  expect(harness.state().lastSyncAt).not.toBeNull()
})

it('stops a round that a real workspace switch made stale', async () => {
  const pageTwoGate = deferred()
  const pageTwoStarted = deferred()
  const serverA = await startServer(
    [
      {
        body: {
          cursor: '2.0.0.7',
          timestamp: 7,
          hasMore: true,
          resync: false,
          userId: 'user-a',
          teams: ['team-1'],
          shares: [share('share-1', 'team-1', 'one')],
          deletedShareIds: [],
        },
      },
      {
        waitFor: pageTwoGate.promise,
        body: {
          cursor: '2.0.0.8',
          timestamp: 8,
          hasMore: false,
          resync: false,
          userId: 'user-a',
          teams: ['team-1'],
          shares: [share('share-2', 'team-1', 'two')],
          deletedShareIds: [],
        },
      },
    ],
    index => {
      if (index === 1) pageTwoStarted.resolve()
    },
  )
  const serverB = await startServer([{ body: { shares: [] } }])
  servers = [serverA, serverB]

  const harness = createHarness({
    settings: {
      enabled: true,
      mode: 'cloud',
      endpoint: serverA.base,
      apiToken: 'token-a',
      currentTeamId: 'team-1',
    },
  })

  dropStoredCursor({ endpoint: serverA.base, userId: 'user-a' })
  dropStoredCursor({ endpoint: serverB.base, userId: 'user-b' })

  const sync = harness.actions.sync()
  await pageTwoStarted.promise
  // The user switches workspace and account while page 2 is in flight.
  harness.set({
    settings: {
      ...harness.state().settings,
      endpoint: serverB.base,
      apiToken: 'token-b',
    },
    userProfile: { id: 'user-b' },
  })
  pageTwoGate.resolve()
  await sync

  // The round never asked the new server, and the page that arrived after the
  // switch was not written anywhere.
  expect(serverB.requests).toEqual([])
  expect(serverA.requests).toHaveLength(2)
  expect(mocks.addSharedHost).toHaveBeenCalledTimes(1)
  expect(mocks.removeUnauthorizedTeamShares).not.toHaveBeenCalled()

  // The old scope keeps the cursor of the page that was fully applied; the new
  // scope has none, and the round did not claim a completed sync.
  expect(readStoredCursor({ endpoint: serverA.base, userId: 'user-a' }))
    .toBe('2.0.0.7')
  expect(readStoredCursor({ endpoint: serverB.base, userId: 'user-b' }))
    .toBeNull()
  expect(harness.state().lastSyncAt).toBeNull()
  expect(harness.state().syncError).toMatch(/changed while it was running/)
})

it('does not send a page after the token was rotated mid-round', async () => {
  const switchGate = deferred()
  const serverA = await startServer([
    {
      waitFor: switchGate.promise,
      body: {
        cursor: '2.0.0.9',
        timestamp: 9,
        hasMore: false,
        resync: false,
        userId: 'user-a',
        teams: ['team-1'],
        shares: [share('share-1', 'team-1', 'one')],
        deletedShareIds: [],
      },
    },
  ])
  const serverB = await startServer([{ body: { shares: [] } }])
  servers = [serverA, serverB]

  const harness = createHarness({
    settings: {
      enabled: true,
      mode: 'cloud',
      endpoint: serverA.base,
      apiToken: 'token-a',
      currentTeamId: 'team-1',
    },
  })

  const sync = harness.actions.sync()
  // Rotate the token in the store while the first request is still in flight.
  harness.set({
    settings: {
      ...harness.state().settings,
      apiToken: 'token-rotated',
    },
  })
  switchGate.resolve()
  await sync

  expect(serverB.requests).toEqual([])
  expect(mocks.addSharedHost).not.toHaveBeenCalled()
  expect(harness.state().syncError).toMatch(/changed while it was running/)
  expect(harness.state().lastSyncAt).toBeNull()
})
