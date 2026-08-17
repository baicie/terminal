import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/app'
import TopToolbar from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      key === 'tabs.closeNamed' ? `Close ${options?.name}` : key,
  }),
}))
const mocks = vi.hoisted(() => ({ mobile: false }))

Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  value: () => {},
})

vi.mock('@/hooks/use-breakpoint', () => ({
  useIsMobile: () => mocks.mobile,
}))
vi.mock('@/components/workspace-switcher', () => ({
  default: ({ variant }: { variant?: string }) => (
    <output data-testid="workspace-switcher">{variant}</output>
  ),
}))
vi.mock('./toolbar-overlays', () => ({ ToolbarOverlays: () => null }))

describe('TopToolbar workspace entry', () => {
  beforeEach(() => {
    mocks.mobile = false
    useAppStore.setState({
      tabs: [
        { id: 'one', label: 'One', type: 'local' },
        { id: 'two', label: 'Two', type: 'local' },
      ],
      splitGroups: [],
      activeTabId: 'one',
    })
  })

  it('renders the existing workspace switcher exactly once', () => {
    render(
      <MemoryRouter initialEntries={['/hosts']}>
        <TooltipProvider>
          <TopToolbar onToggleSidebar={vi.fn()} />
        </TooltipProvider>
      </MemoryRouter>,
    )

    expect(screen.getAllByTestId('workspace-switcher')).toHaveLength(1)
    expect(screen.getByTestId('workspace-switcher').textContent).toBe('vaults')
  })

  it('keeps workspace switching available in the mobile navigation sheet', async () => {
    mocks.mobile = true
    render(
      <MemoryRouter initialEntries={['/terminal']}>
        <TooltipProvider>
          <TopToolbar onToggleSidebar={vi.fn()} />
        </TooltipProvider>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'toolbar.menu' }))

    expect(await screen.findByRole('dialog', { name: 'app.name' })).toBeTruthy()
    expect(screen.getByTestId('workspace-switcher')).toBeTruthy()
  })

  it('keeps mobile terminal sessions switchable and closable', async () => {
    mocks.mobile = true
    render(
      <MemoryRouter initialEntries={['/terminal?tab=one']}>
        <TooltipProvider>
          <TopToolbar onToggleSidebar={vi.fn()} />
        </TooltipProvider>
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('tablist', { name: 'tabs.sessions' }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Two' }))
    expect(useAppStore.getState().activeTabId).toBe('two')

    fireEvent.click(screen.getByRole('button', { name: 'Close Two' }))
    expect(useAppStore.getState().tabs.map(tab => tab.id)).toEqual(['one'])

    fireEvent.click(screen.getByRole('button', { name: 'toolbar.newTab' }))
    expect(useAppStore.getState().tabs).toHaveLength(2)
  })
})
