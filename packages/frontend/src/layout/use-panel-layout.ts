import { useEffect, useRef, useState, type RefObject } from 'react'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { useAppStore } from '@/store/app'
import { useRightPanelStore } from '@/store/right-panel-store'
import { DOCK_WIDTH } from './right-panel'
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
  const cellWidth = useMeasuredCellWidth(
    settings.fontSize ?? 14,
    settings.fontFamily ?? 'monospace',
  )
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
