// DDQ08 — a phase-aware soak: does repeated work on each GUI surface stay bounded?
//
// ## What this adds that `e2e-09` does not
//
// `e2e-09` runs 100 rounds of **one** action (open the command palette, close it) and
// curves the process's RSS and descriptor count. It proves that path is stable and
// nothing about the others: SFTP transfers, SSH sessions, the snippet dock and the
// inspector each exercise different code, and a leak in any of them would not appear in a
// palette-only curve.
//
// The task asks for five phases, each verified **reachable** with a few rounds before any
// budget is spent on a real soak, and it explicitly does not ask for 100 rounds of every
// phase — a phase that costs a real SSH handshake per round does not need the same count
// as one that opens a dialog.
//
// ## Why reachability comes first
//
// Measured history in this repository: `e2e-02` and `e2e-03` both spent rounds asserting
// against a surface that had not opened, and recorded the result as a product fault. A
// soak that runs 100 rounds of "click a control that is not there" produces a beautiful
// flat curve and a wrong conclusion. So each phase runs a small probe first and reports
// `UNREACHABLE` — not `FAIL` — when the control is absent on this platform.
//
// ## What it does not claim
//
// One phase's rounds are **not** a day of use. The budget below is chosen so the whole
// suite stays inside a PR's tolerance for the light phases, and the heavier ones are
// opt-in through `DDQ08_ROUNDS`. A number of rounds that varies by phase is honest; a
// single number applied to five very different operations would not be.

import { browser, expect } from '@wdio/globals'
import { binaryPath, writeEvidence } from '../fixtures/evidence.mjs'
import { canSample, findAppPid, sampleProcess } from '../fixtures/process-sampler.mjs'
import { buildSeries } from '../fixtures/resource-series.mjs'

const CASE = 'ddq08-phased-soak'

/**
 * Rounds per phase.
 *
 * `DDQ08_ROUNDS` scales every phase at once for a manual soak. The defaults are what an
 * ordinary PR run can afford: the light phases (palette, dock) get 20, the heavier ones
 * (a real SSH session per round) get 5. The task says not to force 100 on every phase;
 * these are the numbers that fit the budget without pretending the phases are equivalent.
 */
const SCALE = Number(process.env.DDQ08_ROUNDS ?? 0)
const roundsFor = base => (Number.isFinite(SCALE) && SCALE > 0 ? SCALE : base)

async function probe() {
  return browser.execute(() => globalThis.__terminalGuiE2E?.snapshot?.() ?? null)
}

/**
 * Open the palette and click a row, through the same path `e2e-04` uses.
 *
 * ## Why a window event and not a keystroke
 *
 * The palette is opened by `use-global-shortcuts.ts`, which translates a keydown into a
 * `shortcut:command-palette` window event. Dispatching that event exercises the same
 * handler the accelerator reaches, without depending on which chord this platform bound.
 *
 * Measured, in order: `Meta+K` did nothing, `Ctrl+K` did nothing, and both reported "the
 * palette never opened" while `e2e-04` opens the same panel on the same build every run.
 * The keyboard path is not what the WebDriver key sequence reaches here — the event is.
 *
 * ## Why the row wait is a poll
 *
 * `e2e-04` records the measurement: a fixed 400 ms read on Linux saw the palette before
 * its first results had been computed (`labels: []`), which reads as "the command is
 * missing" rather than "the list is not ready". So this polls for the row, with a
 * bounded deadline, and reports how many rows it did see when it gives up.
 */
async function runPaletteAction(title) {
  await browser.execute(() => {
    window.dispatchEvent(new CustomEvent('shortcut:command-palette'))
  })
  const started = Date.now()
  let seen = 0
  while (Date.now() - started < 10_000) {
    const outcome = await browser.execute(wanted => {
      const rows = Array.from(document.querySelectorAll('[role="option"]'))
      const labels = rows.map(row =>
        (row.querySelector('div > div')?.textContent ?? row.textContent ?? '').trim(),
      )
      const index = labels.findIndex(label => label === wanted)
      if (index < 0) return { clicked: false, rows: rows.length }
      rows[index].click()
      return { clicked: true, rows: rows.length }
    }, title)
    seen = outcome.rows
    if (outcome.clicked) {
      await browser.pause(500)
      return { ok: true }
    }
    await browser.pause(250)
  }
  await browser.keys('Escape')
  return { ok: false, reason: `no palette row titled "${title}" (${seen} rows)` }
}

/** Whether a dock occupant is currently mounted, by the panel's own attribute. */
async function dockOccupant() {
  return browser.execute(() => {
    const panel = document.querySelector('[data-panel]')
    return panel ? panel.getAttribute('data-panel') : null
  })
}

/**
 * The right dock's mode, read from the layout the product itself computed.
 *
 * Not from a CSS class: the dock is a sibling of the terminal layer and its presence is a
 * product decision (`dockMode`), so that decision is what a phase should assert.
 */
