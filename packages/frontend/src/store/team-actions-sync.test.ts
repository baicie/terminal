import { beforeEach, expect, it, vi } from 'vitest'
import { createSyncActions } from './team-actions-sync'
import { MAX_SYNC_PAGES, syncCursorStorageKey } from './team-sync-engine'
import { convertApiShare as realConvertApiShare } from '@/service/team-api-converters'
import type { TeamState } from './team-types'

const mocks = vi.hoisted(() => ({
  addSharedHost: vi.fn(),
  addSharedSnippet: vi.fn(),
  checkConflicts: vi.fn(),
  configure: vi.fn(),
  convertApiShare: vi.fn(),
  getChanges: vi.fn(),
  pushChanges: vi.fn(),
  removeSharedHost: vi.fn(),
  removeSharesAbsentFromSnapshot: vi.fn(),
  removeSharedSnippet: vi.fn(),
  removeUnauthorizedTeamShares: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  addSharedHost: mocks.addSharedHost,
  addSharedSnippet: mocks.addSharedSnippet,
  removeSharedHost: mocks.removeSharedHost,
  removeSharesAbsentFromSnapshot: mocks.removeSharesAbsentFromSnapshot,
  removeSharedSnippet: mocks.removeSharedSnippet,
  removeUnauthorizedTeamShares: mocks.removeUnauthorizedTeamShares,
}))
vi.mock('@/service/team-api', () => ({
  convertApiShare: mocks.convertApiShare,
  teamApi: {
    checkConflicts: mocks.checkConflicts,
    configure: mocks.configure,
    getChanges: mocks.getChanges,
    pushChanges: mocks.pushChanges,
  },
}))

type Harness = {
  actions: ReturnType<typeof createSyncActions>
  state: () => TeamState
}

function createHarness(overrides: Partial<TeamState> = {}): Harness {
  let state = {
    settings: {
      enabled: true,
      mode: 'cloud',
      endpoint: 'https://team.example.test',
      apiToken: 'token',
      currentTeamId: 'team-1',
    },
    currentTeam: { id: 'team-1', name: 'Team' },
    userProfile: { id: 'user-1' },
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
  }
}

const SCOPE = {
  endpoint: 'https://team.example.test',
  userId: 'user-1',
}
const LEGACY_KEY = 'terminal.team.syncCursor'
const PAGE_ONE = '2.00000000000000000042.00000000000000000007.00000000000000000003'
const PAGE_TWO = '2.00000000000000000042.00000000000000000008.00000000000000000001'

function share(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    teamId: 'team-1',
    type: 'HOST',
    data: { name: 'web-1' },
    permission: 'READONLY',
    sharedBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  }
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.convertApiShare.mockImplementation((input: unknown) =>
    realConvertApiShare(input as never),
  )
  mocks.addSharedHost.mockResolvedValue(true)
  mocks.addSharedSnippet.mockResolvedValue(true)
  globalThis.localStorage.clear()
})

it('ignores a second sync while the first one is still running', async () => {
  let release: (value: unknown) => void = () => undefined
  mocks.getChanges.mockImplementation(
    () =>
      new Promise(resolve => {
        release = resolve
      }),
  )
  const harness = createHarness()

  const first = harness.actions.sync()
  const second = harness.actions.sync()
  await Promise.resolve()
  expect(mocks.getChanges).toHaveBeenCalledTimes(1)

  release({ data: { shares: [], deletedShareIds: [] } })
  await first
  await second
  expect(harness.state().isSyncing).toBe(false)
})

it('keeps conflicts from an earlier run instead of clearing them', async () => {
  mocks.getChanges.mockResolvedValue({
    data: { shares: [], deletedShareIds: [] },
  })
  const existingConflict = {
    shareId: 'share-1',
    localVersion: { updatedAt: 1, data: {} },
    remoteVersion: { updatedAt: 2, data: {}, updatedBy: 'user-2' },
  }
  const harness = createHarness({
    syncConflicts: [existingConflict],
  } as unknown as Partial<TeamState>)

  await harness.actions.sync()

  expect(harness.state().syncConflicts).toEqual([existingConflict])
  expect(harness.state().syncError).toBeNull()
})

