import { useEffect, useRef, useState, type RefObject } from 'react'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { defaultSettings } from '@/service/database'
import { useAppStore } from '@/store/app'
import { useRightPanelStore } from '@/store/right-panel-store'
import { DOCK_WIDTH } from './right-panel'
import { OVERVIEW_RULER_WIDTH } from './terminal-width-budget'
import { useTerminalStatusStore } from '@/store/terminal-status'
import {
  chooseLayout,
  type LayoutDecision,
  type LayoutInput,
  type LeftPresentation,
  type LimitingReason,
  type RightPresentation,
} from './layout-decision'
import { withHysteresis } from './layout-hysteresis'

/**
 * What the panels may do at the current viewport, given the real cell width.
 *
 * The rule: **the terminal keeps a usable width; panels yield.** At 1440 the
 * explorer and the dock are both columns. At 720 the dock becomes an overlay
 * instead of taking 300px from a canvas that cannot spare it, and two panels
 * together are refused outright.
 *
 * The cell width is measured, not assumed — `useMeasuredCellWidth` reads it from a
 * live xterm element when one exists and falls back to the default font's metrics.
 * Assuming a ratio is how a layout passes its own test and fails on a real screen.
 */

/** xterm's cell width for the default 14px monospace stack. */
const DEFAULT_CELL_WIDTH = 8.4

/** Assumed horizontal chrome: the rail. The separator is counted by LeftPanel. */
const RAIL_WIDTH = 46

/**
 * Measure the cell width xterm would use, without owning a terminal.
 *
 * A canvas `measureText` call with the same font stack the terminal uses. Not as
 * exact as the render service's own measurement (which rounds and accounts for
 * device pixel ratio), but it tracks font-size and font-family changes, which a
 * hard-coded constant does not.
 */
export function useMeasuredCellWidth(fontSize: number, fontFamily: string): number {
  const [cellWidth, setCellWidth] = useState(DEFAULT_CELL_WIDTH)
  useEffect(() => {
    if (typeof document === 'undefined') return
    try {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) return
      // The width of ten characters divided by ten: a single glyph is too narrow
      // to measure reliably at these sizes.
      context.font = `${fontSize}px ${fontFamily}`
      const ten = context.measureText('MMMMMMMMMM').width
      if (Number.isFinite(ten) && ten > 0) setCellWidth(ten / 10)
    } catch {
      // A canvas that cannot measure leaves the default in place.
    }
  }, [fontSize, fontFamily])
  return cellWidth
}

export interface PanelLayoutInput {
  /**
   * The width `LeftPanel` is actually rendering at, in CSS pixels.
   *
   * **Required.** It used to be optional with a fallback to the default sidebar
   * width, which defeated the point: a caller that forgot to pass it compiled
   * fine and silently got the wrong budget — the same class of defect as the
   * original 52px constant, just quieter. There is no legitimate production
   * caller that does not know this value: the shell owns `sidebarWidth` and
   * passes the same number it renders with.
   */
  explorerWidth: number
}

export interface PanelLayoutDecision {
  /** Whether the explorer may be shown as a column. */
  allowLeft: boolean
  /** How the left column should present, including the drawer fallback. */
  leftPresentation: LeftPresentation
  /** How the right dock should present. */
  rightPresentation: RightPresentation
  /** Whether the dock may be a column, an overlay, or must not show. */
  dockMode: 'column' | 'overlay' | 'hidden'
  /** Columns the terminal is expected to get after the decision. */
  predictedCols: number
  /** Why the layout had to yield, when it did. */
  limitingReason?: LimitingReason
  /** Shell width used for the decision. */
  viewportWidth: number
  cellWidth: number
  /** Attach to the shell element so its width is measured, not assumed. */
  shellRef: RefObject<HTMLDivElement | null>
}

/**
 * Resolve the panel layout for the current viewport.
 *
 * Mobile is handled by the existing breakpoint: the phone layout has its own
 * navigation, and a second breakpoint system is exactly what INV-12 forbids.
 *
 * The required `explorerWidth` is deliberate. The defect this replaced was that
 * the hook called `panelBudget()` with `RAIL + SEPARATOR` and never learned the
 * sidebar's real width, so every decision was computed against 124–368px of
 * terminal that did not exist. Making the argument mandatory means a caller that
 * does not know the width fails to compile instead of silently passing a constant.
 */
