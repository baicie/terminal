import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from './app'
import { useAppStore } from './app'

type TerminalLayoutActions = AppState & {
  resizeSplit: (splitId: string, sizes: [number, number]) => void
  moveTab: (tabId: string, direction: 'left' | 'right') => void
}

function resetTerminalLayout() {
  useAppStore.setState({
    tabs: [],
    splitGroups: [],
    activeTabId: null,
    recentlyClosedTabs: [],
  })
}

describe('terminal layout state', () => {
  beforeEach(() => {
    resetTerminalLayout()
    vi.restoreAllMocks()
  })

  it('limits a split group to two terminal instances', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1001)
    useAppStore.setState({
      tabs: [{ id: 'local-1', label: 'Local', type: 'local' }],
      activeTabId: 'local-1',
    })

    const secondTabId = useAppStore.getState().splitTab('local-1', 'horizontal')
    const thirdTabId = useAppStore
      .getState()
      .splitTab(secondTabId!, 'horizontal')

    expect(secondTabId).toMatch(/^local-split-\d+$/)
    expect(thirdTabId).toBeNull()
    expect(useAppStore.getState().tabs).toHaveLength(2)
    expect(useAppStore.getState().splitGroups[0].tabs).toEqual([
      'local-1',
      secondTabId,
    ])
  })

  it('creates distinct tab IDs when tabs are opened in the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)

    const first = useAppStore
      .getState()
      .addTab({ label: 'First', type: 'local' })
    const second = useAppStore
      .getState()
      .addTab({ label: 'Second', type: 'local' })

    expect(first.id).not.toBe(second.id)
    expect(new Set(useAppStore.getState().tabs.map(tab => tab.id)).size).toBe(2)
  })

  it('does not reuse a closed tab ID when reopened in the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const original = useAppStore
      .getState()
      .addTab({ label: 'Local', type: 'local' })
    useAppStore.getState().removeTab(original.id)

    const reopened = useAppStore
      .getState()
      .reopenTab(useAppStore.getState().recentlyClosedTabs[0])

    expect(reopened.id).not.toBe(original.id)
  })

  it('does not split a serial tab because its backend session cannot be reused', () => {
    useAppStore.setState({
      tabs: [
        {
          id: 'serial-1',
          label: 'COM3',
          type: 'serial',
          serialSessionId: 'serial-session-1',
          serialConfig: { port: 'COM3', baudRate: 115200 },
        },
      ],
      activeTabId: 'serial-1',
    })

    const before = useAppStore.getState()
    const newTabId = before.splitTab('serial-1', 'horizontal')

    expect(newTabId).toBeNull()
    expect(useAppStore.getState().tabs).toEqual(before.tabs)
    expect(useAppStore.getState().splitGroups).toEqual(before.splitGroups)
    expect(useAppStore.getState().activeTabId).toBe('serial-1')
  })

  it('does not copy a process-local shell title into a new split pane', () => {
    useAppStore.setState({
      tabs: [
        { id: 'local-1', label: 'Local', title: 'user@host: /tmp', type: 'local' },
      ],
      splitGroups: [],
      activeTabId: 'local-1',
    })

    const newTabId = useAppStore.getState().splitTab('local-1', 'vertical')

    expect(newTabId).toBeTruthy()
    expect(useAppStore.getState().tabs.find(tab => tab.id === newTabId)?.title).toBeUndefined()
  })

  it('rejects splitting any existing group that already contains three panes', () => {
    useAppStore.setState({
      tabs: [
        {
          id: 'local-1',
          label: 'One',
          type: 'local',
          splitId: 'split-corrupt',
        },
        { id: 'local-2', label: 'Two', type: 'local' },
        { id: 'local-3', label: 'Three', type: 'local' },
      ],
      splitGroups: [
        {
          id: 'split-corrupt',
          mode: 'horizontal',
          tabs: ['local-1', 'local-2', 'local-3'],
          sizes: [34, 33, 33],
        },
      ],
      activeTabId: 'local-1',
    })

    const newTabId = useAppStore.getState().splitTab('local-1', 'vertical')

    expect(newTabId).toBeNull()
    expect(useAppStore.getState().tabs).toHaveLength(3)
    expect(useAppStore.getState().splitGroups[0].tabs).toHaveLength(3)
  })

  it('normalizes and persists the split ratio', () => {
    useAppStore.setState({
      tabs: [
        {
          id: 'local-1',
          label: 'Local',
          type: 'local',
          splitId: 'split-1',
          splitMode: 'horizontal',
        },
        {
          id: 'local-2',
          label: 'Local 2',
          type: 'local',
          splitId: 'split-1',
          splitMode: 'horizontal',
        },
      ],
      splitGroups: [
        {
          id: 'split-1',
          mode: 'horizontal',
          tabs: ['local-1', 'local-2'],
          sizes: [50, 50],
        },
      ],
    })

    const resizeSplit = (useAppStore.getState() as TerminalLayoutActions)
      .resizeSplit
    expect(resizeSplit).toBeTypeOf('function')
    resizeSplit?.('split-1', [92, 8])

    expect(useAppStore.getState().splitGroups[0].sizes).toEqual([80, 20])
  })

  it('moves terminal tabs without changing the active instance', () => {
    useAppStore.setState({
      tabs: [
        { id: 'local-1', label: 'One', type: 'local' },
        { id: 'local-2', label: 'Two', type: 'local' },
        { id: 'local-3', label: 'Three', type: 'local' },
      ],
      activeTabId: 'local-2',
    })

    const moveTab = (useAppStore.getState() as TerminalLayoutActions).moveTab
    expect(moveTab).toBeTypeOf('function')
    moveTab?.('local-2', 'left')

    expect(useAppStore.getState().tabs.map(tab => tab.id)).toEqual([
      'local-2',
      'local-1',
      'local-3',
    ])
    expect(useAppStore.getState().activeTabId).toBe('local-2')
  })

  it('moves both panes of a split group as one tab group', () => {
    useAppStore.setState({
      tabs: [
        { id: 'local-1', label: 'One', type: 'local' },
        {
          id: 'local-2',
          label: 'Two',
          type: 'local',
          splitId: 'split-1',
          splitMode: 'horizontal',
        },
        {
          id: 'local-3',
          label: 'Three',
          type: 'local',
          splitId: 'split-1',
          splitMode: 'horizontal',
        },
        { id: 'local-4', label: 'Four', type: 'local' },
      ],
      activeTabId: 'local-3',
    })

    useAppStore.getState().moveTab('local-3', 'right')

    expect(useAppStore.getState().tabs.map(tab => tab.id)).toEqual([
      'local-1',
      'local-4',
      'local-2',
      'local-3',
    ])
    expect(useAppStore.getState().activeTabId).toBe('local-3')
  })

  it('activates the remaining pane after closing an active split tab', () => {
    useAppStore.setState({
      tabs: [
        {
          id: 'local-1',
          label: 'One',
          type: 'local',
          splitId: 'split-1',
          splitMode: 'horizontal',
        },
        {
          id: 'local-2',
          label: 'Two',
          type: 'local',
          splitId: 'split-1',
          splitMode: 'horizontal',
        },
        { id: 'local-3', label: 'Three', type: 'local' },
      ],
      splitGroups: [
        {
          id: 'split-1',
          mode: 'horizontal',
          tabs: ['local-1', 'local-2'],
          sizes: [50, 50],
        },
      ],
      activeTabId: 'local-2',
    })

    useAppStore.getState().removeTab('local-2')

    expect(useAppStore.getState().activeTabId).toBe('local-1')
    expect(useAppStore.getState().splitGroups).toHaveLength(0)
    expect(useAppStore.getState().tabs[0].splitId).toBeUndefined()
  })

  it('clears split metadata from both panes when one leaves the split', () => {
    useAppStore.setState({
      tabs: [
        {
          id: 'local-1',
          label: 'One',
          type: 'local',
          splitId: 'split-1',
          splitMode: 'horizontal',
          splitChildren: ['local-2'],
        },
        {
          id: 'local-2',
          label: 'Two',
          type: 'local',
          splitId: 'split-1',
          splitMode: 'horizontal',
          splitChildren: ['local-1'],
        },
      ],
      splitGroups: [
        {
          id: 'split-1',
          mode: 'horizontal',
          tabs: ['local-1', 'local-2'],
          sizes: [50, 50],
        },
      ],
    })

    useAppStore.getState().removeTabFromSplit('local-2')

    expect(useAppStore.getState().splitGroups).toHaveLength(0)
    expect(useAppStore.getState().tabs).toEqual([
      { id: 'local-1', label: 'One', type: 'local' },
      { id: 'local-2', label: 'Two', type: 'local' },
    ])
  })
})
