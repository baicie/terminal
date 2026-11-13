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
import {
  chooseLayout,
  withHysteresis,
  type LayoutDecision,
  type LayoutInput,
} from './layout-decision'

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

describe('withHysteresis damps the flip instead of locking it', () => {
  const comfortable: LayoutDecision = {
    leftPresentation: 'column',
    rightPresentation: 'column',
    terminalCssWidth: 800,
    predictedCols: 95,
  }

  it('returns the fresh decision when there is no previous one', () => {
    const next: LayoutDecision = {
      leftPresentation: 'none',
      rightPresentation: 'overlay',
      terminalCssWidth: 500,
      predictedCols: 59,
    }
    expect(withHysteresis(next, null, CELL)).toEqual(next)
  })

  it('holds a comfortable previous decision one column below the floor', () => {
    const next: LayoutDecision = {
      leftPresentation: 'drawer',
      rightPresentation: 'overlay',
      terminalCssWidth: 500,
      predictedCols: 59,
    }
    // 59 is within the 24px band (floor(24/8.4) = 2 cols) of 60.
    expect(withHysteresis(next, comfortable, CELL)).toEqual(comfortable)
  })

  it('yields immediately once the excursion leaves the band', () => {
    const next: LayoutDecision = {
      leftPresentation: 'drawer',
      rightPresentation: 'overlay',
      terminalCssWidth: 400,
      predictedCols: 45,
    }
    expect(withHysteresis(next, comfortable, CELL)).toEqual(next)
  })

  it('does not hold a previous decision that was already starving', () => {
    const starving: LayoutDecision = {
      leftPresentation: 'column',
      rightPresentation: 'column',
      terminalCssWidth: 400,
      predictedCols: 50,
    }
    const next: LayoutDecision = {
      leftPresentation: 'drawer',
      rightPresentation: 'overlay',
      terminalCssWidth: 400,
      predictedCols: 50,
    }
    expect(withHysteresis(next, starving, CELL)).toEqual(next)
  })

  it('scales the band with the cell width', () => {
    const next: LayoutDecision = {
      leftPresentation: 'drawer',
      rightPresentation: 'overlay',
      terminalCssWidth: 500,
      predictedCols: 59,
    }
    // At 12px cells the 24px band is 2 columns; at 30px cells it is 1.
    expect(withHysteresis(next, comfortable, 30)).toEqual(comfortable)
    expect(withHysteresis({ ...next, predictedCols: 57 }, comfortable, 30)).toEqual({
      ...next,
      predictedCols: 57,
    })
  })
})
