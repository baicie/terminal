import { useEffect, useState } from 'react'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { useAppStore } from '@/store/app'
import { DOCK_WIDTH } from './right-panel'
import { panelBudget } from './terminal-width-budget'

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

/** Assumed horizontal chrome: rail, borders and the resize separator. */
const RAIL_WIDTH = 46
const SEPARATOR_WIDTH = 6

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

export interface PanelLayoutDecision {
  /** Whether the explorer may be shown as a column. */
  allowLeft: boolean
  /** Whether the dock may be a column, or must be an overlay, or must not show. */
  dockMode: 'column' | 'overlay' | 'hidden'
  /** Viewport width, for the caller to place overlays. */
  viewportWidth: number
  cellWidth: number
}

/**
 * Resolve the panel layout for the current viewport.
 *
 * Mobile is handled by the existing breakpoint and returns `hidden` for both: the
 * phone layout has its own navigation, and a second breakpoint system is exactly
 * what INV-12 forbids.
 */
export function usePanelLayout(): PanelLayoutDecision {
  const isMobile = useIsMobile()
  const settings = useAppStore(state => state.config) as {
    fontSize?: number
    fontFamily?: string
  }
  const cellWidth = useMeasuredCellWidth(
    settings.fontSize ?? 14,
    settings.fontFamily ?? 'monospace',
  )
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setViewportWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (isMobile) {
    return { allowLeft: false, dockMode: 'hidden', viewportWidth, cellWidth }
  }

  const budget = panelBudget(
    viewportWidth,
    cellWidth,
    RAIL_WIDTH + SEPARATOR_WIDTH,
    DOCK_WIDTH,
  )
  return {
    allowLeft: budget.bothPanels || panelBudgetAllowsLeft(viewportWidth, cellWidth),
    dockMode: budget.dockMode,
    viewportWidth,
    cellWidth,
  }
}

/**
 * Explorer alone: it may stay open at any width where the canvas is still usable.
 * A narrow window collapses it rather than starving the terminal, and the rail
 * entry reopens it when the window grows — the user is never left without a way
 * back.
 */
function panelBudgetAllowsLeft(viewportWidth: number, cellWidth: number): boolean {
  return panelBudget(viewportWidth, cellWidth, RAIL_WIDTH + SEPARATOR_WIDTH, 0)
    .dockAsColumn
}
