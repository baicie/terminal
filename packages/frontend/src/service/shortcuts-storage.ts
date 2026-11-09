/**
 * SQLite-backed storage for shortcut bindings.
 *
 * Uses the existing `settings` table through `getSetting`/`setSetting`, so no
 * schema change is needed and the bindings travel with the rest of the user's
 * preferences (including the settings export).
 */

import { getSetting, setSetting } from './database/settings'
import { SHORTCUTS_SETTING_KEY } from './shortcuts'
import type { ShortcutStorage } from './shortcuts'
import type { Shortcut } from './shortcut-types'

function isShortcutList(value: unknown): value is Shortcut[] {
  return (
    Array.isArray(value)
    && value.every(
      entry =>
        typeof entry?.id === 'string'
        && typeof entry?.action === 'string'
        && Array.isArray(entry.keys)
        && entry.keys.every((key: unknown) => typeof key === 'string')
        && typeof entry.enabled === 'boolean',
    )
  )
}

export const shortcutsSettingStorage: ShortcutStorage = {
  async load(): Promise<Shortcut[] | null> {
    const stored = await getSetting<unknown>(SHORTCUTS_SETTING_KEY, null)
    // A value written by another version, or corrupted, is treated as "nothing
    // stored" rather than fed into the matcher.
    return isShortcutList(stored) ? stored : null
  },
  async save(shortcuts: Shortcut[]): Promise<void> {
    await setSetting(SHORTCUTS_SETTING_KEY, shortcuts)
  },
}
