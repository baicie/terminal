import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/app'
import { MainLayoutContent } from './main-layout-content'

vi.mock('@/components/app-sidebar', () => ({ default: () => null }))
vi.mock('@/components/bottom-nav', () => ({ default: () => null }))
vi.mock('@/components/swipe-back-indicator', () => ({
  SwipeBackIndicator: () => null,
}))
vi.mock('@/components/top-toolbar', () => ({ default: () => null }))
vi.mock('@/hooks/use-breakpoint', () => ({ useIsMobile: () => false }))
vi.mock('./terminal-by-url', () => ({
  TerminalByUrl: () => <div data-testid="terminal-by-url" />,
}))
vi.mock('./use-sidebar-resize', () => ({
  useSidebarResize: () => ({
    resizing: false,
    onResizeStart: vi.fn(),
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

function renderLayout(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <MainLayoutContent
        sidebarOpen={false}
        sidebarWidth={240}
        onToggleSidebar={vi.fn()}
        onSidebarWidthChange={vi.fn()}
      />
    </MemoryRouter>,
  )
}

describe('MainLayoutContent terminal layering', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], splitGroups: [], activeTabId: null })
  })

  it('keeps the empty route outlet from covering the terminal workbench', () => {
    const { container } = renderLayout('/terminal')
    const outletLayer = container.querySelector('.route-transition-enter')

    expect(outletLayer?.classList.contains('invisible')).toBe(true)
    expect(outletLayer?.classList.contains('pointer-events-none')).toBe(true)
  })

  it('keeps the route outlet interactive on non-terminal views', () => {
    const { container } = renderLayout('/hosts')
    const outletLayer = container.querySelector('.route-transition-enter')

    expect(outletLayer?.classList.contains('invisible')).toBe(false)
    expect(outletLayer?.classList.contains('pointer-events-none')).toBe(false)
  })

  it('loads the persistent terminal layer only after a terminal is created', async () => {
    renderLayout('/hosts')

    expect(screen.queryByTestId('terminal-by-url')).toBeNull()

    act(() => {
      useAppStore.setState({
        tabs: [{ id: 'one', label: 'One', type: 'local' }],
        activeTabId: 'one',
      })
    })
    expect(await screen.findByTestId('terminal-by-url')).toBeTruthy()

    act(() => {
      useAppStore.setState({ tabs: [], activeTabId: null })
    })
    await waitFor(() => {
      expect(screen.getByTestId('terminal-by-url')).toBeTruthy()
    })
  })
})
