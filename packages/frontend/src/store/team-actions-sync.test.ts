import { beforeEach, expect, it, vi } from 'vitest'
import { createSyncActions } from './team-actions-sync'
import type { TeamState } from './team-types'

const mocks = vi.hoisted(() => ({
  addSharedHost: vi.fn(),
  addSharedSnippet: vi.fn(),
  checkConflicts: vi.fn(),
  configure: vi.fn(),
  convertApiShare: vi.fn((input: unknown) => input),
  getChanges: vi.fn(),
  pushChanges: vi.fn(),
  removeSharedHost: vi.fn(),
  removeSharedSnippet: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  addSharedHost: mocks.addSharedHost,
  addSharedSnippet: mocks.addSharedSnippet,
  removeSharedHost: mocks.removeSharedHost,
  removeSharedSnippet: mocks.removeSharedSnippet,
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

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.convertApiShare.mockImplementation((input: unknown) => input)
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
