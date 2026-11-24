// SSH11 follow-up — the layout must measure the font the terminal actually renders.
//
// ## The defect this pins
//
// `usePanelLayout` measured the cell width with `settings.fontFamily ?? 'monospace'`
// while `TerminalContainer` gave xterm `settings.fontFamily ?? defaultSettings.fontFamily`
// (`Menlo, Monaco, "Courier New", monospace`). On a default install those are different
// fonts, so the two numbers disagreed — and the layout decided against a budget the
// terminal never had.
//
// Measured on the Linux GUI runner (run 45432150199, E2E-02 at 768px):
//
//   decision predicted 62 columns from an 8.4px cell
//   the terminal reported 50 columns at ~10.8px
//
// The explorer stayed a column because the budget said the terminal could afford it.
// The terminal could not. That is how a 768px window ended up with a *narrower* terminal
// than a 640px one, and it is the whole 60-column-floor failure.
//
// ## Why this is tested at the source, not through the DOM
//
// The disagreement is between two `??` fallbacks in two modules. A rendering test would
// have to reproduce a font stack that is not installed on the test machine; asserting the
// two modules read the same default is exact and does not depend on which fonts exist.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/service/database'

const sourceRoot = path.resolve(process.cwd(), 'src')

function source(relative: string): string {
  return readFileSync(path.join(sourceRoot, relative), 'utf8')
}

describe('the layout measures the font the terminal renders', () => {
  it('both read their font fallback from the same place', () => {
    /*
     * A source-level assertion is the right shape here and worth saying out loud: the
     * property is "these two modules agree", and the cheapest way for them to stop
     * agreeing is somebody writing a fresh literal at one of the two call sites. A DOM
     * test cannot see that; this can.
     */
    const layout = source('layout/use-panel-layout.ts')
    const container = source(
      'features/terminal/components/terminal-container/container.tsx',
    )

    for (const [name, file] of [
      ['use-panel-layout.ts', layout],
      ['container.tsx', container],
    ] as const) {
      expect(
        file,
        `${name} must take its font fallback from defaultSettings, not a local literal`,
      ).toContain('defaultSettings.fontFamily')
    }
  })

  it('the layout does not fall back to a bare monospace literal', () => {
    /*
     * `'monospace'` is what the layout used to pass. Its presence as a *fallback* is the
     * defect: it resolves to whatever the platform calls monospace, which is not the
     * stack xterm was given.
     *
     * Comments are stripped first. The file *explains* the old bug in prose, and a
     * whole-file regex reads that explanation as the bug — which is how a guard starts
     * failing on documentation rather than on code.
     */
    const layout = source('layout/use-panel-layout.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(layout).not.toMatch(/fontFamily\s*\?\?\s*'monospace'/)
    expect(layout).not.toMatch(/fontSize\s*\?\?\s*14\b/)
  })

  it('the shared default is a real font stack, not a generic family', () => {
    // A generic family would make the two modules agree on a value that still does not
    // describe what renders. The default has to name concrete faces first.
    expect(defaultSettings.fontFamily).toMatch(/Menlo|Monaco|Courier/i)
    expect(defaultSettings.fontFamily).toContain('monospace')
  })

  it('a measured cell that disagrees with the assumption changes the decision', () => {
    /*
     * The arithmetic half, kept so the source assertions above cannot pass while the
     * consequence is broken. These are the two cell widths the Linux runner actually
     * produced, at the 768px window that failed:
     *
     *   at 8.4px the decision keeps the explorer as a column and hands the terminal
     *   540px — 50 real columns, which is the E2E-02 failure;
     *   at the real ~10.8px it demotes the explorer to a drawer and the terminal gets
     *   722px — 65 columns.
     *
     * The second number is *larger* than the first even though the cell is wider,
     * because yielding the panel is what buys the width. That is the policy working.
     */
    const input = {
      shellWidth: 768,
      railWidth: 46,
      leftMode: 'explorer' as const,
      leftWidth: 182,
      rightMode: 'none' as const,
      preferredRightWidth: 300,
    }
    const assumed = decision(8.4, input)
    const measured = decision(10.8, input)

    expect(
      {
        cols: assumed.predictedCols,
        left: assumed.leftPresentation,
        css: assumed.terminalCssWidth,
      },
      'the 8.4px assumption keeps the explorer and starves the terminal',
    ).toEqual({ cols: 62, left: 'column', css: 540 })
    expect(
      {
        cols: measured.predictedCols,
        left: measured.leftPresentation,
        css: measured.terminalCssWidth,
      },
      'the real cell width demotes the explorer and widens the terminal',
    ).toEqual({ cols: 65, left: 'drawer', css: 722 })
  })
})

/** The decision for a cell width, through the same function the hook uses. */
function decision(
  cellWidth: number,
  input: {
    shellWidth: number
    railWidth: number
    leftMode: 'none' | 'explorer' | 'navigation'
    leftWidth: number
    rightMode: 'none' | 'sftp'
    preferredRightWidth: number
  },
) {
  return chooseLayout({ ...input, cellWidth })
}

// Imported after the helper so the file reads top-down; vitest hoists imports anyway.
import { chooseLayout } from './layout-decision'
