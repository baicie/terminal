/**
 * Hysteresis: damps width-driven presentation flips without overruling the user.
 *
 * Split out of `layout-decision.ts` for the source-size gate, along the seam that
 * was already there — that module answers "what should the layout be right now",
 * this one answers "how much of the previous answer should we keep".
 */

import { HYSTERESIS_PX, terminalColumns, USABLE_COLS } from './terminal-width-budget'
import type {
  LayoutDecision,
  LayoutInput,
  LeftPresentation,
  RightPresentation,
} from './layout-decision'

/**
 * Apply the hysteresis band to a fresh decision.
 *
 * The first version of this function was wrong in a way worth recording, because
 * it is the obvious way to write it and it does not work:
 *
 *     const wasComfortable = previous.predictedCols >= floor
 *     const isComfortable  = next.predictedCols  >= floor
 *
 * `previous.predictedCols` is the column count the *old* presentation produced at
 * the *old* width. At the moment a flip is being considered, `next` has already
 * demoted a panel, so `next.predictedCols` is almost always back above the floor —
 * `!isComfortable` is therefore almost never true and the hysteresis band never
 * engages. The layout flips at the exact pixel where the floor is crossed and
 * flips straight back, which is the thrash the band exists to prevent.
 *
 * The fix is to judge the *previous presentation* against the *current*
 * conditions. Going down, the old layout is kept until it would genuinely starve
 * the terminal by more than the band. Coming back up, the demoted layout is kept
 * until keeping it would cost more than the band's worth of columns that the
 * column layout could restore. Both directions compare presentations evaluated on
 * the same width, which is the only comparison that means anything.
 */
export function withHysteresis(
  next: LayoutDecision,
  previous: LayoutDecision | null | undefined,
  input: LayoutInput,
  usableColsMin: number = USABLE_COLS,
): LayoutDecision {
  if (!previous) return next
  const unchanged =
    previous.leftPresentation === next.leftPresentation &&
    previous.rightPresentation === next.rightPresentation
  if (unchanged) return next

  // A mode change is the user's instruction, not a measurement edge. Damping it
  // would make the panel refuse to open: opening the explorer from `none` adds a
  // column, which *reduces* the terminal's columns, so a "only restore when it
  // buys more columns" rule reads it as a downgrade and holds the closed layout.
  // Hysteresis exists to stop width oscillation; it has no business overruling a
  // click.
  if (previous.leftMode !== input.leftMode || previous.rightMode !== input.rightMode) {
    return next
  }

  // Both presentations, measured on the width we have *now*.
  const previousNow = evaluatePresentation(
    previous.leftPresentation,
    previous.rightPresentation,
    input,
  )
  const band = bandColumns(input.cellWidth)

  // Compare *the axis that changed*, not "does this layout contain a column".
  // The first version asked `isColumnish(previous) && !isColumnish(next)`, and
  // because the dock stayed a column while the explorer was demoted, both sides
  // were "columnish" and the band never engaged. A layout is column-ish per side.
  const leftWentDown = previous.leftPresentation === 'column' && next.leftPresentation !== 'column'
  const rightWentDown = previous.rightPresentation === 'column' && next.rightPresentation !== 'column'
  const leftCameUp = previous.leftPresentation !== 'column' && next.leftPresentation === 'column'
  const rightCameUp = previous.rightPresentation !== 'column' && next.rightPresentation === 'column'

  if (leftWentDown || rightWentDown) {
    // Going down: hold the old presentation while it still clears the floor minus
    // the band. Below that the panels must yield — hysteresis damps, it does not
    // lock, and it never lets the terminal starve by more than the band.
    if (previousNow.predictedCols >= usableColsMin - band) {
      return previousNow
    }
    return next
  }

  if (leftCameUp || rightCameUp) {
    // Coming back up: only restore the column layout when it buys more than the
    // band's worth of columns. Otherwise a one-pixel widening would flip it back
    // and a one-pixel narrowing would flip it away again.
    if (next.predictedCols - previousNow.predictedCols > band) {
      return next
    }
    return previousNow
  }

  // A change that is not column↔non-column on either side (for example dock
  // overlay → drawer) is not a width-thrash edge; take the fresh decision.
  return next
}

/** Columns the band is worth at this cell width. Never less than one. */
export function bandColumns(cellWidth: number): number {
  return Math.max(1, Math.floor(HYSTERESIS_PX / Math.max(1, cellWidth)))
}

/**
 * What a given pair of presentations would cost at the **current** width.
 *
 * This is the piece the first implementation was missing: without it there is no
 * way to ask "would the layout we currently show still be acceptable here?", and
 * the hysteresis comparison degenerates into comparing two different widths.
 */
export function evaluatePresentation(
  left: LeftPresentation,
  right: RightPresentation,
  input: LayoutInput,
): LayoutDecision {
  const leftWidth = left === 'column' ? Math.max(0, input.leftWidth) : 0
  const rightWidth = right === 'column' ? Math.max(0, input.preferredRightWidth) : 0
  const chrome = (input.paddingAndBorders ?? 0) + input.railWidth
  const shellWidth = Number.isFinite(input.shellWidth) ? input.shellWidth : 0
  const predictedCols = terminalColumns({
    viewportWidth: shellWidth,
    leftWidth,
    rightWidth,
    chromeWidth: chrome,
    cellWidth: input.cellWidth,
  })
  return {
    leftMode: input.leftMode,
    rightMode: input.rightMode,
    leftPresentation: left,
    rightPresentation: right,
    terminalCssWidth: Math.max(0, shellWidth - chrome - leftWidth - rightWidth),
    predictedCols,
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
