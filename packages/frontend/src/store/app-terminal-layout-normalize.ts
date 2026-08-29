import type { SplitGroup, Tab } from '@/types'

export interface TerminalLayoutState {
  tabs: Tab[]
  splitGroups: SplitGroup[]
  activeTabId: string | null
}

export function normalizeTerminalLayout(
  state: TerminalLayoutState,
): TerminalLayoutState {
  const tabIds = new Set<string>()
  const sourceTabs: unknown[] = Array.isArray(state.tabs) ? state.tabs : []
  const tabs = sourceTabs.reduce<Tab[]>((result, value) => {
    if (!isTerminalTab(value) || tabIds.has(value.id)) return result
    const tab = value
    tabIds.add(tab.id)
    result.push(withoutSplit(tab))
    return result
  }, [])
  const tabsById = new Map(tabs.map(tab => [tab.id, tab]))
  const claimedTabIds = new Set<string>()
  const seenGroupIds = new Set<string>()
  const splitGroups: SplitGroup[] = []
  const sourceGroups: unknown[] = Array.isArray(state.splitGroups)
    ? state.splitGroups
    : []

  for (const value of sourceGroups) {
    if (!isSplitGroup(value) || seenGroupIds.has(value.id)) continue
    const group = value

    const groupTabIds: string[] = []
    const seenTabIds = new Set<string>()
    for (const tabId of group.tabs) {
      if (groupTabIds.length === 2) break
      if (typeof tabId !== 'string') continue
      if (seenTabIds.has(tabId) || claimedTabIds.has(tabId)) continue
      seenTabIds.add(tabId)
      const tab = tabsById.get(tabId)
      if (!tab || tab.type === 'serial') continue
      groupTabIds.push(tabId)
    }
    if (groupTabIds.length !== 2) continue

    seenGroupIds.add(group.id)
    groupTabIds.forEach(tabId => claimedTabIds.add(tabId))
    splitGroups.push({
      id: group.id,
      mode: group.mode,
      tabs: groupTabIds,
      sizes: normalizeSplitSizes(group.sizes),
    })
  }

  const groupsByTabId = new Map<string, SplitGroup>()
  splitGroups.forEach(group => {
    group.tabs.forEach(tabId => groupsByTabId.set(tabId, group))
  })
  const normalizedTabs = tabs.map(tab => {
    const group = groupsByTabId.get(tab.id)
    if (!group) return tab
    return {
      ...tab,
      splitMode: group.mode,
      splitId: group.id,
      splitChildren: group.tabs.filter(tabId => tabId !== tab.id),
    }
  })
  const activeTabId = tabIds.has(state.activeTabId ?? '')
    ? state.activeTabId
    : (normalizedTabs[0]?.id ?? null)

  return { tabs: normalizedTabs, splitGroups, activeTabId }
}

export function clampSplitSize(value: number): number {
  return Math.max(20, Math.min(80, value))
}

function normalizeSplitSizes(sizes: number[] | undefined): [number, number] {
  const first = sizes?.[0]
  const normalizedFirst =
    typeof first === 'number' && Number.isFinite(first)
      ? clampSplitSize(first)
      : 50
  return [normalizedFirst, 100 - normalizedFirst]
}

function isTerminalTab(value: unknown): value is Tab {
  if (!value || typeof value !== 'object') return false
  const tab = value as Partial<Tab>
  return (
    typeof tab.id === 'string' &&
    tab.id.length > 0 &&
    typeof tab.label === 'string' &&
    (tab.type === 'local' || tab.type === 'remote' || tab.type === 'serial')
  )
}

function isSplitGroup(value: unknown): value is SplitGroup {
  if (!value || typeof value !== 'object') return false
  const group = value as Partial<SplitGroup>
  return (
    typeof group.id === 'string' &&
    group.id.length > 0 &&
    (group.mode === 'horizontal' || group.mode === 'vertical') &&
    Array.isArray(group.tabs)
  )
}

export function withoutSplit(tab: Tab): Tab {
  const { splitMode: _, splitId: __, splitChildren: ___, ...rest } = tab
  return rest
}
