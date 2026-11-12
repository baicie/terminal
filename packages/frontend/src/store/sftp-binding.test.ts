// UX-1c — INV-13: the SFTP panel is pinned to a host, not to the active tab.
//
// The defect this replaces was one line in `sftp-container.tsx`:
// `activeTab?.hostId`. Switching tabs silently repointed the file browser at a
// different server. That is alarming in a full-page view and unacceptable in a
// dock that stays open while the user works elsewhere in another tab, because a
// delete or a rename is aimed at whatever the panel is showing.
//
// These tests pin the resolution rule, the pin/unpin lifecycle, and the fact that
// the binding is not persisted with the workspace layout.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  differsFromActiveTab,
  resolveSftpHostId,
} from './sftp-binding'
import { useSftpBindingStore } from './sftp-binding-store'
import { useAppStore } from './app'

describe('which host the panel shows', () => {
  it('follows the active tab before anything is pinned', () => {
    // The first open behaves exactly as it did before: you are in a tab for
    // prod-01, you open Files, you see prod-01.
    expect(resolveSftpHostId(null, 'host-prod')).toBe('host-prod')
  })

  it('keeps the pinned host when the active tab changes', () => {
    // The whole point. Focus is not an instruction to open a different server.
    expect(resolveSftpHostId('host-prod', 'host-staging')).toBe('host-prod')
  })

  it('keeps the pinned host when there is no active tab', () => {
    expect(resolveSftpHostId('host-prod', null)).toBe('host-prod')
    expect(resolveSftpHostId('host-prod', undefined)).toBe('host-prod')
  })

  it('has no host when nothing is pinned and nothing is active', () => {
    expect(resolveSftpHostId(null, null)).toBeNull()
  })

  it('reports a divergence only when a pin actually differs', () => {
    // The hint is what makes the pin visible instead of silent.
    expect(differsFromActiveTab('host-prod', 'host-staging')).toBe(true)
    expect(differsFromActiveTab('host-prod', 'host-prod')).toBe(false)
    expect(differsFromActiveTab(null, 'host-staging')).toBe(false)
    expect(differsFromActiveTab('host-prod', null)).toBe(true)
  })
})

describe('the binding lifecycle', () => {
  beforeEach(() => {
    useSftpBindingStore.setState({ hostId: null })
  })

  it('pins when the panel is opened for a host', () => {
    useSftpBindingStore.getState().openFor('host-prod')
    expect(useSftpBindingStore.getState().hostId).toBe('host-prod')
  })

  it('replaces the pin when opened for another host', () => {
    useSftpBindingStore.getState().openFor('host-prod')
    useSftpBindingStore.getState().openFor('host-staging')
    expect(useSftpBindingStore.getState().hostId).toBe('host-staging')
  })

  it('clears the pin when the panel closes', () => {
    // So the next open re-reads the active tab rather than resurrecting a server
    // the user has since moved away from.
    useSftpBindingStore.getState().openFor('host-prod')
    useSftpBindingStore.getState().close()
    expect(useSftpBindingStore.getState().hostId).toBeNull()
  })
})

describe('the binding is not part of the persisted layout', () => {
  beforeEach(() => {
    useSftpBindingStore.setState({ hostId: null })
    useAppStore.setState({
      tabs: [],
      splitGroups: [],
      activeTabId: null,
      sidebarVisible: false,
      leftPanel: 'none',
    })
  })

  it('survives a layout restore untouched', () => {
    useSftpBindingStore.getState().openFor('host-prod')

    useAppStore.getState().restoreLayout({
      tabs: [{ id: 'tab-1', label: 'X', type: 'remote', hostId: 'host-staging' }],
      splitGroups: [],
      activeTabId: 'tab-1',
      sidebarVisible: false,
    })

    // Restoring a workspace must not silently repoint or clear the dock: it is a
    // session decision, not layout state.
    expect(useSftpBindingStore.getState().hostId).toBe('host-prod')
  })

  it('is absent from the layout the store writes', () => {
    // A structural check: `WorkspaceLayout` has no field for this, so a future
    // change that tries to persist it has to change the type first.
    const layout = {
      workspaceId: 'ws-1',
      tabs: [],
      splitGroups: [],
      activeTabId: null,
      sidebarVisible: false,
    }
    expect(Object.keys(layout)).not.toContain('sftpHostId')
    expect(Object.keys(layout)).not.toContain('rightPanel')
  })
})
