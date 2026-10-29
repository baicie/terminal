import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import { useAppStore } from '@/store/app'
import { TerminalByUrl } from './terminal-by-url'

vi.mock('@/features/terminal/components/terminal-container/container', () => ({
  TerminalContainer: ({ tabId }: { tabId: string }) => <div>{tabId}</div>,
}))

vi.mock('@/features/terminal/services/terminal-session-manager', () => ({
  terminalSessionManager: { prune: vi.fn() },
}))

vi.mock('./terminal-workbench', () => ({
  TerminalWorkbench: (props: {
    activeTabId: string | null
    isTerminalRoute: boolean
    onActivateTab: (tabId: string) => void
    renderTerminal: (tabId: string) => ReactNode
  }) => (
    <div
      data-testid="workbench"
      data-active-tab={props.activeTabId}
      data-terminal-route={props.isTerminalRoute}
    >
      <button type="button" onClick={() => props.onActivateTab('two')}>
        Activate two
      </button>
      {props.renderTerminal('one')}
      {props.renderTerminal('two')}
    </div>
  ),
}))

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  )
}

function NavigationControls() {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/hosts')}>
        Leave terminal
      </button>
      <button type="button" onClick={() => navigate('/terminal?tab=one')}>
        Return to one
      </button>
    </>
  )
}

function renderTerminal(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TerminalByUrl />
      <LocationProbe />
      <NavigationControls />
    </MemoryRouter>,
  )
}

describe('TerminalByUrl', () => {
  beforeEach(() => {
    vi.mocked(terminalSessionManager.prune).mockClear()
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

  it('uses a valid deep link as the active terminal', async () => {
    renderTerminal('/terminal?tab=two')

    await waitFor(() => {
      expect(useAppStore.getState().activeTabId).toBe('two')
    })
    expect((await screen.findByTestId('workbench')).dataset.activeTab).toBe(
      'two',
    )
    expect(screen.getByTestId('location').textContent).toBe('/terminal?tab=two')
  })

  it('writes pane activation back to the URL without a second owner', async () => {
    renderTerminal('/terminal?tab=one')

    fireEvent.click(screen.getByRole('button', { name: 'Activate two' }))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/terminal?tab=two',
      )
    })
    expect(useAppStore.getState().activeTabId).toBe('two')
  })

  it('honors the URL again after leaving and returning to the terminal route', async () => {
    renderTerminal('/terminal?tab=one')
    await waitFor(() => {
      expect(useAppStore.getState().activeTabId).toBe('one')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Leave terminal' }))
    useAppStore.getState().setActiveTab('two')
    fireEvent.click(screen.getByRole('button', { name: 'Return to one' }))

    await waitFor(() => {
      expect(useAppStore.getState().activeTabId).toBe('one')
    })
    expect(screen.getByTestId('location').textContent).toBe('/terminal?tab=one')
  })

  it('prunes removed sessions including the final closed terminal', async () => {
    renderTerminal('/terminal?tab=one')

    await waitFor(() => {
      expect(terminalSessionManager.prune).toHaveBeenCalledWith(
        new Set(['one', 'two']),
      )
    })

    useAppStore.setState({ tabs: [], activeTabId: null })
    await waitFor(() => {
      expect(terminalSessionManager.prune).toHaveBeenLastCalledWith(new Set())
    })
  })
})
