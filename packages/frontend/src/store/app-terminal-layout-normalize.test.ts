import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './app'
import { normalizeTerminalLayout } from './app-terminal-layout'

describe('normalizeTerminalLayout', () => {
  it('deduplicates tabs and reduces an oversized group to two valid panes', () => {
    const layout = normalizeTerminalLayout({
      tabs: [
        {
          id: 'one',
          label: 'One',
          type: 'local',
          splitId: 'stale',
          splitMode: 'vertical',
          splitChildren: ['missing'],
        },
        { id: 'one', label: 'Duplicate', type: 'local' },
        {
          id: 'two',
          label: 'Two',
          type: 'remote',
          splitId: 'wrong',
          splitMode: 'vertical',
        },
        {
          id: 'three',
          label: 'Three',
          type: 'local',
          splitId: 'orphan',
          splitMode: 'horizontal',
        },
      ],
      splitGroups: [
        {
          id: 'main',
          mode: 'horizontal',
          tabs: ['one', 'one', 'missing', 'two', 'three'],
          sizes: [92, 8],
        },
      ],
      activeTabId: 'missing',
    })

    expect(layout.activeTabId).toBe('one')
    expect(layout.splitGroups).toEqual([
      {
        id: 'main',
        mode: 'horizontal',
        tabs: ['one', 'two'],
        sizes: [80, 20],
      },
    ])
    expect(layout.tabs).toEqual([
      {
        id: 'one',
        label: 'One',
        type: 'local',
        splitId: 'main',
        splitMode: 'horizontal',
        splitChildren: ['two'],
      },
      {
        id: 'two',
        label: 'Two',
        type: 'remote',
        splitId: 'main',
        splitMode: 'horizontal',
        splitChildren: ['one'],
      },
      { id: 'three', label: 'Three', type: 'local' },
    ])
  })

  it('drops invalid, duplicate, overlapping, and serial split groups', () => {
    const layout = normalizeTerminalLayout({
      tabs: [
        { id: 'one', label: 'One', type: 'local' },
        { id: 'two', label: 'Two', type: 'remote' },
        { id: 'three', label: 'Three', type: 'local' },
        { id: 'four', label: 'Four', type: 'remote' },
        {
          id: 'serial',
          label: 'COM3',
          type: 'serial',
          serialSessionId: 'serial-session',
        },
      ],
      splitGroups: [
        { id: 'broken', mode: 'horizontal', tabs: ['one', 'missing'] },
        { id: 'shared', mode: 'vertical', tabs: ['one', 'two'] },
        { id: 'shared', mode: 'horizontal', tabs: ['three', 'four'] },
        { id: 'overlap', mode: 'horizontal', tabs: ['two', 'three'] },
        {
          id: 'second',
          mode: 'horizontal',
          tabs: ['three', 'four'],
          sizes: [Number.NaN, 0],
        },
        { id: 'serial-split', mode: 'vertical', tabs: ['serial', 'four'] },
      ],
      activeTabId: 'four',
    })

    expect(layout.splitGroups).toEqual([
      {
        id: 'shared',
        mode: 'vertical',
        tabs: ['one', 'two'],
        sizes: [50, 50],
      },
      {
        id: 'second',
        mode: 'horizontal',
        tabs: ['three', 'four'],
        sizes: [50, 50],
      },
    ])
    expect(layout.activeTabId).toBe('four')
    expect(layout.tabs.find(tab => tab.id === 'serial')).toEqual({
      id: 'serial',
      label: 'COM3',
      type: 'serial',
      serialSessionId: 'serial-session',
    })
  })

  it('uses null as the active tab for an empty restored layout', () => {
    expect(
      normalizeTerminalLayout({
        tabs: [],
        splitGroups: [],
        activeTabId: 'missing',
      }),
    ).toEqual({ tabs: [], splitGroups: [], activeTabId: null })
  })

  it('ignores malformed values loaded from persisted JSON', () => {
    const malformed = {
      tabs: [null, { id: '', label: 'Empty ID', type: 'local' }, 'tab'],
      splitGroups: [{ id: 'split', mode: 'diagonal', tabs: [] }],
      activeTabId: 'missing',
    } as unknown as Parameters<typeof normalizeTerminalLayout>[0]

    expect(normalizeTerminalLayout(malformed)).toEqual({
      tabs: [],
      splitGroups: [],
      activeTabId: null,
    })
  })
})

describe('restoreLayout', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [{ id: 'old', label: 'Old', type: 'local' }],
      splitGroups: [],
      activeTabId: 'old',
      sidebarVisible: true,
      recentlyClosedTabs: [],
    })
  })

  it('atomically restores exact tab IDs, normalized layout, and sidebar state', () => {
    useAppStore.getState().restoreLayout({
      tabs: [
        { id: 'saved-one', label: 'Saved One', type: 'local' },
        { id: 'saved-two', label: 'Saved Two', type: 'remote' },
      ],
      splitGroups: [
        {
          id: 'saved-split',
          mode: 'vertical',
          tabs: ['saved-one', 'saved-two'],
          sizes: [10, 90],
        },
      ],
      activeTabId: 'missing',
      sidebarVisible: false,
    })

    const state = useAppStore.getState()
    expect(state.tabs.map(tab => tab.id)).toEqual(['saved-one', 'saved-two'])
    expect(state.splitGroups[0].sizes).toEqual([20, 80])
    expect(state.activeTabId).toBe('saved-one')
    expect(state.sidebarVisible).toBe(false)
  })

  it('defaults a missing persisted sidebar value to visible', () => {
    useAppStore.getState().restoreLayout({
      tabs: [],
      splitGroups: [],
      activeTabId: null,
      sidebarVisible: undefined as unknown as boolean,
    })

    expect(useAppStore.getState().sidebarVisible).toBe(true)
  })
})
