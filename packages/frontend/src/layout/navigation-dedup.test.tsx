// UX-1a review / UX-1b — the navigation surfaces must not overlap.
//
// This file exists because the same mistake was made twice during UX-1a and both
// times every test stayed green: first the activity rail rendered *alongside* the
// full sidebar (so the terminal got 46px narrower, not wider), then the top bar
// grew a second vault button next to the one that already existed.
//
// UX-1b makes the rule structural rather than coincidental: the left column has
// exactly one occupant, chosen by `AppStore.leftPanel`. These tests assert the
// count, not the presence of any single panel — "does the rail render?" and "does
// this button work?" both stayed green through every one of those regressions.

import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { useTransferQueue } from '@/store/transfer-queue'
import { MainLayoutContent } from './main-layout-content'

// The rail and the panels are rendered for real; everything heavy is stubbed.
vi.mock('@/features/connection-explorer/connection-explorer', () => ({
  ConnectionExplorer: () => <div data-testid="connection-explorer" />,
}))
vi.mock('@/components/app-sidebar', () => ({
  default: () => <div data-testid="app-sidebar" />,
}))
vi.mock('./terminal-by-url', () => ({
  TerminalByUrl: () => <div data-testid="terminal-by-url" />,
}))
vi.mock('@/components/top-toolbar', () => ({
  default: () => <div data-testid="top-toolbar" />,
}))
vi.mock('@/components/status-bar', () => ({
  StatusBar: () => <div data-testid="status-bar" />,
}))
vi.mock('@/components/bottom-nav', () => ({ default: () => null }))
vi.mock('@/components/swipe-back-indicator', () => ({
  SwipeBackIndicator: () => null,
}))
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

function panelCount(container: HTMLElement) {
  const explorer = container.querySelector('[data-testid="connection-explorer"]')
  const navigation = container.querySelector('[data-testid="app-sidebar"]')
  return { explorer, navigation, count: (explorer ? 1 : 0) + (navigation ? 1 : 0) }
}

describe('the left column has exactly one occupant', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [],
      splitGroups: [],
      activeTabId: null,
      sidebarVisible: false,
      leftPanel: 'none',
    })
    useHostStore.setState({ hosts: [], groups: [], loading: false })
    useTransferQueue.setState({ transfers: [] })
  })

  it('starts terminal-first: the rail is there and no panel is', () => {
    // The default layout. If this ever shows a panel, the terminal lost the width
    // the whole phase was for.
    const { container } = renderLayout()

    expect(screen.getByTestId('activity-rail')).toBeTruthy()
    expect(panelCount(container).count).toBe(0)
  })

  it('shows the explorer and never the sidebar at the same time', () => {
    useAppStore.setState({ leftPanel: 'explorer', sidebarVisible: true })
    const { container } = renderLayout()

    const panels = panelCount(container)
    expect(panels.explorer).not.toBeNull()
    expect(panels.navigation).toBeNull()
  })

  it('shows the navigation sidebar and never the explorer at the same time', () => {
    useAppStore.setState({ leftPanel: 'navigation', sidebarVisible: true })
    const { container } = renderLayout()

    const panels = panelCount(container)
    expect(panels.navigation).not.toBeNull()
    expect(panels.explorer).toBeNull()
  })

  it('never renders both panels, for any mode', () => {
    // The exhaustive check. A future mode added without a test is caught here
    // rather than by a screenshot six commits later.
    for (const mode of ['none', 'explorer', 'navigation'] as const) {
      useAppStore.setState({ leftPanel: mode, sidebarVisible: mode !== 'none' })
      const { container, unmount } = renderLayout()
      expect(panelCount(container).count, `mode ${mode}`).toBeLessThanOrEqual(1)
      unmount()
    }
  })

  it('switching the panel does not unmount the terminal layer', async () => {
    // The invariant behind every entry in this file: the panel is a sibling of
    // `TerminalByUrl`, so changing which panel is open must leave it alone.
    useAppStore.setState({
      tabs: [{ id: 'tab-1', label: 'Local', type: 'local' }],
    })
    const { container } = renderLayout()

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="terminal-by-url"]'),
      ).not.toBeNull(),
    )

    act(() => useAppStore.setState({ leftPanel: 'explorer' }))
    expect(container.querySelector('[data-testid="terminal-by-url"]')).not.toBeNull()

    act(() => useAppStore.setState({ leftPanel: 'navigation' }))
    expect(container.querySelector('[data-testid="terminal-by-url"]')).not.toBeNull()

    act(() => useAppStore.setState({ leftPanel: 'none' }))
    expect(container.querySelector('[data-testid="terminal-by-url"]')).not.toBeNull()
  })
})
