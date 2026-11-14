/**
 * Terminal width budget: how many columns the canvas actually gets.
 *
 * The design constraints are stated in columns, not pixels ("1440px must give the
 * terminal at least 120 columns", "1024px at least 80"), but the panels are sized
 * in pixels. Assuming a pixel-to-column ratio is how a layout passes its own test
 * and fails on a real screen — the ratio depends on font size, font family and the
 * scrollbar, all of which the user can change.
 *
 * So the arithmetic lives here, once, and is exercised against the same inputs
 * xterm's `FitAddon.proposeDimensions()` uses:
 *
 *     usableWidth   = containerWidth - horizontal padding - overviewRulerWidth
 *     cols          = floor(usableWidth / cellWidth)
 *
 * `cellWidth` is what xterm's render service measured for the active font, so this
 * is the real column count the PTY would be told, not an estimate.
 */

/** xterm's overview ruler takes this much unless scrollback is disabled. */
export const OVERVIEW_RULER_WIDTH = 14

/** xterm clamps to at least two columns; below that nothing is usable. */
export const MIN_COLS = 2

/** Below this many columns a terminal is not usable for real work. */
export const USABLE_COLS = 60

/** The Design Package's two hard floors. */
export const DESIGN_FLOOR_NARROW = 80
export const DESIGN_FLOOR_WIDE = 120

/**
 * Hysteresis band around every presentation threshold.
 *
 * A layout that flips the moment `cols` crosses 60 will thrash: the dock becoming
 * an overlay widens the terminal, which pushes `cols` back over 60, which makes it
 * a column again. The design package therefore requires the decision to hold for
 * 24px before reversing. `chooseLayout` takes the previous decision for exactly
 * this reason — without it there is nothing to be sticky about.
 */
export const HYSTERESIS_PX = 24

export interface LayoutMetrics {
  /** Viewport width in CSS pixels. */
  viewportWidth: number
  /** Left panel width, 0 when it is closed. */
  leftWidth: number
  /** Right dock width, 0 when it is closed. */
  rightWidth: number
  /** Left/right borders, the resize separator, and any workspace padding. */
  chromeWidth?: number
  /** Measured cell width for the active font. */
  cellWidth: number
  /** Horizontal padding inside the terminal element. */
  terminalPadding?: number
  /** Width of xterm's overview ruler, 0 when scrollback is off. */
  rulerWidth?: number
}

/**
 * Columns the terminal canvas would report, given the panels currently open.
 *
 * Mirrors `FitAddon.proposeDimensions()`: subtract the chrome, then divide by the
 * measured cell width and floor it. The `-1` slack is deliberate — a terminal that
 * reports exactly `usableWidth / cellWidth` leaves no room for a partial column,
 * and the fit addon floors the same way, so one pixel of rounding the wrong way
 * would drop a column the user can see.
 */
export function terminalColumns(metrics: LayoutMetrics): number {
  const {
    viewportWidth,
    leftWidth,
    rightWidth,
    chromeWidth = 0,
    cellWidth,
    terminalPadding = 0,
    rulerWidth = OVERVIEW_RULER_WIDTH,
  } = metrics
  if (!Number.isFinite(cellWidth) || cellWidth <= 0) return MIN_COLS
  const canvas = viewportWidth - leftWidth - rightWidth - chromeWidth
  const usable = canvas - terminalPadding - rulerWidth
  return Math.max(MIN_COLS, Math.floor(usable / cellWidth))
}

export interface PanelBudget {
  /** Is it acceptable to show both panels at this viewport width? */
  bothPanels: boolean
  /** Is it acceptable to show the dock as a column at all? */
  dockAsColumn: boolean
  /** What the dock should do when it cannot be a column. */
  dockMode: 'column' | 'overlay'
}

/**
 * What to do with the panels at a given viewport width.
 *
 * The rule the design asks for: **the terminal keeps a usable width; panels yield.**
 * A dock that is a column at 1440 and an overlay at 720 is one dock with two
 * presentations, not two components.
 *
 * `cellWidth` is a parameter rather than a constant because a user who zooms to
 * 20px cells needs panels to yield at a much wider viewport than one at 13px.
 */
export function panelBudget(
  viewportWidth: number,
  cellWidth: number,
  leftWidth: number,
  rightWidth: number,
): PanelBudget {
  const colsWithBoth = terminalColumns({
    viewportWidth,
    leftWidth,
    rightWidth,
    cellWidth,
  })
  const colsDockOnly = terminalColumns({
    viewportWidth,
    leftWidth: 0,
    rightWidth,
    cellWidth,
  })
  return {
    bothPanels: colsWithBoth >= USABLE_COLS,
    dockAsColumn: colsDockOnly >= USABLE_COLS,
    dockMode: colsDockOnly >= USABLE_COLS ? 'column' : 'overlay',
  }
}
