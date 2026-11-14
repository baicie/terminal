// F0 / TN-01 — the layout decision must be driven by real measured widths.
//
// The defect this pins: `usePanelLayout()` called `panelBudget()` with
// `RAIL_WIDTH + SEPARATOR_WIDTH` only (52px). It never learned the sidebar's
// width, so the budget believed the left column was 52px while `LeftPanel` was
// rendering at the user's saved 176px — up to 420px. Every decision it made was
// computed against 124–368px of terminal that does not exist.
//
// The arithmetic was always right; the caller fed it the wrong numbers. So these
// tests drive `chooseLayout`, the function the caller now delegates to, rather
// than re-testing `terminalColumns` in isolation.

import { describe, expect, it } from 'vitest'
import { USABLE_COLS, terminalColumns } from './terminal-width-budget'
import { chooseLayout, type LayoutDecision, type LayoutInput } from './layout-decision'
import { bandColumns, evaluatePresentation, withHysteresis } from './layout-hysteresis'

/** A 8.4px cell is xterm's default 14px monospace, which is what ships. */
const CELL = 8.4
const RAIL = 46
const DOCK = 300
const EXPLORER_DEFAULT = 176
const EXPLORER_MAX = 420

function input(overrides: Partial<LayoutInput> = {}): LayoutInput {
  return {
    shellWidth: 1440,
    railWidth: RAIL,
    leftMode: 'none',
    leftWidth: EXPLORER_DEFAULT,
    rightMode: 'none',
    preferredRightWidth: DOCK,
    cellWidth: CELL,
    ...overrides,
  }
}

describe('chooseLayout counts the explorer width that is actually rendered', () => {
  it('refuses both columns at 1240 when the explorer is 420px wide', () => {
    // 1240 - 46 - 420 - 300 - 14 = 460px → 54 cols, below the 60 floor.
    const decision = chooseLayout(
      input({
        shellWidth: 1240,
        leftMode: 'explorer',
        leftWidth: EXPLORER_MAX,
        rightMode: 'sftp',
      }),
    )
    expect(decision.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS)
    expect(
      decision.leftPresentation === 'column' && decision.rightPresentation === 'column',
    ).toBe(false)
  })

  it('refuses both columns at 1024 with a 420px explorer', () => {
    const decision = chooseLayout(
      input({
        shellWidth: 1024,
        leftMode: 'explorer',
        leftWidth: EXPLORER_MAX,
        rightMode: 'sftp',
      }),
    )
    expect(decision.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS)
  })

  it('gives the same viewport different answers for different explorer widths', () => {
    const narrow = chooseLayout(
      input({
        shellWidth: 1240,
        leftMode: 'explorer',
        leftWidth: EXPLORER_MAX,
        rightMode: 'sftp',
      }),
    )
    const wide = chooseLayout(
      input({
        shellWidth: 1240,
        leftMode: 'explorer',
        leftWidth: 64,
        rightMode: 'sftp',
      }),
    )
    expect(narrow).not.toEqual(wide)
  })

  it('keeps both columns at 1440 with the default 176px explorer', () => {
    const decision = chooseLayout(
      input({
        shellWidth: 1440,
        leftMode: 'explorer',
        leftWidth: EXPLORER_DEFAULT,
        rightMode: 'sftp',
      }),
    )
    expect(decision.leftPresentation).toBe('column')
    expect(decision.rightPresentation).toBe('column')
    expect(decision.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS)
  })

  it('degrades the dock to an overlay instead of starving the terminal', () => {
    // Narrow shell, dock open, explorer closed: the dock cannot be a column.
    const decision = chooseLayout(
      input({ shellWidth: 700, rightMode: 'sftp' })
    )
    expect(decision.rightPresentation).toBe('overlay')
    expect(decision.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS)
    expect(decision.limitingReason).toBe('width')
  })

  it('turns the explorer into a drawer rather than a column when width runs out', () => {
    const decision = chooseLayout(
      input({ shellWidth: 600, leftMode: 'explorer', leftWidth: EXPLORER_MAX })
    )
    expect(decision.leftPresentation).toBe('drawer')
    expect(decision.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS)
  })

  it('reports font-size as the reason when even Focus cannot reach the floor', () => {
    // 512px shell at a 20px font (≈12px cells): Focus alone is under 60 cols.
    const decision = chooseLayout(
      input({ shellWidth: 512, cellWidth: 12 })
    )
    expect(decision.leftPresentation).toBe('none')
    expect(decision.rightPresentation).toBe('none')
    expect(decision.predictedCols).toBeLessThan(USABLE_COLS)
    expect(decision.limitingReason).toBe('font-size')
  })

  it('grows the cell with the font and lets a column become an overlay', () => {
    const at14 = chooseLayout(
      input({ shellWidth: 1024, leftMode: 'explorer', leftWidth: 200, rightMode: 'sftp' })
    )
    const at20 = chooseLayout(
      input({
        shellWidth: 1024,
        cellWidth: 12,
        leftMode: 'explorer',
        leftWidth: 200,
        rightMode: 'sftp',
      })
    )
    expect(at14.rightPresentation).toBe('column')
    expect(at20.rightPresentation).not.toBe('column')
  })

  it('never lets a panel take width the terminal cannot spare', () => {
    for (const shellWidth of [512, 640, 768, 900, 1024, 1240, 1440, 1920]) {
      for (const leftWidth of [64, 176, 240, 420]) {
        for (const rightMode of ['none', 'sftp'] as const) {
          const d = chooseLayout(
            input({
              shellWidth,
              leftMode: 'explorer',
              leftWidth,
              rightMode,
            }),
          )
          // Either the predicted columns clear the floor, or every panel that
          // costs width has already been demoted.
          const starving = d.predictedCols < USABLE_COLS
          if (starving) {
            expect(d.rightPresentation).not.toBe('column')
            expect(d.leftPresentation).not.toBe('column')
          }
        }
      }
    }
  })

  it('matches terminalColumns for the same inputs', () => {
    const d = chooseLayout(
      input({ shellWidth: 1440, leftMode: 'explorer', leftWidth: 176, rightMode: 'sftp' })
    )
    expect(d.predictedCols).toBe(
      terminalColumns({
        viewportWidth: 1440,
        leftWidth: 176,
        rightWidth: DOCK,
        chromeWidth: RAIL,
        cellWidth: CELL,
      }),
    )
    expect(d.terminalCssWidth).toBe(1440 - RAIL - 176 - DOCK)
  })

  it('uses a drawer and an overlay on mobile instead of the 300px dock', () => {
    const d = chooseLayout(
      input({ shellWidth: 390, isMobile: true, leftMode: 'explorer', rightMode: 'sftp' })
    )
    expect(d.leftPresentation).toBe('drawer')
    expect(d.rightPresentation).toBe('overlay')
    expect(d.limitingReason).toBe('mobile')
  })
})


