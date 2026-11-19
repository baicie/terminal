// E2E-05 — a snippet, from a real selection to a row that survives a close.
//
// ## What this answers that the component tests cannot
//
// `snippet-dock-view.test.tsx` and `snippet-draft-save.test.ts` prove the pieces: the
// capture stores a draft, the save validates its input, `createSnippet` writes a row.
// Every one of them stops at a seam. What none can show is that the seams line up in
// the real app — that text selected in a live terminal reaches the dock, that the name
// the user types is what lands in SQLite, and that closing and reopening the dock
// shows the row rather than an empty list.
//
// The design calls this out: prior audits in this repo found three features whose
// tests passed at every hop while the chain was broken between them.
//
// ## Why it reads the database rather than the DOM
//
// A row in the dock's list proves the dock re-read *something*. This spec queries the
// app's own SQLite file directly, by the name the user typed, so "the snippet was
// saved" means a row exists — not that a React state update happened.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { browser } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'

const CASE = 'e2e-05'

/** A name no other run would produce, so the row can only be this run's. */
const SNIPPET_NAME = `e2e-05 probe ${Date.now()}`

/** The text typed into the terminal and selected back out of it. */
const PAYLOAD = 'echo e2e-05-selection-marker'

async function goTo(pathname) {
  await browser.execute(target => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, pathname)
  await browser.pause(400)
}

/** Open a command-palette row by exact title, waiting for the rows to exist. */
async function runPaletteAction(title) {
  await browser.execute(() => {
    window.dispatchEvent(new CustomEvent('shortcut:command-palette'))
  })
  const deadline = 10_000
  const started = Date.now()
  let clicked = false
  let labels = []
  while (Date.now() - started < deadline) {
    const result = await browser.execute(wanted => {
      const rows = Array.from(document.querySelectorAll('[role="option"]'))
      const texts = rows.map(row =>
        (row.querySelector('div > div')?.textContent ?? row.textContent ?? '').trim(),
      )
      const index = texts.findIndex(text => text === wanted)
      if (index < 0) return { clicked: false, labels: texts }
      rows[index].click()
      return { clicked: true, labels: texts }
    }, title)
    labels = result.labels
    if (result.clicked) {
      clicked = true
      break
    }
    await browser.pause(100)
  }
  await browser.pause(500)
  return { clicked, labels, waitedMs: Date.now() - started }
}

/**
 * Flip an extension switch to a target state and wait for it to settle.
 *
 * A real WebDriver click on the trigger — a script `.click()` does not switch a Radix
 * control, which this suite already learned twice. Returns the resulting `data-state`.
 */
async function toggleSwitch(selector, target) {
  const deadline = 10_000
  const started = Date.now()
  let state = null
  const wanted = target === 'on' ? ['checked', 'true'] : ['unchecked', 'false']
  while (Date.now() - started < deadline) {
    state = await browser.execute(sel => {
      const el = document.querySelector(sel)
      return el ? el.getAttribute('data-state') ?? el.getAttribute('aria-checked') : null
    }, selector)
    if (state && wanted.includes(state)) return state
    await browser.$(selector).click()
    await browser.pause(600)
  }
  return state
}

