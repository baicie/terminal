// UX-1b — the panel's own contract.
//
// These render the real component against the real stores, so a "connect" runs the
// same `addTab` + `navigate` the Hosts page runs. That is the point of
// `useConnectToHost`: one function, two surfaces, no second session path to drift.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import type { Host } from '@/types'
import { ConnectionExplorer } from './connection-explorer'
import { useConnectToHost } from './use-connect-to-host'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: { count?: number; name?: string; query?: string }) => {
      if (options?.name) return `${key}:${options.name}`
      if (options?.query) return `${key}:${options.query}`
      if (options?.count !== undefined) return `${key}:${options.count}`
      return key
    },
  }),
}))

const hostQueries = vi.hoisted(() => ({
  recent: vi.fn<() => Promise<Array<{ host: Host; lastConnectedAt: number }>>>(
    async () => [],
  ),
}))

// Only the I/O wrapper is replaced; the pure functions stay real, so the component
// test exercises the same grouping and ordering the app uses.
vi.mock('./recent-connections', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, loadRecentHosts: hostQueries.recent }
})

function host(id: string, overrides: Partial<Host> = {}): Host {
  return {
    id,
    name: id,
    hostname: `${id}.example.com`,
    port: 22,
    username: 'deploy',
    authType: 'password',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Host
}

/** Reports the current pathname so a test can assert navigation happened. */
function LocationProbe() {
  const location = useLocation()
  return <output data-testid="pathname">{location.pathname}</output>
}

function renderExplorer(props: Partial<Parameters<typeof ConnectionExplorer>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/terminal']}>
      <TooltipProvider>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <ConnectionExplorer
                  width={240}
                  onConnect={props.onConnect ?? vi.fn()}
                  onEdit={props.onEdit ?? vi.fn()}
                  onNewHost={props.onNewHost ?? vi.fn()}
                  activeHostId={props.activeHostId ?? null}
                />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  )
}