describe('withHysteresis judges the previous presentation on the current width', () => {
  // The first implementation compared `previous.predictedCols` (measured at the
  // old width) with `next.predictedCols` (measured at the new width, after the
  // demotion). Because a demotion almost always restores the floor, the
  // "next is not comfortable" branch almost never fired and the band never
  // engaged — the layout flipped at the exact threshold pixel.
  //
  // These tests drive width one pixel at a time across the threshold and assert
  // that the presentation does not oscillate.

  const base = {
    railWidth: RAIL,
    leftMode: 'explorer' as const,
    leftWidth: 420,
    rightMode: 'sftp' as const,
    preferredRightWidth: DOCK,
    cellWidth: CELL,
  }

  /**
   * Walk a width range and return the sequence of presentations.
   *
   * `step` carries its own sign (pass -1 to walk down). An earlier version
   * multiplied it by a direction derived from `from`/`to`, which double-negated
   * and turned a descending sweep into an ascending one that never terminated.
   */
  function sweep(from: number, to: number, step: number): string[] {
    if (step === 0) throw new Error('sweep needs a non-zero step')
    if (from !== to && Math.sign(to - from) !== Math.sign(step)) {
      throw new Error(`sweep step ${step} does not head from ${from} to ${to}`)
    }
    let previous: LayoutDecision | null = null
    const seen: string[] = []
    for (let w = from; step > 0 ? w <= to : w >= to; w += step) {
      const input = { ...base, shellWidth: w }
      const next = chooseLayout(input)
      const stable = withHysteresis(next, previous, input)
      previous = stable
      const key = `${stable.leftPresentation}/${stable.rightPresentation}`
      if (seen[seen.length - 1] !== key) seen.push(key)
    }
    return seen
  }

  it('does not oscillate while shrinking one pixel at a time', () => {
    const transitions = sweep(1500, 900, -1)
    // Each distinct presentation may appear once per direction. A thrash shows up
    // as the same state reappearing after another one.
    const counts = new Map<string, number>()
    for (const state of transitions) counts.set(state, (counts.get(state) ?? 0) + 1)
    for (const [state, count] of counts) {
      expect(count, `state ${state} appeared ${count} times while shrinking`).toBe(1)
    }
  })

  it('does not oscillate on a round trip through the threshold', () => {
    const down = sweep(1500, 900, -1)
    const up = sweep(900, 1500, 1)
    for (const sequence of [down, up]) {
      const counts = new Map<string, number>()
      for (const state of sequence) counts.set(state, (counts.get(state) ?? 0) + 1)
      for (const [state, count] of counts) {
        expect(count, `state ${state} appeared ${count} times`).toBe(1)
      }
    }
  })

  it('holds the column layout for the band before yielding', () => {
    // Find the width where a column layout stops being comfortable, then check it
    // is still held a few pixels below that point.
    let threshold = 0
    for (let w = 1500; w >= 900; w -= 1) {
      const cols = terminalColumns({
        viewportWidth: w,
        leftWidth: 420,
        rightWidth: DOCK,
        chromeWidth: RAIL,
        cellWidth: CELL,
      })
      if (cols < USABLE_COLS) {
        threshold = w
        break
      }
    }
    expect(threshold).toBeGreaterThan(900)

    const band = bandColumns(CELL)
    // Prime with a comfortable width.
    const primeInput = { ...base, shellWidth: threshold + 40 }
    const previous = chooseLayout(primeInput)
    expect(previous.leftPresentation).toBe('column')

    const justBelow = { ...base, shellWidth: threshold - 1 }
    const held = withHysteresis(chooseLayout(justBelow), previous, justBelow)
    const colsJustBelow = terminalColumns({
      viewportWidth: threshold - 1,
      leftWidth: 420,
      rightWidth: DOCK,
      chromeWidth: RAIL,
      cellWidth: CELL,
    })

    if (USABLE_COLS - colsJustBelow <= band) {
      // Inside the band the old presentation is held — but never below the floor
      // minus the band. That is the whole trade: a couple of columns of slack to
      // stop the flip, not permission to starve the terminal indefinitely.
      expect(held.leftPresentation).toBe('column')
      expect(held.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS - band)
    } else {
      expect(held.leftPresentation).not.toBe('column')
      expect(held.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS)
    }
  })

  it('still yields immediately once the excursion leaves the band', () => {
    const comfortable = chooseLayout({ ...base, shellWidth: 1500 })
    expect(comfortable.leftPresentation).toBe('column')
    const far = { ...base, shellWidth: 900 }
    const yielded = withHysteresis(chooseLayout(far), comfortable, far)
    expect(yielded.leftPresentation).not.toBe('column')
    expect(yielded.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS)
  })

  it('re-evaluates the old presentation instead of trusting its old column count', () => {
    // Prime at a very wide width so `previous.predictedCols` is large.
    const wide = { ...base, shellWidth: 1600 }
    const previous = chooseLayout(wide)
    expect(previous.predictedCols).toBeGreaterThan(USABLE_COLS + 10)

    // Now at a narrow width the old presentation is NOT acceptable, even though
    // `previous.predictedCols` still says it was.
    const narrow = { ...base, shellWidth: 820 }
    const result = withHysteresis(chooseLayout(narrow), previous, narrow)
    expect(result.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS)
    // The old presentation measured at the current width is what decides.
    const previousNow = evaluatePresentation(
      previous.leftPresentation,
      previous.rightPresentation,
      narrow,
    )
    expect(previousNow.predictedCols).toBeLessThan(USABLE_COLS)
  })

  it('handles a font change through the same path', () => {
    const narrow = { ...base, shellWidth: 1100 }
    const at14 = chooseLayout({ ...narrow, cellWidth: 8.4 })
    const at20 = chooseLayout({ ...narrow, cellWidth: 12 })
    // A larger cell means fewer columns; the decision must react, not hold.
    expect(at20.predictedCols).toBeLessThan(at14.predictedCols)
    const stabilized = withHysteresis(at20, at14, { ...narrow, cellWidth: 12 })
    expect(stabilized.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS)
  })
})
