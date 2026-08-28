import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceLayout } from '@/types'

const mocks = vi.hoisted(() => {
  const appState = {
    tabs: [] as WorkspaceLayout['tabs'],
    splitGroups: [] as WorkspaceLayout['splitGroups'],
    activeTabId: null as string | null,
    sidebarVisible: true,
    restoreLayout: vi.fn(),
  }
  const appListeners = new Set<() => void>()
  const workspaceState = {
    activeWorkspaceId: 'workspace-one' as string | null,
    loadWorkspaces: vi.fn(),
    loadLayout: vi.fn(),
    saveLayout: vi.fn(),
  }
  const hostState = { loadHosts: vi.fn() }

  return { appState, appListeners, workspaceState, hostState }
})

vi.mock('@/store/app', () => ({
  useAppStore: {
    getState: () => mocks.appState,
    subscribe: (listener: () => void) => {
      mocks.appListeners.add(listener)
      return () => mocks.appListeners.delete(listener)
    },
  },
}))

vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: {
    getState: () => mocks.workspaceState,
  },
}))

vi.mock('@/store/host', () => ({
  useHostStore: {
    getState: () => mocks.hostState,
  },
}))

import {
  getWorkspaceRecoveryJournalKey,
  sanitizeWorkspaceRecoveryLayout,
  startWorkspaceRecovery,
} from './workspace-recovery'

function emitLayoutChange() {
  mocks.appListeners.forEach(listener => listener())
}

