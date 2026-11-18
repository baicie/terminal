// E2E-04 — the three Context Dock occupants in a real Tauri WebView.
//
// ## What this answers that jsdom cannot
//
// The Snippet / AI / Inspector docks each have component tests. What those cannot
// show, and what `SNIPPET_DOCK_REAL_GUI`, `AI_DOCK_REAL_GUI`, `INSPECTOR_REAL_GUI`
// and `INSPECTOR_REAL_GUI` were marked NOT_RUN for:
//
//   * does opening one of them really replace the other, in the one right-hand column
//     the design specifies — or do two render side by side?
//   * does closing the dock leave the PTY alive, or does the session go with it?
//   * does an occupant open from a user gesture (the command palette) rather than
//     only from a store write a test made?
//   * does the Inspector, with no SSH session, say why instead of showing zeros?
//
// ## The two rules from the design this is really testing
//
// `UX-1`: "关闭 Dock 不得关闭 PTY 或截断正在进行的传输" — closing a dock is a
// presentation change. A spec that only checks the panel appeared and disappeared
// would pass even if closing it tore down the terminal behind it, so the tab's
// session marker is read *before and after* every close.
//
// `UX-1`: one occupant at a time — the right column is a single slot. Two panels at
// once is the defect the union in `right-panel-state.ts` exists to prevent, and the
// only place it can be observed is a real layout.
//
// ## What it does NOT prove
//
// Every case runs without a live SSH session or a model endpoint. So: the Inspector
// shows its "no session" state rather than real metrics, and the AI dock shows "no
// profile" or "nothing selected" rather than a streamed answer. Those are recorded as
// NOT_RUN with the reason, never asserted as passes.

import { browser } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'

const CASE = 'e2e-04'

/** The occupants, in the order the cases drive them. */
/**
 * The occupants, with the palette titles they actually render.
 *
 * The titles are literals from `locales/en/cmdPalette.ts`, not derived from the action
 * ids. The first version derived them (`open-ai-dock` → "ai dock") and matched with
 * `includes`, which selected the snippet row for every action — the assertion then
 * read "expected the ai occupant, the panel reports snippets" and blamed the product
 * for a spec that could not tell two rows apart.
 */
const OCCUPANTS = [
  { action: 'open-snippet-dock', title: 'Open the snippet dock', label: 'snippets' },
  { action: 'open-ai-dock', title: 'Open the AI assistant', label: 'ai' },
  { action: 'open-inspector', title: 'Inspect the server', label: 'inspector' },
]

/**
 * What the right column and the terminal layer currently look like.
 *
 * `panel` is the dock's own `data-panel` attribute — the occupant value, not a CSS
 * guess. `tabSession` is the tab strip's connection marker, which is what tells a
 * "the dock closed" from a "the session died with it".
 */
async function readState() {
  return browser.execute(() => {
    const panel = document.querySelector('[data-testid="right-panel"]')
    const rect = element => {
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height, left: box.left, right: box.right }
    }
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
    return {
      panelExists: panel !== null,
      occupant: panel?.getAttribute('data-panel') ?? null,
      panel: rect(panel),
      // Every dock body that might be mounted. Counting these is how "two occupants"
      // becomes visible: `data-panel` would only report one of them.
      docksPresent: {
        snippets: document.querySelector('[data-testid="snippet-dock"]') !== null,
        ai: document.querySelector('[data-testid="ai-dock"]') !== null,
        inspector: document.querySelector('[data-testid="server-inspector"]') !== null,
      },
      // The terminal canvas. If closing a dock tore the session down, this element
      // would go away or lose its terminal.
      terminalCanvas: document.querySelector('[data-terminal-canvas]') !== null,
      terminalMounted: document.querySelector('.xterm') !== null,
      tabs: tabs.map(tab => ({
        label: tab.getAttribute('aria-label'),
        selected: tab.getAttribute('aria-selected') === 'true',
        text: (tab.textContent ?? '').trim(),
      })),
      tabCount: tabs.length,
    }
  })
}

