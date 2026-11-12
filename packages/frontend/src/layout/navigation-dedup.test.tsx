// UX-1a review — the navigation surfaces must not overlap.
//
// This file exists because the same mistake was made twice during UX-1a and both
// times every test stayed green: first the activity rail rendered *alongside* the
// full sidebar (so the terminal got 46px narrower, not wider), then the top bar
// grew a second vault button next to the one that already existed.
//
// Both are "two doors to the same room" bugs. They are invisible to tests that ask
// "does the rail render?" and invisible to tests that ask "does the vault button
// work?". What catches them is asking how many doors there are, which is what
// these assertions do.

import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/app'
import { useTransferQueue } from '@/store/transfer-queue'
import { MainLayoutContent } from './main-layout-content'

// The rail and the sidebar are rendered for real; everything heavy is stubbed.
vi.mock('./terminal-by-url', () => ({
  TerminalByUrl: () => <div data-testid="terminal-by-url" />,
}))
vi.mock('@/components/top-toolbar', () => ({
  default: ({ onToggleSidebar }: { onToggleSidebar: () => void }) => (
    <div data-testid="top-toolbar">
      <button type="button" onClick={onToggleSidebar}>
        toggle
      </button>
    </div>
  ),
}))
vi.mock('@/components/status-bar', () => ({
  StatusBar: () => <div data-testid="status-bar" />,
}))
vi.mock('@/components/bottom-nav', () => ({ default: () => null }))
vi.mock('@/components/swipe-back-indicator', () => ({ SwipeBackIndicator: () => null }))
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

function renderLayout(sidebarOpen: boolean) {
  return render(
    <MemoryRouter initialEntries={['/terminal']}>
      <TooltipProvider>
        <MainLayoutContent
          sidebarOpen={sidebarOpen}
          sidebarWidth={240}
          onToggleSidebar={vi.fn()}
          onSidebarWidthChange={vi.fn()}
        />
      </TooltipProvider>
    </MemoryRouter>,
  )
}

/** Nav destinations visible in a container, as route paths. */
function destinationsIn(container: HTMLElement): string[] {
  return [...container.querySelectorAll('a[href^="/"]')].map(
    anchor => anchor.getAttribute('href') ?? '',
  )
}

describe('navigation surfaces do not duplicate each other', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], splitGroups: [], activeTabId: null })
    useTransferQueue.setState({ transfers: [] })
  })

  it('opens terminal-first: the rail is there and the sidebar is not', () => {
    // The default layout. If this ever shows both, the terminal lost the width
    // the whole phase was for.
    const closed = renderLayout(false)

    expect(screen.getByTestId('activity-rail')).toBeTruthy()
    // The sidebar's only render-time marker is its resize separator; the
    // component itself carries no test id. Asserting on the separator is what
    // makes "the sidebar is closed" falsifiable instead of an `if` that never
    // runs.
    expect(
      closed.container.querySelector('[role="separator"][aria-orientation="vertical"]'),
    ).toBeNull()
    closed.unmount()

    const open = renderLayout(true)
    expect(
      open.container.querySelector('[role="separator"][aria-orientation="vertical"]'),
    ).not.toBeNull()
    open.unmount()
  })

  it('the sidebar is not a second copy of the rail', () => {
    // With both rendered, the sidebar must still be the *detailed* navigation.
    // If the two ever became the same component again, this fails — which is the
    // only way to catch "the rail replaced the sidebar's content" rather than
    // "both are present".
    const open = renderLayout(true)
    const rail = screen.getByTestId('activity-rail')
    const railDestinations = new Set(destinationsIn(rail))

    // Everything outside the rail is what the sidebar contributed.
    const outsideRail = [...open.container.querySelectorAll('a[href^="/"]')].filter(
      anchor => !rail.contains(anchor),
    )
    const sidebarOnly = outsideRail.filter(
      anchor => !railDestinations.has(anchor.getAttribute('href') ?? ''),
    )

    // The sidebar reaches surfaces the rail does not: settings is `secondary`, and
    // this is the check that the sidebar did not get replaced by a rail clone.
    expect(sidebarOnly.map(anchor => anchor.getAttribute('href'))).toContain(
      '/settings',
    )
    open.unmount()
  })

  it('gives each daily surface exactly one permanent rail entry', () => {
    renderLayout(false)
    const rail = screen.getByTestId('activity-rail')

    for (const path of ['/hosts', '/sftp', '/keychain', '/snippets', '/port-forward']) {
      const matches = within(rail)
        .getAllByRole('link')
        .filter(anchor => anchor.getAttribute('href') === path)
      expect(matches, `${path} appears ${matches.length} times in the rail`).toHaveLength(1)
    }
  })

  it('keeps the terminal entry and the daily surfaces in the rail', () => {
    renderLayout(false)
    const rail = screen.getByTestId('activity-rail')
    const hrefs = destinationsIn(rail)

    expect(hrefs[0]).toBe('/terminal')
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('does not spend a rail slot on advanced surfaces', () => {
    renderLayout(false)
    const rail = screen.getByTestId('activity-rail')
    const hrefs = destinationsIn(rail)

    for (const path of ['/vaults', '/teams', '/logs', '/known-hosts']) {
      expect(hrefs).not.toContain(path)
    }
  })
})