describe('workspace recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.appListeners.clear()
    mocks.workspaceState.activeWorkspaceId = 'workspace-one'
    mocks.workspaceState.loadWorkspaces.mockResolvedValue(undefined)
    mocks.workspaceState.loadLayout.mockResolvedValue(null)
    mocks.workspaceState.saveLayout.mockResolvedValue(undefined)
    mocks.hostState.loadHosts.mockResolvedValue(undefined)
    mocks.appState.tabs = []
    mocks.appState.splitGroups = []
    mocks.appState.activeTabId = null
    mocks.appState.sidebarVisible = true
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps restorable tabs without persisting process-local session data', () => {
    const layout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [
        { id: 'local', label: 'Local', type: 'local' },
        {
          id: 'saved-remote',
          label: 'Production',
          type: 'remote',
          hostId: 'host-one',
          connectionStatus: 'connected',
          password: 'legacy-layout-secret',
        } as WorkspaceLayout['tabs'][number] & { password: string },
        {
          id: 'temporary',
          label: 'Quick connect',
          type: 'remote',
          profileId: 'temporary-profile',
        },
        {
          id: 'serial',
          label: 'USB serial',
          type: 'serial',
          serialSessionId: 'backend-session-id',
          serialConfig: { port: '/dev/tty.usbserial', baudRate: 115200 },
        },
      ],
      splitGroups: [
        {
          id: 'valid-split',
          mode: 'horizontal',
          tabs: ['local', 'saved-remote'],
          sizes: [30, 70],
        },
        {
          id: 'temporary-split',
          mode: 'vertical',
          tabs: ['saved-remote', 'temporary'],
        },
      ],
      activeTabId: 'temporary',
      sidebarVisible: false,
    }

    expect(sanitizeWorkspaceRecoveryLayout(layout)).toEqual({
      workspaceId: 'workspace-one',
      tabs: [
        {
          id: 'local',
          label: 'Local',
          type: 'local',
          splitMode: 'horizontal',
          splitId: 'valid-split',
          splitChildren: ['saved-remote'],
        },
        {
          id: 'saved-remote',
          label: 'Production',
          type: 'remote',
          hostId: 'host-one',
          splitMode: 'horizontal',
          splitId: 'valid-split',
          splitChildren: ['local'],
        },
      ],
      splitGroups: [
        {
          id: 'valid-split',
          mode: 'horizontal',
          tabs: ['local', 'saved-remote'],
          sizes: [30, 70],
        },
      ],
      activeTabId: 'local',
      sidebarVisible: false,
    })
  })

  it('restores the active workspace before subscribing to layout changes', async () => {
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [{ id: 'local', label: 'Local', type: 'local' }],
      splitGroups: [],
      activeTabId: 'local',
      sidebarVisible: true,
    }
    mocks.workspaceState.loadLayout.mockResolvedValue(savedLayout)

    const recovery = await startWorkspaceRecovery()

    expect(mocks.workspaceState.loadWorkspaces).toHaveBeenCalledOnce()
    expect(mocks.hostState.loadHosts).toHaveBeenCalledOnce()
    expect(mocks.workspaceState.loadLayout).toHaveBeenCalledWith(
      'workspace-one',
    )
    expect(mocks.appState.restoreLayout).toHaveBeenCalledWith(savedLayout)
    expect(mocks.appListeners).toHaveLength(1)
    recovery.dispose()
  })

  it('starts workspace and host loading concurrently for a faster first terminal', async () => {
    let resolveWorkspace: (() => void) | undefined
    const workspaceReady = new Promise<void>(resolve => {
      resolveWorkspace = resolve
    })
    mocks.workspaceState.loadWorkspaces.mockReturnValue(workspaceReady)

    const recoveryPromise = startWorkspaceRecovery()
    await Promise.resolve()

    expect(mocks.workspaceState.loadWorkspaces).toHaveBeenCalledOnce()
    expect(mocks.hostState.loadHosts).toHaveBeenCalledOnce()

    resolveWorkspace?.()
    const recovery = await recoveryPromise
    recovery.dispose()
  })

  it('starts layout loading as soon as the active workspace is known', async () => {
    let resolveWorkspace: (() => void) | undefined
    let resolveHosts: (() => void) | undefined
    const workspaceReady = new Promise<void>(resolve => {
      resolveWorkspace = resolve
    })
    const hostsReady = new Promise<void>(resolve => {
      resolveHosts = resolve
    })
    mocks.workspaceState.loadWorkspaces.mockReturnValue(workspaceReady)
    mocks.hostState.loadHosts.mockReturnValue(hostsReady)

    const recoveryPromise = startWorkspaceRecovery()
    await Promise.resolve()
    expect(mocks.workspaceState.loadLayout).not.toHaveBeenCalled()

    resolveWorkspace?.()
    await Promise.resolve()
    expect(mocks.workspaceState.loadLayout).toHaveBeenCalledWith(
      'workspace-one',
    )

    resolveHosts?.()
    const recovery = await recoveryPromise
    recovery.dispose()
  })

  it('debounces layout snapshots and saves the latest state to SQLite', async () => {
    const recovery = await startWorkspaceRecovery()
    mocks.appState.tabs = [{ id: 'first', label: 'First', type: 'local' }]
    mocks.appState.activeTabId = 'first'
    emitLayoutChange()

    await vi.advanceTimersByTimeAsync(500)
    mocks.appState.tabs = [{ id: 'second', label: 'Second', type: 'local' }]
    mocks.appState.activeTabId = 'second'
    emitLayoutChange()

    await vi.advanceTimersByTimeAsync(999)
    expect(mocks.workspaceState.saveLayout).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(mocks.workspaceState.saveLayout).toHaveBeenCalledOnce()
    expect(mocks.workspaceState.saveLayout).toHaveBeenCalledWith(
      'workspace-one',
      [{ id: 'second', label: 'Second', type: 'local' }],
      [],
      'second',
      true,
    )
    recovery.dispose()
  })

  it('captures the workspace id when a save is scheduled', async () => {
    const recovery = await startWorkspaceRecovery()
    mocks.appState.tabs = [{ id: 'old', label: 'Old', type: 'local' }]
    mocks.appState.activeTabId = 'old'
    emitLayoutChange()
    mocks.workspaceState.activeWorkspaceId = 'workspace-two'

    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.workspaceState.saveLayout).toHaveBeenCalledWith(
      'workspace-one',
      [{ id: 'old', label: 'Old', type: 'local' }],
      [],
      'old',
      true,
    )
    recovery.dispose()
  })

  it('journals every sanitized layout change before the SQLite debounce', async () => {
    const recovery = await startWorkspaceRecovery()
    mocks.appState.tabs = [
      {
        id: 'saved-remote',
        label: 'Production',
        type: 'remote',
        hostId: 'host-one',
        connectionStatus: 'connected',
        password: 'must-not-be-persisted',
      } as WorkspaceLayout['tabs'][number] & { password: string },
    ]
    mocks.appState.activeTabId = 'saved-remote'

    emitLayoutChange()

    const raw = localStorage.getItem(
      getWorkspaceRecoveryJournalKey('workspace-one'),
    )
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('must-not-be-persisted')
    expect(JSON.parse(raw ?? '{}').layout.tabs).toEqual([
      {
        id: 'saved-remote',
        label: 'Production',
        type: 'remote',
        hostId: 'host-one',
      },
    ])
    expect(mocks.workspaceState.saveLayout).not.toHaveBeenCalled()
    recovery.dispose()
  })

  it('restores an unsaved crash journal ahead of the older SQLite layout', async () => {
    const databaseLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [{ id: 'old', label: 'Old', type: 'local' }],
      splitGroups: [],
      activeTabId: 'old',
      sidebarVisible: true,
    }
    const journalLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [{ id: 'latest', label: 'Latest', type: 'local' }],
      splitGroups: [],
      activeTabId: 'latest',
      sidebarVisible: false,
    }
    mocks.workspaceState.loadLayout.mockResolvedValue(databaseLayout)
    localStorage.setItem(
      getWorkspaceRecoveryJournalKey('workspace-one'),
      JSON.stringify({ version: 1, savedAt: 123, layout: journalLayout }),
    )

    const recovery = await startWorkspaceRecovery()

    expect(mocks.appState.restoreLayout).toHaveBeenCalledWith(journalLayout)
    await recovery.flush()
    expect(mocks.workspaceState.saveLayout).toHaveBeenCalledWith(
      'workspace-one',
      journalLayout.tabs,
      journalLayout.splitGroups,
      journalLayout.activeTabId,
      journalLayout.sidebarVisible,
    )
    expect(
      localStorage.getItem(getWorkspaceRecoveryJournalKey('workspace-one')),
    ).toBeNull()
    recovery.dispose()
  })
})
