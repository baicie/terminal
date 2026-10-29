const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])
const EDITABLE_SAFE_ACTIONS = new Set([
  'command-palette',
  'toggle-sidebar',
  'new-tab',
  'new-local',
  'new-ssh',
])

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  '|': '\\',
}

export function keysMatch(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false

  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((key, index) => key === sortedRight[index])
}

export function parseShortcutKeyboardEvent(event: KeyboardEvent): string[] {
  const keys: string[] = []
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform)

  if (event.ctrlKey || (isMac && event.metaKey)) keys.push('Ctrl')
  if (event.shiftKey) keys.push('Shift')
  if (event.altKey) keys.push('Alt')
  if (!isMac && event.metaKey) keys.push('Meta')

  if (!MODIFIER_KEYS.has(event.key)) {
    const normalized =
      KEY_NAMES[event.key] ??
      (event.key.length === 1 ? event.key.toUpperCase() : event.key)
    keys.push(normalized)
  }

  return keys
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  ) {
    return true
  }
  return target.isContentEditable
}

export function shouldHandleShortcutInEditableTarget(action: string): boolean {
  return EDITABLE_SAFE_ACTIONS.has(action)
}
