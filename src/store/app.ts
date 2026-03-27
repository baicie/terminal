import type { SplitGroup, Tab } from '@/types'
import { create } from 'zustand'
import { getAppSettings as getAppSettingsFromDb } from '@/service/database'

type NewTab = Omit<Tab, 'id'>

export type AppThemeMode = 'light' | 'dark' | 'system'

export interface AppState {
  config: Record<string, unknown>
  theme: AppThemeMode
  language: string
  tabs: Tab[]
  splitGroups: SplitGroup[]
  activeTabId: string | null
  sidebarVisible: boolean
  // Actions
  setTheme: (theme: AppThemeMode) => void
  setLanguage: (language: string) => void
  hydrateFromDatabase: () => Promise<void>
  addTab: (tab: NewTab) => Tab
  removeTab: (id: string) => void
  splitTab: (id: string, direction: 'horizontal' | 'vertical') => string | null
  removeTabFromSplit: (tabId: string) => void
  closeSplit: (tabId: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, updates: Partial<Tab>) => void
  toggleSidebar: () => void
  setConfig: (config: Record<string, unknown>) => void
  queryConfig: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  config: {},
  theme: 'dark',
  language: 'en',
  tabs: [],
  splitGroups: [],
  activeTabId: null,
  sidebarVisible: true,

  setTheme(theme) {
    set({ theme })
  },

  setLanguage(language) {
    set({ language })
  },

  async hydrateFromDatabase() {
    try {
      const s = await getAppSettingsFromDb()
      set({
        theme: s.theme,
        language: s.language,
        config: s as unknown as Record<string, unknown>,
      })
    } catch (e) {
      console.error('hydrateFromDatabase failed:', e)
    }
  },

  addTab(tab) {
    const id = `${tab.type}-${Date.now()}`
    const newTab: Tab = { ...tab, id }
    set(state => ({
      tabs: [...state.tabs, newTab],
      activeTabId: id,
    }))
    return newTab
  },

  removeTab(id) {
    const { tabs, activeTabId } = get()
    const index = tabs.findIndex(t => t.id === id)
    if (index === -1) return

    const tab = tabs[index]
    if (tab.splitId) {
      get().removeTabFromSplit(id)
    }

    const newTabs = tabs.filter(t => t.id !== id)
    let newActiveId: string | null = null
    if (activeTabId === id) {
      if (newTabs.length > 0) {
        const newIndex = Math.min(index, newTabs.length - 1)
        newActiveId = newTabs[newIndex].id
      }
    } else {
      newActiveId = activeTabId
    }

    set({ tabs: newTabs, activeTabId: newActiveId })
  },

  splitTab(id, direction) {
    const { tabs } = get()
    const tabIndex = tabs.findIndex(t => t.id === id)
    if (tabIndex === -1) return null

    const sourceTab = tabs[tabIndex]
    const splitId = sourceTab.splitId || `split-${Date.now()}`

    const newTabId = `${sourceTab.type}-split-${Date.now()}`
    const newTab: Tab = {
      ...sourceTab,
      id: newTabId,
      splitMode: direction,
      splitId,
      splitChildren: [],
    }

    // Build updated tabs
    const updatedTabs = tabs.map(t => {
      if (t.id === id) {
        if (!sourceTab.splitId) {
          return {
            ...t,
            splitMode: direction,
            splitId,
            splitChildren: [newTabId],
          }
        }
        return { ...t, splitChildren: [...(t.splitChildren || []), newTabId] }
      }
      return t
    })

    const existingGroup = get().splitGroups.find(g => g.id === splitId)
    const newGroups = existingGroup
      ? get().splitGroups.map(g =>
          g.id === splitId ? { ...g, tabs: [...g.tabs, newTabId] } : g,
        )
      : [
          ...get().splitGroups,
          {
            id: splitId,
            mode: direction,
            tabs: [id, newTabId],
            sizes: [50, 50],
          },
        ]

    set({
      tabs: [...updatedTabs, newTab],
      splitGroups: newGroups,
      activeTabId: newTabId,
    })
    return newTabId
  },

  removeTabFromSplit(tabId) {
    const { tabs, splitGroups } = get()
    const tab = tabs.find(t => t.id === tabId)
    if (!tab?.splitId) return

    const group = splitGroups.find(g => g.id === tab.splitId)
    if (!group) return

    const newGroupTabs = group.tabs.filter(tid => tid !== tabId)
    const updatedTabs = tabs.map(t => {
      if (newGroupTabs.includes(t.id)) {
        if (newGroupTabs.length <= 1) {
          const { splitMode: _, splitId: __, splitChildren: ___, ...rest } = t
          return { ...rest, splitMode: 'none' as const }
        }
        return { ...t, splitChildren: newGroupTabs }
      }
      return t
    })

    const newGroups =
      newGroupTabs.length <= 1
        ? splitGroups.filter(g => g.id !== tab.splitId)
        : splitGroups.map(g =>
            g.id === tab.splitId ? { ...g, tabs: newGroupTabs } : g,
          )

    set({ tabs: updatedTabs, splitGroups: newGroups })
  },

  closeSplit(tabId) {
    const { tabs, splitGroups } = get()
    const tab = tabs.find(t => t.id === tabId)
    if (!tab?.splitId) return

    const group = splitGroups.find(g => g.id === tab.splitId)
    if (!group) return

    const updatedTabs = tabs.map(t => {
      if (group.tabs.includes(t.id)) {
        const { splitMode: _, splitId: __, splitChildren: ___, ...rest } = t
        return { ...rest, splitMode: 'none' as const }
      }
      return t
    })

    const newGroups = splitGroups.filter(g => g.id !== tab.splitId)
    set({ tabs: updatedTabs, splitGroups: newGroups })
  },

  setActiveTab(id) {
    set({ activeTabId: id })
  },

  updateTab(id, updates) {
    set(state => ({
      tabs: state.tabs.map(t => (t.id === id ? { ...t, ...updates } : t)),
    }))
  },

  toggleSidebar() {
    set(state => ({ sidebarVisible: !state.sidebarVisible }))
  },

  setConfig(config) {
    set({ config })
  },

  async queryConfig() {
    try {
      const res = await getAppSettingsFromDb()
      set({ config: res as unknown as Record<string, unknown> })
    } catch {
      // ignore
    }
  },
}))
