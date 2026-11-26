// The layout must decide against the cell width the terminal is *really* using.
//
// ## The defect, twice
//
// The first version read `'monospace'` while xterm got the full font stack; that was
// fixed by pointing both at `defaultSettings.fontFamily`. It was not enough. Measured on
// the Linux GUI runner at 768px afterwards:
//
//   the canvas measurement reported 8.4px  → the decision kept the explorer as a column
//   xterm rendered at ~10.8px               → the terminal got 50 columns, under its floor
//
// The canvas measures the *named* stack; when those faces are absent the browser
// substitutes, and it substitutes differently for a canvas than for xterm's DOM
// measurement. So the two numbers disagree on exactly the machines that do not have
// Menlo — which is every Linux runner and any minimal container.
//
// ## What this pins
//
// The fix is to prefer a width back-computed from a mounted terminal (the pane
// publishes `cols` and the width it was fitted to) over the canvas estimate, and to fall
// back only before a terminal exists. These tests assert that preference and the
// arithmetic it depends on, because "the layout is right on machines with Menlo" is what
// shipped twice already.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { chooseLayout, type LayoutInput } from './layout-decision'
import { OVERVIEW_RULER_WIDTH, terminalColumns } from './terminal-width-budget'

const sourceRoot = path.resolve(process.cwd(), 'src')

function source(relative: string): string {
  return readFileSync(path.join(sourceRoot, relative), 'utf8')
}

/** The 768px case the Linux runner failed, with both cell widths. */
const SEVENTY_SIXTY_EIGHT: Omit<LayoutInput, 'cellWidth'> = {
  shellWidth: 768,
  railWidth: 46,
  leftMode: 'explorer',
  leftWidth: 182,
  rightMode: 'sftp',
  preferredRightWidth: 300,
}

describe('an observed cell width wins over the canvas estimate', () => {
  it('the layout reads the pane-published cell width', () => {
    /*
     * Source-level on purpose: the property is "the hook prefers the observed value",
     * and the cheapest way for that to regress is somebody deleting the local without
     * noticing — which is precisely how the first fix passed its own tests and failed on
     * a runner.
     */
    const layout = source('layout/use-panel-layout.ts')
    expect(layout).toContain('useObservedCellWidth')
    expect(layout).toMatch(/observedCellWidth\s*\?\?\s*estimatedCellWidth/)
  })

  it('back-computes the same cell width the column arithmetic uses', () => {
    /*
     * The derivation is the inverse of `terminalColumns`, so round-tripping must land on
     * the column count the terminal itself reported. This is the arithmetic half: if the
     * two ever disagree, the layout decides against a number the terminal never had.
     */
    for (const cols of [50, 60, 65, 92, 142]) {
      const fittedWidth = 800
      const cell = (fittedWidth - OVERVIEW_RULER_WIDTH) / cols
      const recovered = terminalColumns({
        viewportWidth: fittedWidth,
        leftWidth: 0,
        rightWidth: 0,
        chromeWidth: 0,
        cellWidth: cell,
      })
      expect(recovered, `cols=${cols}`).toBe(cols)
    }
  })

  /*
   * The decision the failure was about. At the measured 10.8px the dock must not stay a
   * column at 768px; at the canvas's 8.4px this same input is what starved the terminal.
   */
  it('yields the panels at the width the runner actually rendered', () => {
    const atEstimate = chooseLayout({ ...SEVENTY_SIXTY_EIGHT, cellWidth: 8.4 })
    const atMeasured = chooseLayout({ ...SEVENTY_SIXTY_EIGHT, cellWidth: 10.8 })

    expect(
      atMeasured.rightPresentation,
      'at the real cell width the dock cannot stay a column',
    ).not.toBe('column')
    expect(
      atMeasured.predictedCols,
      'the terminal must clear the 60-column floor once the panels yield',
    ).toBeGreaterThanOrEqual(60)
    expect(
      atEstimate.predictedCols,
      'the 8.4px estimate is what made the same window look affordable',
    ).toBeGreaterThan(60)
  })
})

describe('the publisher only reports what it measured', () => {
  it('omits fittedWidth when the pane cannot measure itself', () => {
    /*
     * Absent is the signal the layout waits for. A zero or a guess would be used as if it
     * were real, which is the whole class of defect here.
     */
    const publisher = source(
      'features/terminal/components/terminal-container/use-publish-terminal-size.ts',
    )
    expect(publisher).toMatch(/measured\s*>\s*0/)
    expect(publisher).toMatch(/fittedWidth:\s*measured/)
  })

  it('clears the observed width with the snapshot', () => {
    /*
     * `fittedWidth` is a copy of a field on `active`. Left behind after `clear`, the
     * layout would back-compute a cell width from a pane that no longer exists.
     */
    const store = source('store/terminal-status.ts')
    const clearBody = store.slice(store.indexOf('clear: tabId'))
    expect(clearBody).toMatch(/active:\s*null,\s*fittedWidth:\s*0/)
  })
})
