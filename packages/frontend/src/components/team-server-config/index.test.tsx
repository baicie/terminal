import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamServerConfig } from './index'

const mocks = vi.hoisted(() => ({
  cloudLoadTeams: vi.fn(),
  configure: vi.fn(),
  healthCheck: vi.fn(),
  register: vi.fn(),
  saveSettings: vi.fn(),
  useTeamStore: vi.fn(),
}))

vi.mock('@/components/ui/sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/service/team-api', () => ({
  teamApi: {
    configure: mocks.configure,
    healthCheck: mocks.healthCheck,
    register: mocks.register,
  },
}))

vi.mock('@/store/team', () => ({
  useTeamStore: mocks.useTeamStore,
}))

describe('TeamServerConfig', () => {
  beforeEach(() => {
    mocks.cloudLoadTeams.mockReset()
    mocks.configure.mockReset()
    mocks.healthCheck.mockResolvedValue(true)
    mocks.register.mockResolvedValue({ data: { id: 'user-id' } })
    mocks.saveSettings.mockResolvedValue(undefined)
    mocks.useTeamStore.mockReturnValue({
      cloudLoadTeams: mocks.cloudLoadTeams,
      saveSettings: mocks.saveSettings,
      settings: {
        apiToken: 'configured-token',
        autoSync: false,
        enabled: true,
        endpoint: 'https://team.example.test',
        mode: 'cloud',
        syncInterval: 30000,
      },
      userProfile: { id: 'user-id', name: 'User' },
    })
  })

  afterEach(() => vi.clearAllMocks())

  it('uses an existing token to test the connection without registering again', async () => {
    render(<TeamServerConfig />)

    fireEvent.click(
      screen.getByRole('button', { name: 'settings.testConnection' }),
    )

    await waitFor(() => expect(mocks.healthCheck).toHaveBeenCalledOnce())
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('registers only when the first cloud configuration has no token', async () => {
    mocks.register.mockResolvedValue({ data: { token: 'new-token' } })
    mocks.useTeamStore.mockReturnValue({
      cloudLoadTeams: mocks.cloudLoadTeams,
      saveSettings: mocks.saveSettings,
      settings: {
        autoSync: false,
        enabled: true,
        endpoint: 'https://team.example.test',
        mode: 'cloud',
        syncInterval: 30000,
      },
      userProfile: { id: 'user-id', name: 'User' },
    })

    render(<TeamServerConfig />)

    fireEvent.click(
      screen.getByRole('button', { name: 'settings.testConnection' }),
    )

    await waitFor(() => expect(mocks.healthCheck).toHaveBeenCalledOnce())
    expect(mocks.register).toHaveBeenCalledOnce()
    expect(mocks.configure).toHaveBeenNthCalledWith(
      1,
      'https://team.example.test',
      '',
      'user-id',
    )
    expect(mocks.configure).toHaveBeenLastCalledWith(
      'https://team.example.test',
      'new-token',
      'user-id',
    )
  })

  it('does not report success when first registration returns no token', async () => {
    mocks.register.mockResolvedValue({ error: 'already registered' })
    mocks.useTeamStore.mockReturnValue({
      cloudLoadTeams: mocks.cloudLoadTeams,
      saveSettings: mocks.saveSettings,
      settings: {
        autoSync: false,
        enabled: true,
        endpoint: 'https://team.example.test',
        mode: 'cloud',
        syncInterval: 30000,
      },
      userProfile: { id: 'user-id', name: 'User' },
    })

    render(<TeamServerConfig />)
    fireEvent.click(
      screen.getByRole('button', { name: 'settings.testConnection' }),
    )

    await waitFor(() => expect(mocks.register).toHaveBeenCalledOnce())
    expect(mocks.healthCheck).not.toHaveBeenCalled()
    expect(screen.getByText('already registered')).toBeTruthy()
  })
})