describe('a snippet survives the round trip a user makes', () => {
  const notes = []
  const failures = []
  let currentCase = 'unknown case'

  function check(condition, message) {
    if (!condition) {
      failures.push({ title: currentCase, error: message })
      throw new Error(message)
    }
  }

  beforeEach(function () {
    currentCase = this?.currentTest?.title ?? 'unknown case'
  })

  afterEach(function () {
    if (this?.currentTest?.state !== 'failed') return
    const title = this.currentTest.title ?? currentCase
    if (failures.some(entry => entry.title === title)) return
    failures.push({
      title,
      error: `case failed without reaching an assertion (${title})`,
    })
  })

  before(async () => {
    await browser.$('[data-testid="activity-rail"]').waitForExist({ timeout: 20_000 })
    await browser.setWindowSize(1440, 900)
    const state = await browser.execute(() => ({
      canvas: document.querySelector('[data-terminal-canvas]') !== null,
    }))
    if (!state.canvas) await goTo('/terminal')
    await browser.pause(500)
  })

  it('enables the extension through Settings, because it is off by default', async () => {
    /*
     * The extension ships `defaultEnabled: false` — measured: opening the dock before
     * this case rendered "The snippet dock is turned off. Enable it in Settings."
     *
     * So the flow a user actually performs starts here, not at the dock. Driving the
     * real Settings switch (rather than flipping the registry from the console) is the
     * point: the dock's own empty state says to do this, and nothing had ever verified
     * that doing it works.
     */
    await goTo('/settings')
    // Settings is a lazy route: the tablist only exists after its chunk loads.
    await browser.$('[role="tablist"]').waitForExist({ timeout: 20_000 })
    const diagnostics = await browser.execute(() => ({
      url: location.pathname,
      tabs: Array.from(document.querySelectorAll('[role="tab"]')).map(tab =>
        (tab.textContent ?? '').trim(),
      ),
      switches: Array.from(document.querySelectorAll('[id^="extension-"]')).map(el => el.id),
    }))
    notes.push(`settings diagnostics: ${JSON.stringify(diagnostics)}`)

    // A script `.click()` on a Radix trigger does not switch it — the same lesson the
    // palette case learned. WebDriver's own click dispatches the real pointer sequence.
    const tabSelector = '[role="tab"]'
    const tabIndex = await browser.execute(sel => {
      const tabs = Array.from(document.querySelectorAll(sel))
      return tabs.findIndex(tab => /extension/i.test(tab.textContent ?? ''))
    }, tabSelector)
    check(tabIndex >= 0, 'no Extensions tab in Settings')
    const tabElements = await browser.$$(tabSelector)
    await tabElements[tabIndex].click()
    await browser.pause(800)

    const switchSelector = '#extension-snippet-dock'
    await browser
      .$(switchSelector)
      .waitForExist({ timeout: 15_000 })
      .catch(async () => {
        const after = await browser.execute(() => ({
          switches: Array.from(document.querySelectorAll('[id^="extension-"]')).map(el => el.id),
          panel: (document.querySelector('[role="tabpanel"]')?.textContent ?? '').slice(0, 300),
        }))
        notes.push(`switch never appeared: ${JSON.stringify(after)}`)
        throw new Error(`no extension switch after switching tabs: ${JSON.stringify(after)}`)
      })
    const before = await browser.execute(sel => {
      const el = document.querySelector(sel)
      return el ? el.getAttribute('data-state') ?? el.getAttribute('aria-checked') : null
    }, switchSelector)
    notes.push(`extension switch before: ${JSON.stringify(before)}`)

    if (before !== 'checked' && before !== 'true') {
      await browser.$(switchSelector).click()
      await browser.pause(600)
    }

    const after = await browser.execute(sel => {
      const el = document.querySelector(sel)
      return el ? el.getAttribute('data-state') ?? el.getAttribute('aria-checked') : null
    }, switchSelector)
    notes.push(`extension switch after: ${JSON.stringify(after)}`)
    check(
      after === 'checked' || after === 'true',
      `the extension did not turn on: switch reports ${JSON.stringify(after)}`,
    )

    // Ask the runtime itself, not the switch: a switch that renders "checked" while
    // the registry disagrees is exactly the kind of split this spec should catch.
    const runtime = await browser.execute(() => {
      const probe = window.__terminalGuiE2E
      return probe?.extensionSnapshot ? probe.extensionSnapshot() : { unsupported: true }
    })
    notes.push(`runtime after enabling: ${JSON.stringify(runtime)}`)
    /*
     * Assert the registry, not the switch.
     *
     * The first version only recorded this snapshot. It was in the evidence file and
     * looked like a check, but nothing compared it — so on a CI run where the switch
     * flipped and the registry stayed empty, this case reported ✓ and the next three
     * failed with "the terminal context menu offers no extension entry" and a dock
     * that still said "turned off".
     *
     * The switch rendering "checked" while `registry.list()` disagrees is the defect
     * this spec exists to catch, and recording it without asserting it made the spec
     * blind to exactly that.
     */
    check(
      Array.isArray(runtime?.active) && runtime.active.includes('snippet-dock'),
      `the extension is not active after enabling it: ${JSON.stringify(runtime)}`,
    )
    check(
      Array.isArray(runtime?.menus) && runtime.menus.includes('snippet-dock.capture-selection'),
      `no terminal.context menu was contributed: ${JSON.stringify(runtime)}`,
    )
    check(
      runtime?.snippetDockHandle === true,
      `the dock has no handle, so it renders its "turned off" state: ${JSON.stringify(runtime)}`,
    )

    await goTo('/terminal')
    await browser.pause(500)
  })

  it('captures the terminal selection into the dock as a draft', async () => {
    // 1. Put known text on the terminal, then select it the way a user does — with
    //    xterm's own selection API against the real buffer, not by injecting a string
    //    into the store. The dock's capture path calls `readSelectedText()`, so a
    //    selection made any other way would not exercise it.
    const typed = await browser.execute(text => {
      const probe = window.__terminalGuiE2E
      if (!probe?.typeIntoActiveTerminal) return { ok: false, reason: 'no probe' }
      probe.typeIntoActiveTerminal(`${text}\r`)
      return { ok: true }
    }, PAYLOAD)
    check(typed.ok, `could not type into the terminal: ${JSON.stringify(typed)}`)
    await browser.pause(900)

    const selected = await browser.execute(wanted => {
      const probe = window.__terminalGuiE2E
      if (!probe?.selectTextInActiveTerminal) {
        return { ok: false, reason: 'the GUI probe has no selection helper' }
      }
      return probe.selectTextInActiveTerminal(wanted)
    }, PAYLOAD)
    notes.push(`selection: ${JSON.stringify(selected)}`)
    check(selected.ok, `could not select the payload: ${JSON.stringify(selected)}`)

    // 2. Open the dock through the palette — the reachable entry point, not a store
    //    write a test made.
    const opened = await runPaletteAction('Open the snippet dock')
    check(opened.clicked, `the snippet dock command is missing: ${JSON.stringify(opened)}`)
    const dockPresent = await browser.$('[data-testid="snippet-dock"]').isExisting()
    check(dockPresent, 'the dock reported open but rendered no body')

    /*
     * The registry at the moment of the capture, not only back on the Settings page.
     *
     * The enabling case asserts the registry right after the switch flips, and that
     * passed on a run where this case failed with "the terminal context menu offers no
     * extension entry" — the menu's items come from the same registry, so either it
     * lost the activation between the two cases or the menu rendered from something
     * else. Recording it here makes those two hypotheses distinguishable in the
     * evidence instead of leaving a plausible story in their place.
     */
    const runtimeHere = await browser.execute(() => {
      const probe = window.__terminalGuiE2E
      return probe?.extensionSnapshot ? probe.extensionSnapshot() : { unsupported: true }
    })
    notes.push(`runtime before capture: ${JSON.stringify(runtimeHere)}`)
    check(
      Array.isArray(runtimeHere?.menus) &&
        runtimeHere.menus.includes('snippet-dock.capture-selection'),
      `the extension lost its contribution before the capture: ${JSON.stringify(runtimeHere)}`,
    )

    // 3. Capture through the **terminal context menu** — the surface the extension
    //    registers into. Before this batch the contribution was stored and never
    //    rendered: the menu had Copy/Paste/Select All/Clear/Search/Font and nothing
    //    else, so with the dock open and text selected a user had no way to capture.
    //    Reaching it through the palette would not have exercised that gap.
    /*
     * Open the menu the way the trigger listens.
     *
     * Measured twice: `surface.click({button: 'right'})` on `[data-terminal-canvas]`
     * and on `.xterm` both produced an empty menu — xterm installs its own
     * `contextmenu` handling on the canvas and the event never reached Radix's
     * trigger. Dispatching `contextmenu` on the element the trigger wraps is what the
     * browser does when the user right-clicks there, and it exercises the same
     * `onContextMenu` path; the difference is only who synthesises it.
     *
     * This is weaker than a real pointer sequence and is recorded as such: the
     * evidence says the menu was opened by a dispatched event.
     */
    const menuOpened = await browser.execute(() => {
      /*
       * The terminal's trigger, not the tab strip's.
       *
       * `[data-slot="context-menu-trigger"]` is not unique — the tab strip uses the same
       * primitive, and `querySelector` returned that one first. Measured: the "terminal"
       * menu came back as ["Move Left", "Split Vertical", "Close Tab"].
       *
       * Walking up from `.xterm` finds the boundary that actually wraps the terminal.
       */
      const host = document.querySelector('.xterm')
      const trigger = host?.closest('[data-slot="context-menu-trigger"]') ?? host
      if (!trigger) {
        return {
          ok: false,
          reason: 'no trigger',
          slots: Array.from(document.querySelectorAll('[data-slot]')).map(el =>
            el.getAttribute('data-slot'),
          ),
        }
      }
      trigger.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 40,
          clientY: 40,
        }),
      )
      return { ok: true, tag: trigger.className }
    })
    notes.push(`context menu opened: ${JSON.stringify(menuOpened)}`)
    await browser.pause(800)
    const domAfter = await browser.execute(() => ({
      menus: document.querySelectorAll('[role="menu"]').length,
      menuItems: document.querySelectorAll('[role="menuitem"]').length,
      anyRole: Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]')).length,
      bodyTail: (document.body.textContent ?? '').slice(-200),
    }))
    notes.push(`dom after dispatch: ${JSON.stringify(domAfter)}`)

    const menu = await browser.execute(() => {
      const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
      return { labels: items.map(item => (item.textContent ?? '').trim()) }
    })
    notes.push(`context menu: ${JSON.stringify(menu)}`)
    /*
     * Match the contribution's own title, not a guessed verb.
     *
     * The first version looked for `/capture/i`; the product's label is "Save
     * selection as a snippet draft" and contains no such word, so the case failed on a
     * menu that was correct. Read from the command's `titleKey`, which is what the
     * registry hands the host.
     */
    const entry = menu.labels.find(label => /snippet/i.test(label) && /draft/i.test(label))
    check(
      entry !== undefined,
      `the terminal context menu offers no extension entry: ${JSON.stringify(menu.labels)}`,
    )

    const captured = await browser.execute(() => {
      const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
      const capture = items.find(item => {
        const text = item.textContent ?? ''
        return /snippet/i.test(text) && /draft/i.test(text)
      })
      if (!capture) return { ok: false }
      capture.click()
      return { ok: true }
    })
    check(captured.ok, 'the capture entry vanished between read and click')
    await browser.$('[data-testid="snippet-draft"]').waitForExist({ timeout: 5_000 })

    const draftText = await browser.execute(() => {
      const draft = document.querySelector('[data-testid="snippet-draft"] pre')
      return (draft?.textContent ?? '').trim()
    })
    notes.push(`draft text: ${JSON.stringify(draftText)}`)
    check(
      draftText.includes(PAYLOAD),
      `the draft does not contain what was selected: ${JSON.stringify(draftText)}`,
    )
  })

  it('saves the named draft and the row is readable from the database', async () => {
    // The write has to land in the same SQLite the app uses, found by the name the
    // user typed. Anything weaker ("the list refreshed") passes on a render.
    const nameField = await browser.$('#snippet-draft-name')
    check(await nameField.isExisting(), 'the draft has no name field to type into')
    await nameField.setValue(SNIPPET_NAME)

    const saved = await browser.execute(() => {
      const draft = document.querySelector('[data-testid="snippet-draft"]')
      if (!draft) return { ok: false }
      const buttons = Array.from(draft.querySelectorAll('button'))
      const save = buttons.find(button => /save/i.test(button.textContent ?? ''))
      if (!save) return { ok: false, labels: buttons.map(b => (b.textContent ?? '').trim()) }
      save.click()
      return { ok: true }
    })
    check(saved.ok, `no save button in the draft: ${JSON.stringify(saved)}`)
    await browser.pause(1_200)

    const failure = await browser.execute(() => {
      const alert = document.querySelector('[data-testid="snippet-draft"] [role="alert"]')
      return alert ? (alert.textContent ?? '').trim() : null
    })
    check(failure === null, `the dock reported a save failure: ${failure}`)

    // Through the app's own database module, via a read-only hook the GUI build
    // installs. A dynamic `import()` from inside `execute` fails over Tauri's custom
    // protocol — measured: `'text/html' is not a valid JavaScript MIME type`.
    const row = await browser.executeAsync(async (name, done) => {
      const probe = window.__terminalGuiE2E
      if (!probe?.findSnippetByName) {
        done({ ok: false, error: 'the GUI probe cannot query the database' })
        return
      }
      done(await probe.findSnippetByName(name))
    }, SNIPPET_NAME)
    notes.push(`database lookup: ${JSON.stringify(row)}`)
    check(
      row.ok && Array.isArray(row.rows) && row.rows.length === 1,
      `expected exactly one snippets row named "${SNIPPET_NAME}": ${JSON.stringify(row)}`,
    )
    check(
      String(row.rows[0].script ?? '').includes(PAYLOAD),
      `the stored script is not what was selected: ${JSON.stringify(row.rows[0])}`,
    )
  })

  it('the saved snippet is still there after closing and reopening the dock', async () => {
    // Reopening is what a user does next. A dock that shows its list only because it
    // never unmounted would pass the previous case and fail this one.
    const closed = await browser.execute(() => {
      const button = document.querySelector('[data-testid="right-panel-close"]')
      if (button) {
        button.click()
        return 'close button'
      }
      const rail = document.querySelector('[data-testid="rail-sftp"]')
      if (rail && rail.getAttribute('aria-pressed') === 'true') {
        rail.click()
        return 'rail toggle'
      }
      return null
    })
    check(closed !== null, 'could not close the dock to test reopening')
    await browser.pause(600)
    check(
      !(await browser.$('[data-testid="snippet-dock"]').isExisting()),
      'the dock did not close, so reopening proves nothing',
    )

    const reopened = await runPaletteAction('Open the snippet dock')
    check(reopened.clicked, `could not reopen the dock: ${JSON.stringify(reopened)}`)
    await browser.$('[data-testid="snippet-dock"]').waitForExist({ timeout: 5_000 })

    const listed = await browser.execute(name => {
      const dock = document.querySelector('[data-testid="snippet-dock"]')
      return {
        present: (dock?.textContent ?? '').includes(name),
        text: (dock?.textContent ?? '').slice(0, 400),
      }
    }, SNIPPET_NAME)
    notes.push(`after reopen: ${JSON.stringify(listed)}`)
    check(
      listed.present,
      `the snippet saved in the previous case is not in the reopened dock: ${JSON.stringify(listed.text)}`,
    )
  })

  /*
   * Turning it off and on again, through the switch a user actually clicks.
   *
   * Task E names this sequence explicitly, and it is where two defects lived at once:
   * the toggle applied the new list without persisting it, so anything that re-applied
   * the stored list put the registry back to the old value with the switch still
   * rendering "on". A case that only ever turns the switch on cannot see that.
   */
  it('survives being switched off and on again, and the choice is persisted', async () => {
    await goTo('/settings')
    await browser.$('[role="tablist"]').waitForExist({ timeout: 20_000 })
    const tabIndex = await browser.execute(sel => {
      const tabs = Array.from(document.querySelectorAll(sel))
      return tabs.findIndex(tab => /extension/i.test(tab.textContent ?? ''))
    }, '[role="tab"]')
    check(tabIndex >= 0, 'no Extensions tab in Settings')
    await browser.$$('[role="tab"]')[tabIndex].click()
    await browser.pause(800)

    const switchSelector = '#extension-snippet-dock'
    await browser.$(switchSelector).waitForExist({ timeout: 15_000 })

    const off = await toggleSwitch(switchSelector, 'off')
    notes.push(`switch off: ${JSON.stringify(off)}`)
    check(off === 'unchecked', `the extension did not turn off: switch reports ${JSON.stringify(off)}`)
    const runtimeOff = await browser.execute(
      () => window.__terminalGuiE2E?.extensionSnapshot?.() ?? {},
    )
    notes.push(`runtime while off: ${JSON.stringify(runtimeOff)}`)
    check(
      !(Array.isArray(runtimeOff?.active) && runtimeOff.active.includes('snippet-dock')),
      `the switch is off but the extension is still active: ${JSON.stringify(runtimeOff)}`,
    )

    const on = await toggleSwitch(switchSelector, 'on')
    notes.push(`switch on: ${JSON.stringify(on)}`)
    check(on === 'checked', `the extension did not turn back on: switch reports ${JSON.stringify(on)}`)

    /*
     * The choice must be in SQLite, not only in the registry.
     *
     * This is the half the old toggle was missing, and reading the registry would not
     * reveal it: the registry was correct right up until something re-applied the
     * stored (stale) list. The app setting is the durable record.
     */
    const stored = await browser.executeAsync(async done => {
      const probe = window.__terminalGuiE2E
      if (!probe?.readSetting) {
        done({ ok: false, reason: 'the GUI probe cannot read app settings' })
        return
      }
      done(await probe.readSetting('app_settings'))
    })
    const ids = stored?.value?.enabledExtensions
    notes.push(`stored enabledExtensions: ${JSON.stringify(ids)}`)
    check(
      Array.isArray(ids) && ids.includes('snippet-dock'),
      `the switch is on but app_settings does not list it: ${JSON.stringify(stored)}`,
    )

    await goTo('/terminal')
    await browser.pause(600)
    const runtimeBack = await browser.execute(
      () => window.__terminalGuiE2E?.extensionSnapshot?.() ?? {},
    )
    notes.push(`runtime after re-enable: ${JSON.stringify(runtimeBack)}`)
    check(
      Array.isArray(runtimeBack?.menus) &&
        runtimeBack.menus.includes('snippet-dock.capture-selection'),
      `the extension lost its contribution after a disable/enable cycle: ${JSON.stringify(runtimeBack)}`,
    )
  })

  it('closing the dock leaves the same PTY able to run a command', async () => {
    // The design's rule — closing a dock is a presentation change — verified by
    // running a command afterwards and reading its output back, not by checking that
    // an `.xterm` element is still in the DOM. A torn-down PTY can leave the element
    // behind; it cannot echo.
    const token = `e2e05-${Date.now()}`
    const echoed = await browser.executeAsync(async (marker, done) => {
      const probe = window.__terminalGuiE2E
      if (!probe?.typeIntoActiveTerminal || !probe?.readActiveTerminalTail) {
        done({ ok: false, reason: 'the GUI probe cannot drive the terminal' })
        return
      }
      probe.typeIntoActiveTerminal(`echo ${marker}\r`)
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 250))
        const tail = probe.readActiveTerminalTail()
        if (typeof tail === 'string' && tail.includes(marker)) {
          done({ ok: true, tail: tail.slice(-200) })
          return
        }
      }
      done({ ok: false, reason: 'the marker never came back', tail: probe.readActiveTerminalTail() })
    }, token)
    notes.push(`pty after dock close: ${JSON.stringify(echoed)}`)
    check(
      echoed.ok,
      `the shell did not echo after the dock closed: ${JSON.stringify(echoed)}`,
    )
  })

  after(async () => {
    const GAPS = []
    for (const gap of GAPS) notes.push(`NOT_RUN ${gap.id}: ${gap.reason} (needs ${gap.needs})`)

    const notRunCount = notes.filter(note => note.includes('NOT_RUN')).length
    const verdict = failures.length > 0 ? 'FAIL' : notRunCount > 0 ? 'PARTIAL' : 'PASS'
    await writeEvidence(CASE, {
      verdict,
      notes: notes.join('\n'),
      error:
        failures.length > 0
          ? failures.map(f => `${f.title}: ${f.error}`).join('\n')
          : undefined,
      extra: { failures, notRunCount, gaps: GAPS, snippetName: SNIPPET_NAME },
    })
  })
})
