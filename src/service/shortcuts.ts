// Custom Shortcuts Service - Define and manage custom keyboard shortcuts

export interface Shortcut {
  id: string
  name: string
  description?: string
  keys: string[] // e.g., ['Ctrl', 'Shift', 'K']
  action: string // e.g., 'new-tab', 'command-palette', 'toggle-sidebar'
  enabled: boolean
}

export interface ShortcutAction {
  id: string
  name: string
  description?: string
}

// Built-in actions
export const builtInActions: ShortcutAction[] = [
  { id: 'new-tab', name: 'New Tab', description: 'Open a new terminal tab' },
  {
    id: 'new-ssh',
    name: 'New SSH Connection',
    description: 'Create a new SSH connection',
  },
  {
    id: 'new-local',
    name: 'New Local Terminal',
    description: 'Open a new local terminal',
  },
  {
    id: 'command-palette',
    name: 'Command Palette',
    description: 'Open the command palette',
  },
  {
    id: 'toggle-sidebar',
    name: 'Toggle Sidebar',
    description: 'Show or hide the sidebar',
  },
  {
    id: 'split-horizontal',
    name: 'Split Horizontal',
    description: 'Split terminal horizontally',
  },
  {
    id: 'split-vertical',
    name: 'Split Vertical',
    description: 'Split terminal vertically',
  },
  { id: 'close-tab', name: 'Close Tab', description: 'Close the current tab' },
  { id: 'next-tab', name: 'Next Tab', description: 'Switch to the next tab' },
  {
    id: 'prev-tab',
    name: 'Previous Tab',
    description: 'Switch to the previous tab',
  },
  {
    id: 'reload-tab',
    name: 'Reload Tab',
    description: 'Reconnect the current session',
  },
  {
    id: 'clear-terminal',
    name: 'Clear Terminal',
    description: 'Clear terminal screen',
  },
  {
    id: 'search-terminal',
    name: 'Search in Terminal',
    description: 'Open terminal search',
  },
  { id: 'zoom-in', name: 'Zoom In', description: 'Increase font size' },
  { id: 'zoom-out', name: 'Zoom Out', description: 'Decrease font size' },
  {
    id: 'reset-zoom',
    name: 'Reset Zoom',
    description: 'Reset font size to default',
  },
]

// Default shortcuts
export const defaultShortcuts: Shortcut[] = [
  {
    id: 'ctrl-t',
    name: 'New Tab',
    keys: ['Ctrl', 'T'],
    action: 'new-tab',
    enabled: true,
  },
  {
    id: 'ctrl-j',
    name: 'Command Palette',
    keys: ['Ctrl', 'J'],
    action: 'command-palette',
    enabled: true,
  },
  {
    id: 'ctrl-b',
    name: 'Toggle Sidebar',
    keys: ['Ctrl', 'B'],
    action: 'toggle-sidebar',
    enabled: true,
  },
  {
    id: 'ctrl-w',
    name: 'Close Tab',
    keys: ['Ctrl', 'W'],
    action: 'close-tab',
    enabled: true,
  },
  {
    id: 'ctrl-shift-t',
    name: 'New SSH Connection',
    keys: ['Ctrl', 'Shift', 'T'],
    action: 'new-ssh',
    enabled: true,
  },
  {
    id: 'ctrl-shift-n',
    name: 'New Local Terminal',
    keys: ['Ctrl', 'Shift', 'N'],
    action: 'new-local',
    enabled: true,
  },
  {
    id: 'ctrl-shift-h',
    name: 'Split Horizontal',
    keys: ['Ctrl', 'Shift', 'H'],
    action: 'split-horizontal',
    enabled: true,
  },
  {
    id: 'ctrl-shift-v',
    name: 'Split Vertical',
    keys: ['Ctrl', 'Shift', 'V'],
    action: 'split-vertical',
    enabled: true,
  },
  {
    id: 'ctrl-tab',
    name: 'Next Tab',
    keys: ['Ctrl', 'Tab'],
    action: 'next-tab',
    enabled: true,
  },
  {
    id: 'ctrl-shift-tab',
    name: 'Previous Tab',
    keys: ['Ctrl', 'Shift', 'Tab'],
    action: 'prev-tab',
    enabled: true,
  },
  {
    id: 'ctrl-k',
    name: 'Clear Terminal',
    keys: ['Ctrl', 'K'],
    action: 'clear-terminal',
    enabled: true,
  },
  {
    id: 'ctrl-f',
    name: 'Search in Terminal',
    keys: ['Ctrl', 'F'],
    action: 'search-terminal',
    enabled: true,
  },
  {
    id: 'ctrl-equals',
    name: 'Zoom In',
    keys: ['Ctrl', '='],
    action: 'zoom-in',
    enabled: true,
  },
  {
    id: 'ctrl-minus',
    name: 'Zoom Out',
    keys: ['Ctrl', '-'],
    action: 'zoom-out',
    enabled: true,
  },
  {
    id: 'ctrl-0',
    name: 'Reset Zoom',
    keys: ['Ctrl', '0'],
    action: 'reset-zoom',
    enabled: true,
  },
]

