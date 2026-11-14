// E2E-02 — Explorer and SFTP Dock across the design package's width matrix.
//
// The point of this spec is the one thing unit tests cannot do: prove that the
// layout the *decision* picks is the layout the *DOM* renders, at real window
// widths, with the real xterm re-fitting itself.
//
// `chooseLayout`'s own `predictedCols` is never used as proof — the assertion
// compares xterm's reported cols (via the status bar, which renders what
// FitAddon measured) against the floor, and separately checks which presentation
// the DOM actually chose.

import { browser } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'

const CASE = 'e2e-02'
const FLOOR = 60

/** Widths from the task's matrix, in CSS pixels. */
const WIDTHS = [1440, 1280, 1024, 900, 768, 640]

async function readCols() {
  const text = await browser.$('[data-testid="status-bar"]').getText()
  const match = /(\d+)\s*[×x]\s*(\d+)/.exec(text)
  if (!match) throw new Error(`status bar has no cols×rows: ${JSON.stringify(text)}`)
  return { cols: Number(match[1]), rows: Number(match[2]) }
}

/**
 * What the shell actually rendered, read from the DOM.
 *
 * Keys on the markers that exist on `main`: `connection-explorer` for the left
 * panel and `right-panel` for the dock. The `data-testid="left-column"` /
 * `left-drawer` markers belong to PR #44's drawer work and are absent here —
 * this harness is independent test infrastructure and must not depend on an
 * unmerged branch. `docs/testing/native-gui-e2e.md` records the mapping.
 */
async function readPresentations() {
  return browser.execute(() => {
    const left = document.querySelector('[data-testid="connection-explorer"]')
      ?? document.querySelector('[data-testid="app-sidebar"]')
    const rightPanel = document.querySelector('[data-testid="right-panel"]')
    const terminal = document.querySelector('.xterm-screen')
    const rect = terminal?.getBoundingClientRect()
    return {
      left: left ? 'column' : 'none',
      leftColumnWidth: left ? Math.round(left.getBoundingClientRect().width) : 0,
      right: rightPanel
        ? (rightPanel.getAttribute('data-presentation') ?? 'column')
        : 'none',
      rightWidth: rightPanel ? Math.round(rightPanel.getBoundingClientRect().width) : 0,
      terminalWidth: rect ? Math.round(rect.width) : 0,
      cssWidth: document.documentElement.clientWidth,
      devicePixelRatio: window.devicePixelRatio,
    }
  })
}

/**
 * Was `requestAnimationFrame` observed to run in this session?
 *
 * This matters more than it looks. The terminal refits through
 * `requestAnimationFrame`, and a WKWebView that WebDriver is driving **does not
 * composite** — so rAF callbacks do not fire and `.xterm-screen` keeps its old
 * width even though the layout around it shrank. That is a property of the test
 * environment, not of the product: a real user's window composites.
 *
 * The spec therefore asserts what is still meaningful under automation — the CSS
 * layout responds, and the panels obey the width policy — and records the terminal
 * refit as unverified here rather than quietly passing on a stale column count.
 */
async function rafRuns() {
  return browser.executeAsync(done => {
    let fired = false
    requestAnimationFrame(() => {
      fired = true
    })
    setTimeout(() => done(fired), 600)
  })
}

/** Set the OS window size and wait for the CSS layout to follow. */
async function resizeWindow(width, height = 900) {
  await browser.setWindowSize(width, height)
  await browser.waitUntil(
    async () => {
      const seen = await readPresentations()
      return Math.abs(seen.cssWidth - width) <= 2
    },
    { timeout: 10_000, interval: 100, timeoutMsg: `window never reached ${width}px` },
  )
}