it('keeps one cursor per server, identity and protocol generation', () => {
  const keys = new Set([
    syncCursorStorageKey(SCOPE),
    syncCursorStorageKey({ ...SCOPE, endpoint: 'https://other.example.test' }),
    syncCursorStorageKey({ ...SCOPE, userId: 'user-2' }),
  ])

  expect(keys.size).toBe(3)
  for (const key of keys) {
    expect(key).toContain('terminal.team.syncCursor:v2:')
    // prefix + generation + endpoint + identity: the scope is one server and one
    // identity. A team segment would claim an isolation the window does not have
    // (docs/phase8/sync-protocol.md §3.8).
    expect(key.split(':')).toHaveLength(4)
  }
})

it('resumes the same window after switching the current team', async () => {
  mocks.getChanges.mockResolvedValue({
    data: {
      shares: [],
      deletedShareIds: [],
      cursor: PAGE_ONE,
      hasMore: false,
      userId: 'user-1',
      teams: ['team-1', 'team-2'],
    },
  })
  const harness = createHarness()

  await harness.actions.sync()
  expect(mocks.getChanges.mock.calls[0][0]).toBeUndefined()

  const switched = harness.state().currentTeam
  expect(switched).not.toBeNull()
  switched!.id = 'team-2'
  switched!.name = 'Other'
  harness.state().settings.currentTeamId = 'team-2'
  await harness.actions.sync()

  // One identity, one position: the window covers both teams, so switching the
  // selected team must not restart from nothing nor keep a second position.
  expect(mocks.getChanges.mock.calls[1][0]).toBe(PAGE_ONE)
})

it('discards the legacy global cursor instead of porting it into a scope', async () => {
  mocks.getChanges.mockResolvedValue({
    data: {
      shares: [],
      deletedShareIds: [],
      cursor: PAGE_ONE,
      hasMore: false,
      userId: 'user-1',
      teams: ['team-1'],
    },
  })
  globalThis.localStorage.setItem(LEGACY_KEY, PAGE_ONE)
  const harness = createHarness()

  await harness.actions.sync()

  // A global cursor names no server and no identity, so it cannot be proven to
  // belong here: the round asks for the whole window instead of resuming.
  expect(mocks.getChanges.mock.calls[0][0]).toBeUndefined()
  expect(globalThis.localStorage.getItem(LEGACY_KEY)).toBeNull()
  // The cursor the server issued for this scope is stored as usual.
  expect(globalThis.localStorage.getItem(syncCursorStorageKey(SCOPE))).toBe(
    PAGE_ONE,
  )
})

it('drops a legacy value that is not a cursor instead of replaying it', async () => {
  mocks.getChanges.mockResolvedValue({
    data: { shares: [], deletedShareIds: [] },
  })
  globalThis.localStorage.setItem(LEGACY_KEY, '1750000000000')
  globalThis.localStorage.setItem(LEGACY_KEY, 'not-a-cursor')
  const harness = createHarness()

  await harness.actions.sync()

  expect(mocks.getChanges.mock.calls[0][0]).toBeUndefined()
  expect(globalThis.localStorage.getItem(LEGACY_KEY)).toBeNull()
})

it('pulls every page and only advances the cursor page by page', async () => {
  mocks.getChanges
    .mockResolvedValueOnce({
      data: { shares: [], deletedShareIds: [], cursor: PAGE_ONE, hasMore: true },
    })
    .mockResolvedValueOnce({
      data: { shares: [], deletedShareIds: [], cursor: PAGE_TWO, hasMore: false },
    })
  const harness = createHarness()

  await harness.actions.sync()

  expect(mocks.getChanges).toHaveBeenCalledTimes(2)
  expect(mocks.getChanges.mock.calls[0][0]).toBeUndefined()
  expect(mocks.getChanges.mock.calls[1][0]).toBe(PAGE_ONE)
  expect(globalThis.localStorage.getItem(syncCursorStorageKey(SCOPE))).toBe(
    PAGE_TWO,
  )
})

