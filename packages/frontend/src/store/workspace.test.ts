/**
 * Tests for workspace store
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/service/database', () => ({
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  setActiveWorkspace: vi.fn(),
  getWorkspaceLayout: vi.fn(),
  getWorkspaces: vi.fn(),
  saveWorkspaceLayout: vi.fn(),
  updateWorkspace: vi.fn(),
}))

import {
  createWorkspace,
  deleteWorkspace as dbDeleteWorkspace,
  setActiveWorkspace as dbSetActiveWorkspace,
  getWorkspaceLayout,
  getWorkspaces,
  saveWorkspaceLayout,
} from '@/service/database'

import { useWorkspaceStore } from './workspace'

const {
  createWorkspace: cw,
  deleteWorkspace: dw,
  setActiveWorkspace: sa,
  getWorkspaceLayout: gwl,
  getWorkspaces: gw,
  saveWorkspaceLayout: swl,
} = vi.mocked({
  createWorkspace: createWorkspace as ReturnType<typeof vi.fn>,
  deleteWorkspace: dbDeleteWorkspace as ReturnType<typeof vi.fn>,
  setActiveWorkspace: dbSetActiveWorkspace as ReturnType<typeof vi.fn>,
  getWorkspaceLayout: getWorkspaceLayout as ReturnType<typeof vi.fn>,
  getWorkspaces: getWorkspaces as ReturnType<typeof vi.fn>,
  saveWorkspaceLayout: saveWorkspaceLayout as ReturnType<typeof vi.fn>,
})

function reset() {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, loading: false })
}

describe('loadWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it('loads workspaces from DB and sets first as active if none is active', async () => {
    gw.mockResolvedValue([
      { id: 'ws-1', name: 'Work', description: null, icon: '📁', color: '#3b82f6', order: 0, is_active: 0, created_at: 1000, updated_at: 1000 },
      { id: 'ws-2', name: 'Play', description: null, icon: '🎮', color: '#ef4444', order: 1, is_active: 0, created_at: 2000, updated_at: 2000 },
    ])

    await useWorkspaceStore.getState().loadWorkspaces()

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2)
    // activeWorkspaceId defaults to first when none is_active
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1')
  })

  it('sets activeWorkspaceId from DB is_active flag', async () => {
    gw.mockResolvedValue([
      { id: 'ws-1', name: 'A', description: null, icon: null, color: null, order: 0, is_active: 0, created_at: 1000, updated_at: 1000 },
      { id: 'ws-2', name: 'B', description: null, icon: null, color: null, order: 1, is_active: 1, created_at: 2000, updated_at: 2000 },
    ])

    await useWorkspaceStore.getState().loadWorkspaces()

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2')
  })

  it('creates default workspace if none exist', async () => {
    gw.mockResolvedValue([])
    cw.mockResolvedValue({ rowsAffected: 1 } as never)

    await useWorkspaceStore.getState().loadWorkspaces()

    expect(cw).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Default', is_active: 1 }),
    )
  })
})

describe('setActiveWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'ws-1', name: 'A', order: 0, isActive: true, createdAt: 0, updatedAt: 0 },
        { id: 'ws-2', name: 'B', order: 1, isActive: false, createdAt: 0, updatedAt: 0 },
      ],
      activeWorkspaceId: 'ws-1',
    })
  })

  it('updates DB and local state', async () => {
    sa.mockResolvedValue({ rowsAffected: 1 } as never)

    await useWorkspaceStore.getState().setActiveWorkspace('ws-2')

    expect(sa).toHaveBeenCalledWith('ws-2')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2')
    expect(useWorkspaceStore.getState().workspaces.find(w => w.id === 'ws-2')?.isActive).toBe(true)
    expect(useWorkspaceStore.getState().workspaces.find(w => w.id === 'ws-1')?.isActive).toBe(false)
  })
})

describe('deleteWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it('does nothing when deleting the last workspace', async () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'ws-1', name: 'Only', order: 0, isActive: true, createdAt: 0, updatedAt: 0 },
      ],
      activeWorkspaceId: 'ws-1',
    })

    await useWorkspaceStore.getState().deleteWorkspace('ws-1')

    expect(dw).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
  })
})

describe('loadLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it('returns null when no layout exists', async () => {
    gwl.mockResolvedValue(null)

    const result = await useWorkspaceStore.getState().loadLayout('ws-none')

    expect(result).toBeNull()
  })

  it('returns parsed layout from DB', async () => {
    const layout = {
      workspaceId: 'ws-1',
      tabs: [],
      splitGroups: [],
      activeTabId: null,
      sidebarVisible: true,
    }
    gwl.mockResolvedValue(layout as never)

    const result = await useWorkspaceStore.getState().loadLayout('ws-1')

    expect(result).toEqual(layout)
  })
})

describe('saveLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it('serializes layout and calls DB', async () => {
    swl.mockResolvedValue({ rowsAffected: 1 } as never)

    await useWorkspaceStore.getState().saveLayout(
      'ws-1',
      [],
      [],
      null,
      true,
    )

    expect(swl).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      workspaceId: 'ws-1',
      sidebarVisible: true,
    }))
  })
})