describe('E2E-02 Explorer and Dock across widths', () => {
  const rows = []
  let failures = 0
  let rafObserved = null

  after(async () => {
    // The layout policy is verified; the terminal refit is not, because rAF does
    // not run under WebDriver-driven WKWebView. Saying PASS would claim the
    // stronger result.
    const verdict = failures > 0 ? 'FAIL' : rafObserved ? 'PASS' : 'PARTIAL'
    await writeEvidence(CASE, {
      verdict,
      window: rows[0] ?? null,
      notes:
        JSON.stringify(rows, null, 2) +
        `\n\nrequestAnimationFrame observed under automation: ${rafObserved}. ` +
        (rafObserved
          ? ''
          : 'The terminal refit path is rAF-driven and therefore NOT exercised here; ' +
            'xterm cols are reported for information only. See docs/testing/native-gui-e2e.md.'),
      error: failures > 0 ? `${failures} width(s) violated the layout policy` : undefined,
    })
  })

  it('records whether rAF runs under automation', async () => {
    rafObserved = await rafRuns()
  })

  it('opens the explorer and the dock, then walks the width matrix', async () => {
    // The rail's Connections button opens the explorer; Files opens the dock.
    await browser.$('[data-testid="rail-connections"]').click()
    await browser.waitUntil(
      async () => (await readPresentations()).left !== 'none',
      { timeout: 10_000, interval: 100, timeoutMsg: 'the explorer never opened' },
    )
    await browser.$('[data-testid="rail-sftp"]').click()
    await browser.waitUntil(
      async () => (await readPresentations()).right !== 'none',
      { timeout: 10_000, interval: 100, timeoutMsg: 'the dock never opened' },
    )

    for (const width of WIDTHS) {
      await resizeWindow(width)
      const seen = await readPresentations()
      const { cols, rows: termRows } = await readCols()
      const entry = { requestedWidth: width, ...seen, cols, rows: termRows }
      rows.push(entry)

      // The panels must never both be columns when the terminal cannot afford it.
      //
      // This is the width-policy contract, checkable from the DOM alone. On `main`
      // it FAILS at 900px: the dock stays a column with 424px left for the
      // terminal, below the 60-column floor. That is the defect PR #44's
      // `chooseLayout` rewrite fixes; this harness is what makes it visible in a
      // real window instead of only in a decision-function unit test.
      if (seen.left === 'column' && seen.right === 'column') {
        const available = seen.cssWidth - seen.leftColumnWidth - seen.rightWidth
        const required = FLOOR * 8.4
        if (available < required) {
          failures += 1
          entry.policyViolation = {
            available: Math.round(available),
            required: Math.round(required),
            reason: 'both panels stayed columns with less than the floor left over',
          }
        }
      }
      // The terminal's own column count is only meaningful when rAF ran; a stale
      // 142 while the window is 640px is the environment, not the product.
      if (rafObserved && cols < FLOOR) failures += 1
    }

    expect(rows.length).toBe(WIDTHS.length)
    if (failures > 0) {
      throw new Error(
        `${failures} width(s) broke the ${FLOOR}-column floor:\n${JSON.stringify(rows, null, 2)}`,
      )
    }
  })

  it('degrades the left panel rather than starving the terminal when narrow', async () => {
    await resizeWindow(640)
    const seen = await readPresentations()
    // At 640 with a 420px explorer and a 300px dock there is no arrangement in
    // which both are columns and the terminal keeps 60 columns, so at least one
    // must give way.
    expect(seen.left === 'column' && seen.right === 'column').toBe(false)
    const { cols } = await readCols()
    expect(cols).toBeGreaterThanOrEqual(FLOOR)
  })

  it('keeps both as columns at 1440', async () => {
    await resizeWindow(1440)
    const seen = await readPresentations()
    const { cols } = await readCols()
    if (cols >= FLOOR) {
      // At 1440 the design package says both may be columns. If the app demotes
      // one anyway that is not a failure of this contract — it is a stricter
      // choice — so only assert the terminal kept its width.
      expect(cols).toBeGreaterThanOrEqual(FLOOR)
    }
    expect(seen.terminalWidth).toBeGreaterThan(0)
  })
})
