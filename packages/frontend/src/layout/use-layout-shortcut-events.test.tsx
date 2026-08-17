import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { SHORTCUT_EVENT_PREFIX } from '@/hooks/use-global-shortcuts'
import { useAppStore } from '@/store/app'
import { useLayoutShortcutEvents } from './use-layout-shortcut-events'

const handlers = {
  onNewLocalTerminal: vi.fn(),
  onToggleSidebar: vi.fn(),
  onToggleHelp: vi.fn(),
  onOpenHelp: vi.fn(),
}

function wrapperAt(pathname: string) {
  return function RouterWrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[pathname]}>{children}</MemoryRouter>
  }
}

function dispatchShortcut(action: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent(`${SHORTCUT_EVENT_PREFIX}${action}`))
  })
}

describe('useLayoutShortcutEvents terminal route guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      tabs: [
        { id: 'one', label: 'One', type: 'local' },
        { id: 'two', label: 'Two', type: 'local' },
      ],
      splitGroups: [],
      activeTabId: 'one',
      recentlyClosedTabs: [],
    })
  })

  it('ignores terminal layout commands outside /terminal', () => {
    renderHook(() => useLayoutShortcutEvents(handlers), {
      wrapper: wrapperAt('/hosts'),
    })

    dispatchShortcut('split-horizontal')
    dispatchShortcut('close-tab')
    dispatchShortcut('next-tab')

    expect(useAppStore.getState().tabs.map(tab => tab.id)).toEqual([
      'one',
      'two',
    ])
    expect(useAppStore.getState().splitGroups).toEqual([])
    expect(useAppStore.getState().activeTabId).toBe('one')
  })

  it('runs terminal layout commands on /terminal', () => {
    const { unmount } = renderHook(() => useLayoutShortcutEvents(handlers), {
      wrapper: wrapperAt('/terminal'),
    })

    dispatchShortcut('split-horizontal')
    expect(useAppStore.getState().splitGroups).toHaveLength(1)

    unmount()
    useAppStore.setState({
      tabs: [
        { id: 'one', label: 'One', type: 'local' },
        { id: 'two', label: 'Two', type: 'local' },
      ],
      splitGroups: [],
      activeTabId: 'one',
    })
    renderHook(() => useLayoutShortcutEvents(handlers), {
      wrapper: wrapperAt('/terminal'),
    })
    dispatchShortcut('close-tab')

    expect(useAppStore.getState().tabs.map(tab => tab.id)).toEqual(['two'])
  })
})
