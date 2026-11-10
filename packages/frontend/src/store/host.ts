import type { Group, Host } from '@/types'
import { create } from 'zustand'
import { executeQuery, selectStrict as select } from '@/service/database'
import {
  createHost as createHostRow,
  deleteHost as deleteHostRow,
  getHostById,
  updateHost as updateHostRow,
} from '@/service/database/hosts'
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
  /**
   * Resolve with the rows this call loaded, or `null` when another concurrent
   * call owns the store generation. Startup recovery must not infer "no hosts"
   * from a superseded call: that filtered restorable remote tabs and let a
   * local fallback win (Issue #184).
   */
  loadHosts: (signal?: AbortSignal) => Promise<Host[] | null>
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

/** Drop the form-only secret fields, keeping everything the row actually stores. */
function withoutSecrets(host: Host): Host {
  const { password: _password, privateKey: _privateKey, ...metadata } = host
  // `clearCredential` is an instruction for a write, never state a host holds.
  const { clearCredential: _clear, ...rest } = metadata as Host
  return rest as Host
}

export const useHostStore = create<HostState>((set, get) => {  let loadGeneration = 0

  return {
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

    async loadHosts(signal) {
      if (signal?.aborted) return null
      const generation = ++loadGeneration
      const clearLoadingOnAbort = () => {
        if (generation === loadGeneration) set({ loading: false })
      }
      set({ loading: true })
      signal?.addEventListener('abort', clearLoadingOnAbort, { once: true })
      if (signal?.aborted) {
        clearLoadingOnAbort()
        signal.removeEventListener('abort', clearLoadingOnAbort)
        return null
      }
      try {
        const rows = await select<HostRow>('SELECT * FROM hosts ORDER BY name')
        if (signal?.aborted || generation !== loadGeneration) return null
        const hosts = rows.map(hostRowToHost)
        set({ hosts, dbAvailable: true })
        return hosts
      } catch (error) {
        // Check if it's a "not in Tauri context" error
        if (
          error instanceof Error &&
          error.message === 'Database only available in Tauri context'
        ) {
          if (!signal?.aborted && generation === loadGeneration) {
            set({ hosts: [], dbAvailable: false })
          }
          return []
        }
        throw error
      } finally {
        signal?.removeEventListener('abort', clearLoadingOnAbort)
        if (generation === loadGeneration) set({ loading: false })
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

      // The one place a host row is written. It moves any secret into the vault
      // and stores only a reference, so no other module can reintroduce a
      // plaintext column by writing its own INSERT (see
      // docs/phase10/08-credential-single-write-path-adr.md).
      await createHostRow(newHost)

      // Read the row back instead of guessing what it became. The reference and
      // its version are decided by the write path, so a caller that needs the
      // stored host — "save, then connect", "save, then show it" — would otherwise
      // hold an object with no credential at all. That was a real defect: the
      // in-memory copy had no reference, so the very next connection said "no
      // stored secret" while the vault held one.
      const stored = await getHostById(id)
      // The value typed into the form never enters the store: it is in the vault
      // now, and keeping it would leave plaintext in memory for the session.
      const metadata = withoutSecrets(stored ?? newHost)
      set(state => ({ hosts: [...state.hosts, metadata] }))
      return metadata
    },

    async updateHost(id, updates) {
      const existing = get().hosts.find(h => h.id === id)
      if (!existing) return

      await updateHostRow(id, updates)

      // Same reason as addHost: a credential change, a clear, or a version bump is
      // decided inside the write path. Re-deriving it here would drift from what is
      // stored, and the drift is exactly a stale credential.
      const stored = await getHostById(id)
      if (stored === null) {
        // The row is gone (deleted concurrently). Drop it from the list rather than
        // keeping a host that no longer exists.
        set(state => ({ hosts: state.hosts.filter(h => h.id !== id) }))
        return
      }
      const metadata = withoutSecrets(stored)
      set(state => ({
        hosts: state.hosts.map(h => (h.id === id ? metadata : h)),
      }))
    },

    async deleteHost(id) {
      // Deletes the row first, then the vault keys: a failure between the two
      // leaves an unreferenced secret, never a host whose secret is already gone
      // (ADR §4).
      await deleteHostRow(id)
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
  }
})
