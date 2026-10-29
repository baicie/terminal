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
  const hostState = {
    hosts: [] as Array<{ id: string }>,
    loadHosts: vi.fn(),
  }

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
  WORKSPACE_HOST_LOAD_TIMEOUT_MS,
} from './workspace-recovery'

// Recent Node releases no longer expose `localStorage` in the jsdom test
// environment, and the recovery journal it backs is a browser API. Providing
// an in-memory implementation keeps these tests independent of the runtime's
// experimental storage flags.
const memoryStorage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    clear: () => memoryStorage.clear(),
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    key: (index: number) => [...memoryStorage.keys()][index] ?? null,
    get length() {
      return memoryStorage.size
    },
    removeItem: (key: string) => void memoryStorage.delete(key),
    setItem: (key: string, value: string) => void memoryStorage.set(key, value),
  },
})

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
    mocks.hostState.hosts = []
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

  it('allows saved recovery to replace only the temporary startup fallback', async () => {
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [{ id: 'saved', label: 'Saved', type: 'local' }],
      splitGroups: [],
      activeTabId: 'saved',
      sidebarVisible: true,
    }
    mocks.workspaceState.loadLayout.mockResolvedValue(savedLayout)
    mocks.appState.tabs = [
      { id: 'fallback', label: 'Local', type: 'local', startupFallback: true },
    ] as WorkspaceLayout['tabs']

    const recovery = await startWorkspaceRecovery()

    expect(mocks.appState.restoreLayout).toHaveBeenCalledWith(savedLayout)
    recovery.dispose()
  })

  it('replaces a connected fallback before the user enters input', async () => {
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [{ id: 'saved', label: 'Saved', type: 'local' }],
      splitGroups: [],
      activeTabId: 'saved',
      sidebarVisible: true,
    }
    mocks.workspaceState.loadLayout.mockResolvedValue(savedLayout)
    mocks.appState.tabs = [
      {
        id: 'fallback',
        label: 'Local',
        type: 'local',
        startupFallback: true,
        connectionStatus: 'connected',
      },
    ] as WorkspaceLayout['tabs']

    const recovery = await startWorkspaceRecovery()

    expect(mocks.appState.restoreLayout).toHaveBeenCalledWith(savedLayout)
    recovery.dispose()
  })

  it('does not replace a fallback after the user has entered input', async () => {
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [{ id: 'saved', label: 'Saved', type: 'local' }],
      splitGroups: [],
      activeTabId: 'saved',
      sidebarVisible: true,
    }
    mocks.workspaceState.loadLayout.mockResolvedValue(savedLayout)
    mocks.appState.tabs = [
      {
        id: 'fallback',
        label: 'Local',
        type: 'local',
        startupFallback: false,
        connectionStatus: 'connected',
      },
    ] as WorkspaceLayout['tabs']

    const recovery = await startWorkspaceRecovery()

    expect(mocks.appState.restoreLayout).not.toHaveBeenCalled()
    recovery.dispose()
  })

  it('restores a delayed remote layout after the fallback begins connecting', async () => {
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [
        {
          id: 'saved-remote',
          label: 'Production',
          type: 'remote',
          hostId: 'host-one',
        },
      ],
      splitGroups: [],
      activeTabId: 'saved-remote',
      sidebarVisible: true,
    }
    let resolveWorkspace: (() => void) | undefined
    mocks.hostState.hosts = [{ id: 'host-one' }]
    mocks.workspaceState.loadLayout.mockResolvedValue(savedLayout)
    mocks.workspaceState.loadWorkspaces.mockReturnValue(
      new Promise<void>(resolve => {
        resolveWorkspace = resolve
      }),
    )
    mocks.appState.restoreLayout.mockImplementation(layout => {
      mocks.appState.tabs = layout.tabs
      mocks.appState.splitGroups = layout.splitGroups
      mocks.appState.activeTabId = layout.activeTabId
    })

    const recoveryPromise = startWorkspaceRecovery()
    mocks.appState.tabs = [
      {
        id: 'fallback',
        label: 'Local',
        type: 'local',
        startupFallback: true,
        connectionStatus: 'connecting',
      },
    ]
    mocks.appState.activeTabId = 'fallback'
    resolveWorkspace?.()
    const recovery = await recoveryPromise
    await vi.advanceTimersByTimeAsync(1_000)

    expect(mocks.appState.tabs).toEqual(savedLayout.tabs)
    expect(mocks.workspaceState.saveLayout).toHaveBeenCalledWith(
      'workspace-one',
      savedLayout.tabs,
      [],
      'saved-remote',
      true,
    )
    recovery.dispose()
  })

  it('persists a startup fallback when the workspace has no saved layout', async () => {
    mocks.appState.tabs = [
      { id: 'fallback', label: 'Local', type: 'local', startupFallback: true },
    ] as WorkspaceLayout['tabs']
    mocks.appState.activeTabId = 'fallback'

    const recovery = await startWorkspaceRecovery()

    await vi.advanceTimersByTimeAsync(1_000)

    expect(mocks.workspaceState.saveLayout).toHaveBeenCalledWith(
      'workspace-one',
      [{ id: 'fallback', label: 'Local', type: 'local' }],
      [],
      'fallback',
      true,
    )
    recovery.dispose()
  })

  it('keeps a single debounce timer on the fallback schedule path so dispose leaves none armed', async () => {
    localStorage.clear()
    mocks.appState.tabs = [
      { id: 'fallback', label: 'Local', type: 'local', startupFallback: true },
    ] as WorkspaceLayout['tabs']
    mocks.appState.activeTabId = 'fallback'

    const nativeSetTimeout = globalThis.setTimeout
    const nativeClearTimeout = globalThis.clearTimeout
    const armedTimers = new Set<ReturnType<typeof setTimeout>>()
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((handler: () => void, timeout?: number) => {
        const handle = nativeSetTimeout(handler, timeout)
        armedTimers.add(handle)
        return handle
      }) as unknown as typeof setTimeout)
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(((handle: ReturnType<typeof setTimeout>) => {
        armedTimers.delete(handle)
        nativeClearTimeout(handle)
      }) as unknown as typeof clearTimeout)

    try {
      const recovery = await startWorkspaceRecovery()

      // Recovery ended on the "empty backend log but tabs exist" path, where
      // schedule() already armed the debounce timer.
      expect(armedTimers.size).toBe(1)

      recovery.dispose()

      // A second, orphaned timer would survive the handle's own flush().
      expect(armedTimers.size).toBe(0)
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.workspaceState.saveLayout).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(1_000)
      expect(mocks.workspaceState.saveLayout).toHaveBeenCalledOnce()
    } finally {
      setTimeoutSpy.mockRestore()
      clearTimeoutSpy.mockRestore()
    }
  })

  it('does not let late recovery replace a user-created tab', async () => {
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [{ id: 'saved', label: 'Saved', type: 'local' }],
      splitGroups: [],
      activeTabId: 'saved',
      sidebarVisible: true,
    }
    mocks.workspaceState.loadLayout.mockResolvedValue(savedLayout)
    mocks.appState.tabs = [
      { id: 'local', label: 'Local', type: 'local' },
    ] as WorkspaceLayout['tabs']

    const recovery = await startWorkspaceRecovery()

    expect(mocks.appState.restoreLayout).not.toHaveBeenCalled()
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

  it('aborts the concurrent host load when workspace recovery fails', async () => {
    let resolveHosts: (() => void) | undefined
    const hostsReady = new Promise<void>(resolve => {
      resolveHosts = resolve
    })
    mocks.workspaceState.loadWorkspaces.mockRejectedValue(
      new Error('workspace database unavailable'),
    )
    let hostSignal: AbortSignal | undefined
    mocks.hostState.loadHosts.mockImplementation(signal => {
      hostSignal = signal
      return hostsReady
    })

    const recoveryPromise = startWorkspaceRecovery()
    await expect(recoveryPromise).rejects.toThrow(
      'workspace database unavailable',
    )
    expect(hostSignal?.aborted).toBe(true)
    resolveHosts?.()
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

  it('keeps saved remote tabs when host loading fails transiently', async () => {
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [
        {
          id: 'remote-tab',
          label: 'Production',
          type: 'remote',
          hostId: 'host-one',
        },
      ],
      splitGroups: [],
      activeTabId: 'remote-tab',
      sidebarVisible: true,
    }
    mocks.workspaceState.loadLayout.mockResolvedValue(savedLayout)
    mocks.hostState.loadHosts.mockRejectedValue(new Error('database busy'))

    const recovery = await startWorkspaceRecovery()

    expect(mocks.appState.restoreLayout).toHaveBeenCalledWith(savedLayout)
    recovery.dispose()
  })

  it('bounds a never-settling host load while preserving the saved remote layout', async () => {
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [
        {
          id: 'remote-tab',
          label: 'Production',
          type: 'remote',
          hostId: 'host-one',
        },
      ],
      splitGroups: [],
      activeTabId: 'remote-tab',
      sidebarVisible: true,
    }
    let hostSignal: AbortSignal | undefined
    mocks.workspaceState.loadLayout.mockResolvedValue(savedLayout)
    mocks.hostState.loadHosts.mockImplementation(signal => {
      hostSignal = signal
      return new Promise<void>(() => undefined)
    })

    const recoveryPromise = startWorkspaceRecovery()
    await vi.advanceTimersByTimeAsync(WORKSPACE_HOST_LOAD_TIMEOUT_MS)
    const recovery = await recoveryPromise

    expect(hostSignal?.aborted).toBe(true)
    expect(mocks.appState.restoreLayout).toHaveBeenCalledWith(savedLayout)
    expect(mocks.appListeners).toHaveLength(1)
    recovery.dispose()
  })

  it('restores the saved layout before a slow host query completes', async () => {
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [{ id: 'local-tab', label: 'Local', type: 'local' }],
      splitGroups: [],
      activeTabId: 'local-tab',
      sidebarVisible: true,
    }
    let resolveHosts: (() => void) | undefined
    mocks.workspaceState.loadLayout.mockResolvedValue(savedLayout)
    mocks.hostState.loadHosts.mockReturnValue(
      new Promise<void>(resolve => {
        resolveHosts = resolve
      }),
    )

    const recoveryPromise = startWorkspaceRecovery()
    await vi.waitFor(() => {
      expect(mocks.appState.restoreLayout).toHaveBeenCalledWith(savedLayout)
    })

    const recovery = await recoveryPromise
    resolveHosts?.()
    recovery.dispose()
  })

  it('drops a late layout when the active workspace changed during host loading', async () => {
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [
        {
          id: 'remote-tab',
          label: 'Production',
          type: 'remote',
          hostId: 'host-one',
        },
      ],
      splitGroups: [],
      activeTabId: 'remote-tab',
      sidebarVisible: true,
    }
    let resolveHosts: (() => void) | undefined
    mocks.workspaceState.loadLayout.mockResolvedValue(savedLayout)
    mocks.hostState.hosts = [{ id: 'host-one' }]
    mocks.hostState.loadHosts.mockReturnValue(
      new Promise<void>(resolve => {
        resolveHosts = resolve
      }),
    )

    const recoveryPromise = startWorkspaceRecovery()
    await vi.waitFor(() => {
      expect(mocks.workspaceState.loadLayout).toHaveBeenCalledWith(
        'workspace-one',
      )
    })

    mocks.workspaceState.activeWorkspaceId = 'workspace-two'
    mocks.appState.tabs = [
      { id: 'fallback', label: 'Local', type: 'local', startupFallback: true },
    ] as WorkspaceLayout['tabs']
    resolveHosts?.()
    const recovery = await recoveryPromise

    expect(mocks.appState.restoreLayout).not.toHaveBeenCalled()
    await recovery.flush()
    expect(mocks.workspaceState.saveLayout).toHaveBeenCalledOnce()
    expect(mocks.workspaceState.saveLayout.mock.calls[0][0]).toBe(
      'workspace-two',
    )
    expect(mocks.workspaceState.saveLayout.mock.calls[0][1]).toEqual([
      { id: 'fallback', label: 'Local', type: 'local' },
    ])
    recovery.dispose()
  })

  it('cancels a pending host load when the recovery handle is disposed', async () => {
    const savedLayout: WorkspaceLayout = {
      workspaceId: 'workspace-one',
      tabs: [{ id: 'local-tab', label: 'Local', type: 'local' }],
      splitGroups: [],
      activeTabId: 'local-tab',
      sidebarVisible: true,
    }
    let hostSignal: AbortSignal | undefined
    mocks.workspaceState.loadLayout.mockResolvedValue(savedLayout)
    mocks.hostState.loadHosts.mockImplementation(signal => {
      hostSignal = signal
      return new Promise<void>(() => undefined)
    })

    const recovery = await startWorkspaceRecovery()
    expect(hostSignal?.aborted).toBe(false)

    recovery.dispose()

    expect(hostSignal?.aborted).toBe(true)
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