class ShortcutsService {
  private shortcuts: Shortcut[] = [...defaultShortcuts]
  private listeners: ((action: string) => void)[] = []

  /**
   * Get all shortcuts
   */
  getShortcuts(): Shortcut[] {
    return [...this.shortcuts]
  }

  /**
   * Get enabled shortcuts only
   */
  getEnabledShortcuts(): Shortcut[] {
    return this.shortcuts.filter(s => s.enabled)
  }

  /**
   * Get shortcut by action
   */
  getShortcutByAction(action: string): Shortcut | undefined {
    return this.shortcuts.find(s => s.action === action)
  }

  /**
   * Update a shortcut
   */
  updateShortcut(id: string, updates: Partial<Shortcut>): boolean {
    const index = this.shortcuts.findIndex(s => s.id === id)
    if (index === -1) return false

    this.shortcuts[index] = { ...this.shortcuts[index], ...updates }
    return true
  }

  /**
   * Add a custom shortcut
   */
  addShortcut(shortcut: Shortcut): void {
    // Check for conflicts
    const conflicts = this.shortcuts.filter(
      s =>
        s.enabled &&
        s.id !== shortcut.id &&
        this.keysMatch(s.keys, shortcut.keys),
    )

    if (conflicts.length > 0) {
      console.warn(
        'Shortcut conflicts with:',
        conflicts.map(c => c.name),
      )
    }

    this.shortcuts.push(shortcut)
  }

  /**
   * Remove a shortcut
   */
  removeShortcut(id: string): boolean {
    const index = this.shortcuts.findIndex(s => s.id === id)
    if (index === -1) return false

    this.shortcuts.splice(index, 1)
    return true
  }

  /**
   * Reset shortcuts to default
   */
  resetToDefault(): void {
    this.shortcuts = [...defaultShortcuts]
  }

  /**
   * Check if two key combinations match
   */
  private keysMatch(keys1: string[], keys2: string[]): boolean {
    if (keys1.length !== keys2.length) return false

    const sorted1 = [...keys1].sort()
    const sorted2 = [...keys2].sort()

    return sorted1.every((key, i) => key === sorted2[i])
  }

  /**
   * Parse keyboard event to key combination
   */
  parseKeyboardEvent(event: KeyboardEvent): string[] {
    const keys: string[] = []

    if (event.ctrlKey) keys.push('Ctrl')
    if (event.shiftKey) keys.push('Shift')
    if (event.altKey) keys.push('Alt')
    if (event.metaKey) keys.push('Meta')

    // Add the main key
    const key = event.key
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      // Normalize key names
      const keyMap: Record<string, string> = {
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
      }
      keys.push(keyMap[key] || key)
    }

    return keys
  }

  /**
   * Check if keyboard event matches a shortcut
   */
  matchShortcut(event: KeyboardEvent): Shortcut | undefined {
    const keys = this.parseKeyboardEvent(event)

    return this.shortcuts.find(s => s.enabled && this.keysMatch(s.keys, keys))
  }

  /**
   * Trigger action for matched shortcut
   */
  handleKeyboardEvent(event: KeyboardEvent): boolean {
    const shortcut = this.matchShortcut(event)
    if (shortcut) {
      event.preventDefault()
      this.triggerAction(shortcut.action)
      return true
    }
    return false
  }

  /**
   * Trigger an action
   */
  triggerAction(action: string): void {
    this.listeners.forEach(listener => listener(action))
  }

  /**
   * Add action listener
   */
  addListener(callback: (action: string) => void): () => void {
    this.listeners.push(callback)
    return () => {
      const index = this.listeners.indexOf(callback)
      if (index !== -1) {
        this.listeners.splice(index, 1)
      }
    }
  }

  /**
   * Format shortcut keys for display
   */
  formatShortcut(shortcut: Shortcut): string {
    return shortcut.keys.join(' + ')
  }

  /**
   * Export shortcuts as JSON
   */
  exportShortcuts(): string {
    return JSON.stringify(this.shortcuts, null, 2)
  }

  /**
   * Import shortcuts from JSON
   */
  importShortcuts(json: string): boolean {
    try {
      const shortcuts = JSON.parse(json) as Shortcut[]
      if (Array.isArray(shortcuts)) {
        this.shortcuts = shortcuts
        return true
      }
    } catch {
      // Invalid JSON
    }
    return false
  }
}

// Export singleton instance
export const shortcutsService = new ShortcutsService()
