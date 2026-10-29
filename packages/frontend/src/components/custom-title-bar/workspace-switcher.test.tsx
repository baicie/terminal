import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/app'
import { useWorkspaceStore } from '@/store/workspace'
import type { WorkspaceLayout } from '@/types'
import { TitleBarWorkspaceSwitcher } from './workspace-switcher'

const initialAppState = useAppStore.getState()
const initialWorkspaceState = useWorkspaceStore.getState()

describe('TitleBarWorkspaceSwitcher', () => {
  beforeEach(() => {
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
      tabs: [
        { id: 'target-one', label: 'Target One', type: 'local' },
        { id: 'target-two', label: 'Target Two', type: 'remote' },
      ],
      splitGroups: [
        {
          id: 'target-split',
          mode: 'vertical',
          tabs: ['target-one', 'target-two'],
          sizes: [40, 60],
        },
      ],
      activeTabId: 'target-two',
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
      loadLayout: vi.fn().mockResolvedValue(targetLayout),
      setActiveWorkspace: vi.fn(async id => {
        useWorkspaceStore.setState({ activeWorkspaceId: id })
      }),
    })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialAppState, true)
    useWorkspaceStore.setState(initialWorkspaceState, true)
  })

  it('switches through the complete persisted terminal layout', async () => {
    render(<TitleBarWorkspaceSwitcher />)

    fireEvent.pointerDown(screen.getByRole('button', { name: /Current/i }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Next/i }))

    await waitFor(() => {
      expect(useAppStore.getState().activeTabId).toBe('target-two')
    })
    const state = useAppStore.getState()
    expect(state.tabs.map(tab => tab.id)).toEqual(['target-one', 'target-two'])
    expect(state.splitGroups).toEqual([
      {
        id: 'target-split',
        mode: 'vertical',
        tabs: ['target-one', 'target-two'],
        sizes: [40, 60],
      },
    ])
    expect(state.sidebarVisible).toBe(false)
  })
})
