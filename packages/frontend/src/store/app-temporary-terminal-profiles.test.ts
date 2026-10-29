import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearTemporaryTerminalProfiles,
  getTemporaryTerminalProfile,
  registerTemporaryTerminalProfile,
} from '@/features/terminal/services/temporary-terminal-profiles'
import type { Host, Tab } from '@/types'
import { useAppStore } from './app'

const temporaryHost: Host = {
  id: 'quick-connect-host',
  name: 'Quick Connect',
  hostname: 'example.com',
  port: 22,
  username: 'alice',
  authType: 'password',
  password: 'not-persisted',
  isFavorite: false,
  portForwards: [],
  createdAt: 1,
  updatedAt: 1,
}

describe('temporary terminal profile lifecycle', () => {
  beforeEach(() => {
    clearTemporaryTerminalProfiles()
    useAppStore.setState({
      tabs: [],
      splitGroups: [],
      activeTabId: null,
      recentlyClosedTabs: [],
    })
  })

  it('shares a profile across split panes and removes it after the last close', () => {
    const profileId = registerTemporaryTerminalProfile(temporaryHost)
    const tab = useAppStore.getState().addTab({
      label: temporaryHost.name,
      type: 'remote',
      profileId,
    })

    const splitTabId = useAppStore.getState().splitTab(tab.id, 'horizontal')

    expect(useAppStore.getState().tabs.map(item => item.profileId)).toEqual([
      profileId,
      profileId,
    ])

    useAppStore.getState().removeTab(tab.id)
    expect(getTemporaryTerminalProfile(profileId)).toEqual(temporaryHost)

    useAppStore.getState().removeTab(splitTabId!)
    expect(getTemporaryTerminalProfile(profileId)).toBeUndefined()
    expect(useAppStore.getState().recentlyClosedTabs).toEqual([])
  })

  it('drops a persisted temporary tab when its in-memory profile is missing', () => {
    useAppStore.getState().restoreLayout({
      tabs: [
        {
          id: 'temporary',
          label: 'Temporary',
          type: 'remote',
          profileId: 'temporary-profile_missing',
        },
        { id: 'saved', label: 'Saved', type: 'remote', hostId: 'host-1' },
      ],
      splitGroups: [
        {
          id: 'split-1',
          mode: 'horizontal',
          tabs: ['temporary', 'saved'],
          sizes: [50, 50],
        },
      ],
      activeTabId: 'temporary',
      sidebarVisible: true,
    })

    expect(useAppStore.getState().tabs).toEqual([
      { id: 'saved', label: 'Saved', type: 'remote', hostId: 'host-1' },
    ])
    expect(useAppStore.getState().splitGroups).toEqual([])
    expect(useAppStore.getState().activeTabId).toBe('saved')
  })

  it('fails closed for a malformed persisted profile reference', () => {
    useAppStore.getState().restoreLayout({
      tabs: [
        {
          id: 'temporary',
          label: 'Temporary',
          type: 'remote',
          profileId: null,
        } as unknown as Tab,
      ],
      splitGroups: [],
      activeTabId: 'temporary',
      sidebarVisible: true,
    })

    expect(useAppStore.getState().tabs).toEqual([])
    expect(useAppStore.getState().activeTabId).toBeNull()
  })

  it('restores a temporary tab while its process-local profile still exists', () => {
    const profileId = registerTemporaryTerminalProfile(temporaryHost)

    useAppStore.getState().restoreLayout({
      tabs: [
        {
          id: 'temporary',
          label: 'Temporary',
          type: 'remote',
          profileId,
        },
      ],
      splitGroups: [],
      activeTabId: 'temporary',
      sidebarVisible: false,
    })

    expect(useAppStore.getState().tabs[0].profileId).toBe(profileId)
    expect(getTemporaryTerminalProfile(profileId)).toEqual(temporaryHost)
  })

  it('cleans profiles that lose their final reference during layout restore', () => {
    const profileId = registerTemporaryTerminalProfile(temporaryHost)
    useAppStore.setState({
      tabs: [
        {
          id: 'temporary',
          label: 'Temporary',
          type: 'remote',
          profileId,
        },
      ],
      activeTabId: 'temporary',
    })

    useAppStore.getState().restoreLayout({
      tabs: [],
      splitGroups: [],
      activeTabId: null,
      sidebarVisible: true,
    })

    expect(getTemporaryTerminalProfile(profileId)).toBeUndefined()
  })
})
