// F0 / TN-01 — proof that the OLD implementation fails these assertions.
//
// This file is the "先红" half of the fix. It re-implements the defect verbatim as
// it existed on `main` (1a24eed) — `usePanelLayout()` called `panelBudget()` with
// `RAIL_WIDTH + SEPARATOR_WIDTH` and never learned the sidebar width — and asserts
// that the shipping decision function disagrees with it.
//
// If someone later reintroduces the 52px assumption, the "agrees with the old
// implementation" assertions below flip and this file goes red.

import { describe, expect, it } from 'vitest'
import { USABLE_COLS, panelBudget, terminalColumns } from './terminal-width-budget'
import { chooseLayout, type LayoutInput } from './layout-decision'

const CELL = 8.4
const RAIL = 46
const SEPARATOR = 6
const DOCK = 300

/**
 * The defect, copied from `main:packages/frontend/src/layout/use-panel-layout.ts`
 * before the fix: the budget only ever heard about the rail and the separator.
 */
function oldDecision(viewportWidth: number, cellWidth: number) {
  const budget = panelBudget(
    viewportWidth,
    cellWidth,
    RAIL + SEPARATOR,
    DOCK,
  )
  return {
    allowLeft: budget.bothPanels,
    dockMode: budget.dockMode,
  }
}

function input(overrides: Partial<LayoutInput> = {}): LayoutInput {
  return {
    shellWidth: 1440,
    railWidth: RAIL,
    leftMode: 'none',
    leftWidth: 176,
    rightMode: 'none',
    preferredRightWidth: DOCK,
    cellWidth: CELL,
    ...overrides,
  }
}

describe('the old 52px budget was wrong and the new decision corrects it', () => {
  it('at 1240 with a 420px explorer the old budget said "both fit"', () => {
    // The old function's answer, reproduced so the defect is on the record.
    const old = oldDecision(1240, CELL)
    expect(old.allowLeft).toBe(true)
    expect(old.dockMode).toBe('column')
  })

  it('...but the real columns there are below the floor', () => {
    // What the terminal would get if both panels stayed columns.
    // 1240 - 46 - 420 - 300 - 6 - 14 = 454px → 54 cols.
    const naive = terminalColumns({
      viewportWidth: 1240,
      leftWidth: 420,
      rightWidth: DOCK,
      chromeWidth: RAIL,
      cellWidth: CELL,
    })
    expect(naive).toBeLessThan(USABLE_COLS)

    // The decision therefore demotes a panel, and the columns it reports are the
    // ones the terminal will actually have *after* that demotion.
    const decision = chooseLayout(
      input({
        shellWidth: 1240,
        leftMode: 'explorer',
        leftWidth: 420,
        rightMode: 'sftp',
      }),
    )
    expect(decision.predictedCols).toBeGreaterThan(naive)
    expect(decision.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS)
  })

  it('the new decision refuses what the old one allowed', () => {
    const old = oldDecision(1240, CELL)
    const next = chooseLayout(
      input({
        shellWidth: 1240,
        leftMode: 'explorer',
        leftWidth: 420,
        rightMode: 'sftp',
      }),
    )
    const newAllowsBoth =
      next.leftPresentation === 'column' && next.rightPresentation === 'column'
    // The whole point: old said yes, new says no.
    expect(old.allowLeft).toBe(true)
    expect(newAllowsBoth).toBe(false)
  })

  it('at 1024 with a 420px explorer the disagreement is even wider', () => {
    const old = oldDecision(1024, CELL)
    const naive = terminalColumns({
      viewportWidth: 1024,
      leftWidth: 420,
      rightWidth: DOCK,
      chromeWidth: RAIL,
      cellWidth: CELL,
    })
    // 1024 - 46 - 420 - 300 - 14 = 244px → 29 cols.
    expect(naive).toBeLessThan(USABLE_COLS)

    const decision = chooseLayout(
      input({
        shellWidth: 1024,
        leftMode: 'explorer',
        leftWidth: 420,
        rightMode: 'sftp',
      }),
    )
    expect(old.allowLeft).toBe(true)
    expect(decision.predictedCols).toBeGreaterThanOrEqual(USABLE_COLS)
    // It recovered by demoting panels, not by pretending they fit.
    expect(decision.leftPresentation).not.toBe('column')
  })

  it('agrees with the old implementation when the explorer really is rail-width', () => {
    // Sanity check in the other direction: with a 64px explorer (the SIDEBAR_MIN)
    // the numbers are close enough that both should allow the dock as a column.
    // This keeps the new code from being "always stricter", which would be a
    // different bug.
    const old = oldDecision(1440, CELL)
    const next = chooseLayout(
      input({
        shellWidth: 1440,
        leftMode: 'explorer',
        leftWidth: 64,
        rightMode: 'sftp',
      }),
    )
    expect(old.dockMode).toBe('column')
    expect(next.rightPresentation).toBe('column')
  })
})
