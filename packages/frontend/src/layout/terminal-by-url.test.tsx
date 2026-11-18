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

/*
 * The save-credential prompt is `React.lazy`, and it sits inside the same Suspense
 * boundary as the workbench this spec asserts on. Leaving it unmocked made every
 * assertion below depend on how fast a dynamic import resolves: measured with the
 * CPU saturated, 6 of 6 runs failed with `Unable to find an element by:
 * [data-testid="workbench"]` and the DOM showing the `Loading...` fallback, while
 * the same command passed 12 of 12 on an idle machine.
 *
 * That is a property of the test environment, not of the product, and this spec is
 * about deep-link routing rather than about the prompt. Mocking it removes the
 * dynamic import from the path under test instead of buying patience for it.
 */
vi.mock('@/view/hosts/save-credential-prompt', () => ({
  SaveCredentialPrompt: () => null,
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


  /*
   * ## Why the prompt is mocked, and what actually guards that decision
   *
   * Measured before the mock existed, CPU saturated by eight `yes` processes: **6 of
   * 6 runs failed** at `Unable to find an element by: [data-testid="workbench"]`, DOM
   * showing the `Loading...` fallback. Idle machine, same command: 12 of 12 passed.
   * Machine load decided the verdict.
   *
   * An earlier version of this block claimed to pin the property. It does not.
   * Measured: with the mock removed the case below still passes on an idle machine,
   * because `findByTestId` retries and the dynamic import resolves well inside its
   * budget; only under saturation does it fail. A test that needs a saturated CPU to
   * reproduce a defect is not a guard for that defect.
   *
   * So the guard here is not a unit test. It is the mock plus this record, and the
   * reproduction command for anyone who doubts it:
   *
   *     for i in $(seq 1 8); do (yes >/dev/null &); done
   *     pnpm -C packages/frontend exec vitest run src/layout/terminal-by-url.test.tsx
   */
  it('renders the workbench without waiting on the lazy prompt', async () => {
    // This states the *contract* the mock implements: the workbench is reachable
    // without the prompt contributing anything. It is a regression test for the
    // tree's shape, not proof that the race is gone — see the note above.
    renderTerminal('/terminal?tab=one')
    const workbench = await screen.findByTestId('workbench')
    expect(workbench.dataset.activeTab).toBe('one')
    expect(document.body.textContent).not.toContain('Loading...')
  })
})
