import { useTerminalLongPress } from './use-terminal-long-press'
import { useTerminalShortcutEvents } from './use-terminal-shortcut-events'

/**
 * Wire the pane's own keyboard and touch gestures.
 *
 * Extracted from `TerminalContainer` as pure glue: every argument is already
 * available there, and keeping it separate keeps the container readable at its
 * size limit. The shortcut *rules* live in `use-terminal-shortcut-events`; this
 * only binds them to this pane's actions.
 */
export function usePaneShortcuts(options: {
  active: boolean
  term: { clear: () => void } | null
  reconnectAction: () => void
  onSearch: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
  onLongPress: () => void
}) {
  const {
    active,
    term,
    reconnectAction,
    onSearch,
    onZoomIn,
    onZoomOut,
    onResetZoom,
    onLongPress,
  } = options
  useTerminalShortcutEvents({
    active,
    onReconnect: reconnectAction,
    onClear: () => term?.clear(),
    onSearch,
    onZoomIn,
    onZoomOut,
    onResetZoom,
  })
  return useTerminalLongPress(onLongPress)
}
