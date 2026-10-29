export interface Shortcut {
  id: string
  name: string
  description?: string
  keys: string[]
  action: string
  enabled: boolean
}

export interface ShortcutAction {
  id: string
  name: string
  description?: string
}
