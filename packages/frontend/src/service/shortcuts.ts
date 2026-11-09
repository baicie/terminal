import { builtInActions, defaultShortcuts } from './shortcut-defaults'
import {
  isEditableShortcutTarget,
  keysMatch,
  parseShortcutKeyboardEvent,
  shouldHandleShortcutInEditableTarget,
} from './shortcut-keyboard'
import type { Shortcut } from './shortcut-types'
import { ShortcutWriter } from './shortcut-writer'
import type { ShortcutPersistState } from './shortcut-persist-state'

/** Where the user's bindings live in the existing settings table. */
export const SHORTCUTS_SETTING_KEY = 'shortcuts.bindings'

/**
 * Storage for the bindings. The SQLite settings table is the real backend; the
 * interface exists so the service can be tested without a database and so a
 * failed write is visible instead of silently losing the user's keys.
 */
export interface ShortcutStorage {
  load(): Promise<Shortcut[] | null>
  save(shortcuts: Shortcut[]): Promise<void>
}

/** A storage that keeps nothing: used until the database-backed one is attached. */
export const memoryOnlyShortcutStorage: ShortcutStorage = {
  load: async () => null,
  save: async () => undefined,
}

export { builtInActions, defaultShortcuts }
export type { Shortcut, ShortcutAction } from './shortcut-types'
export type { ShortcutPersistState, ShortcutPersistStatus } from './shortcut-persist-state'

export class ShortcutsService {
  // Deep copies: the defaults are a module-level constant, and a shallow copy
  // would let one service instance mutate the shared objects (which then leaks
  // into every other instance and into the exported defaults).
  private shortcuts: Shortcut[] = defaultShortcuts.map(shortcut => ({
    ...shortcut,
    keys: [...shortcut.keys],
  }))
  private listeners: ((action: string) => void)[] = []
  private storage: ShortcutStorage = memoryOnlyShortcutStorage
  /** Bumped on every change so a stale in-flight load cannot overwrite it. */
  private revision = 0
  /** Serialised writes plus the state the UI needs to show them. */
  private readonly writer = new ShortcutWriter()

  /** Attach the persistent backend. Call once at startup, before `hydrate()`. */
  useStorage(storage: ShortcutStorage): void {
    this.storage = storage
  }

  /**
   * Loads the user's bindings.
   *
   * A stored list replaces the defaults; an absent one keeps them. A stored list
   * whose actions no longer exist is merged against the defaults so a binding the
   * app added later is not silently lost, and a removed action does not linger.
   */
  async hydrate(): Promise<void> {
    const revisionAtStart = this.revision
    let stored: Shortcut[] | null = null
    try {
      stored = await this.storage.load()
    } catch (error) {
      // A read failure must not leave the user with no shortcuts at all.
      console.warn('Shortcut settings could not be loaded; using defaults.', error)
      return
    }
    if (stored === null || this.revision !== revisionAtStart) return
    this.shortcuts = this.mergeWithDefaults(stored)
    this.notifyChange()
  }

  private mergeWithDefaults(stored: Shortcut[]): Shortcut[] {
    // Keyed by `id`, not by `action`: the shipped defaults deliberately bind one
    // action to more than one key (Ctrl+J and Ctrl+K both open the palette), and
    // keying by action collapsed them into whichever came last.
    const byId = new Map(stored.map(shortcut => [shortcut.id, shortcut]))
    const merged = defaultShortcuts.map(dflt => {
      const saved = byId.get(dflt.id)
      return saved === undefined
        ? { ...dflt, keys: [...dflt.keys] }
        : { ...dflt, ...saved, keys: [...saved.keys] }
    })
    // Bindings the user added for actions the app does not ship are kept only if
    // the action still exists in the defaults; otherwise they would be dead keys.
    return merged
  }

  /**
   * Writes the current bindings. The in-memory change stays even if the write
   * fails - the UI must show what the user chose - and the rejection is reported
   * by the caller so it is never mistaken for a saved binding.
   */
  private async persist(): Promise<void> {
    // Bumping the revision is what stops a slow in-flight hydrate from
    // overwriting what the user just changed (see hydrate()).
    this.revision += 1
    this.writer.write(() => this.storage.save(this.getShortcuts()))
  }

  getShortcutById(id: string): Shortcut | undefined {
    return this.shortcuts.find(shortcut => shortcut.id === id)
  }

  private notifyChange(): void {
    this.listeners.forEach(listener => listener('shortcuts-changed'))
  }

  getPersistState(): ShortcutPersistState {
    return this.writer.state()
  }

  onPersistStateChange(
    listener: (state: ShortcutPersistState) => void,
  ): () => void {
    return this.writer.onChange(listener)
  }

  /** Re-runs the last write; used by the UI's retry action. */
  async retryPersist(): Promise<boolean> {
    try {
      await this.persist()
      return true
    } catch {
      return false
    }
  }

  getShortcuts(): Shortcut[] {
    return [...this.shortcuts]
  }

  getEnabledShortcuts(): Shortcut[] {
    return this.shortcuts.filter(shortcut => shortcut.enabled)
  }

  getShortcutByAction(action: string): Shortcut | undefined {
    return this.shortcuts.find(shortcut => shortcut.action === action)
  }

  /**
   * Applies an edit and persists it.
   *
   * A new key set that collides with an enabled binding is refused: silently
   * accepting it would leave two actions fighting for one keystroke and only one
   * of them ever running. The caller gets `false` and shows why.
   */
  updateShortcut(id: string, updates: Partial<Shortcut>): boolean {
    const index = this.shortcuts.findIndex(shortcut => shortcut.id === id)
    if (index === -1) return false

    if (updates.keys !== undefined) {
      const conflict = this.conflictingShortcut(id, updates.keys)
      if (conflict !== null) {
        console.warn(
          `Shortcut ${updates.keys.join('+')} is already bound to ${conflict.name}; the change was refused.`,
        )
        return false
      }
    }
    this.shortcuts[index] = { ...this.shortcuts[index], ...updates }
    // Reported through `getPersistState()`, not only the console: a binding the
    // user thinks they saved must not silently fail to persist.
    void this.persist().catch(() => undefined)
    this.notifyChange()
    return true
  }

  /** The enabled shortcut other than `id` that already uses `keys`, if any. */
  conflictingShortcut(id: string, keys: string[]): Shortcut | null {
    return (
      this.shortcuts.find(
        shortcut =>
          shortcut.enabled &&
          shortcut.id !== id &&
          keysMatch(shortcut.keys, keys),
      ) ?? null
    )
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
    this.shortcuts = defaultShortcuts.map(shortcut => ({
      ...shortcut,
      keys: [...shortcut.keys],
    }))
    void this.persist().catch(() => undefined)
    this.notifyChange()
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
      if (!Array.isArray(shortcuts)) return false
      // Validate before adopting: a malformed entry would make matching throw on
      // every keystroke.
      const valid = shortcuts.every(
        shortcut =>
          typeof shortcut?.id === 'string'
          && typeof shortcut.action === 'string'
          && Array.isArray(shortcut.keys)
          && shortcut.keys.every(key => typeof key === 'string'),
      )
      if (!valid) return false
      this.shortcuts = this.mergeWithDefaults(shortcuts)
      void this.persist().catch(() => undefined)
      this.notifyChange()
      return true
    } catch {
      // Invalid JSON keeps the current bindings unchanged.
    }
    return false
  }
}

export const shortcutsService = new ShortcutsService()