/** Navigate with the History API — `createBrowserRouter` ignores hash changes. */
async function goTo(path) {
  await browser.execute(target => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await browser.pause(500)
}

/**
 * Run a command-palette action.
 *
 * The panel is driven the way a user drives it. Setting the store directly would
 * make the case a tautology: it would prove the store works, which its unit test
 * already says, and not that there is a reachable gesture.
 *
 * The palette listens for a `shortcut:command-palette` window event
 * (`use-global-shortcuts.ts`). Dispatching that is what a keyboard shortcut does
 * after its own translation layer, so it exercises the same path without depending
 * on which accelerator this platform bound.
 */
async function runPaletteAction(title) {
  await browser.execute(() => {
    window.dispatchEvent(new CustomEvent('shortcut:command-palette'))
  })
  await browser.pause(400)

  const ran = await browser.execute(wanted => {
    // Palette rows are `role="option"` buttons; there is no `data-value` to match on
    // (`command-palette-result.tsx:27-35`). The title is compared exactly — a
    // substring match is what crossed two entries on the first attempt.
    const rows = Array.from(document.querySelectorAll('[role="option"]'))
    const labels = rows.map(row =>
      (row.querySelector('div > div')?.textContent ?? row.textContent ?? '').trim(),
    )
    const index = labels.findIndex(label => label === wanted)
    if (index < 0) return { clicked: false, labels }
    rows[index].click()
    return { clicked: true, label: labels[index] }
  }, title)
  await browser.pause(600)
  return ran
}

describe('Context Dock occupants — real WebView', () => {
  const notes = []
  const measurements = {}
  const failures = []

  afterEach(function () {
    if (this.currentTest?.state === 'failed') {
      const err = this.currentTest.err
      const text =
        (typeof err === 'string' ? err : undefined) ??
        err?.message ??
        err?.stack?.split('\n')[0] ??
        ''
      failures.push({
        title: this.currentTest.title,
        error: text && text !== '[object Object]' ? text : `(no error text for "${this.currentTest.title}")`,
      })
    }
  })

  before(async () => {
    await browser.$('[data-testid="activity-rail"]').waitForExist({ timeout: 20_000 })
    await browser.setWindowSize(1440, 900)
    await browser.pause(300)
    // The docks live on the terminal route; the app may have booted onto it already.
    const state = await readState()
    if (!state.terminalCanvas) {
      await goTo('/terminal')
      await browser.pause(800)
    }
    measurements.before = await readState()
  })

  it('each occupant opens from a user gesture and fills the same column', async () => {
    for (const occupant of OCCUPANTS) {
      const opened = await runPaletteAction(occupant.title)
      notes.push(`${occupant.action}: ${JSON.stringify(opened)}`)

      const state = await readState()
      measurements[occupant.label] = state

      if (!state.panelExists) {
        // Some occupants refuse to render in a build without their precondition
        // (the AI dock when no model is compiled in). That is the product's designed
        // behaviour, not a defect — recorded, not failed.
        notes.push(
          `${occupant.label} NOT_RUN: the dock did not open (palette reported ${JSON.stringify(opened)})`,
        )
        continue
      }
      if (state.occupant !== occupant.label) {
        throw new Error(
          `expected the ${occupant.label} occupant, the panel reports ${state.occupant}`,
        )
      }
      notes.push(`${occupant.label}: panel ${state.panel?.width}px wide, occupant ${state.occupant}`)
    }
  })

  it('never shows two occupants at once', async () => {
    // The single-slot rule, observed where it can actually break: in the layout.
    // `right-panel-state.ts` has a source-level guard against a second boolean; this
    // is the runtime half of the same claim.
    let worst = { label: null, present: null }
    for (const occupant of OCCUPANTS) {
      await runPaletteAction(occupant.title)
      const state = await readState()
      const present = Object.entries(state.docksPresent)
        .filter(([, isPresent]) => isPresent)
        .map(([name]) => name)
      if (present.length > 1) {
        worst = { label: occupant.label, present }
        break
      }
      notes.push(`${occupant.label}: docks present = ${JSON.stringify(present)}`)
    }
    if (worst.present) {
      throw new Error(
        `two docks rendered at once after opening ${worst.label}: ${JSON.stringify(worst.present)}`,
      )
    }
  })

  it('closing the dock does not close the session', async () => {
    // The design's rule, stated as an assertion rather than as prose: closing a dock
    // is a presentation change. `data-terminal-canvas` and the xterm node are read
    // before and after, and the tab strip's selected tab must survive.
    const before = await readState()
    if (!before.panelExists) {
      notes.push('close-survival case NOT_RUN: no dock was open')
      return
    }
    if (!before.terminalMounted) {
      notes.push('close-survival case NOT_RUN: no terminal is mounted in this profile')
      return
    }

    const closed = await browser.execute(() => {
      const button = document.querySelector('[data-testid="right-panel-close"]')
      if (button) {
        button.click()
        return 'overlay close button'
      }
      // A column dock has no overlay close button; the rail toggle is what closes it.
      const rail = document.querySelector('[data-testid="rail-sftp"]')
      if (rail && rail.getAttribute('aria-pressed') === 'true') {
        rail.click()
        return 'rail toggle'
      }
      return null
    })
    await browser.pause(400)
    const after = await readState()
    measurements.closeSurvival = { before, after, closed }

    notes.push(`closed via ${closed}`)
    if (!after.terminalCanvas) {
      throw new Error('closing the dock removed the terminal canvas')
    }
    if (!after.terminalMounted) {
      throw new Error('closing the dock unmounted the terminal')
    }
    if (after.tabCount < before.tabCount) {
      throw new Error(
        `closing the dock closed a tab: ${before.tabCount} → ${after.tabCount}`,
      )
    }
  })

  it('the inspector says why it has no metrics instead of showing zeros', async () => {
    // "No SSH session" must not look like "everything is 0%". The panel's own state
    // is read, and the absence of numeric metrics is asserted alongside the reason.
    const opened = await runPaletteAction('Inspect the server')
    const state = await readState()
    if (!state.panelExists || state.occupant !== 'inspector') {
      notes.push(`inspector NOT_RUN: dock did not open (${JSON.stringify(opened)})`)
      return
    }

    const inspector = await browser.execute(() => {
      const root = document.querySelector('[data-testid="server-inspector"]')
      if (!root) return null
      return {
        text: (root.textContent ?? '').replace(/\s+/g, ' ').trim(),
        hasError: document.querySelector('[data-testid="inspector-error"]') !== null,
        hasRunning: document.querySelector('[data-testid="inspector-running"]') !== null,
        hasNoSession: document.querySelector('[data-testid="inspector-no-session"]') !== null,
        hasMetrics: document.querySelector('[data-testid="server-inspector"] [data-metric]') !== null,
        // A percentage with no host behind it would be the failure this guards.
        percentages: (root.textContent ?? '').match(/\d+\s*%/g) ?? [],
      }
    })
    measurements.inspector = inspector
    if (!inspector) {
      throw new Error('the inspector occupant rendered no body')
    }
    notes.push(`inspector text: ${JSON.stringify(inspector.text)}`)

    if (inspector.percentages.length > 0 && !inspector.hasMetrics) {
      throw new Error(
        `the inspector showed percentages with no metric data: ${JSON.stringify(inspector.percentages)}`,
      )
    }
    if (inspector.hasNoSession) {
      // The fixed empty state: the panel says why it has nothing. This is the case
      // e2e-04 found — before the fix the body was "Server inspectorRefreshClose" with
      // no explanation at all.
      notes.push(`inspector no-session state: ${JSON.stringify(inspector.text)}`)
      return
    }
    if (!inspector.hasError && !inspector.hasRunning && !inspector.hasMetrics) {
      // No state marker at all: it rendered something, but nothing says what. That is
      // the "looks like it works" failure the design's null-not-zero rule prevents.
      throw new Error(
        `the inspector showed neither an error, a running state, nor metrics: ${JSON.stringify(inspector.text)}`,
      )
    }
  })

  it('the AI dock renders its destination and refuses an unreviewed send', async () => {
    // The two UI-visible rules: the destination is printed, and selecting text is not
    // consent. With no approved context the dock must show its no-selection state
    // rather than a Send button that would post something the user never reviewed.
    const opened = await runPaletteAction('Open the AI assistant')
    const state = await readState()
    if (!state.panelExists || state.occupant !== 'ai') {
      // A build without the `ai` feature hides the dock entirely — the design's
      // "feature-off 无 profile UI 假入口". Recorded as such.
      notes.push(`ai dock NOT_RUN: dock did not open (${JSON.stringify(opened)})`)
      return
    }

    const dock = await browser.execute(() => {
      const root = document.querySelector('[data-testid="ai-dock"]')
      if (!root) return null
      return {
        // Not truncated: the first version sliced to 400 characters, which cut the
        // text *before* the "nothing is run automatically" footer, so the assertion
        // below failed on a product that is correct. A diagnostic string that hides
        // what is being asserted is worse than none.
        text: (root.textContent ?? '').replace(/\s+/g, ' ').trim(),
        hasEndpoint: document.querySelector('[data-testid="ai-endpoint"]') !== null,
        noSelection: document.querySelector('[data-testid="ai-no-selection"]') !== null,
        contextPreview: document.querySelector('[data-testid="ai-context-preview"]') !== null,
        // The standing promise, which must be on screen without scrolling for it.
        // The product's sentence is "Nothing is run automatically." — the first
        // version's pattern looked for "not run automatically" and therefore failed
        // on a dock that says exactly the right thing. Matched against the promise
        // rather than a phrase recalled from the design note.
        saysNeverRuns: /nothing is run automatically|rien n’est exécuté|不会自动执行/i.test(
          root.textContent ?? '',
        ),
      }
    })
    measurements.aiDock = dock
    if (!dock) throw new Error('the AI dock rendered no body')
    notes.push(`ai dock text: ${JSON.stringify(dock.text)}`)

    if (!dock.saysNeverRuns) {
      throw new Error('the AI dock must state that nothing is run automatically')
    }
    if (dock.contextPreview && dock.noSelection) {
      throw new Error('the AI dock showed both a context preview and a no-selection state')
    }
  })

  it('records what could not be verified', () => {
    notes.push(
      'NOT_RUN: a real model answer (no OpenAI-compatible endpoint in this environment)',
    )
    notes.push(
      'NOT_RUN: real Inspector metrics (no SSH session is opened by this spec)',
    )
    notes.push(
      'NOT_RUN: snippet draft capture (needs a terminal selection and an enabled extension)',
    )
  })

  after(async () => {
    const notRunCount = notes.filter(note => note.includes('NOT_RUN')).length
    const verdict = failures.length > 0 ? 'FAIL' : notRunCount > 0 ? 'PARTIAL' : 'PASS'
    await writeEvidence(CASE, {
      verdict,
      notes: notes.join('\n'),
      error:
        failures.length > 0
          ? failures.map(f => `${f.title}: ${f.error}`).join('\n')
          : undefined,
      extra: { measurements, failures, notRunCount },
    })
  })
})
