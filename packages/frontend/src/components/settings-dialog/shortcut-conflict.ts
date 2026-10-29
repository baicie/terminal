import type { Shortcut } from '@/service/shortcuts'

export function findShortcutConflict(
  shortcuts: readonly Shortcut[],
  keys: string[],
  excludeId: string,
): Shortcut | undefined {
  return shortcuts.find(
    shortcut =>
      shortcut.id !== excludeId &&
      shortcut.enabled &&
      keys.length === shortcut.keys.length &&
      keys.every((key, index) => key === shortcut.keys[index]),
  )
}