it('does not advance the cursor when a change fails to land', async () => {
  mocks.getChanges.mockResolvedValue({
    data: {
      shares: [share()],
      deletedShareIds: [],
      cursor: PAGE_ONE,
      hasMore: false,
    },
  })
  mocks.addSharedHost.mockRejectedValue(new Error('disk is full'))
  const harness = createHarness()

  await harness.actions.sync()

  expect(harness.state().syncError).toContain('disk is full')
  expect(globalThis.localStorage.getItem(syncCursorStorageKey(SCOPE))).toBeNull()
  expect(mocks.pushChanges).not.toHaveBeenCalled()
})

it('stores a pulled share under the team the server reported', async () => {
  mocks.getChanges.mockResolvedValue({
    data: {
      shares: [share({ id: 'share-9', teamId: 'team-other', version: 7 })],
      deletedShareIds: [],
      cursor: PAGE_ONE,
      hasMore: false,
    },
  })
  const harness = createHarness()

  await harness.actions.sync()

  expect(mocks.addSharedHost).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'share-9', team_id: 'team-other', version: 7 }),
  )
})

it('declares UPDATE with the stored version and CREATE for an unsynced share', async () => {
  mocks.getChanges.mockResolvedValue({
    data: { shares: [], deletedShareIds: [], cursor: PAGE_ONE, hasMore: false },
  })
  mocks.pushChanges.mockResolvedValue({
    data: { created: [], updated: [], deleted: [], conflicts: [], errors: [] },
  })
  const harness = createHarness({
    sharedHosts: [
      {
        id: 'shared-synced',
        teamId: 'team-1',
        hostData: { name: 'a' },
        sharedBy: 'user-1',
        permission: 'readonly',
        createdAt: 1,
        version: 5,
      },
      {
        id: 'shared-local',
        teamId: 'team-1',
        hostData: { name: 'b' },
        sharedBy: 'user-1',
        permission: 'readonly',
        createdAt: 2,
        version: null,
      },
    ],
  } as unknown as Partial<TeamState>)

  await harness.actions.sync()

  const pushed = mocks.pushChanges.mock.calls[0][0]
  expect(pushed[0]).toMatchObject({
    id: 'shared-synced',
    operation: 'UPDATE',
    baseVersion: 5,
  })
  expect(pushed[1]).toMatchObject({ id: 'shared-local', operation: 'CREATE' })
  expect('baseVersion' in pushed[1]).toBe(false)
})

it('drops the local rows of teams the server no longer authorizes', async () => {
  mocks.getChanges.mockResolvedValue({
    data: {
      shares: [],
      deletedShareIds: [],
      cursor: PAGE_ONE,
      hasMore: false,
      userId: 'user-1',
      teams: ['team-1'],
    },
  })
  const harness = createHarness()

  await harness.actions.sync()

  expect(mocks.removeUnauthorizedTeamShares).toHaveBeenCalledWith(['team-1'])
  expect(harness.state().syncError).toBeNull()
})

it('refuses a snapshot that names no team instead of filing it under the current team', async () => {
  mocks.getChanges.mockResolvedValue({
    data: {
      shares: [share({ id: 'share-unowned', teamId: '' })],
      deletedShareIds: [],
      cursor: PAGE_ONE,
      hasMore: false,
      userId: 'user-1',
      teams: ['team-1'],
    },
  })
  const harness = createHarness()

  await harness.actions.sync()

  expect(mocks.addSharedHost).not.toHaveBeenCalled()
  expect(harness.state().syncError).toContain('carries no teamId')
  // A refused page must not advance the position, or the row would be gone.
  expect(globalThis.localStorage.getItem(syncCursorStorageKey(SCOPE))).toBeNull()
})

it('refuses a snapshot from a team outside the scope the server reported', async () => {
  mocks.getChanges.mockResolvedValue({
    data: {
      shares: [share({ id: 'share-foreign', teamId: 'team-foreign' })],
      deletedShareIds: [],
      cursor: PAGE_ONE,
      hasMore: false,
      userId: 'user-1',
      teams: ['team-1'],
    },
  })
  const harness = createHarness()

  await harness.actions.sync()

  expect(mocks.addSharedHost).not.toHaveBeenCalled()
  expect(harness.state().syncError).toContain('may not read')
})

