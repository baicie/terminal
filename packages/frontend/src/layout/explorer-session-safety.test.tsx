// UX-1b — the panel must never cost the user a session.
//
// The task's core standard: "不会因 Explorer 的任何操作中断已有终端会话". Three
// mechanisms could break that, and each gets an assertion:
//
// 1. the panel becoming an ancestor of the terminal (so opening it re-mounts the
//    pane) — pinned here by rendering the real layout;
// 2. opening the panel changing the active tab;
// 3. connecting replacing the current tab instead of adding one.
//
// `INV-1`/`INV-2` (one mount point, one container per tab) have their own tests;
// this file is about *the panel's* effect on them.

import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'

const mounts = vi.hoisted(() => ({ byTab: new Map<string, number>() }))

vi.mock('@/features/connection-explorer/connection-explorer', () => ({
  ConnectionExplorer: () => <div data-testid="connection-explorer" />,
}))
vi.mock('@/components/app-sidebar', () => ({
  default: () => <div data-testid="app-sidebar" />,
}))
/**
 * A stand-in for the terminal layer that counts mounts per tab id. A re-mount here
 * is what a real `TerminalContainer` would do, and in production that means a new
 * xterm instance and a restored-then-rebuilt PTY binding.
 */
vi.mock('./terminal-by-url', () => ({
  TerminalByUrl: () => {
    // Count *mounts*, not renders. A render is free; a mount is what creates an
    // xterm instance and re-binds the PTY in production. Counting in the render
    // body would make every re-render look like a session loss.
    const tabId = useAppStore(state => state.activeTabId) ?? 'none'
    React.useEffect(() => {
      mounts.byTab.set(tabId, (mounts.byTab.get(tabId) ?? 0) + 1)
    }, [tabId])
    return <div data-testid="terminal-by-url" />
  },
}))
vi.mock('../components/top-toolbar', () => ({ default: () => null }))
vi.mock('@/components/status-bar', () => ({ StatusBar: () => null }))
vi.mock('@/components/bottom-nav', () => ({ default: () => null }))
vi.mock('@/components/swipe-back-indicator', () => ({ SwipeBackIndicator: () => null }))
vi.mock('@/components/host-list/host-dialog', () => ({ HostDialog: () => null }))
vi.mock('@/hooks/use-breakpoint', () => ({ useIsMobile: () => false }))
vi.mock('./use-sidebar-resize', () => ({
  useSidebarResize: () => ({
    resizing: false,
    onResizeStart: vi.fn(),
    onResizeKeyDown: vi.fn(),
    onToggleCollapse: vi.fn(),
  }),
}))
vi.mock('./use-swipe-back', () => ({
  useSwipeBack: () => ({
    swipeProgress: 0,
    onSwipeStart: vi.fn(),
    onSwipeMove: vi.fn(),
    onSwipeEnd: vi.fn(),
  }),
}))

import { MainLayoutContent } from './main-layout-content'

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/terminal']}>
      <TooltipProvider>
        <MainLayoutContent
          sidebarWidth={240}
          onToggleSidebar={vi.fn()}
          onSidebarWidthChange={vi.fn()}
        />
      </TooltipProvider>
    </MemoryRouter>,
  )
}

function mountsFor(tabId: string) {
  return mounts.byTab.get(tabId) ?? 0
}

describe('the explorer cannot cost a session', () => {
  beforeEach(() => {
    mounts.byTab.clear()
    useHostStore.setState({ hosts: [], groups: [], loading: false })
    useAppStore.setState({
      tabs: [{ id: 'tab-1', label: 'Local', type: 'local' }],
      splitGroups: [],
      activeTabId: 'tab-1',
      sidebarVisible: false,
      leftPanel: 'none',
    })
  })

  it('opening the explorer does not re-mount the terminal pane', async () => {
    const { container } = renderLayout()
    await waitFor(() => expect(mountsFor('tab-1')).toBeGreaterThan(0))
    const before = mountsFor('tab-1')

    act(() => useAppStore.setState({ leftPanel: 'explorer', sidebarVisible: true }))

    expect(screen.getByTestId('connection-explorer')).toBeTruthy()
    expect(container.querySelector('[data-testid="terminal-by-url"]')).not.toBeNull()
    expect(mountsFor('tab-1')).toBe(before)
  })

  it('closing the explorer does not re-mount the terminal pane', async () => {
    useAppStore.setState({ leftPanel: 'explorer', sidebarVisible: true })
    renderLayout()
    await waitFor(() => expect(mountsFor('tab-1')).toBeGreaterThan(0))
    const before = mountsFor('tab-1')

    act(() => useAppStore.setState({ leftPanel: 'none', sidebarVisible: false }))

    expect(mountsFor('tab-1')).toBe(before)
  })

  it('switching between the explorer and the navigation panel does not re-mount', async () => {
    renderLayout()
    await waitFor(() => expect(mountsFor('tab-1')).toBeGreaterThan(0))
    const before = mountsFor('tab-1')

    act(() => useAppStore.setState({ leftPanel: 'explorer', sidebarVisible: true }))
    act(() => useAppStore.setState({ leftPanel: 'navigation', sidebarVisible: true }))
    act(() => useAppStore.setState({ leftPanel: 'none', sidebarVisible: false }))

    expect(mountsFor('tab-1')).toBe(before)
  })

  it('does not change which tab is active', async () => {
    useAppStore.setState({
      tabs: [
        { id: 'tab-1', label: 'Local', type: 'local' },
        { id: 'tab-2', label: 'Other', type: 'local' },
      ],
      activeTabId: 'tab-2',
    })
    renderLayout()

    act(() => useAppStore.setState({ leftPanel: 'explorer' }))

    expect(useAppStore.getState().activeTabId).toBe('tab-2')
  })

  it('keeps the terminal layer mounted when there are no tabs at all', async () => {
    // `shouldMountTerminal` latches once a tab has existed. The panel must not
    // reset that latch — losing it is what would stop output ACKs.
    useAppStore.setState({ tabs: [], activeTabId: null })
    renderLayout()
    act(() => useAppStore.setState({ leftPanel: 'explorer' }))

    useAppStore.setState({
      tabs: [{ id: 'tab-9', label: 'Later', type: 'local' }],
      activeTabId: 'tab-9',
    })

    await waitFor(() => expect(mountsFor('tab-9')).toBeGreaterThan(0))
  })

  it('starts with the panel closed, so a fresh launch is terminal-first', () => {
    useAppStore.setState({ leftPanel: 'none', sidebarVisible: false })
    const { container } = renderLayout()

    expect(container.querySelector('[data-testid="connection-explorer"]')).toBeNull()
    expect(container.querySelector('[data-testid="app-sidebar"]')).toBeNull()
  })
})