export function usePanelLayout(input: PanelLayoutInput): PanelLayoutDecision {
  const isMobile = useIsMobile()
  const settings = useAppStore(state => state.config) as {
    fontSize?: number
    fontFamily?: string
  }
  /*
   * The same fallback the terminal itself uses, not a local one.
   *
   * This read `settings.fontFamily ?? 'monospace'` while `TerminalContainer` read
   * `settings.fontFamily ?? defaultSettings.fontFamily`. With no font configured — the
   * default install — the layout measured `monospace` and the terminal rendered
   * `Menlo, Monaco, "Courier New", monospace`. They are different widths, so the layout
   * decided against a budget the terminal never had.
   *
   * Measured on the Linux GUI runner at 768px: the decision predicted 62 columns from an
   * 8.4px cell, the terminal actually got 50 columns at ~10.8px. The explorer stayed a
   * column because the budget said the terminal could afford it, and the terminal could
   * not. That is the whole 60-column-floor failure in E2E-02, and it is a product defect
   * — the layout is supposed to yield *before* the terminal is starved.
   */
  const estimatedCellWidth = useMeasuredCellWidth(
    settings.fontSize ?? defaultSettings.fontSize,
    settings.fontFamily ?? defaultSettings.fontFamily,
  )
  /*
   * ## A mounted terminal knows its cell width; a canvas only guesses it
   *
   * `useMeasuredCellWidth` measures the font stack with a canvas. That was the fix for
   * the *first* version of this defect (the layout read `'monospace'` while xterm got
   * `Menlo, …`) and it still fails on a machine where the named faces are absent: the
   * canvas substitutes a font, reports 8.4px, and xterm — which substitutes differently
   * — renders at ~10.8px. Measured on the Linux GUI runner: at 768px the decision
   * predicted 62 columns from 8.4 and the terminal reported 50 at 10.8, so the explorer
   * stayed a column and the terminal was starved below its floor.
   *
   * The terminal itself publishes the truth — `cols` and the width it was fitted to —
   * through `useTerminalStatusStore`, and this layout already subscribes to it. Deriving
   * the cell width from those two numbers is not an estimate: it is the value xterm
   * actually used, back-computed. The canvas measurement stays as the value for the
   * first frame, before any terminal has mounted.
   */
  const observedCellWidth = useObservedCellWidth()
  const cellWidth = observedCellWidth ?? estimatedCellWidth
  // The shell, not the window: the window includes OS chrome and any caption
  // buttons, and feeding the already-squeezed terminal element back in is what
  // makes a layout oscillate.
  const { width: shellWidth, ref: shellRef } = useShellWidth()
  const chromeWidth = useMeasuredChrome(shellRef)
  const leftMode = useAppStore(state => state.leftPanel)
  const rightPanel = useRightPanelStore(state => state.rightPanel)
  const previousRef = useRef<LayoutDecision | null>(null)

  const layoutInput: LayoutInput = {
    shellWidth,
    railWidth: RAIL_WIDTH,
    leftMode,
    leftWidth: input.explorerWidth,
    rightMode: rightPanel,
    preferredRightWidth: DOCK_WIDTH,
    cellWidth,
    paddingAndBorders: chromeWidth,
    isMobile,
  }
  const decision = chooseLayout(layoutInput)
  const stable = withHysteresis(decision, previousRef.current, layoutInput)
  previousRef.current = stable

  return {
    allowLeft: stable.leftPresentation === 'column',
    leftPresentation: stable.leftPresentation,
    rightPresentation: stable.rightPresentation,
    dockMode:
      stable.rightPresentation === 'none'
        ? 'hidden'
        : stable.rightPresentation === 'overlay'
          ? 'overlay'
          : 'column',
    predictedCols: stable.predictedCols,
    limitingReason: stable.limitingReason,
    viewportWidth: shellWidth,
    cellWidth,
    /** Attach to the element whose width the panels divide. */
    shellRef,
  }
}

/**
 * The horizontal chrome inside the shell that the terminal never gets.
 *
 * Measured rather than assumed. The layout used to subtract nothing here, so the
 * separator, panel borders and the terminal's own padding were all unaccounted
 * for — a few pixels each, which matters exactly at a threshold. Reading it from
 * `getComputedStyle` keeps it correct when a theme changes padding or a border
 * width without anyone remembering to update a constant.
 */
function useMeasuredChrome(shellRef: RefObject<HTMLDivElement | null>): number {
  const [chrome, setChrome] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const element = shellRef.current
    if (!element || typeof getComputedStyle === 'undefined') return
    const measure = () => {
      const style = getComputedStyle(element)
      const horizontal =
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0) +
        (Number.parseFloat(style.borderLeftWidth) || 0) +
        (Number.parseFloat(style.borderRightWidth) || 0)
      if (Number.isFinite(horizontal)) setChrome(horizontal)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [shellRef])
  return chrome
}

/**
 * The width available to the shell, tracked with a ResizeObserver.
 *
 * Falls back to `window.innerWidth` before the observer reports, which is what the
 * previous implementation used unconditionally. The observer is what makes a
 * sidebar drag or a split resize update the decision without a window resize.
 */
function useShellWidth(): { width: number; ref: RefObject<HTMLDivElement | null> } {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') {
      const onResize = () => setWidth(window.innerWidth)
      onResize()
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const next = entry.contentRect.width
      if (Number.isFinite(next) && next > 0) setWidth(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { width, ref }
}

/**
 * The cell width a mounted terminal is actually using, or `null` before one exists.
 *
 * ## Why back-compute instead of asking xterm
 *
 * xterm's render service exposes its measured cell, but only on an instance, and the
 * layout renders *around* the terminal layer rather than owning it — reaching into it
 * would invert that relationship and couple the shell to the pane's internals.
 *
 * What the pane already publishes is enough: `cols` and the CSS width it was fitted to.
 * `(fittedWidth - ruler - padding) / cols` is the same arithmetic
 * `terminal-columns.ts` does forwards, so the layout ends up deciding against exactly
 * the cell width the terminal is rendering with.
 *
 * `null` is returned rather than a fallback so the caller can tell "no terminal yet"
 * from "a terminal that measured the same as the canvas estimate".
 */
function useObservedCellWidth(): number | null {
  const snapshot = useTerminalStatusStore(state => state.active)
  const fittedWidth = useTerminalStatusStore(state => state.fittedWidth)
  if (snapshot === null || snapshot.cols <= 0) return null
  if (!Number.isFinite(fittedWidth) || fittedWidth <= 0) return null
  const usable = fittedWidth - OVERVIEW_RULER_WIDTH
  if (usable <= 0) return null
  const cell = usable / snapshot.cols
  /*
   * A sanity band, not a filter for tidiness. A back-computed cell outside this range
   * means the two numbers describe different things — a stale `cols` from before a
   * resize, or a width read from the wrong element — and using it would move the
   * decision on garbage. The band is wide enough to cover every plausible font size.
   */
  return cell >= 4 && cell <= 24 ? cell : null
}
