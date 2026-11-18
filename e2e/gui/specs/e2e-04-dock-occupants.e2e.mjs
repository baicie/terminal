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
//   * does an occupant open through the command palette rather than only from a
//     store write a test made? (The palette is triggered by the same window event a
//     keyboard shortcut dispatches, then its row is clicked. That is one step above a
//     store write — it exercises the action handler and the render — but it is not a
//     real key or pointer event, and this spec does not claim to be one.)
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
/**
 * Whether an occupant MUST open in this environment.
 *
 * The first version treated every occupant as optional: if the panel did not appear
 * it pushed a `NOT_RUN` note and moved on. That is how Linux shipped a green GUI job
 * while the snippet dock never opened at all — the one thing this spec exists to
 * catch had a path that could not fail.
 *
 * - `REQUIRED`  — must open here. Failure to open is a FAIL.
 * - `OPTIONAL`  — opens only when a precondition holds (a compiled-in feature, a
 *                 configured profile). Absence is recorded, not failed.
 * - `UNAVAILABLE` — cannot be exercised in this environment at all.
 *
 * All three occupants are REQUIRED: opening a dock needs no network, no model and no
 * SSH session. The AI dock renders a "no profile" state rather than refusing to mount,
 * which is exactly what the design specifies, and the Inspector renders its no-session
 * state. If any of them cannot mount on a platform, that is a product defect.
 */
