import { builtInActions, defaultShortcuts } from './shortcut-defaults'
import {
  isEditableShortcutTarget,
  keysMatch,
  parseShortcutKeyboardEvent,
  shouldHandleShortcutInEditableTarget,
} from './shortcut-keyboard'
import type { Shortcut } from './shortcut-types'

export { builtInActions, defaultShortcuts }
export type { Shortcut, ShortcutAction } from './shortcut-types'

class ShortcutsService {
  private shortcuts: Shortcut[] = [...defaultShortcuts]
  private listeners: ((action: string) => void)[] = []

  getShortcuts(): Shortcut[] {
    return [...this.shortcuts]
  }

  getEnabledShortcuts(): Shortcut[] {
    return this.shortcuts.filter(shortcut => shortcut.enabled)
  }

  getShortcutByAction(action: string): Shortcut | undefined {
    return this.shortcuts.find(shortcut => shortcut.action === action)
  }

  updateShortcut(id: string, updates: Partial<Shortcut>): boolean {
    const index = this.shortcuts.findIndex(shortcut => shortcut.id === id)
    if (index === -1) return false

    this.shortcuts[index] = { ...this.shortcuts[index], ...updates }
    return true
  }

  addShortcut(shortcut: Shortcut): void {
    const conflicts = this.shortcuts.filter(
      current =>
        current.enabled &&
        current.id !== shortcut.id &&
        keysMatch(current.keys, shortcut.keys),
    )

    if (conflicts.length > 0) {
      console.warn(
        'Shortcut conflicts with:',
        conflicts.map(conflict => conflict.name),
      )
    }

    this.shortcuts.push(shortcut)
  }

  removeShortcut(id: string): boolean {
    const index = this.shortcuts.findIndex(shortcut => shortcut.id === id)
    if (index === -1) return false

    this.shortcuts.splice(index, 1)
    return true
  }

  resetToDefault(): void {
    this.shortcuts = [...defaultShortcuts]
  }

  /** Maps Command to the shared Ctrl binding on macOS. */
  parseKeyboardEvent(event: KeyboardEvent): string[] {
    return parseShortcutKeyboardEvent(event)
  }

  matchShortcut(event: KeyboardEvent): Shortcut | undefined {
    const keys = this.parseKeyboardEvent(event)
    return this.shortcuts.find(
      shortcut => shortcut.enabled && keysMatch(shortcut.keys, keys),
    )
  }

  handleKeyboardEvent(event: KeyboardEvent): boolean {
    const shortcut = this.matchShortcut(event)
    if (!shortcut) return false

    if (
      isEditableShortcutTarget(event.target) &&
      !shouldHandleShortcutInEditableTarget(shortcut.action)
    ) {
      return false
    }

    event.preventDefault()
    this.triggerAction(shortcut.action)
    return true
  }

  triggerAction(action: string): void {
    this.listeners.forEach(listener => listener(action))
  }

  addListener(callback: (action: string) => void): () => void {
    this.listeners.push(callback)
    return () => {
      const index = this.listeners.indexOf(callback)
      if (index !== -1) this.listeners.splice(index, 1)
    }
  }

  formatShortcut(shortcut: Shortcut): string {
    return shortcut.keys.join(' + ')
  }

  exportShortcuts(): string {
    return JSON.stringify(this.shortcuts, null, 2)
  }

  importShortcuts(json: string): boolean {
    try {
      const shortcuts = JSON.parse(json) as Shortcut[]
      if (Array.isArray(shortcuts)) {
        this.shortcuts = shortcuts
        return true
      }
    } catch {
      // Invalid JSON keeps the current bindings unchanged.
    }
    return false
  }
}

export const shortcutsService = new ShortcutsService()
