import { action, makeAutoObservable, runInAction } from 'mobx'
import { singleton } from 'tsyringe'
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

@singleton()
export class WorkspaceStore {
  workspaces: Workspace[] = []
  activeWorkspaceId: string | null = null
  loading = false

  constructor() {
    makeAutoObservable(this, {
      loadWorkspaces: action,
      setActiveWorkspace: action,
    })
  }

  async loadWorkspaces() {
    this.loading = true
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

      runInAction(() => {
        this.workspaces = rows.map(rowToWorkspace)
        const active = this.workspaces.find(w => w.isActive)
        this.activeWorkspaceId = active?.id ?? this.workspaces[0]?.id ?? null
      })
    } finally {
      runInAction(() => {
        this.loading = false
      })
    }
  }

  get activeWorkspace(): Workspace | undefined {
    return this.workspaces.find(w => w.id === this.activeWorkspaceId)
  }

  async addWorkspace(
    workspace: Omit<
      Workspace,
      'id' | 'createdAt' | 'updatedAt' | 'isActive' | 'order'
    >,
  ) {
    const now = Date.now()
    const id = generateId()
    const order = this.workspaces.length

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

    runInAction(() => {
      this.workspaces.push(newWorkspace)
    })

    return newWorkspace
  }

  async updateWorkspace(id: string, updates: Partial<Workspace>) {
    const existing = this.workspaces.find(w => w.id === id)
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

    runInAction(() => {
      const index = this.workspaces.findIndex(w => w.id === id)
      if (index !== -1) {
        this.workspaces[index] = updated
      }
    })
  }

  async deleteWorkspace(id: string) {
    // Don't delete if it's the last workspace
    if (this.workspaces.length <= 1) {
      console.warn('Cannot delete the last workspace')
      return
    }

    await dbDeleteWorkspace(id)

    runInAction(() => {
      this.workspaces = this.workspaces.filter(w => w.id !== id)

      // If we deleted the active workspace, switch to another
      if (this.activeWorkspaceId === id) {
        this.activeWorkspaceId = this.workspaces[0]?.id ?? null
      }
    })
  }

  async setActiveWorkspace(id: string) {
    await dbSetActiveWorkspace(id)

    runInAction(() => {
      this.workspaces.forEach(w => {
        w.isActive = w.id === id
      })
      this.activeWorkspaceId = id
    })
  }

  async saveLayout(
    workspaceId: string,
    tabs: Tab[],
    splitGroups: SplitGroup[],
    activeTabId: string | null,
    sidebarVisible: boolean,
  ) {
    const layout: WorkspaceLayout = {
      workspaceId,
      tabs,
      splitGroups,
      activeTabId,
      sidebarVisible,
    }
    await saveWorkspaceLayout(workspaceId, layout)
  }

  async loadLayout(workspaceId: string): Promise<WorkspaceLayout | null> {
    const record = await getWorkspaceLayout(workspaceId)
    if (!record) return null
    try {
      return JSON.parse(record.layout_data) as WorkspaceLayout
    } catch {
      return null
    }
  }
}
