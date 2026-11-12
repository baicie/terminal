import { useEffect } from 'react'
import {
  useTerminalStatusStore,
  type TerminalStatusSnapshot,
} from '@/store/terminal-status'

/**
 * The slice of xterm this hook needs.
 *
 * Deliberately narrow: a test can drive the real `onResize` contract without
 * constructing a terminal, and the hook cannot reach for anything else on the
 * instance (which is what would tempt it to *infer* a size instead of reporting
 * the one the PTY was told).
 */
export interface SizeReportingTerminal {
  readonly cols: number
  readonly rows: number
  onResize: (
    handler: (size: { cols: number, rows: number }) => void,
  ) => { dispose: () => void }
}

/**
 * Report this pane's size to the status bar, but only while it is the active tab.
 *
 * Extracted from `TerminalContainer` because that file is at its size limit and
 * because "what the status bar should show" is a different decision from "how the
 * pane renders".
 *
 * **The source is xterm's own `onResize`, not `window.resize`.** The earlier
 * version listened on the window, which is only one of the ways a terminal gets
 * resized: a split-sash drag, opening or closing the sidebar, and the font-zoom
 * shortcuts all run `fitAddon.fit()` without the window changing size at all. The
 * status bar then kept showing a column count the PTY no longer had — a stale
 * number in the one place the user looks for the truth.
 *
 * `onResize` fires from `Terminal.resize()`, which is exactly what `fit()` calls,
 * so this is the same event the PTY resize path (`terminal-input-registration.ts`)
 * already sends from. It is a second, independent subscriber: nothing here changes
 * what the session layer does.
 */
export function usePublishTerminalSize(options: {
  tabId: string
  isActive: boolean
  isReady: boolean
  term: SizeReportingTerminal | null
  /** Re-runs the publish when the session state changes, e.g. after a reconnect. */
  status: TerminalStatusSnapshot['status']
  sessionType: TerminalStatusSnapshot['sessionType']
}): void {
  const publish = useTerminalStatusStore(state => state.publish)
  const clear = useTerminalStatusStore(state => state.clear)
  const { tabId, isActive, isReady, term, status, sessionType } = options

  // A closed tab must not leave its size behind. The effect below only clears
  // when its dependencies change, so without this an unmount while active would
  // keep the last pane's dimensions in the status bar indefinitely.
  useEffect(() => () => clear(tabId), [clear, tabId])

  useEffect(() => {
    if (!isActive || !isReady || !term) {
      // A background pane keeps running and keeps resizing (a split sash moves
      // both halves). It must never write the slot the visible pane owns.
      clear(tabId)
      return
    }
    const report = (cols: number, rows: number) => {
      if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return
      if (cols <= 0 || rows <= 0) return
      publish({ tabId, cols, rows, status, sessionType })
    }
    report(term.cols, term.rows)
    const subscription = term.onResize(({ cols, rows }) => report(cols, rows))
    return () => subscription.dispose()
  }, [tabId, isActive, isReady, term, status, sessionType, publish, clear])
}
