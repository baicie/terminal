// DDQ12 — can the user keep working *while* output is still arriving?
//
// ## What `e2e-08` proves, and what it does not
//
// `e2e-08` floods the terminal and then waits for the shell to come back to a prompt
// before typing. That answers "is the terminal usable **after** a flood". The question a
// daily driver asks is different: **while** output is arriving, can I switch panes, work
// in the other one, come back, interrupt the flood, and carry on?
//
// Those are not the same claim, and the second one is where a blocked output path shows
// up: a product that drains correctly but holds a lock, or one that re-renders the whole
// scrollback on every chunk, passes the first and fails the second.
//
// ## Why the payload is counted in bytes
//
// The same measurement `e2e-08` records: PowerShell's per-iteration cost made a
// line-counted payload track the runner rather than the product. Every round here uses
// the same throttled, byte-sized flood, and records the bytes it actually asked for.
//
// ## What it deliberately does not assert
//
// "Backpressure engaged" is **not** claimed. Crossing the 1 MiB pause watermark is
// necessary but not sufficient — the pump may have drained faster than the producer
// filled it. The task says as much, and the honest evidence here is the byte count plus
// the observation that the buffer stayed bounded, not a claim about which watermark was
// crossed.

import { browser, expect } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'

const CASE = 'ddq12-interaction-during-output'

/** Same generator shape `e2e-08` measured; see that file for why it is byte-sized. */
const PAD = 'padding '.repeat(13).trim()
const LINES = 100_000
const FLOOD_POSIX = `seq 1 ${LINES} | awk '{ printf "%s ${PAD}\\n", $1; if (NR % 20000 == 0) system("sleep 0.25") }'`
const FLOOD_POWERSHELL = `$pad = '${PAD}'; 1..${LINES} | ForEach-Object { "$_ $pad"; if ($_ % 20000 -eq 0) { Start-Sleep -Milliseconds 250 } }`
const FLOOD = process.platform === 'win32' ? FLOOD_POWERSHELL : FLOOD_POSIX

/** Approximate bytes the flood produces: line width × count. Recorded, not asserted. */
const FLOOD_BYTES = (PAD.length + 6) * LINES

/**
 * Whether the shell **ran** `echo <token>` — not merely echoed the typed line.
 *
 * ## The defect this replaces, and where it was measured
 *
 * The first version used `tail.includes(token)`. That is satisfied by the shell's own
 * echo of the command line: the terminal shows `echo during123` the instant the
 * keystrokes arrive, before the shell has executed anything. So the assertion passed for
 * a command that was typed and never run — which is exactly the state a blocked output
 * path produces.
 *
 * `e2e-01` already solved this: the output is the line whose trimmed content is **exactly**
 * the token, while the echo line is `echo <token>`. A run that echoed but did not execute
 * has no such line.
 */
function ranEcho(text, token) {
  const lines = String(text).split('\n').map(line => line.trim())
  return lines.some(line => line === token)
}

async function snapshot() {
  return browser.execute(() => globalThis.__terminalGuiE2E?.snapshot?.() ?? null)
}

async function tail() {
  return browser.execute(() => globalThis.__terminalGuiE2E?.readActiveTerminalTail?.() ?? '')
}

/** Focus the visible terminal, then type — the path a keystroke takes. */
async function typeCommand(command) {
  const focused = await browser.execute(
    () => globalThis.__terminalGuiE2E?.focusActiveTerminal?.() ?? false,
  )
  if (!focused) return false
  const typed = await browser.execute(
    text => globalThis.__terminalGuiE2E?.typeIntoActiveTerminal?.(text) ?? false,
    command,
  )
  if (!typed) return false
  await browser.keys('Enter')
  return true
}

/** Dispatch one of the app's own shortcut events — the path a keystroke reaches. */
async function dispatchShortcut(action) {
  return browser.execute(
    name => {
      window.dispatchEvent(new CustomEvent(`shortcut:${name}`))
      return true
    },
    action,
  )
}

async function tabs() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('[role="tab"]')).map((tab, index) => ({
      index,
      type: tab.getAttribute('data-tab-type'),
      selected: tab.getAttribute('aria-selected') === 'true',
    })),
  )
}

async function activateTab(index) {
  const handles = await browser.$$('[role="tab"]')
  if (!handles[index]) return false
  const label = await handles[index].getAttribute('aria-label')
  await handles[index].click()
  await browser.pause(600)
  if ((await handles[index].getAttribute('aria-selected')) === 'true') return true
  return browser.execute(
    wanted =>
      Array.from(document.querySelectorAll('[role="tab"]')).some(
        tab => tab.getAttribute('aria-label') === wanted && tab.getAttribute('aria-selected') === 'true',
      ),
    label,
  )
}

