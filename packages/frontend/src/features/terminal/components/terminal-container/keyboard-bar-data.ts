import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

export type KeyboardModifiers = { ctrl: boolean; alt: boolean }

export const NO_KEYBOARD_MODIFIERS: KeyboardModifiers = {
  ctrl: false,
  alt: false,
}
export const CLEAR_TERMINAL_SEQUENCE = '\x1b[2J\x1b[H'
export const MODIFIER_KEY_NAMES = [
  'Alt',
  'AltGraph',
  'CapsLock',
  'Control',
  'Meta',
  'Shift',
]

const CTRL_KEY_EQUIVALENTS: Record<string, string> = {
  ' ': '\x00',
  '2': '\x00',
  '3': '\x1b',
  '4': '\x1c',
  '5': '\x1d',
  '6': '\x1e',
  '7': '\x1f',
  '/': '\x1f',
  '8': '\x7f',
  '?': '\x7f',
}

function toControlCode(key: string) {
  const equivalent = CTRL_KEY_EQUIVALENTS[key]
  if (equivalent !== undefined) return equivalent
  const code = key.length === 1 ? key.charCodeAt(0) : -1
  return (code >= 0x40 && code <= 0x5f) || (code >= 0x61 && code <= 0x7a)
    ? String.fromCharCode(code & 0x1f)
    : key
}

export function applyKeyboardModifiers(
  key: string,
  modifiers: KeyboardModifiers,
) {
  const sequence = modifiers.ctrl ? toControlCode(key) : key
  return modifiers.alt ? `\x1b${sequence}` : sequence
}

export function useKeyboardModifiers(
  onSendKey: (key: string) => void,
  onRequestFocus?: () => void,
) {
  const [modifiers, setModifiers] = useState(NO_KEYBOARD_MODIFIERS)
  const sendModifiedKey = useCallback(
    (key: string) => {
      onSendKey(applyKeyboardModifiers(key, modifiers))
      setModifiers(NO_KEYBOARD_MODIFIERS)
      onRequestFocus?.()
    },
    [modifiers, onRequestFocus, onSendKey],
  )

  useEffect(() => {
    if (!modifiers.ctrl && !modifiers.alt) return
    const focusTarget = document.activeElement
    if (!(focusTarget instanceof HTMLElement)) return
    let consumed = false
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        consumed ||
        event.isComposing ||
        MODIFIER_KEY_NAMES.includes(event.key)
      )
        return
      consumed = true
      if (
        event.key.length !== 1 ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        setModifiers(NO_KEYBOARD_MODIFIERS)
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      sendModifiedKey(event.key)
    }
    focusTarget.addEventListener('keydown', handleKeyDown, true)
    return () => focusTarget.removeEventListener('keydown', handleKeyDown, true)
  }, [modifiers, sendModifiedKey])

  const toggleModifier = (modifier: keyof KeyboardModifiers) => {
    setModifiers(current => ({ ...current, [modifier]: !current[modifier] }))
    onRequestFocus?.()
  }
  return { modifiers, sendModifiedKey, toggleModifier }
}

export const KEYBOARD_KEYS = [
  { label: 'Esc', key: '\x1b', icon: null },
  { label: 'Tab', key: '\t', icon: null },
  { label: 'Ctrl', key: 'ctrl', icon: null, isModifier: true },
  { label: 'Alt', key: 'alt', icon: null, isModifier: true },
  { label: '↑', key: '\x1b[A', icon: ChevronUp },
  { label: '↓', key: '\x1b[B', icon: ChevronDown },
  { label: '→', key: '\x1b[C', icon: null },
  { label: '←', key: '\x1b[D', icon: null },
  { label: 'PgUp', key: '\x1b[5~', icon: null },
  { label: 'PgDn', key: '\x1b[6~', icon: null },
  { label: 'Home', key: '\x1b[H', icon: null },
  { label: 'End', key: '\x1b[F', icon: null },
]

export type KeyboardKey = (typeof KEYBOARD_KEYS)[number]

export const KEYBOARD_SHORTCUTS = [
  { key: 'Esc', descriptionKey: 'terminal.shortcut.cancelExit' },
  { key: 'Tab', descriptionKey: 'terminal.shortcut.autocomplete' },
  { key: 'Ctrl+C', descriptionKey: 'terminal.shortcut.interrupt' },
  { key: 'Ctrl+D', descriptionKey: 'terminal.shortcut.endOfFile' },
  { key: 'Ctrl+L', descriptionKey: 'terminal.clearScreen' },
  { key: 'Ctrl+Z', descriptionKey: 'terminal.shortcut.suspend' },
  { key: '↑ / ↓', descriptionKey: 'terminal.shortcut.commandHistory' },
  { key: 'Ctrl+R', descriptionKey: 'terminal.shortcut.searchHistory' },
] as const
