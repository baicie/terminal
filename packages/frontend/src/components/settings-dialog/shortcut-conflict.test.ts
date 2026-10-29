import { describe, expect, it } from 'vitest'
import type { Shortcut } from '@/service/shortcuts'
import { findShortcutConflict } from './shortcut-conflict'

const shortcuts: Shortcut[] = [
  {
    id: 'excluded',
    name: 'Excluded',
    keys: ['Ctrl', 'K'],
    action: 'excluded',
    enabled: true,
  },
  {
    id: 'disabled',
    name: 'Disabled',
    keys: ['Ctrl', 'K'],
    action: 'disabled',
    enabled: false,
  },
  {
    id: 'match',
    name: 'Match',
    keys: ['Ctrl', 'K'],
    action: 'match',
    enabled: true,
  },
]

describe('findShortcutConflict', () => {
  it('returns an enabled exact match while excluding the edited shortcut', () => {
    expect(findShortcutConflict(shortcuts, ['Ctrl', 'K'], 'excluded')).toBe(
      shortcuts[2],
    )
  })

  it('requires the same key order and key count', () => {
    expect(
      findShortcutConflict(shortcuts, ['K', 'Ctrl'], 'excluded'),
    ).toBeUndefined()
    expect(
      findShortcutConflict(shortcuts, ['Ctrl'], 'excluded'),
    ).toBeUndefined()
  })
})
