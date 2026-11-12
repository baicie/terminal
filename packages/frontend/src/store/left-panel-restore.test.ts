// UX-1b — what an upgrading user gets, now that there are two panels.
//
// UX-1a taught the layout to fold a pre-rail `sidebarVisible: true` exactly once.
// UX-1b adds a second possible occupant, so the same restored boolean now has to
// resolve to *one* panel instead of "a panel open or not". The rules:
//
// - a layout saved before the rail → no panel (terminal-first)
// - a layout saved by a user who chose to have the sidebar open → the navigation
//   panel, because that is what was open when they left
// - a fresh session → no panel
// - what is open is a session preference; *whether* a panel opens is the layout
//   preference that survives a restart

import { beforeEach, describe, expect, it } from 'vitest'
import type { WorkspaceLayout } from '@/types'
import { useAppStore } from '@/store/app'
import { LAYOUT_SCHEMA_VERSION } from '@/service/workspace-layout-version'

function layout(overrides: Partial<WorkspaceLayout> = {}): WorkspaceLayout {
  return {
    workspaceId: 'ws-1',
    tabs: [
      { id: 'tab-a', label: 'A', type: 'local' },
      { id: 'tab-b', label: 'B', type: 'remote', hostId: 'h-1' },
    ],
    splitGroups: [],
    activeTabId: 'tab-b',
    sidebarVisible: false,
    ...overrides,
  }
}

describe('restoring a workspace resolves one panel', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [],
      splitGroups: [],
      activeTabId: null,
      sidebarVisible: false,
      leftPanel: 'none',
    })
  })

  it('opens no panel for a pre-rail layout', () => {
    // The upgrade case: `sidebarVisible: true` from a build that predates the rail.
    useAppStore.getState().restoreLayout(layout({ sidebarVisible: true }))

    expect(useAppStore.getState().sidebarVisible).toBe(false)
    expect(useAppStore.getState().leftPanel).toBe('none')
  })

  it('opens the navigation panel when the saved layout recorded one', () => {
    useAppStore.getState().restoreLayout(
      layout({ sidebarVisible: true, layoutVersion: LAYOUT_SCHEMA_VERSION }),
    )

    expect(useAppStore.getState().leftPanel).toBe('navigation')
    expect(useAppStore.getState().sidebarVisible).toBe(true)
  })

  it('opens no panel when the saved layout recorded none', () => {
    useAppStore.setState({ leftPanel: 'explorer', sidebarVisible: true })

    useAppStore.getState().restoreLayout(
      layout({ sidebarVisible: false, layoutVersion: LAYOUT_SCHEMA_VERSION }),
    )

    expect(useAppStore.getState().leftPanel).toBe('none')
  })

  it('does not reopen a panel the user closed, even if they had opened one earlier', () => {
    // Closing the panel persists `sidebarVisible: false` at the current version, so
    // the next restore must honor that rather than resurrect the panel.
    useAppStore.setState({ leftPanel: 'navigation', sidebarVisible: true })

    useAppStore.getState().restoreLayout(
      layout({ sidebarVisible: false, layoutVersion: LAYOUT_SCHEMA_VERSION }),
    )

    expect(useAppStore.getState().leftPanel).toBe('none')
  })

  it('preserves every recovery field through the panel resolution', () => {
    // The migration must not be a reason to lose terminals.
    useAppStore.getState().restoreLayout(
      layout({
        tabs: [
          { id: 'tab-a', label: 'A', type: 'local' },
          { id: 'tab-b', label: 'B', type: 'remote', hostId: 'h-1' },
          { id: 'tab-c', label: 'C', type: 'remote', hostId: 'h-2' },
        ],
        splitGroups: [
          { id: 'split-1', mode: 'horizontal', tabs: ['tab-b', 'tab-c'], sizes: [60, 40] },
        ],
        activeTabId: 'tab-c',
        sidebarVisible: true,
      }),
    )

    const state = useAppStore.getState()
    expect(state.tabs.map(tab => tab.id)).toEqual(['tab-a', 'tab-b', 'tab-c'])
    expect(state.splitGroups).toEqual([
      { id: 'split-1', mode: 'horizontal', tabs: ['tab-b', 'tab-c'], sizes: [60, 40] },
    ])
    expect(state.activeTabId).toBe('tab-c')
  })
})

describe('the panel toggle keeps the two flags consistent', () => {
  beforeEach(() => {
    useAppStore.setState({ leftPanel: 'none', sidebarVisible: false })
  })

  it('opens the explorer and marks a panel open', () => {
    useAppStore.getState().toggleSidebar()

    expect(useAppStore.getState().leftPanel).toBe('explorer')
    expect(useAppStore.getState().sidebarVisible).toBe(true)
  })

  it('closes whichever panel is open', () => {
    useAppStore.setState({ leftPanel: 'navigation', sidebarVisible: true })

    useAppStore.getState().toggleSidebar()

    expect(useAppStore.getState().leftPanel).toBe('none')
    expect(useAppStore.getState().sidebarVisible).toBe(false)
  })

  it('never leaves both flags claiming a different panel', () => {
    for (const panel of ['none', 'explorer', 'navigation'] as const) {
      useAppStore.getState().setLeftPanel(panel)
      const state = useAppStore.getState()
      expect(state.sidebarVisible).toBe(panel !== 'none')
      expect(state.leftPanel).toBe(panel)
    }
  })
})
