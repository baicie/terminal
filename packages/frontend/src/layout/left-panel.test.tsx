// F0 review fix — the left drawer must be a real presentation, not a decision
// that nothing renders.
//
// The defect this pins: `chooseLayout` could return `leftPresentation: 'drawer'`,
// but `MainLayoutContent` only read `allowLeft` (a boolean derived from
// `leftPresentation === 'column'`) and used it to set the panel mode to `none`.
// So a drawer decision rendered *nothing* — the panel became unreachable exactly
// when the window was too narrow for a column, which is when the user needs it.
// Navigation bypassed the decision entirely.
//
// These tests drive the real `LeftPanel` component, not the decision function.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LeftPanel, type LeftPanelProps } from './left-panel'

vi.mock('@/features/connection-explorer/connection-explorer', () => ({
  ConnectionExplorer: () => <div data-testid="explorer-content" />,
}))
vi.mock('@/components/app-sidebar', () => ({
  default: () => <div data-testid="navigation-content" />,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

function props(overrides: Partial<LeftPanelProps> = {}): LeftPanelProps {
  return {
    mode: 'explorer',
    presentation: 'column',
    width: 240,
    resizing: false,
    resizeLabel: 'Resize sidebar',
    drawerLabel: 'Connections',
    onToggleCollapse: vi.fn(),
    onDismissDrawer: vi.fn(),
    onResizeStart: vi.fn(),
    onResizeKeyDown: vi.fn(),
    onConnect: vi.fn(),
    onEdit: vi.fn(),
    onNewHost: vi.fn(),
    activeHostId: null,
    ...overrides,
  }
}

describe('LeftPanel renders all three presentations', () => {
  it('renders nothing when presentation is none', () => {
    const { container } = render(<LeftPanel {...props({ presentation: 'none' })} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders a column with a resize separator', () => {
    render(<LeftPanel {...props({ presentation: 'column' })} />)
    expect(screen.getByTestId('left-column').getAttribute('data-presentation')).toBe('column')
    expect(screen.getByRole('separator')).not.toBeNull()
    expect(screen.getByTestId('explorer-content')).not.toBeNull()
  })

  it('renders a drawer as a dialog over the terminal, without a separator', () => {
    render(<LeftPanel {...props({ presentation: 'drawer' })} />)
    const drawer = screen.getByTestId('left-drawer')
    expect(drawer.getAttribute('data-presentation')).toBe('drawer')
    expect(drawer.getAttribute('role')).toBe('dialog')
    // A drawer takes no column width, so there is nothing to drag.
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.getByTestId('explorer-content')).not.toBeNull()
  })

  it('the drawer is reachable: it opens for both explorer and navigation', () => {
    const { unmount } = render(
      <LeftPanel {...props({ presentation: 'drawer', mode: 'explorer' })} />,
    )
    expect(screen.getByTestId('explorer-content')).not.toBeNull()
    unmount()

    render(<LeftPanel {...props({ presentation: 'drawer', mode: 'navigation' })} />)
    expect(screen.getByTestId('navigation-content')).not.toBeNull()
  })

  it('closes from the scrim and from the close button', () => {
    const onDismissDrawer = vi.fn()
    render(<LeftPanel {...props({ presentation: 'drawer', onDismissDrawer })} />)

    fireEvent.click(screen.getByTestId('left-drawer-scrim'))
    expect(onDismissDrawer).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('left-drawer-close'))
    expect(onDismissDrawer).toHaveBeenCalledTimes(2)
  })

  it('closes on Escape', () => {
    const onDismissDrawer = vi.fn()
    render(<LeftPanel {...props({ presentation: 'drawer', onDismissDrawer })} />)
    fireEvent.keyDown(screen.getByTestId('left-drawer'), { key: 'Escape' })
    expect(onDismissDrawer).toHaveBeenCalled()
  })

  it('moves focus into the drawer so a keyboard user is not left behind it', () => {
    render(<LeftPanel {...props({ presentation: 'drawer' })} />)
    expect(document.activeElement).toBe(screen.getByTestId('left-drawer'))
  })

  it('is modal: the drawer is announced as a dialog', () => {
    render(<LeftPanel {...props({ presentation: 'drawer' })} />)
    const drawer = screen.getByRole('dialog')
    expect(drawer.getAttribute('aria-modal')).toBe('true')
  })

  it('navigation obeys the same presentation contract as explorer', () => {
    // The bug was that navigation ignored the decision. Both modes must honour
    // `none`, and both must render when the decision says so.
    const { unmount } = render(
      <LeftPanel {...props({ mode: 'navigation', presentation: 'none' })} />,
    )
    expect(screen.queryByTestId('navigation-content')).toBeNull()
    unmount()

    render(<LeftPanel {...props({ mode: 'navigation', presentation: 'column' })} />)
    expect(screen.getByTestId('navigation-content')).not.toBeNull()
    expect(screen.getByRole('separator')).not.toBeNull()
  })

  it('an empty mode wins over a drawer decision', () => {
    // `leftPresentationFor` returns 'none' when the mode is none; the component
    // must not resurrect a panel the store says is closed.
    render(<LeftPanel {...props({ mode: 'none', presentation: 'drawer' })} />)
    expect(screen.queryByTestId('left-drawer')).toBeNull()
    expect(screen.queryByTestId('explorer-content')).toBeNull()
  })
})
