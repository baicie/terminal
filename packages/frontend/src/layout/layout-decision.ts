/**
 * The single layout decision the shell renders from.
 *
 * Split out of `terminal-width-budget.ts` for the source-size gate, along the
 * seam that was already there: that module owns the *arithmetic* (how many
 * columns a width buys), this one owns the *policy* (which panel yields, in what
 * order, and how stubbornly it holds its previous answer).
 */

import { terminalColumns, USABLE_COLS } from './terminal-width-budget'

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
  /**
   * The modes this decision was computed for.
   *
   * Carried on the decision so `withHysteresis` can tell a width-driven flip from
   * a user opening or closing a panel. Without it the two are indistinguishable,
   * and the band suppresses the user's own action.
   */
  leftMode: 'none' | 'explorer' | 'navigation'
  rightMode: 'none' | 'sftp'
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

  const modes = { leftMode: input.leftMode, rightMode: input.rightMode }

  if (input.isMobile) {
    return {
      ...modes,
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
      ...modes,
      leftPresentation: 'column',
      rightPresentation: 'column',
      terminalCssWidth: widthFor(leftWidth, rightWidth),
      predictedCols: cols(leftWidth, rightWidth),
    }
  }

  // 2. Dock as a column with the explorer yielding to a drawer.
  if (rightOpen && cols(0, rightWidth) >= usableColsMin) {
    return {
      ...modes,
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
      ...modes,
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
      ...modes,
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
    ...modes,
    leftPresentation: 'none',
    rightPresentation: 'none',
    terminalCssWidth: widthFor(0, 0),
    predictedCols: focusCols,
    limitingReason: focusCols < usableColsMin ? 'font-size' : undefined,
  }
}

/**
 * What presentation the left panel should actually render with.
 *
 * A decision is only worth anything if the component obeys it. Previously the
 * shell read `allowLeft` (a boolean derived from `leftPresentation === 'column'`)
 * and used it to set the panel mode to `none` — so a `drawer` decision silently
 * rendered *nothing*, and navigation ignored the decision altogether. Keeping the
 * mapping in one place makes "the DOM follows the decision" a single expression
 * that a test can pin.
 */
export function leftPresentationFor(
  decision: Pick<LayoutDecision, 'leftPresentation'>,
  mode: 'none' | 'explorer' | 'navigation',
): LeftPresentation {
  if (mode === 'none') return 'none'
  return decision.leftPresentation
}
