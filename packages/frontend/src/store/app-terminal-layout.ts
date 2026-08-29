import type { SplitGroup, Tab } from '@/types'
import {
  clampSplitSize,
  type TerminalLayoutState,
  withoutSplit,
} from './app-terminal-layout-normalize'

export {
  normalizeTerminalLayout,
  type TerminalLayoutState,
} from './app-terminal-layout-normalize'

export interface SplitTerminalResult extends TerminalLayoutState {
  newTabId: string
}

export function createUniqueTerminalId(
  prefix: string,
  existingIds: Iterable<string>,
  timestamp = Date.now(),
): string {
  const ids = new Set(existingIds)
  const base = `${prefix}-${timestamp}`
  if (!ids.has(base)) return base

  let suffix = 2
  while (ids.has(`${base}-${suffix}`)) suffix++
  return `${base}-${suffix}`
}

export function removeTerminalTab(
  state: TerminalLayoutState,
  tabId: string,
): TerminalLayoutState | null {
  const index = state.tabs.findIndex(tab => tab.id === tabId)
  if (index === -1) return null

  const removedTab = state.tabs[index]
  let tabs = state.tabs.filter(tab => tab.id !== tabId)
  let splitGroups = state.splitGroups
  let siblingId: string | null = null

  if (removedTab.splitId) {
    const group = state.splitGroups.find(item => item.id === removedTab.splitId)
    const remainingIds = group?.tabs.filter(id => id !== tabId) ?? []
    siblingId = remainingIds[0] ?? null
    splitGroups = state.splitGroups.filter(
      item => item.id !== removedTab.splitId,
    )
    tabs = tabs.map(tab =>
      remainingIds.includes(tab.id) ? withoutSplit(tab) : tab,
    )
  }

  const activeTabId = getActiveTabAfterRemoval({
    activeTabId: state.activeTabId,
    removedTabId: tabId,
    removedIndex: index,
    remainingTabs: tabs,
    siblingId,
  })

  return { tabs, splitGroups, activeTabId }
}

export function splitTerminalTab(
  state: TerminalLayoutState,
  tabId: string,
  direction: 'horizontal' | 'vertical',
  timestamp = Date.now(),
): SplitTerminalResult | null {
  const sourceIndex = state.tabs.findIndex(tab => tab.id === tabId)
  if (sourceIndex === -1) return null

  const source = state.tabs[sourceIndex]
  if (source.type === 'serial') return null
  const existingGroup = source.splitId
    ? state.splitGroups.find(group => group.id === source.splitId)
    : undefined
  if (existingGroup && existingGroup.tabs.length >= 2) return null

  const existingIds = [
    ...state.tabs.map(tab => tab.id),
    ...state.splitGroups.map(group => group.id),
  ]
  const splitId =
    existingGroup?.id ?? createUniqueTerminalId('split', existingIds, timestamp)
  const newTabId = createUniqueTerminalId(
    `${source.type}-split`,
    existingIds,
    timestamp,
  )
  const sourceWithSplit: Tab = {
    ...source,
    splitMode: direction,
    splitId,
    splitChildren: [newTabId],
  }
  const newTab: Tab = {
    ...source,
    id: newTabId,
    title: undefined,
    splitMode: direction,
    splitId,
    splitChildren: [source.id],
    connectionStatus: undefined,
  }
  const tabs = [...state.tabs]
  tabs.splice(sourceIndex, 1, sourceWithSplit, newTab)

  const splitGroups = existingGroup
    ? state.splitGroups.map(group =>
        group.id === splitId
          ? { ...group, mode: direction, tabs: [source.id, newTabId] }
          : group,
      )
    : [
        ...state.splitGroups,
        {
          id: splitId,
          mode: direction,
          tabs: [source.id, newTabId],
          sizes: [50, 50],
        },
      ]

  return {
    tabs,
    splitGroups,
    activeTabId: newTabId,
    newTabId,
  }
}

export function resizeTerminalSplit(
  splitGroups: SplitGroup[],
  splitId: string,
  sizes: [number, number],
): SplitGroup[] {
  const first = clampSplitSize(sizes[0])
  return splitGroups.map(group =>
    group.id === splitId ? { ...group, sizes: [first, 100 - first] } : group,
  )
}

export function moveTerminalTab(
  tabs: Tab[],
  tabId: string,
  direction: 'left' | 'right',
): Tab[] {
  const units = toTabUnits(tabs)
  const index = units.findIndex(unit => unit.some(tab => tab.id === tabId))
  const targetIndex = direction === 'left' ? index - 1 : index + 1
  if (index < 0 || targetIndex < 0 || targetIndex >= units.length) return tabs
  ;[units[index], units[targetIndex]] = [units[targetIndex], units[index]]
  return units.flat()
}

export function leaveTerminalSplit(
  tabs: Tab[],
  splitGroups: SplitGroup[],
  tabId: string,
): Pick<TerminalLayoutState, 'tabs' | 'splitGroups'> | null {
  const tab = tabs.find(item => item.id === tabId)
  if (!tab?.splitId) return null

  const group = splitGroups.find(item => item.id === tab.splitId)
  if (!group) return null

  return {
    tabs: tabs.map(item =>
      group.tabs.includes(item.id) ? withoutSplit(item) : item,
    ),
    splitGroups: splitGroups.filter(item => item.id !== group.id),
  }
}

function getActiveTabAfterRemoval(options: {
  activeTabId: string | null
  removedTabId: string
  removedIndex: number
  remainingTabs: Tab[]
  siblingId: string | null
}): string | null {
  if (options.activeTabId !== options.removedTabId) return options.activeTabId
  if (options.siblingId) return options.siblingId
  const nextIndex = Math.min(
    options.removedIndex,
    options.remainingTabs.length - 1,
  )
  return options.remainingTabs[nextIndex]?.id ?? null
}

function toTabUnits(tabs: Tab[]): Tab[][] {
  const units: Tab[][] = []
  const splitUnits = new Map<string, Tab[]>()
  for (const tab of tabs) {
    if (!tab.splitId) {
      units.push([tab])
      continue
    }
    const existing = splitUnits.get(tab.splitId)
    if (existing) {
      existing.push(tab)
      continue
    }
    const unit = [tab]
    splitUnits.set(tab.splitId, unit)
    units.push(unit)
  }
  return units
}