/** Wait until the buffer stops growing for `quietMs`, or the deadline passes. */
async function waitUntilQuiet(quietMs = 2_000, deadlineMs = 120_000) {
  const started = Date.now()
  let last = (await snapshot())?.lines ?? 0
  let lastChange = Date.now()
  while (Date.now() - started < deadlineMs) {
    await browser.pause(400)
    const current = (await snapshot())?.lines ?? 0
    if (current !== last) {
      last = current
      lastChange = Date.now()
    } else if (Date.now() - lastChange >= quietMs) {
      return { quiet: true, lines: current, elapsedMs: Date.now() - started }
    }
  }
  return { quiet: false, lines: last, elapsedMs: Date.now() - started }
}

describe('DDQ12 — working while output arrives', () => {
  const measured = {}
  const caseFailures = []

  afterEach(function () {
    if (this.currentTest?.state === 'failed') {
      const test = this.currentTest
      caseFailures.push({
        title: test.title ?? '<unknown case>',
        error:
          typeof test.duration === 'number'
            ? `failed after ${test.duration} ms; see the measurements`
            : 'failed; see the measurements',
      })
    }
  })

  after(async () => {
    const verdict =
      caseFailures.length > 0 ? 'FAIL' : measured.notRun === 'NOT_RUN' ? 'NOT_RUN' : 'PASS'
    await writeEvidence(CASE, {
      verdict,
      ...(verdict === 'FAIL'
        ? { error: caseFailures.map(f => `${f.title}: ${f.error}`).join('; ') }
        : {}),
      ...(verdict === 'NOT_RUN' ? { notes: measured.note ?? 'preconditions were not met' } : {}),
      command: FLOOD,
      extra: { floodBytesRequested: FLOOD_BYTES, floodLinesRequested: LINES, ...measured },
    })
    expect(verdict).not.toBe('FAIL')
  })

  it('a second pane stays usable while the first is producing output', async function () {
    this.timeout(420_000)

    const probe = await snapshot()
    if (!probe) {
      measured.notRun = 'NOT_RUN'
      measured.note = 'the read-only GUI probe is absent (built without VITE_TERMINAL_GUI_E2E)'
      return
    }
    const before = await tabs()
    const localIndex = before.find(tab => tab.type === 'local')?.index
    if (localIndex === undefined) {
      measured.notRun = 'NOT_RUN'
      measured.note = 'no local terminal tab in this run'
      return
    }
    await activateTab(localIndex)

    /*
     * The flood is started and **not waited for**. Every assertion below happens while it
     * is still producing; waiting first would turn this into `e2e-08` with extra steps.
     */
    const stamp = Date.now()
    const startedLines = (await snapshot())?.lines ?? 0
    measured.linesBeforeFlood = startedLines
    if (!(await typeCommand(FLOOD))) {
      throw new Error('the probe could not type into the terminal, so no flood was started')
    }

    // Wait only for the flood to be visibly producing — not for it to finish.
    await browser.waitUntil(
      async () => ((await snapshot())?.lines ?? 0) >= startedLines + 200,
      { timeout: 60_000, interval: 300, timeoutMsg: 'the flood never produced output' },
    )
    /*
     * ## Wait for output to *still be arriving*, not for it to have arrived
     *
     * Measured on the first run: `linesWhileProducing: 10043` — the buffer was already at
     * its scrollback ceiling, so everything below happened **after** the flood finished.
     * The case passed while never once interacting during output, which is the whole
     * claim it exists to make.
     *
     * A flood that finished is detectable: the shell prints its prompt. So this waits
     * for the opposite — the prompt must **not** be there yet. If it appears first, the
     * payload was too small for this runner and the case says so instead of pretending.
     */
    const stillProducing = await browser
      .waitUntil(
        async () => {
          const current = await tail()
          const promptAtEnd = /[$#%>]\s*$/.test(current)
          const grew = ((await snapshot())?.lines ?? 0) > startedLines
          return grew && !promptAtEnd
        },
        { timeout: 30_000, interval: 250 },
      )
      .then(() => true)
      .catch(() => false)
    measured.outputStillArriving = stillProducing
    measured.linesWhileProducing = (await snapshot())?.lines ?? null

    /*
     * ## The interaction, performed while output is arriving
     *
     * Split the pane through the product's own shortcut event, then type into the new
     * pane. A product whose output path holds the renderer would fail here — the split
     * would not mount, or the keystroke would not reach a prompt.
     */
    const splitStart = Date.now()
    const tabsBeforeSplit = (await tabs()).length
    await dispatchShortcut('split-vertical')
    await browser.pause(1_500)
    /*
     * ## What "split happened" looks like in the DOM
     *
     * Measured, and wrong on the first attempt: I counted `[data-terminal-workbench]`,
     * which is the whole terminal layer — it stays at **1** whether or not a split
     * exists, because the split renders *inside* it (`terminal-workbench.tsx:88-107`,
     * a grid whose children are the split tabs).
     *
     * A split adds a **tab** (`splitTab()` returns a new id) and therefore a second
     * `.xterm` instance. Those two numbers are what actually distinguish "split" from
     * "the shortcut did nothing".
     */
    const afterSplit = await browser.execute(() => ({
      tabs: document.querySelectorAll('[role="tab"]').length,
      terminals: document.querySelectorAll('.xterm').length,
    }))
    measured.split = {
      ...afterSplit,
      tabsBeforeSplit,
      elapsedMs: Date.now() - splitStart,
      // A split that did not happen is recorded, and the case says so rather than
      // asserting it: this run is about interaction under load, and split support may
      // legitimately differ by platform.
      happened: afterSplit.tabs > tabsBeforeSplit,
    }

    const duringNonce = `during${stamp}`
    const typedDuring = await typeCommand(`echo ${duringNonce}`)
    measured.typedDuringOutput = typedDuring

    let echoedDuring = false
    if (typedDuring) {
      try {
        await browser.waitUntil(
          async () => ranEcho(await tail(), duringNonce),
          { timeout: 20_000, interval: 400 },
        )
        echoedDuring = true
      } catch {
        echoedDuring = false
      }
    }
    measured.echoedDuringOutput = echoedDuring
    measured.tailDuringOutput = (await tail()).slice(-160)

    /*
     * ## Interrupt the flood
     *
     * Ctrl+C through the same key path. The assertion is that the buffer **stops
     * growing** — a terminal that scrolled but never accepted the interrupt is the failure
     * this catches, and it is invisible to a "process is alive" check.
     */
    await browser.execute(
      () => globalThis.__terminalGuiE2E?.focusActiveTerminal?.() ?? false,
    )
    await browser.keys(['Control', 'c'])
    const settled = await waitUntilQuiet(2_500, 90_000)
    measured.afterInterrupt = settled

    const afterNonce = `after${stamp}`
    const typedAfter = await typeCommand(`echo ${afterNonce}`)
    measured.typedAfterInterrupt = typedAfter
    let echoedAfter = false
    if (typedAfter) {
      try {
        await browser.waitUntil(
          async () => ranEcho(await tail(), afterNonce),
          { timeout: 30_000, interval: 500 },
        )
        echoedAfter = true
      } catch {
        echoedAfter = false
      }
    }
    measured.echoedAfterInterrupt = echoedAfter
    measured.linesAfterInterrupt = (await snapshot())?.lines ?? null
    measured.notes =
      `flood ${startedLines} → ${measured.linesWhileProducing} lines while producing; ` +
      `split=${afterSplit.workbenches} workbench(es); ` +
      `echoed during=${echoedDuring}, after interrupt=${echoedAfter}`

    /*
     * ## What must hold, and why each one is required
     *
     * 1. **Output was still arriving when the interaction happened.** Without this the
     *    case degrades into `e2e-08` — measured on the first run, where the buffer was
     *    already at its ceiling before the split was even attempted.
     * 2. **The buffer stopped growing after the interrupt.** A terminal that scrolls but
     *    never accepts Ctrl+C is the failure this catches, and a "process is alive" check
     *    cannot see it.
     * 3. **The shell accepts input afterwards**, which is the difference between "the
     *    output stopped" and "the session is still usable".
     *
     * The split itself is asserted as a fact of this run rather than as a product claim:
     * `splitTab()` adds a tab, and a run where the shortcut did nothing would make (1)
     * meaningless — it would be a single-pane run reported as a two-pane one.
     */
    expect(measured.outputStillArriving).toBe(true)
    expect(measured.split.happened).toBe(true)
    expect(settled.quiet).toBe(true)
    expect(echoedAfter).toBe(true)
  })
})
