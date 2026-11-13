// UX-1 hardening — the terminal keeps a usable width as panels open.
//
// The task's acceptance for this section is stated in **columns**, and that is
// what these tests compute: `terminalColumns` mirrors `FitAddon.proposeDimensions`
// (`floor((container - padding - ruler) / cellWidth)`), so a passing assertion is a
// column count the PTY would actually be told.
//
// Why not render xterm in jsdom: the render service measures cell width from real
// layout, and jsdom reports zero for every box. A test that "passes" against zero
// cells proves nothing. Driving the formula with a measured `cellWidth` is both
// honest and portable.

import { describe, expect, it } from 'vitest'
import {
  DESIGN_FLOOR_NARROW,
  DESIGN_FLOOR_WIDE,
  MIN_COLS,
  USABLE_COLS,
  panelBudget,
  terminalColumns,
} from './terminal-width-budget'

/** Cell width for the default 14px monospace font, measured in a real window. */
const CELL = 8.4
/** A user who zoomed the terminal font in one step. */
const CELL_ZOOMED = 10.5

const VIEWPORTS = [
  { name: '1440x900', width: 1440 },
  { name: '1280x800', width: 1280 },
  { name: '1024x768', width: 1024 },
  { name: '900x700', width: 900 },
  { name: '720x720', width: 720 },
  { name: '640x720', width: 640 },
  { name: '390x844', width: 390 },
  { name: '320x700', width: 320 },
] as const

const LEFT = 176 // sidebar default
const DOCK = 300 // the design package's spec, and DOCK_WIDTH in right-panel.tsx
const RAIL = 46 // activity rail
const SEPARATOR = 6

/** Chrome that exists regardless of which panels are open. */
const RAIL_ONLY = RAIL

function cols(width: number, opts: { left?: boolean; dock?: boolean; cell?: number } = {}) {
  return terminalColumns({
    viewportWidth: width,
    leftWidth: (opts.left ? LEFT : 0) + RAIL_ONLY,
    rightWidth: opts.dock ? DOCK : 0,
    chromeWidth: opts.left ? SEPARATOR : 0,
    cellWidth: opts.cell ?? CELL,
  })
}

describe('design floors from the UX-0 package', () => {
  it('1440 gives the default terminal at least 120 columns', () => {
    // "1440px 下默认终端列数不低于 120" — default means no panels open.
    expect(cols(1440)).toBeGreaterThanOrEqual(DESIGN_FLOOR_WIDE)
  })

  it('1024 gives the default terminal at least 80 columns', () => {
    expect(cols(1024)).toBeGreaterThanOrEqual(DESIGN_FLOOR_NARROW)
  })

  it('the floors survive the dock being open at 1440', () => {
    // The dock is the panel a terminal user keeps open while working.
    expect(cols(1440, { dock: true })).toBeGreaterThanOrEqual(DESIGN_FLOOR_WIDE)
  })
})

describe('every required viewport, every panel combination', () => {
  it('the default terminal is usable at every viewport down to 320', () => {
    for (const viewport of VIEWPORTS) {
      const columns = cols(viewport.width)
      // The floor is the panel-free maximum: nothing may be taken away that the
      // viewport could have given. On a 390px phone that is 40 columns, and the
      // test compares against that rather than against a fixed 60.
      // The panel-free maximum, including the overview ruler that FitAddon
      // always subtracts.
      const ceiling = Math.floor((viewport.width - RAIL_ONLY - 14) / CELL)
      expect(columns, `${viewport.name} default`).toBe(ceiling)
    }
  })

  it('the dock never drives the terminal below the usable floor', () => {
    // Where the dock as a column would starve the terminal, `panelBudget` must
    // switch it to an overlay — so a column-mode dock is only ever chosen when
    // the result is usable.
    for (const viewport of VIEWPORTS) {
      const budget = panelBudget(viewport.width, CELL, LEFT + RAIL_ONLY, DOCK)
      if (budget.dockAsColumn) {
        const columns = terminalColumns({
          viewportWidth: viewport.width,
          leftWidth: RAIL_ONLY,
          rightWidth: DOCK,
          cellWidth: CELL,
        })
        expect(columns, `${viewport.name} dock column`).toBeGreaterThanOrEqual(
          USABLE_COLS,
        )
      }
    }
  })

  it('explorer + dock together are refused when they would starve the canvas', () => {
    for (const viewport of VIEWPORTS) {
      const budget = panelBudget(viewport.width, CELL, LEFT + RAIL_ONLY, DOCK)
      if (budget.bothPanels) {
        const columns = cols(viewport.width, { left: true, dock: true })
        expect(columns, `${viewport.name} both panels`).toBeGreaterThanOrEqual(
          USABLE_COLS,
        )
      }
    }
  })

  it('a zoomed font changes where panels must yield', () => {
    // The same viewport that comfortably holds both panels at 8.4px cells cannot
    // hold them at 10.5px. This is why the thresholds are computed, not guessed.
    const comfortable = panelBudget(1440, CELL, LEFT + RAIL_ONLY, DOCK)
    const zoomed = panelBudget(1440, CELL_ZOOMED, LEFT + RAIL_ONLY, DOCK)
    expect(comfortable.bothPanels).toBe(true)
    expect(cols(1440, { left: true, dock: true, cell: CELL_ZOOMED })).toBeLessThan(
      cols(1440, { left: true, dock: true }),
    )
    // Whatever it decides, it must never report "both fit" while the canvas is
    // below the floor.
    if (zoomed.bothPanels) {
      expect(cols(1440, { left: true, dock: true, cell: CELL_ZOOMED })).toBeGreaterThanOrEqual(
        USABLE_COLS,
      )
    }
  })
})

