import { useEffect } from 'react'
import { SHORTCUT_EVENT_PREFIX } from '@/hooks/use-global-shortcuts'
import { shortcutsService } from '@/service/shortcuts'

const DEFAULT_SHELL_CTRL_BINDINGS = new Set([
  'command-palette:Ctrl+J',
  'command-palette:Ctrl+K',
  'clear-terminal:Ctrl+L',
  'close-tab:Ctrl+W',
  'new-tab:Ctrl+T',
  'toggle-sidebar:Ctrl+B',
])

export function handleXtermShortcut(
  event: KeyboardEvent,
  active: boolean,
): boolean {
  if (!active || event.type !== 'keydown') return true
  const shortcut = shortcutsService.matchShortcut(event)
  if (!shortcut) return true

  const shellBinding = `${shortcut.action}:${shortcut.keys.join('+')}`
  if (
    event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey &&
    DEFAULT_SHELL_CTRL_BINDINGS.has(shellBinding)
  ) {
    event.stopPropagation()
    return true
  }

  event.preventDefault()
  event.stopPropagation()
  shortcutsService.triggerAction(shortcut.action)
  return false
}

interface TerminalShortcutHandlers {
  active: boolean
  onReconnect: () => void
  onClear: () => void
  onSearch: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
}

export function useTerminalShortcutEvents({
  active,
  onReconnect,
  onClear,
  onSearch,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: TerminalShortcutHandlers) {
  useEffect(() => {
    if (!active) return
    const listeners = [
      ['reload-tab', onReconnect],
      ['clear-terminal', onClear],
      ['search-terminal', onSearch],
      ['zoom-in', onZoomIn],
      ['zoom-out', onZoomOut],
      ['reset-zoom', onResetZoom],
    ] as const

    for (const [action, listener] of listeners) {
      window.addEventListener(`${SHORTCUT_EVENT_PREFIX}${action}`, listener)
    }
    return () => {
      for (const [action, listener] of listeners) {
        window.removeEventListener(
          `${SHORTCUT_EVENT_PREFIX}${action}`,
          listener,
        )
      }
    }
  }, [active, onClear, onReconnect, onResetZoom, onSearch, onZoomIn, onZoomOut])
}
