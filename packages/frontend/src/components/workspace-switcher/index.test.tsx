import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/app'
import { useWorkspaceStore } from '@/store/workspace'
import type { WorkspaceLayout } from '@/types'
import '@/locales'
import WorkspaceSwitcher from './index'

const initialAppState = useAppStore.getState()
const initialWorkspaceState = useWorkspaceStore.getState()

describe('WorkspaceSwitcher', () => {
  beforeEach(() => {
    useAppStore.setState(initialAppState, true)
    useWorkspaceStore.setState(initialWorkspaceState, true)

    useAppStore.setState({
      tabs: [{ id: 'old-tab', label: 'Old', type: 'local' }],
      splitGroups: [],
      activeTabId: 'old-tab',
      sidebarVisible: true,
    })
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'next',
      tabs: [
        { id: 'saved-one', label: 'Saved One', type: 'local' },
        { id: 'saved-two', label: 'Saved Two', type: 'remote' },
      ],
      splitGroups: [
        {
          id: 'saved-split',
          mode: 'horizontal',
          tabs: ['saved-one', 'saved-two'],
          sizes: [25, 75],
        },
      ],
      activeTabId: 'saved-two',
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
      loadWorkspaces: vi.fn().mockResolvedValue(undefined),
      saveLayout: vi.fn().mockResolvedValue(undefined),
      setActiveWorkspace: vi.fn(async id => {
        useWorkspaceStore.setState({ activeWorkspaceId: id })
      }),
      loadLayout: vi.fn().mockResolvedValue(savedLayout),
      updateWorkspace: vi.fn().mockResolvedValue(undefined),
      deleteWorkspace: vi.fn().mockResolvedValue(undefined),
    })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialAppState, true)
    useWorkspaceStore.setState(initialWorkspaceState, true)
  })

  it('replaces the current layout while preserving persisted tab IDs', async () => {
    render(<WorkspaceSwitcher />)

    fireEvent.pointerDown(screen.getByRole('button', { name: /Current/i }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Next/i }))

    await waitFor(() => {
      expect(useAppStore.getState().activeTabId).toBe('saved-two')
    })
    const state = useAppStore.getState()
    expect(state.tabs.map(tab => tab.id)).toEqual(['saved-one', 'saved-two'])
    expect(state.splitGroups).toEqual([
      {
        id: 'saved-split',
        mode: 'horizontal',
        tabs: ['saved-one', 'saved-two'],
        sizes: [25, 75],
      },
    ])
    expect(state.sidebarVisible).toBe(false)
  })

  it('clears the previous layout when the selected workspace has no saved layout', async () => {
    vi.mocked(useWorkspaceStore.getState().loadLayout).mockResolvedValue(null)
    render(<WorkspaceSwitcher />)

    fireEvent.pointerDown(screen.getByRole('button', { name: /Current/i }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Next/i }))

    await waitFor(() => {
      expect(useAppStore.getState().tabs).toEqual([])
    })
    expect(useAppStore.getState().splitGroups).toEqual([])
    expect(useAppStore.getState().activeTabId).toBeNull()
    expect(useAppStore.getState().sidebarVisible).toBe(true)
  })

  it('loads the target layout before committing the active workspace', async () => {
    const workspaceState = useWorkspaceStore.getState()
    const saveLayout = vi.mocked(workspaceState.saveLayout)
    const loadLayout = vi.mocked(workspaceState.loadLayout)
    const setActiveWorkspace = vi.mocked(workspaceState.setActiveWorkspace)
    render(<WorkspaceSwitcher />)

    fireEvent.pointerDown(screen.getByRole('button', { name: /Current/i }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Next/i }))

    await waitFor(() => expect(setActiveWorkspace).toHaveBeenCalledOnce())
    expect(saveLayout.mock.invocationCallOrder[0]).toBeLessThan(
      loadLayout.mock.invocationCallOrder[0],
    )
    expect(loadLayout.mock.invocationCallOrder[0]).toBeLessThan(
      setActiveWorkspace.mock.invocationCallOrder[0],
    )
  })

  it('keeps management controls outside workspace selection menu items', async () => {
    const workspaceState = useWorkspaceStore.getState()
    const updateWorkspace = vi.mocked(workspaceState.updateWorkspace)
    const setActiveWorkspace = vi.mocked(workspaceState.setActiveWorkspace)
    render(<WorkspaceSwitcher />)

    fireEvent.pointerDown(screen.getByRole('button', { name: /Current/i }), {
      button: 0,
      ctrlKey: false,
    })
    const menu = await screen.findByRole('menu')
    expect(
      within(menu).queryByRole('button', { name: /Rename Next/i }),
    ).toBeNull()
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: /Manage Workspaces/i }),
    )

    const dialog = await screen.findByRole('dialog', {
      name: /Manage Workspaces/i,
    })
    const rename = within(dialog).getByRole('button', {
      name: /Rename Next/i,
    })
    fireEvent.pointerDown(rename, { button: 0, isPrimary: true })
    fireEvent.pointerUp(rename, { button: 0, isPrimary: true })
    fireEvent.click(rename)
    const input = within(dialog).getByRole('textbox', {
      name: /Workspace name/i,
    })
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(updateWorkspace).toHaveBeenCalledWith('next', { name: 'Renamed' })
    })
    expect(setActiveWorkspace).not.toHaveBeenCalled()
  })
})