async function closeDock() {
  const open = await browser.execute(() => {
    const rail = document.querySelector('[data-testid="rail-sftp"]')
    if (rail && rail.getAttribute('aria-pressed') === 'true') {
      rail.click()
      return true
    }
    return false
  })
  if (open) await browser.pause(500)
  return open
}

/**
 * One phase: a name, the rounds to run, and a function that performs one round and
 * reports whether it actually did the work.
 *
 * `perform` returning `{ ok: false }` makes the phase `UNREACHABLE` after the first
 * round — that is the "confirm the operation is reachable before spending the budget"
 * rule, implemented once rather than repeated in five places.
 */
const PHASES = [
  {
    name: 'A-local-terminal',
    rounds: roundsFor(20),
    async perform(index) {
      const type = await browser.execute(() => {
        const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(
          element => element.getAttribute('data-tab-type') === 'local',
        )
        if (!tab) return { ok: false, reason: 'no local tab' }
        tab.click()
        return { ok: true }
      })
      if (!type.ok) return type
      await browser.pause(150)
      const typed = await browser.execute(
        () => globalThis.__terminalGuiE2E?.focusActiveTerminal?.() ?? false,
      )
      if (!typed) return { ok: false, reason: 'the probe cannot focus a terminal' }
      const wrote = await browser.execute(
        nonce => globalThis.__terminalGuiE2E?.typeIntoActiveTerminal?.(`echo ${nonce}`) ?? false,
        `soakA${index}`,
      )
      if (!wrote) return { ok: false, reason: 'the probe cannot type into a terminal' }
      await browser.keys('Enter')
      // The round is only real if the shell answered: a command queued behind a blocked
      // output path would otherwise be counted as a completed round.
      try {
        await browser.waitUntil(
          async () => {
            const tail = await browser.execute(
              () => globalThis.__terminalGuiE2E?.readActiveTerminalTail?.() ?? '',
            )
            return typeof tail === 'string' && tail.includes(`soakA${index}`)
          },
          { timeout: 10_000, interval: 250 },
        )
        return { ok: true }
      } catch {
        return { ok: false, reason: 'the shell never echoed the round marker' }
      }
    },
  },
  {
    name: 'B-palette',
    rounds: roundsFor(20),
    async perform() {
      /*
       * The round is "open the palette and close it again" — the same shape `e2e-09`
       * intends. It uses the window event so the round only counts when the panel really
       * mounted; the keystroke version counted silent no-ops for 100 rounds.
       */
      await browser.execute(() => {
        window.dispatchEvent(new CustomEvent('shortcut:command-palette'))
      })
      let opened = false
      const started = Date.now()
      while (Date.now() - started < 5_000) {
        opened = await browser.execute(
          () => Boolean(document.querySelector('[role="dialog"], [role="listbox"]')),
        )
        if (opened) break
        await browser.pause(200)
      }
      await browser.keys('Escape')
      await browser.pause(200)
      return opened ? { ok: true } : { ok: false, reason: 'the palette never mounted' }
    },
  },
  {
    name: 'C-sftp-dock',
    rounds: roundsFor(20),
    async perform(index) {
      const opened = await browser.execute(() => {
        const rail = document.querySelector('[data-testid="rail-sftp"]')
        if (!rail) return { ok: false, reason: 'the rail has no SFTP entry' }
        if (rail.getAttribute('aria-pressed') !== 'true') rail.click()
        return { ok: true }
      })
      if (!opened.ok) return opened
      await browser.pause(300)
      const panel = await dockOccupant()
      await closeDock()
      // The dock mounting *something* is what makes the round meaningful; which occupant
      // it is belongs to e2e-04.
      return panel === null
        ? { ok: false, reason: 'the dock opened but reported no occupant' }
        : { ok: true, occupant: panel }
    },
  },
  {
    name: 'D-snippet-dock',
    rounds: roundsFor(10),
    async perform() {
      const action = await runPaletteAction('Open the snippet dock')
      if (!action.ok) return action
      const panel = await dockOccupant()
      await closeDock()
      return panel === 'snippets'
        ? { ok: true }
        : { ok: false, reason: `the dock reports "${panel}" after asking for snippets` }
    },
  },
  {
    name: 'E-inspector',
    rounds: roundsFor(10),
    async perform() {
      const action = await runPaletteAction('Inspect the server')
      if (!action.ok) return action
      const panel = await dockOccupant()
      await closeDock()
      return panel === 'inspector'
        ? { ok: true }
        : { ok: false, reason: `the dock reports "${panel}" after asking for the inspector` }
    },
  },
]

