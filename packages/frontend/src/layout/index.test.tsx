import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/app'
import MainLayout from './index'

vi.mock('@/components/shortcuts-help', () => ({ default: () => null }))
vi.mock('@/hooks/use-breakpoint', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/use-global-shortcuts', () => ({
  useGlobalShortcuts: () => {},
}))
vi.mock('@/hooks/use-tray-events', () => ({ useTrayEvents: () => {} }))
vi.mock('./use-layout-shortcut-events', () => ({
  useLayoutShortcutEvents: () => {},
}))
vi.mock('./main-layout-content', () => ({
  MainLayoutContent: (props: {
    sidebarOpen: boolean
    onToggleSidebar: () => void
  }) => (
    <div>
      <output data-testid="sidebar-state">{String(props.sidebarOpen)}</output>
      <button type="button" onClick={props.onToggleSidebar}>
        Toggle sidebar
      </button>
    </div>
  ),
}))

describe('MainLayout sidebar state', () => {
  beforeEach(() => {
    useAppStore.setState({ sidebarVisible: true })
  })

  it('renders restored workspace visibility and toggles the same store value', () => {
    render(
      <MemoryRouter>
        <MainLayout />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('sidebar-state').textContent).toBe('true')

    act(() => useAppStore.setState({ sidebarVisible: false }))
    expect(screen.getByTestId('sidebar-state').textContent).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(useAppStore.getState().sidebarVisible).toBe(true)
  })
})