it('never files another identity\'s answer under this scope', async () => {
  mocks.getChanges.mockResolvedValue({
    data: {
      shares: [share({ id: 'share-other-identity' })],
      deletedShareIds: [],
      cursor: PAGE_ONE,
      hasMore: false,
      userId: 'user-2',
      teams: ['team-1'],
    },
  })
  globalThis.localStorage.setItem(syncCursorStorageKey(SCOPE), PAGE_TWO)
  const harness = createHarness()

  await harness.actions.sync()

  expect(mocks.addSharedHost).not.toHaveBeenCalled()
  expect(harness.state().syncError).toContain('Sync identity mismatch')
  // The position cannot be proven to belong to this identity: drop it.
  expect(globalThis.localStorage.getItem(syncCursorStorageKey(SCOPE))).toBeNull()
})
it('reports the page limit instead of claiming the round finished', async () => {
  mocks.pushChanges.mockResolvedValue({
    data: { created: [], updated: [], deleted: [], conflicts: [], errors: [] },
  })
  let page = 0
  mocks.getChanges.mockImplementation(async () => {
    page += 1
    return {
      data: {
        shares: [],
        deletedShareIds: [],
        cursor: `2.00000000000000000042.${String(page).padStart(20, '0')}.00000000000000000001`,
        hasMore: true,
        resync: false,
        userId: 'user-1',
        teams: ['team-1'],
      },
    }
  })
  const harness = createHarness({
    sharedHosts: [
      {
        id: 'pending',
        teamId: 'team-1',
        hostData: { name: 'web' },
        sharedBy: 'user-1',
        permission: 'readonly',
        createdAt: 1,
        version: 1,
        updatedAt: 1,
      },
    ],
  })

  await harness.actions.sync()

  expect(mocks.getChanges).toHaveBeenCalledTimes(MAX_SYNC_PAGES)
  // A stopped round has not seen the window. Pushing from it would submit changes
  // against versions this round never reconciled, and "last synced" would be a
  // claim the round cannot back.
  expect(mocks.pushChanges).not.toHaveBeenCalled()
  expect(harness.state().lastSyncAt).toBeNull()
})

it('removes the ghost rows a complete resync snapshot no longer carries', async () => {
  mocks.removeSharesAbsentFromSnapshot.mockResolvedValue(1)
  mocks.getChanges.mockResolvedValue({
    data: {
      shares: [share({ id: 'still-there' })],
      deletedShareIds: [],
      cursor: PAGE_TWO,
      hasMore: false,
      resync: true,
      userId: 'user-1',
      teams: ['team-1'],
    },
  })
  const harness = createHarness()

  await harness.actions.sync()

  expect(mocks.removeSharesAbsentFromSnapshot).toHaveBeenCalledWith(
    ['team-1'],
    ['still-there'],
  )
})

it('never prunes local rows on a round that proves nothing about absence', async () => {
  mocks.pushChanges.mockResolvedValue({
    data: { created: [], updated: [], deleted: [], conflicts: [], errors: [] },
  })
  // 1. An incremental round: it can only name the ids it delivered, never the
  //    rows deleted outside its window.
  mocks.getChanges.mockResolvedValue({
    data: {
      shares: [],
      deletedShareIds: [],
      cursor: PAGE_ONE,
      hasMore: false,
      resync: false,
      userId: 'user-1',
      teams: ['team-1'],
    },
  })
  await createHarness().actions.sync()
  // 2. A resnapshot the client could not finish reading.
  let page = 0
  mocks.getChanges.mockImplementation(async () => {
    page += 1
    return {
      data: {
        shares: [],
        deletedShareIds: [],
        cursor: `2.00000000000000000043.${String(page).padStart(20, '0')}.00000000000000000002`,
        hasMore: true,
        resync: true,
        userId: 'user-1',
        teams: ['team-1'],
      },
    }
  })
  await createHarness().actions.sync()
  // 3. A resnapshot that reported no authorizing scope at all.
  mocks.getChanges.mockReset()
  mocks.getChanges.mockResolvedValue({
    data: {
      shares: [],
      deletedShareIds: [],
      cursor: PAGE_TWO,
      hasMore: false,
      resync: true,
      userId: 'user-1',
    },
  })
  await createHarness().actions.sync()

  expect(mocks.removeSharesAbsentFromSnapshot).not.toHaveBeenCalled()
})
