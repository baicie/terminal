import { ChevronDown, ChevronUp } from 'lucide-react'

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
  ['Esc', 'Cancel / Exit'],
  ['Tab', 'Auto-complete'],
  ['Ctrl+C', 'Interrupt'],
  ['Ctrl+D', 'End of file'],
  ['Ctrl+L', 'Clear screen'],
  ['Ctrl+Z', 'Suspend process'],
  ['↑ / ↓', 'Command history'],
  ['Ctrl+R', 'Search history'],
]