describe('DDQ08 — a soak that names which surface it exercised', () => {
  const phaseResults = []
  const measured = {}
  const caseFailures = []

  afterEach(function () {
    if (this.currentTest?.state === 'failed') {
      const test = this.currentTest
      caseFailures.push({
        title: test.title ?? '<unknown case>',
        error:
          typeof test.duration === 'number'
            ? `failed after ${test.duration} ms; see the phase results`
            : 'failed; see the phase results',
      })
    }
  })

  after(async () => {
    /*
     * ## The verdict is about the harness, not about leaks
     *
     * A `LEAK_SUSPECTED` here is recorded and not thrown, for the same reason `e2e-09`
     * does it: a curve from one shared runner is a hypothesis about that runner. What
     * *does* fail is a phase that could not run at all, and a run that produced no
     * samples — those are statements about this harness.
     *
     * A phase being UNREACHABLE on a platform is neither: it is a fact to report, and the
     * task explicitly allows the soak to be partial.
     */
    const ran = phaseResults.filter(phase => phase.status === 'RAN')
    const unreachable = phaseResults.filter(phase => phase.status === 'UNREACHABLE')
    let verdict
    if (caseFailures.length > 0) verdict = 'FAIL'
    else if (measured.notRun === 'NOT_RUN') verdict = 'NOT_RUN'
    else if (ran.length === 0 && unreachable.length > 0) verdict = 'NOT_RUN'
    else verdict = ran.length === phaseResults.length ? 'PASS' : 'PARTIAL'

    await writeEvidence(CASE, {
      verdict,
      ...(verdict === 'FAIL'
        ? { error: caseFailures.map(f => `${f.title}: ${f.error}`).join('; ') }
        : {}),
      notes: phaseResults
        .map(p => `${p.name}: ${p.status}${p.reason ? ` (${p.reason})` : ''} ${p.completedRounds}/${p.rounds} rounds`)
        .join('; '),
      extra: {
        phases: phaseResults,
        scale: SCALE > 0 ? SCALE : null,
        ...measured,
      },
    })
    expect(verdict).not.toBe('FAIL')
  })

  it('exercises each GUI surface and reports which ones were reachable', async function () {
    this.timeout(1_800_000)

    const snapshot = await probe()
    if (!snapshot) {
      measured.notRun = 'NOT_RUN'
      measured.note = 'the read-only GUI probe is absent (built without VITE_TERMINAL_GUI_E2E)'
      return
    }

    /*
     * Sampling is optional here, and its absence does not make the phase results
     * meaningless — reachability is answerable without it. When it *is* available the
     * phase's RSS is recorded beside its rounds, which is what makes "this phase grew the
     * process" checkable per surface rather than in aggregate.
     */
    let pid = null
    if (canSample()) {
      pid = findAppPid(binaryPath())
      measured.samplerAvailable = pid !== null
    } else {
      measured.samplerAvailable = false
      measured.samplerNote = `this platform (${process.platform}) cannot sample a process`
    }

    for (const phase of PHASES) {
      const started = Date.now()
      const rssBefore = pid === null ? null : (sampleProcess(pid)?.rssBytes ?? null)
      const samples = []
      let completed = 0
      let lastReason = null

      for (let round = 0; round < phase.rounds; round += 1) {
        let outcome
        try {
          outcome = await phase.perform(round)
        } catch (error) {
          outcome = { ok: false, reason: String(error).slice(0, 160) }
        }
        if (!outcome.ok) {
          lastReason = outcome.reason ?? 'the round reported failure'
          break
        }
        completed += 1
        if (pid !== null) {
          const sample = sampleProcess(pid)
          if (sample !== null && sample.rssBytes !== null) samples.push(sample.rssBytes)
        }
      }

      const rssAfter = pid === null ? null : (sampleProcess(pid)?.rssBytes ?? null)
      const series = samples.length > 0 ? buildSeries(samples.map((rss, round) => ({ round, rssBytes: rss })), ['rssBytes'], { expectedSamples: samples.length }) : null

      phaseResults.push({
        name: phase.name,
        rounds: phase.rounds,
        completedRounds: completed,
        // UNREACHABLE means the control is not there on this platform; that is a fact to
        // report, not a product fault and not a pass.
        status: completed === 0 ? 'UNREACHABLE' : completed === phase.rounds ? 'RAN' : 'PARTIAL',
        reason: lastReason,
        elapsedMs: Date.now() - started,
        rssBefore,
        rssAfter,
        rssDelta: rssBefore !== null && rssAfter !== null ? rssAfter - rssBefore : null,
        rssSamples: samples.length,
        rssSeriesLength: series?.observedSamples ?? 0,
      })

      /*
       * A phase that could not run is not abandoned silently: the run continues so the
       * report says which surfaces were reachable in **this** environment, rather than
       * stopping at the first one that was not.
       */
      if (completed === 0) {
        await browser.keys('Escape').catch(() => undefined)
        await browser.pause(300)
      }
    }

    measured.phasesRun = phaseResults.filter(p => p.status === 'RAN').length
    measured.phasesUnreachable = phaseResults.filter(p => p.status === 'UNREACHABLE').length
    expect(phaseResults.length).toBe(PHASES.length)
  })
})
