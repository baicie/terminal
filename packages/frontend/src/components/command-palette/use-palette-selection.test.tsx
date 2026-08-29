import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/app'
import { useWorkspaceStore } from '@/store/workspace'
import type { WorkspaceLayout } from '@/types'
import type { SearchResult } from './command-palette-types'
import { usePaletteSelection } from './use-palette-selection'

const initialAppState = useAppStore.getState()
const initialWorkspaceState = useWorkspaceStore.getState()
let currentLocation = ''

function LocationCapture() {
  const location = useLocation()
  currentLocation = location.pathname + location.search
  return null
}

function Wrapper({ children }: PropsWithChildren) {
  return (
    <MemoryRouter>
      {children}
      <LocationCapture />
    </MemoryRouter>
  )
}

describe('usePaletteSelection workspace routing', () => {
  beforeEach(() => {
    currentLocation = ''
    useAppStore.setState(initialAppState, true)
    useWorkspaceStore.setState(initialWorkspaceState, true)
    useAppStore.setState({
      tabs: [{ id: 'old-tab', label: 'Old', type: 'local' }],
      splitGroups: [],
      activeTabId: 'old-tab',
      sidebarVisible: true,
    })
    const targetLayout: WorkspaceLayout = {
      workspaceId: 'next',
      tabs: [{ id: 'palette-tab', label: 'Palette', type: 'local' }],
      splitGroups: [],
      activeTabId: 'palette-tab',
      sidebarVisible: false,
    }
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: 'current',
          name: 'Current',
          order: 0,
          isActive: true,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'next',
          name: 'Next',
          order: 1,
          isActive: false,
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      activeWorkspaceId: 'current',
      saveLayout: vi.fn().mockResolvedValue(undefined),
      loadLayout: vi.fn().mockResolvedValue(targetLayout),
      setActiveWorkspace: vi.fn(async id => {
        useWorkspaceStore.setState({ activeWorkspaceId: id })
      }),
    })
  })

  afterEach(() => {
    useAppStore.setState(initialAppState, true)
    useWorkspaceStore.setState(initialWorkspaceState, true)
  })

  it('switches workspace results with the saved terminal layout', async () => {
    const onClose = vi.fn()
    const { result } = renderHook(() => usePaletteSelection(onClose), {
      wrapper: Wrapper,
    })
    const workspaceResult: SearchResult = {
      id: 'next',
      type: 'workspace',
      title: 'Next',
      data: { id: 'next' },
      icon: null,
    }

    await act(async () => {
      await result.current(workspaceResult)
    })

    await waitFor(() => {
      expect(useAppStore.getState().activeTabId).toBe('palette-tab')
    })
    expect(useAppStore.getState().tabs.map(tab => tab.id)).toEqual([
      'palette-tab',
    ])
    expect(useAppStore.getState().sidebarVisible).toBe(false)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('navigates to the tab returned by reopening a closed session', async () => {
    useAppStore.setState({
      recentlyClosedTabs: [
        {
          id: 'closed-old-id',
          label: 'Recovered',
          type: 'local',
          closedAt: 1,
        },
      ],
    })
    const onClose = vi.fn()
    const { result } = renderHook(() => usePaletteSelection(onClose), {
      wrapper: Wrapper,
    })

    await act(async () => {
      await result.current({
        id: 'closed-old-id',
        type: 'closed-tab',
        title: 'Recovered',
        data: useAppStore.getState().recentlyClosedTabs[0],
        icon: null,
      })
    })

    const reopened = useAppStore
      .getState()
      .tabs.find(tab => tab.label === 'Recovered')
    expect(reopened).toBeDefined()
    expect(currentLocation).toBe(`/terminal?tab=${reopened?.id}`)
  })
})
