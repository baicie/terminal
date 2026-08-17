import type { SplitGroup, Tab } from '@/types'
import { create } from 'zustand'
import { getAppSettings as getAppSettingsFromDb } from '@/service/database'
import {
  createUniqueTerminalId,
  leaveTerminalSplit,
  moveTerminalTab,
  normalizeTerminalLayout,
  removeTerminalTab,
  resizeTerminalSplit,
  splitTerminalTab,
} from './app-terminal-layout'

type NewTab = Omit<Tab, 'id'>
type RestorableLayout = {
  tabs: Tab[]
  splitGroups: SplitGroup[]
  activeTabId: string | null
  sidebarVisible: boolean
}

export interface RecentlyClosedTab {
  id: string
  label: string
  type: 'local' | 'remote' | 'serial'
  hostId?: string
  serialSessionId?: string
  serialConfig?: { port: string; baudRate: number }
  closedAt: number
}

export type AppThemeMode = 'light' | 'dark' | 'system'

export interface AppState {
  config: Record<string, unknown>
  theme: AppThemeMode
  language: string
  tabs: Tab[]
  splitGroups: SplitGroup[]
  activeTabId: string | null
  sidebarVisible: boolean
  recentlyClosedTabs: RecentlyClosedTab[]
  // Actions
  setTheme: (theme: AppThemeMode) => void
  setLanguage: (language: string) => void
  hydrateFromDatabase: () => Promise<void>
  restoreLayout: (layout: RestorableLayout) => void
  addTab: (tab: NewTab) => Tab
  removeTab: (id: string) => void
  splitTab: (id: string, direction: 'horizontal' | 'vertical') => string | null
  resizeSplit: (splitId: string, sizes: [number, number]) => void
  moveTab: (tabId: string, direction: 'left' | 'right') => void
  removeTabFromSplit: (tabId: string) => void
  closeSplit: (tabId: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, updates: Partial<Tab>) => void
  toggleSidebar: () => void
  setConfig: (config: Record<string, unknown>) => void
  queryConfig: () => Promise<void>
  reopenTab: (closedTab: RecentlyClosedTab) => Tab
}

export const useAppStore = create<AppState>((set, get) => ({
  config: {},
  theme: 'dark',
  language: 'en',
  tabs: [],
  splitGroups: [],
  activeTabId: null,
  sidebarVisible: true,
  recentlyClosedTabs: [],

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

  restoreLayout(layout) {
    set({
      ...normalizeTerminalLayout(layout),
      sidebarVisible:
        typeof layout.sidebarVisible === 'boolean'
          ? layout.sidebarVisible
          : true,
    })
  },

  addTab(tab) {
    const state = get()
    const id = createUniqueTerminalId(tab.type, [
      ...state.tabs.map(item => item.id),
      ...state.recentlyClosedTabs.map(item => item.id),
    ])
    const newTab: Tab = { ...tab, id }
    set(state => ({
      tabs: [...state.tabs, newTab],
      activeTabId: id,
    }))
    return newTab
  },

  removeTab(id) {
    const { tabs, splitGroups, activeTabId } = get()
    const tab = tabs.find(item => item.id === id)
    if (!tab) return
    const layout = removeTerminalTab({ tabs, splitGroups, activeTabId }, id)
    if (!layout) return

    const closedTab: RecentlyClosedTab = {
      id: tab.id,
      label: tab.label,
      type: tab.type,
      hostId: tab.hostId,
      serialSessionId: tab.serialSessionId,
      serialConfig: tab.serialConfig,
      closedAt: Date.now(),
    }

    set(state => ({
      ...layout,
      recentlyClosedTabs: [closedTab, ...state.recentlyClosedTabs].slice(0, 10),
    }))
  },

  splitTab(id, direction) {
    const { tabs, splitGroups, activeTabId } = get()
    const layout = splitTerminalTab(
      { tabs, splitGroups, activeTabId },
      id,
      direction,
    )
    if (!layout) return null
    const { newTabId, ...nextState } = layout
    set(nextState)
    return newTabId
  },

  resizeSplit(splitId, sizes) {
    set(state => ({
      splitGroups: resizeTerminalSplit(state.splitGroups, splitId, sizes),
    }))
  },

  moveTab(tabId, direction) {
    set(state => ({ tabs: moveTerminalTab(state.tabs, tabId, direction) }))
  },

  removeTabFromSplit(tabId) {
    const { tabs, splitGroups } = get()
    const layout = leaveTerminalSplit(tabs, splitGroups, tabId)
    if (layout) set(layout)
  },

  closeSplit(tabId) {
    const { tabs, splitGroups } = get()
    const layout = leaveTerminalSplit(tabs, splitGroups, tabId)
    if (layout) set(layout)
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

  reopenTab(closedTab) {
    const state = get()
    const newId = createUniqueTerminalId(closedTab.type, [
      ...state.tabs.map(item => item.id),
      ...state.recentlyClosedTabs.map(item => item.id),
    ])
    const restoredTab: Tab = {
      id: newId,
      label: closedTab.label,
      type: closedTab.type,
      hostId: closedTab.hostId,
      serialSessionId: closedTab.serialSessionId,
      serialConfig: closedTab.serialConfig,
    }
    set(state => ({
      tabs: [...state.tabs, restoredTab],
      activeTabId: newId,
      recentlyClosedTabs: state.recentlyClosedTabs.filter(
        t => t.id !== closedTab.id,
      ),
    }))
    return restoredTab
  },
}))
