/**
 * The single layout decision the shell renders from.
 *
 * Split out of `terminal-width-budget.ts` for the source-size gate, along the
 * seam that was already there: that module owns the *arithmetic* (how many
 * columns a width buys), this one owns the *policy* (which panel yields, in what
 * order, and how stubbornly it holds its previous answer).
 */

import {
  HYSTERESIS_PX,
  terminalColumns,
  USABLE_COLS,
} from './terminal-width-budget'

export type LeftPresentation = 'none' | 'column' | 'drawer'
export type RightPresentation = 'none' | 'column' | 'overlay'
export type LimitingReason = 'width' | 'font-size' | 'mobile'

export interface LayoutInput {
  /**
   * Width available to the shell itself, in CSS pixels.
   *
   * Measured from the shell container with a ResizeObserver, **not** taken from
   * `window.innerWidth`. The window includes the traffic lights / caption buttons
   * and any OS chrome, and — more importantly — feeding the already-squeezed
   * terminal element's width back in is what makes a layout oscillate.
   */
  shellWidth: number
  railWidth: number
  leftMode: 'none' | 'explorer' | 'navigation'
  /**
   * The user's saved left-panel width, in CSS pixels.
   *
   * This is the value `LeftPanel` actually renders at (`SIDEBAR_DEFAULT` 176,
   * clamped to 64–420). Passing only `railWidth` here is the defect this module
   * exists to prevent: the budget then believes the left column is 52px while the
   * user is looking at 420px of it.
   */
  leftWidth: number
  rightMode: 'none' | 'sftp'
  preferredRightWidth: number
  cellWidth: number
  paddingAndBorders?: number
  usableColsMin?: number
  isMobile?: boolean
  /** Previous decision, for the hysteresis band. Omit on first render. */
  previous?: LayoutDecision | null
}

export interface LayoutDecision {
  leftPresentation: LeftPresentation
  rightPresentation: RightPresentation
  /** Width the terminal canvas is expected to get, in CSS pixels. */
  terminalCssWidth: number
  /** Columns that width buys at the measured cell width. */
  predictedCols: number
  limitingReason?: LimitingReason
}

/**
 * Decide what the shell shows, from real measured widths.
 *
 * Precedence is fixed by the design package: **terminal ≥ 60 cols** first, then the
 * active dock (which may become an overlay), then the explorer (which may become a
 * drawer). A panel never takes width the terminal cannot spare; it changes
 * presentation instead. The user's saved widths are never modified — only how they
 * are shown.
 */
export function chooseLayout(input: LayoutInput): LayoutDecision {
  const usableColsMin = input.usableColsMin ?? USABLE_COLS
  const chrome = (input.paddingAndBorders ?? 0) + input.railWidth
  const leftOpen = input.leftMode !== 'none'
  const rightOpen = input.rightMode !== 'none'
  const leftWidth = leftOpen ? Math.max(0, input.leftWidth) : 0
  const rightWidth = rightOpen ? Math.max(0, input.preferredRightWidth) : 0
  const shellWidth = Number.isFinite(input.shellWidth) ? input.shellWidth : 0

  const cols = (left: number, right: number): number =>
    terminalColumns({
      viewportWidth: shellWidth,
      leftWidth: left,
      rightWidth: right,
      chromeWidth: chrome,
      cellWidth: input.cellWidth,
    })

  const widthFor = (left: number, right: number): number =>
    Math.max(0, shellWidth - chrome - left - right)

  if (input.isMobile) {
    return {
      leftPresentation: leftOpen ? 'drawer' : 'none',
      rightPresentation: rightOpen ? 'overlay' : 'none',
      terminalCssWidth: widthFor(0, 0),
      predictedCols: cols(0, 0),
      limitingReason: 'mobile',
    }
  }

  // 1. Both as columns, if the terminal still clears the floor.
  if (leftOpen && rightOpen && cols(leftWidth, rightWidth) >= usableColsMin) {
    return {
      leftPresentation: 'column',
      rightPresentation: 'column',
      terminalCssWidth: widthFor(leftWidth, rightWidth),
      predictedCols: cols(leftWidth, rightWidth),
    }
  }

  // 2. Dock as a column with the explorer yielding to a drawer.
  if (rightOpen && cols(0, rightWidth) >= usableColsMin) {
    return {
      leftPresentation: leftOpen ? 'drawer' : 'none',
      rightPresentation: 'column',
      terminalCssWidth: widthFor(0, rightWidth),
      predictedCols: cols(0, rightWidth),
    }
  }

  // 3. Dock becomes an overlay so it costs the terminal nothing.
  if (rightOpen) {
    const withLeft = leftOpen && cols(leftWidth, 0) >= usableColsMin
    return {
      leftPresentation: withLeft ? 'column' : leftOpen ? 'drawer' : 'none',
      rightPresentation: 'overlay',
      terminalCssWidth: widthFor(withLeft ? leftWidth : 0, 0),
      predictedCols: cols(withLeft ? leftWidth : 0, 0),
      limitingReason: withLeft && leftOpen ? undefined : 'width',
    }
  }

  // 4. Explorer only.
  if (leftOpen) {
    const fits = cols(leftWidth, 0) >= usableColsMin
    return {
      leftPresentation: fits ? 'column' : 'drawer',
      rightPresentation: 'none',
      terminalCssWidth: widthFor(fits ? leftWidth : 0, 0),
      predictedCols: cols(fits ? leftWidth : 0, 0),
      limitingReason: fits ? undefined : 'width',
    }
  }

  // 5. Focus: nothing open, the terminal gets everything.
  const focusCols = cols(0, 0)
  return {
    leftPresentation: 'none',
    rightPresentation: 'none',
    terminalCssWidth: widthFor(0, 0),
    predictedCols: focusCols,
    limitingReason: focusCols < usableColsMin ? 'font-size' : undefined,
  }
}

/**
 * Apply the hysteresis band to a fresh decision.
 *
 * Only one step of excursion is allowed before the previous decision is honoured:
 * a panel that is a column stays a column until the terminal would fall more than
 * `HYSTERESIS_PX` worth of columns below the floor. That is enough to stop the
 * measure → re-decide → re-measure loop, and it still yields promptly when the
 * user actually drags the window narrower.
 */
export function withHysteresis(
  next: LayoutDecision,
  previous: LayoutDecision | null | undefined,
  cellWidth: number,
  usableColsMin: number = USABLE_COLS,
): LayoutDecision {
  if (!previous) return next
  if (
    previous.leftPresentation === next.leftPresentation &&
    previous.rightPresentation === next.rightPresentation
  ) {
    return next
  }
  // The slack is expressed in columns so it scales with the font, exactly like the
  // floor it is guarding.
  const slackCols = Math.max(1, Math.floor(HYSTERESIS_PX / Math.max(1, cellWidth)))
  const wasComfortable = previous.predictedCols >= usableColsMin
  const isComfortable = next.predictedCols >= usableColsMin
  // Only hold a *comfortable* previous decision. A layout that is already starving
  // the terminal must be allowed to degrade immediately — hysteresis is a damper,
  // not a lock.
  if (wasComfortable && !isComfortable && next.predictedCols >= usableColsMin - slackCols) {
    return previous
  }
  return next
}
