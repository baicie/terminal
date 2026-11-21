import { useEffect } from 'react'
import { SHORTCUT_EVENT_PREFIX } from '@/hooks/use-global-shortcuts'
import { shortcutsService } from '@/service/shortcuts'

/**
 * Application shortcuts that a **terminal pane** must nonetheless pass to the shell.
 *
 * ## What this set actually is
 *
 * The name says "shell bindings"; the contents are application actions. What they share
 * is that a terminal-first product must not consume them inside a terminal: each one is a
 * key a shell or readline uses, and the application capability has another way in.
 *
 * | Key | Shell meaning | Where the app action still lives |
 * | --- | --- | --- |
 * | `Ctrl+L` | clear screen | the same key still clears here — see the handler |
 * | `Ctrl+W` | delete word | tab strip, command palette |
 * | `Ctrl+T` | transpose chars | command palette, new-tab button |
 * | `Ctrl+B` | back one char | rail toggle |
 * | `Ctrl+J` | line feed | command palette |
 * | `Ctrl+K` | kill to end of line | command palette |
 * | `Ctrl+F` | **forward-char** | right-click menu, command palette |
 *
 * ## Why `Ctrl+F` was added
 *
 * It was previously left out, with a comment saying the omission was pre-existing and
 * that reclaiming the key "would be a product decision about search". T05 makes that
 * decision: `C-f` is one of the readline keys a shell user presses without thinking,
 * and search keeps two other entry points. A terminal that steals forward-char is not
 * terminal-first.
 */
const DEFAULT_SHELL_CTRL_BINDINGS = new Set([
  'command-palette:Ctrl+J',
  'command-palette:Ctrl+K',
  'clear-terminal:Ctrl+L',
  'close-tab:Ctrl+W',
  'new-tab:Ctrl+T',
  'toggle-sidebar:Ctrl+B',
  'search-terminal:Ctrl+F',
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
