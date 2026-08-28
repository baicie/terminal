import type { Group, Host } from '@/types'
import { create } from 'zustand'
import { executeQuery, select } from '@/service/database'
import { generateId } from '@/utils/id'
import {
  groupRowToGroup,
  hostRowToHost,
  type GroupRow,
  type HostRow,
} from './host-mappers'

export interface HostState {
  hosts: Host[]
  groups: Group[]
  selectedHostId: string | null
  selectedGroupId: string | null
  loading: boolean
  dbAvailable: boolean
  // Computed
  favoriteHosts: () => Host[]
  getGroupChildren: (parentId: string | null) => Group[]
  getHostsByGroup: (groupId: string | null) => Host[]
  // Actions
  loadHosts: () => Promise<void>
  loadGroups: () => Promise<void>
  addHost: (host: Omit<Host, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Host>
  updateHost: (id: string, updates: Partial<Host>) => Promise<void>
  deleteHost: (id: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  addGroup: (group: Omit<Group, 'id'>) => Promise<Group>
  updateGroup: (id: string, updates: Partial<Group>) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  setSelectedHost: (id: string | null) => void
  setSelectedGroup: (id: string | null) => void
}

export const useHostStore = create<HostState>((set, get) => ({
  hosts: [],
  groups: [],
  selectedHostId: null,
  selectedGroupId: null,
  loading: false,
  dbAvailable: true,

  // Computed
  favoriteHosts(): Host[] {
    return get().hosts.filter(h => h.isFavorite)
  },
  getGroupChildren(parentId: string | null): Group[] {
    return get().groups.filter(g => g.parentId === parentId)
  },
  getHostsByGroup(groupId: string | null): Host[] {
    return get().hosts.filter(h => h.groupId === groupId)
  },

  async loadHosts() {
    set({ loading: true })
    try {
      const rows = await select<HostRow>('SELECT * FROM hosts ORDER BY name')
      set({ hosts: rows.map(hostRowToHost), dbAvailable: true })
    } catch (error) {
      // Check if it's a "not in Tauri context" error
      if (
        error instanceof Error &&
        error.message === 'Database only available in Tauri context'
      ) {
        set({ hosts: [], dbAvailable: false })
        return
      }
      throw error
    } finally {
      set({ loading: false })
    }
  },

  async loadGroups() {
    try {
      const rows = await select<GroupRow>(
        'SELECT * FROM groups ORDER BY "order"',
      )
      set({ groups: rows.map(groupRowToGroup) })
    } catch (error) {
      // Check if it's a "not in Tauri context" error - don't throw, just log
      if (
        error instanceof Error &&
        error.message === 'Database only available in Tauri context'
      ) {
        set({ groups: [] })
        return
      }
      throw error
    }
  },

  async addHost(host) {
    const now = Date.now()
    const id = generateId()
    const newHost: Host = {
      ...host,
      id,
      createdAt: now,
      updatedAt: now,
    }

    await executeQuery(
      `INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, certificate, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, jump_host_id, jump_host_auth_type, agent_forwarding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newHost.id,
        newHost.name,
        newHost.hostname,
        newHost.port,
        newHost.username,
        newHost.authType,
        newHost.password ?? null,
        newHost.privateKey ?? null,
        newHost.certificate ?? null,
        newHost.groupId ?? null,
        newHost.isFavorite ? 1 : 0,
        newHost.color ?? null,
        newHost.tags ? JSON.stringify(newHost.tags) : null,
        JSON.stringify(newHost.portForwards),
        newHost.startupCommand ?? null,
        newHost.environment ? JSON.stringify(newHost.environment) : null,
        newHost.jumpHostId ?? null,
        newHost.jumpHostAuthType ?? null,
        newHost.agentForwarding ? 1 : 0,
        newHost.createdAt,
        newHost.updatedAt,
      ],
    )

    set(state => ({ hosts: [...state.hosts, newHost] }))
    return newHost
  },

  async updateHost(id, updates) {
    const existing = get().hosts.find(h => h.id === id)
    if (!existing) return

    const updated: Host = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    }

    await executeQuery(
      `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = ?, private_key = ?, certificate = ?, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, agent_forwarding = ?, updated_at = ? WHERE id = ?`,
      [
        updated.name,
        updated.hostname,
        updated.port,
        updated.username,
        updated.authType,
        updated.password ?? null,
        updated.privateKey ?? null,
        updated.certificate ?? null,
        updated.groupId ?? null,
        updated.isFavorite ? 1 : 0,
        updated.color ?? null,
        updated.tags ? JSON.stringify(updated.tags) : null,
        JSON.stringify(updated.portForwards),
        updated.startupCommand ?? null,
        updated.environment ? JSON.stringify(updated.environment) : null,
        updated.jumpHostId ?? null,
        updated.jumpHostAuthType ?? null,
        updated.agentForwarding ? 1 : 0,
        updated.updatedAt,
        id,
      ],
    )

    set(state => ({
      hosts: state.hosts.map(h => (h.id === id ? updated : h)),
    }))
  },

  async deleteHost(id) {
    await executeQuery('DELETE FROM hosts WHERE id = ?', [id])
    set(state => ({ hosts: state.hosts.filter(h => h.id !== id) }))
  },

  async toggleFavorite(id) {
    const host = get().hosts.find(h => h.id === id)
    if (host) {
      await get().updateHost(id, { isFavorite: !host.isFavorite })
    }
  },

  async addGroup(group) {
    const id = generateId()
    const newGroup: Group = { ...group, id }

    await executeQuery(
      `INSERT INTO groups (id, name, parent_id, color, inherit_settings, settings, "order") VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newGroup.id,
        newGroup.name,
        newGroup.parentId ?? null,
        newGroup.color ?? null,
        newGroup.inheritSettings ? 1 : 0,
        newGroup.settings ? JSON.stringify(newGroup.settings) : null,
        newGroup.order,
      ],
    )

    set(state => ({ groups: [...state.groups, newGroup] }))
    return newGroup
  },

  async updateGroup(id, updates) {
    const existing = get().groups.find(g => g.id === id)
    if (!existing) return

    const updated: Group = { ...existing, ...updates }

    await executeQuery(
      `UPDATE groups SET name = ?, parent_id = ?, color = ?, inherit_settings = ?, settings = ?, "order" = ? WHERE id = ?`,
      [
        updated.name,
        updated.parentId ?? null,
        updated.color ?? null,
        updated.inheritSettings ? 1 : 0,
        updated.settings ? JSON.stringify(updated.settings) : null,
        updated.order,
        id,
      ],
    )

    set(state => ({
      groups: state.groups.map(g => (g.id === id ? updated : g)),
    }))
  },

  async deleteGroup(id) {
    await executeQuery('DELETE FROM groups WHERE id = ?', [id])
    set(state => ({ groups: state.groups.filter(g => g.id !== id) }))
  },

  setSelectedHost(id) {
    set({ selectedHostId: id })
  },

  setSelectedGroup(id) {
    set({ selectedGroupId: id })
  },
}))
