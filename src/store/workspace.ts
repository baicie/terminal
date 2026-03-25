import { create } from 'zustand'
import type { Workspace, WorkspaceLayout, Tab, SplitGroup } from '@/types'
import {
  createWorkspace,
  updateWorkspace,
  deleteWorkspace as dbDeleteWorkspace,
  getWorkspaces,
  setActiveWorkspace as dbSetActiveWorkspace,
  saveWorkspaceLayout,
  getWorkspaceLayout,
  type WorkspaceRecord,
} from '@/service/database'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

function rowToWorkspace(row: WorkspaceRecord): Workspace {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    icon: row.icon ?? undefined,
    color: row.color ?? undefined,
    order: row.order,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface WorkspaceState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  loading: boolean
  // Computed
  activeWorkspace: () => Workspace | undefined
  // Actions
  loadWorkspaces: () => Promise<void>
  addWorkspace: (workspace: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt' | 'isActive' | 'order'>) => Promise<Workspace>
  updateWorkspace: (id: string, updates: Partial<Workspace>) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  setActiveWorkspace: (id: string) => Promise<void>
  saveLayout: (workspaceId: string, tabs: Tab[], splitGroups: SplitGroup[], activeTabId: string | null, sidebarVisible: boolean) => Promise<void>
  loadLayout: (workspaceId: string) => Promise<WorkspaceLayout | null>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  loading: false,

  async loadWorkspaces() {
    set({ loading: true })
    try {
      const rows = await getWorkspaces()

      // If no workspaces exist, create a default one
      if (rows.length === 0) {
        const now = Date.now()
        const defaultWorkspace: WorkspaceRecord = {
          id: generateId(),
          name: 'Default',
          description: 'Default workspace',
          icon: '📁',
          color: '#3b82f6',
          order: 0,
          is_active: 1,
          created_at: now,
          updated_at: now,
        }
        await createWorkspace(defaultWorkspace)
        rows.push(defaultWorkspace)
      }

      const workspaces = rows.map(rowToWorkspace)
      const active = workspaces.find(w => w.isActive)
      set({
        workspaces,
        activeWorkspaceId: active?.id ?? workspaces[0]?.id ?? null,
      })
    } finally {
      set({ loading: false })
    }
  },

  activeWorkspace(): Workspace | undefined {
    return get().workspaces.find(w => w.id === get().activeWorkspaceId)
  },

  async addWorkspace(workspace) {
    const now = Date.now()
    const id = generateId()
    const order = get().workspaces.length

    const newWorkspace: Workspace = {
      ...workspace,
      id,
      order,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    }

    const record: WorkspaceRecord = {
      id: newWorkspace.id,
      name: newWorkspace.name,
      description: newWorkspace.description ?? null,
      icon: newWorkspace.icon ?? null,
      color: newWorkspace.color ?? null,
      order: newWorkspace.order,
      is_active: 0,
      created_at: newWorkspace.createdAt,
      updated_at: newWorkspace.updatedAt,
    }

    await createWorkspace(record)
    set(state => ({ workspaces: [...state.workspaces, newWorkspace] }))
    return newWorkspace
  },

  async updateWorkspace(id, updates) {
    const existing = get().workspaces.find(w => w.id === id)
    if (!existing) return

    const updated: Workspace = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    }

    await updateWorkspace(id, {
      name: updated.name,
      description: updated.description ?? null,
      icon: updated.icon ?? null,
      color: updated.color ?? null,
      order: updated.order,
      updated_at: updated.updatedAt,
    })

    set(state => ({
      workspaces: state.workspaces.map(w => (w.id === id ? updated : w)),
    }))
  },

  async deleteWorkspace(id) {
    if (get().workspaces.length <= 1) {
      console.warn('Cannot delete the last workspace')
      return
    }

    await dbDeleteWorkspace(id)

    set(state => {
      const workspaces = state.workspaces.filter(w => w.id !== id)
      const activeWorkspaceId =
        state.activeWorkspaceId === id
          ? workspaces[0]?.id ?? null
          : state.activeWorkspaceId
      return { workspaces, activeWorkspaceId }
    })
  },

  async setActiveWorkspace(id) {
    await dbSetActiveWorkspace(id)
    set(state => ({
      workspaces: state.workspaces.map(w => ({
        ...w,
        isActive: w.id === id,
      })),
      activeWorkspaceId: id,
    }))
  },

  async saveLayout(workspaceId, tabs, splitGroups, activeTabId, sidebarVisible) {
    const layout: WorkspaceLayout = {
      workspaceId,
      tabs,
      splitGroups,
      activeTabId,
      sidebarVisible,
    }
    await saveWorkspaceLayout(workspaceId, layout)
  },

  async loadLayout(workspaceId) {
    const record = await getWorkspaceLayout(workspaceId)
    if (!record) return null
    try {
      return JSON.parse(record.layout_data) as WorkspaceLayout
    } catch {
      return null
    }
  },
}))