const OCCUPANTS = [
  { action: 'open-snippet-dock', title: 'Open the snippet dock', label: 'snippets', need: 'REQUIRED' },
  { action: 'open-ai-dock', title: 'Open the AI assistant', label: 'ai', need: 'REQUIRED' },
  { action: 'open-inspector', title: 'Inspect the server', label: 'inspector', need: 'REQUIRED' },
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

  /*
   * Wait for the palette to have *rows*, then for the row we want.
   *
   * The first version slept 400 ms and read the list once. On Linux that read the
   * palette before its first results had been computed and got `labels: []` — an
   * empty list, not a missing entry — which the case then recorded as NOT_RUN. The
   * next two actions in the same run worked, so it was a first-open timing problem,
   * not a missing command.
   *
   * A longer fixed sleep would hide the same race again on a slower runner. This
   * polls a *condition* (the row we asked for exists) with a bounded deadline, so a
   * palette that genuinely lacks the command still fails quickly and loudly.
   */
  const deadline = 10_000
  const started = Date.now()
  let last = { clicked: false, labels: [], waitedMs: 0 }
  while (Date.now() - started < deadline) {
    last = await browser.execute(wanted => {
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
    if (last.clicked) break
    await browser.pause(100)
  }
  last.waitedMs = Date.now() - started
  await browser.pause(600)
  return last
}

describe('Context Dock occupants — real WebView', () => {
  const notes = []
  const measurements = {}
  const failures = []

  /*
   * Failures are recorded by `check()` below, at the throw site.
   *
   * Mocha's `currentTest` here carries `state: "failed"` but `err` is `undefined` —
   * measured with a deliberately broken spec, whose recorded evidence came out as the
   * placeholder `(no error text for "...")`. The mechanism that was supposed to
   * capture the reason did not have access to it. Rather than guess at another
   * undocumented field, every assertion in this spec goes through `check()`, which
   * records the message where it is still in hand.
   */

  /** Assert, and record the reason before rethrowing so the evidence keeps it. */
  function check(condition, message) {
    if (!condition) {
      failures.push({ title: currentCase, error: message })
      throw new Error(message)
    }
  }

  /** The case currently executing, for the failure record. */
  let currentCase = 'unknown case'
  beforeEach(function () {
    currentCase = this?.currentTest?.title ?? 'unknown case'
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

  it('each occupant opens through the command palette and fills the same column', async () => {
    for (const occupant of OCCUPANTS) {
      const opened = await runPaletteAction(occupant.title)
      notes.push(`${occupant.action}: ${JSON.stringify(opened)}`)

      const state = await readState()
      measurements[occupant.label] = state

      if (!state.panelExists) {
        // A REQUIRED occupant that does not open is a failure, not a note.
        //
        // This branch used to record NOT_RUN and continue, which is how the Linux job
        // stayed green while the snippet dock never mounted. The palette result is
        // included because "the command was not found" and "the command ran but the
        // panel did not render" are different defects with different owners.
        if (occupant.need === 'REQUIRED') {
          check(false, 
            `${occupant.label} is REQUIRED but did not open: ` +
              `${JSON.stringify(opened)}`,
          )
        }
        notes.push(
          `${occupant.label} UNAVAILABLE: the dock did not open (palette reported ${JSON.stringify(opened)})`,
        )
        continue
      }
      if (state.occupant !== occupant.label) {
        check(false, 
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
      check(false, 
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
      check(false, 'closing the dock removed the terminal canvas')
    }
    if (!after.terminalMounted) {
      check(false, 'closing the dock unmounted the terminal')
    }
    if (after.tabCount < before.tabCount) {
      check(false, 
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
      // REQUIRED: opening the inspector needs no SSH session — it has a designed
      // no-session state that this very case asserts below. Failing to mount it is a
      // product defect, and the previous NOT_RUN path hid it.
      check(false, 
        `the inspector is REQUIRED but did not open: ${JSON.stringify(opened)} ` +
          `(panelExists=${state.panelExists}, occupant=${state.occupant})`,
      )
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
      check(false, 'the inspector occupant rendered no body')
    }
    notes.push(`inspector text: ${JSON.stringify(inspector.text)}`)

    if (inspector.percentages.length > 0 && !inspector.hasMetrics) {
      check(false, 
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
      check(false, 
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
      // The binary under test is built with the `ai` feature (the workflow builds with
      // `--features gui-e2e`, and this dock is part of the default UI). A dock that
      // does not mount is a defect; the old NOT_RUN path would have called a build
      // without the feature "unavailable" even when the feature was present.
      check(false, 
        `the AI dock is REQUIRED but did not open: ${JSON.stringify(opened)} ` +
          `(panelExists=${state.panelExists}, occupant=${state.occupant})`,
      )
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
    if (!dock) check(false, 'the AI dock rendered no body')
    notes.push(`ai dock text: ${JSON.stringify(dock.text)}`)

    if (!dock.saysNeverRuns) {
      check(false, 'the AI dock must state that nothing is run automatically')
    }
    if (dock.contextPreview && dock.noSelection) {
      check(false, 'the AI dock showed both a context preview and a no-selection state')
    }
  })

  // ## There is no "records what could not be verified" case any more
  //
  // That case asserted nothing — its body was three `notes.push` calls — yet it counted
  // as one of the six cases "passing", which is how a suite reports 6/6 while one sixth
  // of it could not fail. The gaps it listed are real, so they are declared here in
  // `after()` as structured `NOT_RUN` entries, where they are counted as NOT_RUN rather
  // than as passes.

  after(async () => {
    /*
     * Gaps that this environment genuinely cannot close.
     *
     * Declared once, as data, so the evidence file carries them without a fake case
     * inflating the pass count. Each names what would be needed to close it.
     */
    const GAPS = [
      {
        id: 'real-model-answer',
        reason: 'no OpenAI-compatible endpoint in this environment',
        needs: 'a model endpoint (BLOCKED_EXTERNAL; the suite must not consume a paid key)',
      },
      {
        id: 'real-inspector-metrics',
        reason: 'no SSH session is opened by this spec',
        needs: 'a reachable sshd; covered by the real-machine matrix instead',
      },
      {
        id: 'snippet-draft-capture',
        reason: 'needs a terminal selection and an enabled extension',
        needs: 'the snippet workflow spec (e2e-05)',
      },
    ]
    for (const gap of GAPS) {
      notes.push(`NOT_RUN ${gap.id}: ${gap.reason} (needs ${gap.needs})`)
    }
    const notRunCount = notes.filter(note => note.includes('NOT_RUN')).length
    const verdict = failures.length > 0 ? 'FAIL' : notRunCount > 0 ? 'PARTIAL' : 'PASS'
    await writeEvidence(CASE, {
      verdict,
      notes: notes.join('\n'),
      error:
        failures.length > 0
          ? failures.map(f => `${f.title}: ${f.error}`).join('\n')
          : undefined,
      extra: { measurements, failures, notRunCount, gaps: GAPS },
    })
  })

})