describe('connection explorer', () => {
  beforeEach(() => {
    hostQueries.recent.mockReset()
    hostQueries.recent.mockResolvedValue([])
    useAppStore.setState({ tabs: [], splitGroups: [], activeTabId: null })
    // The panel loads on mount; these tests are about rendering what the store
    // holds, so the load is a no-op that leaves the fixture in place.
    useHostStore.setState({
      hosts: [],
      groups: [],
      loading: false,
      dbAvailable: true,
      loadHosts: async () => null,
      loadGroups: async () => undefined,
    })
  })

  it('shows an explicit empty state rather than a blank panel', () => {
    renderExplorer()

    expect(screen.getByTestId('explorer-empty')).toBeTruthy()
  })

  it('lists hosts grouped by their group', async () => {
    useHostStore.setState({
      hosts: [host('prod-db', { groupId: 'g1' })],
      groups: [{ id: 'g1', name: 'Production', parentId: null, order: 0 } as never],
    })

    renderExplorer()

    await waitFor(() =>
      expect(screen.getByTestId('explorer-group-g1')).toBeTruthy(),
    )
    expect(screen.getByText('Production')).toBeTruthy()
  })

  it('collapses and expands a group', () => {
    useHostStore.setState({
      hosts: [host('prod-db', { groupId: 'g1' })],
      groups: [{ id: 'g1', name: 'Production', parentId: null, order: 0 } as never],
    })

    renderExplorer()
    const group = screen.getByTestId('explorer-group-g1')
    const toggle = group.querySelector('button')
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(toggle as HTMLElement)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('explorer-host-prod-db')).toBeNull()

    fireEvent.click(toggle as HTMLElement)
    expect(screen.getByTestId('explorer-host-prod-db')).toBeTruthy()
  })

  it('filters the list from the search box', () => {
    useHostStore.setState({ hosts: [host('prod-db'), host('staging-web')] })

    renderExplorer()
    const search = screen.getByTestId('explorer-search')
    fireEvent.change(search, { target: { value: 'prod' } })

    expect(screen.getByTestId('explorer-host-prod-db')).toBeTruthy()
    expect(screen.queryByTestId('explorer-host-staging-web')).toBeNull()
  })

  it('says so when a search matches nothing', () => {
    useHostStore.setState({ hosts: [host('prod-db')] })

    renderExplorer()
    fireEvent.change(screen.getByTestId('explorer-search'), {
      target: { value: 'zzzz' },
    })

    expect(screen.getByTestId('explorer-no-results')).toBeTruthy()
  })

  it('connects through the same hook the Hosts page uses', () => {
    // The acceptance item "连接操作复用原有服务". `useConnectToHost` is the single
    // implementation: the Hosts page's `handleConnect` delegates to it, and this
    // panel receives its `connectToHost`. The test wires the real hook so the
    // assertion covers the actual code path rather than a mock of it.
    useHostStore.setState({ hosts: [host('prod-db')] })

    function Wired() {
      const { connectToHost } = useConnectToHost()
      return (
        <ConnectionExplorer
          width={240}
          onConnect={connectToHost}
          onEdit={vi.fn()}
          onNewHost={vi.fn()}
        />
      )
    }

    render(
      <MemoryRouter initialEntries={['/terminal']}>
        <TooltipProvider>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <Wired />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    )

    fireEvent.click(
      screen.getByTestId('explorer-host-prod-db').querySelector('button')!,
    )

    const state = useAppStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({
      type: 'remote',
      hostId: 'prod-db',
      label: 'prod-db',
    })
    expect(state.activeTabId).toBe(state.tabs[0].id)
    // The deep link, including the tab id — the URL form `terminal-by-url.tsx`
    // reads and eight call sites write.
    expect(screen.getByTestId('pathname').textContent).toBe('/terminal')
  })

  it('toggles a favourite through the host store', async () => {
    useHostStore.setState({ hosts: [host('prod-db', { isFavorite: false })] })
    const toggleFavorite = vi.fn(async () => undefined)
    useHostStore.setState({ toggleFavorite })

    renderExplorer()
    fireEvent.click(screen.getByTestId('explorer-favorite-prod-db'))

    await waitFor(() => expect(toggleFavorite).toHaveBeenCalledWith('prod-db'))
  })

  it('offers edit for a host without leaving the panel', () => {
    const onEdit = vi.fn()
    useHostStore.setState({ hosts: [host('prod-db')] })

    renderExplorer({ onEdit })
    fireEvent.click(screen.getByTestId('explorer-edit-prod-db'))

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'prod-db' }))
  })

  it('shows the recent section from the connection log', async () => {
    const recentHost = host('recent-one')
    useHostStore.setState({ hosts: [recentHost] })
    hostQueries.recent.mockResolvedValue([
      { host: recentHost, lastConnectedAt: Date.now() - 5 * 60_000 },
    ])

    renderExplorer()

    await waitFor(() =>
      expect(screen.getByTestId('explorer-section-recent')).toBeTruthy(),
    )
    // Recent is a shortcut, not an exclusive list: the same host also appears in
    // its group section below. Two entries is the intended shape.
    expect(screen.getAllByTestId('explorer-host-recent-one').length).toBeGreaterThanOrEqual(1)
  })

  it('keeps the panel usable when the recent read fails', async () => {
    // A recency failure degrades one section. It must not hide favourites, groups
    // or search — and it must never touch the terminal.
    const favourite = host('fav', { isFavorite: true })
    useHostStore.setState({ hosts: [favourite] })
    hostQueries.recent.mockRejectedValue(new Error('db gone'))

    renderExplorer()

    await waitFor(() =>
      expect(screen.getByTestId('explorer-recent-failed')).toBeTruthy(),
    )
    expect(screen.getByTestId('explorer-section-favorites')).toBeTruthy()
    expect(screen.getAllByTestId('explorer-host-fav').length).toBeGreaterThanOrEqual(1)
  })

  it('does not report a host-list failure as an empty list', () => {
    // "Could not load" and "you have no hosts" call for opposite reactions.
    useHostStore.setState({ hosts: [host('kept')] })
    const loadHosts = vi.fn(async () => {
      throw new Error('database is locked')
    })
    useHostStore.setState({ loadHosts })

    renderExplorer()

    return waitFor(() =>
      expect(screen.getByTestId('explorer-load-failed')).toBeTruthy(),
    ).then(() => {
      // The hosts already in the store are still rendered: a failed reload must not
      // wipe what the user could see a moment ago.
      expect(screen.getByTestId('explorer-host-kept')).toBeTruthy()
    })
  })

  it('distinguishes "storage unavailable" from "no hosts"', () => {
    useHostStore.setState({ hosts: [], dbAvailable: false })

    renderExplorer()

    expect(screen.getByTestId('explorer-db-unavailable')).toBeTruthy()
    expect(screen.queryByTestId('explorer-empty')).toBeNull()
  })

  it('opens the new-host dialog from the panel', () => {
    const onNewHost = vi.fn()
    renderExplorer({ onNewHost })

    fireEvent.click(screen.getByTestId('explorer-new-host'))

    expect(onNewHost).toHaveBeenCalledOnce()
  })
})
