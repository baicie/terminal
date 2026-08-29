import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/locales'
import {
  clearTemporaryTerminalProfiles,
  getTemporaryTerminalProfile,
} from '@/features/terminal/services/temporary-terminal-profiles'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { useHostsViewHandlers } from './use-hosts-view-handlers'

const navigate = vi.fn()

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

describe('useHostsViewHandlers Quick Connect', () => {
  beforeEach(() => {
    navigate.mockReset()
    clearTemporaryTerminalProfiles()
    useHostStore.setState({ hosts: [] })
    useAppStore.setState({
      tabs: [],
      splitGroups: [],
      activeTabId: null,
      recentlyClosedTabs: [],
    })
  })

  it('opens credentials for a new target and stores secrets outside the tab', () => {
    const { result } = renderHook(() => useHostsViewHandlers())

    act(() => result.current.handleConnectBarSubmit('deploy@new.example.com:2202'))
    expect(result.current.quickConnectTarget).toEqual({
      hostname: 'new.example.com',
      username: 'deploy',
      port: 2202,
    })

    act(() =>
      result.current.handleQuickConnect({
        name: 'deploy@new.example.com',
        hostname: 'new.example.com',
        port: 2202,
        username: 'deploy',
        authType: 'password',
        password: 'memory-only-secret',
        isFavorite: false,
        portForwards: [],
      }),
    )

    const tab = useAppStore.getState().tabs[0]
    expect(tab).toMatchObject({
      label: 'deploy@new.example.com',
      type: 'remote',
    })
    expect(tab.profileId).toMatch(/^temporary-profile_/)
    expect(tab).not.toHaveProperty('password')
    expect(tab.hostId).toBeUndefined()
    expect(getTemporaryTerminalProfile(tab.profileId!)).toMatchObject({
      password: 'memory-only-secret',
      hostname: 'new.example.com',
    })
    expect(navigate).toHaveBeenCalledWith(`/terminal?tab=${tab.id}`)
  })
})
