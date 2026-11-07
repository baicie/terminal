import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeamStore } from './team'

const mocks = vi.hoisted(() => ({
  api: {
    configure: vi.fn(),
    createTeam: vi.fn(),
    listTeams: vi.fn(),
  },
  persistTeam: vi.fn(async () => undefined),
  addTeamMember: vi.fn(async () => undefined),
}))

vi.mock('@/service/team-api', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, teamApi: mocks.api }
})

vi.mock('@/service/database', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createTeam: mocks.persistTeam,
    addTeamMember: mocks.addTeamMember,
  }
})

const saveSettings = vi.fn(async (patch: Record<string, unknown>) => {
  useTeamStore.setState(state => ({
    settings: { ...state.settings, ...patch },
  }))
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.persistTeam.mockResolvedValue(undefined)
  mocks.addTeamMember.mockResolvedValue(undefined)
  useTeamStore.setState({
    userProfile: {
      id: 'user-1',
      name: 'User',
      createdAt: 0,
      updatedAt: 0,
    },
    settings: { enabled: false, mode: 'local', autoSync: false, syncInterval: 30000 },
    teams: [],
    currentTeam: null,
    saveSettings: saveSettings as never,
  })
})

describe('createCloudTeamWithSettings', () => {
  it('creates on the server and persists the server id before reporting success', async () => {
    mocks.api.listTeams.mockResolvedValue({ data: [] })
    mocks.api.createTeam.mockResolvedValue({
      data: { id: 'srv-1', name: 'Team', ownerId: 'user-1' },
    })

    const result = await useTeamStore
      .getState()
      .createCloudTeamWithSettings(' Team ', 'https://team.example.com/', ' token ')

    expect(result.ok).toBe(true)
    expect(mocks.api.createTeam).toHaveBeenCalledWith('Team')
    expect(mocks.persistTeam).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'srv-1', mode: 'cloud', owner_id: 'user-1' }),
    )
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        mode: 'cloud',
        endpoint: 'https://team.example.com',
        apiToken: 'token',
        currentTeamId: 'srv-1',
      }),
    )
    expect(useTeamStore.getState().currentTeam?.id).toBe('srv-1')
  })

  it('does not create or persist a local team when the server refuses', async () => {
    mocks.api.listTeams.mockResolvedValue({ data: [] })
    mocks.api.createTeam.mockResolvedValue({ error: '401 Unauthorized' })

    const result = await useTeamStore
      .getState()
      .createCloudTeamWithSettings('Team', 'https://team.example.com', 'token')

    expect(result.ok).toBe(false)
    expect(result.stage).toBe('create')
    expect(mocks.persistTeam).not.toHaveBeenCalled()
    expect(saveSettings).not.toHaveBeenCalled()
    expect(useTeamStore.getState().currentTeam).toBeNull()
  })

  it('reports a local persistence failure with the server team id', async () => {
    mocks.api.listTeams.mockResolvedValue({ data: [] })
    mocks.api.createTeam.mockResolvedValue({
      data: { id: 'srv-2', name: 'Team', ownerId: 'user-1' },
    })
    mocks.persistTeam.mockRejectedValue(new Error('disk I/O error'))

    const result = await useTeamStore
      .getState()
      .createCloudTeamWithSettings('Team', 'https://team.example.com', 'token')

    expect(result.ok).toBe(false)
    expect(result.stage).toBe('persist')
    expect(result.serverTeamId).toBe('srv-2')
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('adopts an existing server team instead of creating a duplicate', async () => {
    mocks.api.listTeams.mockResolvedValue({
      data: [{ id: 'srv-3', name: 'Team', ownerId: 'user-1', memberCount: 1, role: 'ADMIN' }],
    })

    const result = await useTeamStore
      .getState()
      .createCloudTeamWithSettings('Team', 'https://team.example.com', 'token')

    expect(result.ok).toBe(true)
    expect(result.adopted).toBe(true)
    expect(mocks.api.createTeam).not.toHaveBeenCalled()
    expect(mocks.persistTeam).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'srv-3' }),
    )
  })

  it('rejects an endpoint without http(s) before touching the network', async () => {
    const result = await useTeamStore
      .getState()
      .createCloudTeamWithSettings('Team', 'team.example.com', 'token')

    expect(result.ok).toBe(false)
    expect(result.stage).toBe('validate')
    expect(mocks.api.listTeams).not.toHaveBeenCalled()
  })
})