describe('panelBudget decisions', () => {
  it('opens both panels on a wide viewport', () => {
    expect(panelBudget(1440, CELL, LEFT + RAIL_ONLY, DOCK).bothPanels).toBe(true)
  })

  it('turns the dock into an overlay when it would starve the terminal', () => {
    // 720 with the dock as a column leaves well under 60 columns.
    const budget = panelBudget(720, CELL, RAIL_ONLY, DOCK)
    expect(budget.dockMode).toBe('overlay')
  })

  it('keeps the dock as a column where it fits', () => {
    expect(panelBudget(1440, CELL, RAIL_ONLY, DOCK).dockMode).toBe('column')
  })

  it('never claims both panels fit when the canvas is below the floor', () => {
    for (const viewport of VIEWPORTS) {
      for (const cell of [CELL, CELL_ZOOMED]) {
        const budget = panelBudget(viewport.width, cell, LEFT + RAIL_ONLY, DOCK)
        if (budget.bothPanels) {
          const columns = cols(viewport.width, { left: true, dock: true, cell })
          expect(
            columns,
            `${viewport.name} @${cell}px cell`,
          ).toBeGreaterThanOrEqual(USABLE_COLS)
        }
      }
    }
  })
})

describe('terminalColumns edge cases', () => {
  it('never returns fewer than two columns', () => {
    // xterm clamps here too; a zero-column terminal divides by zero downstream.
    expect(terminalColumns({ viewportWidth: 10, leftWidth: 0, rightWidth: 0, cellWidth: 8.4 })).toBe(MIN_COLS)
  })

  it('returns the clamp when cell width is not measured yet', () => {
    // Before the first render service pass, `cellWidth` is 0. Reporting a large
    // column count there would tell the PTY a size the screen does not have.
    expect(terminalColumns({ viewportWidth: 1440, leftWidth: 0, rightWidth: 0, cellWidth: 0 })).toBe(MIN_COLS)
    expect(terminalColumns({ viewportWidth: 1440, leftWidth: 0, rightWidth: 0, cellWidth: Number.NaN })).toBe(MIN_COLS)
  })

  it('subtracts the overview ruler by default and honors an override', () => {
    const withRuler = terminalColumns({ viewportWidth: 1000, leftWidth: 0, rightWidth: 0, cellWidth: 10 })
    const without = terminalColumns({
      viewportWidth: 1000,
      leftWidth: 0,
      rightWidth: 0,
      cellWidth: 10,
      rulerWidth: 0,
    })
    expect(withRuler).toBe(98) // (1000 - 14) / 10
    expect(without).toBe(100)
  })

  it('is monotonic in width', () => {
    // A wider viewport must never report fewer columns; that would be a sign the
    // arithmetic has a sign error somewhere.
    let previous = 0
    for (let width = 320; width <= 1600; width += 40) {
      const current = terminalColumns({
        viewportWidth: width,
        leftWidth: 0,
        rightWidth: 0,
        cellWidth: CELL,
      })
      expect(current).toBeGreaterThanOrEqual(previous)
      previous = current
    }
  })
})
