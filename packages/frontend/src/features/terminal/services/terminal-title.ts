import type { Tab } from '@/types'

const MAX_TERMINAL_TITLE_LENGTH = 160

export function normalizeTerminalTitle(title: string): string | undefined {
  if (typeof title !== 'string') return undefined
  const normalized = title.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.slice(0, MAX_TERMINAL_TITLE_LENGTH)
}

export function getTabDisplayLabel(
  tab: Pick<Tab, 'label' | 'title'>,
): string {
  return tab.title ?? tab.label
}
