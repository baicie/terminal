import { useEffect, useRef } from 'react'
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
 * The element the terminal renders into, or `null` when it has not mounted.
 *
 * Passed as a getter rather than an element so this hook never holds a stale node
 * across a remount, and so a pane without a measurable container simply publishes no
 * `fittedWidth` — see `TerminalStatusSnapshot.fittedWidth` for why absent is preferable
 * to a guess.
 */
export type TerminalWidthSource = () => number | null

/**
 * The width of a fitted element, or `null` when there is nothing to measure.
 *
 * A getter at the call site rather than a captured element, because the layout needs the
 * *current* width at the moment of a resize and a captured node would go stale across a
 * remount.
 *
 * `getBoundingClientRect` rather than `clientWidth` so a CSS transform — the mobile zoom,
 * a split animation — is included. That is the width xterm fit to; `clientWidth` reports
 * the untransformed box, which would make the back-computed cell width wrong by exactly
 * the transform's scale.
 */
export function measureElementWidth(element: Element | null): number | null {
  if (element === null) return null
  const width = element.getBoundingClientRect().width
  return Number.isFinite(width) && width > 0 ? width : null
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
  /**
   * Width of the element xterm was fitted to, in CSS pixels.
   *
   * The layout needs it to back-compute the cell width the terminal is really using; a
   * canvas measurement of the same font stack is only as good as this machine's font
   * substitution, and on the Linux GUI runner it was wrong by 28 % (8.4 vs 10.8 px).
   */
  measureWidth?: TerminalWidthSource
}): void {
  const publish = useTerminalStatusStore(state => state.publish)
  const clear = useTerminalStatusStore(state => state.clear)
  const { tabId, isActive, isReady, term, status, sessionType, measureWidth } = options
  /*
   * ## The getter is held in a ref, not in the dependency array
   *
   * `measureWidth` is written inline at the call site (`() => measureElementWidth(...)`),
   * so its identity changes on every render. Putting it in the effect's dependencies
   * therefore re-ran the effect on every render → `publish` → store change → render →
   * new getter → effect again. Measured on the macOS GUI run: the layout stopped
   * rendering entirely and e2e-02 could not find the status bar at all, at every width
   * including 1440.
   *
   * A ref keeps the effect's dependency list stable while still calling the latest
   * getter — which is what a getter is for.
   */
  const measureWidthRef = useRef(measureWidth)
  measureWidthRef.current = measureWidth

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
      const measured = measureWidthRef.current?.() ?? null
      publish({
        tabId,
        cols,
        rows,
        status,
        sessionType,
        ...(measured !== null && Number.isFinite(measured) && measured > 0
          ? { fittedWidth: measured }
          : {}),
      })
    }
    report(term.cols, term.rows)
    const subscription = term.onResize(({ cols, rows }) => report(cols, rows))
    return () => subscription.dispose()
  }, [tabId, isActive, isReady, term, status, sessionType, publish, clear])
}
