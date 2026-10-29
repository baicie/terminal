import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/app'
import { useWorkspaceStore } from '@/store/workspace'
import type { WorkspaceLayout } from '@/types'
import {
  deleteWorkspaceAndSwitch,
  switchWorkspaceLayout,
} from './workspace-switch'

const initialAppState = useAppStore.getState()
const initialWorkspaceState = useWorkspaceStore.getState()
const currentTabs = [
  { id: 'current-tab', label: 'Current', type: 'local' },
] as const

function configureWorkspaceActions(targetLayout: WorkspaceLayout) {
  const saveLayout = vi.fn().mockResolvedValue(undefined)
  const loadLayout = vi.fn().mockResolvedValue(targetLayout)
  const setActiveWorkspace = vi.fn(async (id: string) => {
    useWorkspaceStore.setState(state => ({
      activeWorkspaceId: id,
      workspaces: state.workspaces.map(workspace => ({
        ...workspace,
        isActive: workspace.id === id,
      })),
    }))
  })
  useWorkspaceStore.setState({ saveLayout, loadLayout, setActiveWorkspace })
  return { saveLayout, loadLayout, setActiveWorkspace }
}

describe('switchWorkspaceLayout', () => {
  let targetLayout: WorkspaceLayout

  beforeEach(() => {
    useAppStore.setState(initialAppState, true)
    useWorkspaceStore.setState(initialWorkspaceState, true)
    useAppStore.setState({
      tabs: [...currentTabs],
      splitGroups: [],
      activeTabId: 'current-tab',
      sidebarVisible: true,
    })
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
    })
    targetLayout = {
      workspaceId: 'next',
      tabs: [
        { id: 'next-one', label: 'Next One', type: 'local' },
        { id: 'next-two', label: 'Next Two', type: 'remote' },
      ],
      splitGroups: [
        {
          id: 'next-split',
          mode: 'horizontal',
          tabs: ['next-one', 'next-two'],
          sizes: [20, 80],
        },
      ],
      activeTabId: 'next-two',
      sidebarVisible: false,
    }
  })

  afterEach(() => {
    useAppStore.setState(initialAppState, true)
    useWorkspaceStore.setState(initialWorkspaceState, true)
  })

  it('saves the current layout, preloads the target, then restores all fields', async () => {
    const { saveLayout, loadLayout, setActiveWorkspace } =
      configureWorkspaceActions(targetLayout)

    await switchWorkspaceLayout('next')

    expect(saveLayout).toHaveBeenCalledWith(
      'current',
      [...currentTabs],
      [],
      'current-tab',
      true,
    )
    expect(loadLayout.mock.invocationCallOrder[0]).toBeLessThan(
      setActiveWorkspace.mock.invocationCallOrder[0],
    )
    expect(useAppStore.getState()).toMatchObject({
      tabs: targetLayout.tabs,
      splitGroups: targetLayout.splitGroups,
      activeTabId: 'next-two',
      sidebarVisible: false,
    })
  })

  it('keeps the current workspace and layout when target loading fails', async () => {
    const { loadLayout, setActiveWorkspace } =
      configureWorkspaceActions(targetLayout)
    loadLayout.mockRejectedValueOnce(new Error('layout unavailable'))

    await expect(switchWorkspaceLayout('next')).rejects.toThrow(
      'layout unavailable',
    )

    expect(setActiveWorkspace).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('current')
    expect(useAppStore.getState()).toMatchObject({
      tabs: [...currentTabs],
      activeTabId: 'current-tab',
      sidebarVisible: true,
    })
  })

  it('rolls back both stores when layout restoration fails after commit', async () => {
    const { setActiveWorkspace } = configureWorkspaceActions(targetLayout)
    const restoreLayout = initialAppState.restoreLayout
    let restoreAttempt = 0
    useAppStore.setState({
      restoreLayout: layout => {
        restoreAttempt++
        if (restoreAttempt === 1) throw new Error('invalid target layout')
        restoreLayout(layout)
      },
    })

    await expect(switchWorkspaceLayout('next')).rejects.toThrow(
      'invalid target layout',
    )

    expect(setActiveWorkspace).toHaveBeenNthCalledWith(1, 'next')
    expect(setActiveWorkspace).toHaveBeenNthCalledWith(2, 'current')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('current')
    expect(useAppStore.getState()).toMatchObject({
      tabs: [...currentTabs],
      activeTabId: 'current-tab',
      sidebarVisible: true,
    })
  })

  it('persists layout changes made while the target workspace is loading', async () => {
    let resolveLayout!: (layout: WorkspaceLayout) => void
    const pendingLayout = new Promise<WorkspaceLayout>(resolve => {
      resolveLayout = resolve
    })
    const { saveLayout, loadLayout } = configureWorkspaceActions(targetLayout)
    loadLayout.mockReturnValueOnce(pendingLayout)

    const switching = switchWorkspaceLayout('next')
    await vi.waitFor(() => expect(loadLayout).toHaveBeenCalledWith('next'))

    const lateTab = useAppStore
      .getState()
      .addTab({ label: 'Created While Switching', type: 'local' })
    resolveLayout(targetLayout)
    await switching

    expect(saveLayout).toHaveBeenLastCalledWith(
      'current',
      expect.arrayContaining([expect.objectContaining({ id: lateTab.id })]),
      [],
      lateTab.id,
      true,
    )
  })

  it('switches away from an active workspace before deleting it', async () => {
    const { setActiveWorkspace } = configureWorkspaceActions(targetLayout)
    const deleteWorkspace = vi.fn(async (id: string) => {
      useWorkspaceStore.setState(state => ({
        workspaces: state.workspaces.filter(workspace => workspace.id !== id),
      }))
    })
    useWorkspaceStore.setState({ deleteWorkspace })

    await deleteWorkspaceAndSwitch('current')

    expect(setActiveWorkspace).toHaveBeenCalledWith('next')
    expect(deleteWorkspace).toHaveBeenCalledWith('current')
    expect(setActiveWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      deleteWorkspace.mock.invocationCallOrder[0],
    )
    expect(useAppStore.getState().activeTabId).toBe('next-two')
  })
})
