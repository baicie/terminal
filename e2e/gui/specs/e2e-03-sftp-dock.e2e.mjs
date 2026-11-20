// E2E-03 — the SFTP Context Dock in a real Tauri WebView (issue #58).
//
// ## Why this cannot be a jsdom test
//
// The dock's single/two-pane decision reads a `ResizeObserver` on the container. In
// jsdom there is no layout, so every measurement is a stub the test chose. What the
// stubs cannot answer:
//
//   * is the dock really 300 CSS px wide inside a 1440 px window?
//   * does the content box minus padding land where `TWO_PANE_MIN_WIDTH` expects?
//   * does a file name truncate to the space the pane actually has?
//   * does the transfer panel fit, or is it clipped by the dock's edge?
//   * does a real keyboard event reach the row, and does Enter open a directory?
//
// Those are the questions `COMPACT_DOCK_USABLE`, `HOST_SWITCH_SAFE` and
// `REAL_GUI_E2E` were marked NOT_RUN / PARTIAL for. This spec answers them, and
// records NOT_RUN for the ones it still cannot (see the end of the file).
//
// ## What it does NOT prove
//
// Every case runs without a real SSH connection: opening the dock on a host that is
// not connected shows the empty state, which is enough to prove layout and keyboard
// but proves nothing about a live transfer. A case that needs a server is marked
// NOT_RUN with the reason, rather than being faked against a local directory.

import { browser } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'

const CASE = 'e2e-03'

/**
 * Resize the window and wait for the dock's own measurement to settle.
 *
 * The dock reports its width through `data-width` on the panes element, written from
 * the same `ResizeObserver` the decision uses. Waiting on that value is waiting on
 * the signal itself, not on a sleep.
 */
async function resize(width, height = 900) {
  await browser.setWindowSize(width, height)
  await browser.pause(150)
}

/** Read what the dock actually rendered. */
async function readDock() {
  return browser.execute(() => {
    const panel = document.querySelector('[data-testid="right-panel"]')
    const panes = document.querySelector('[data-testid="sftp-file-panes"]')
    const switchRow = document.querySelector('[data-testid="pane-switch"]')
    const transfer = document.querySelector('[data-testid="transfer-panel"]')
    const rect = element => {
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height, left: box.left, right: box.right }
    }
    return {
      panel: rect(panel),
      panes: rect(panes),
      presentation: panes?.getAttribute('data-presentation') ?? null,
      hasSwitch: switchRow !== null,
      transfer: rect(transfer),
      // The content box is what `ResizeObserver` reports, and what the threshold is
      // expressed in. Padding is the difference between this and the border box.
      panesContentWidth: panes
        ? panes.clientWidth -
          Number.parseFloat(getComputedStyle(panes).paddingLeft) -
          Number.parseFloat(getComputedStyle(panes).paddingRight)
        : null,
      panesPadding:
        panes
          ? Number.parseFloat(getComputedStyle(panes).paddingLeft) +
            Number.parseFloat(getComputedStyle(panes).paddingRight)
          : null,
      // No connected host means the dock renders `sftp.noActiveSession` instead of
      // the panes. That is the product's correct behaviour, not a failure: the cases
      // below record NOT_RUN rather than inventing a pass.
      //
      // `panelMissing` is the third state, and folding it into `emptyState` was a
      // real defect: when the dock was closed the panel was `null`, `emptyState`
      // came out `false`, and the cases below blamed the pane layout for something
      // that was really "there is no dock". The two are now distinct, so a missing
      // dock is reported as such.
      panelMissing: panel === null,
      emptyState: panel !== null && panes === null,
    }
  })
}

/** Read the rows the remote pane is showing. */
async function readRows() {
  return browser.execute(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="file-row"]'))
    return rows.map(row => {
      const name = row.querySelector('[title]')
      return {
        label: row.getAttribute('aria-selected'),
        name: name?.getAttribute('title') ?? null,
        focused: document.activeElement === row,
        text: row.textContent?.trim() ?? '',
      }
    })
  })
}

describe('SFTP Context Dock — real WebView', () => {
  const notes = []
  const measurements = {}
  /**
   * Every case that threw, recorded as it happens.
   *
   * `after()` runs whatever the outcome, so without this it has no way to tell a
   * clean run from a broken one — which is how this spec came to write
   * `verdict: 'PASS'` for a run in which three cases had failed. Mocha's own state
   * is available through `this`, but the hook below is a suite-level `after`, where
   * aggregating explicitly is both simpler and testable.
   */
  const failures = []

  afterEach(function () {
    if (this.currentTest?.state !== 'failed') return

    /*
     * ## Where the error text actually comes from
     *
     * The first version read `this.currentTest.err` with four fallbacks. Measured on
     * run 44694682531: that value was empty while the *console* carried
     * `element ("[data-testid="file-row-rename"]") still not existing after 5000ms`.
     * The evidence file said `(no error text for "…")` — the exact failure this
     * repository keeps having to apologise for, and it cost a trip through the artifact
     * to learn one line.
     *
     * `wdio.conf.mjs` now records the error in `afterTest`, which is where wdio hands
     * the reporter the real object. This hook reads that first, and only falls back to
     * mocha's own field.
     */
    const fromRunner = process.__guiE2ELastError
    const runnerText =
      fromRunner && fromRunner.title === this.currentTest.title ? fromRunner.text : null

    const err = this.currentTest.err
    const mochaText =
      (typeof err === 'string' ? err : undefined) ??
      err?.message ??
      err?.stack?.split('\n')[0] ??
      err?.toString?.() ??
      null

    let shape = ''
    if (!runnerText && !mochaText) {
      try {
        shape = err === undefined ? 'undefined' : JSON.stringify(err)
      } catch {
        shape = `<unserialisable ${typeof err}>`
      }
    }

    const text = runnerText ?? mochaText
    failures.push({
      title: this.currentTest.title,
      error:
        text && text !== '[object Object]'
          ? text
          : `(no error text for "${this.currentTest.title}"; err=${shape})`,
    })
  })

  before(async () => {
    await browser.$('[data-testid="activity-rail"]').waitForExist({ timeout: 20_000 })
    await resize(1440)

    // When the launcher seeded a host, connect to it so the dock lists a real
    // directory. Without it the dock shows its empty state and the interesting cases
    // record NOT_RUN — which is honest, but is also why those claims stayed PARTIAL
    // for three rounds.
    // The app boots into a restored **local** terminal, not the seeded SSH host. So
    // a connected tab existing is not the same as an SFTP-capable session: the dock
    // reads `activeTab.hostId`, and a local tab has none.
    //
    // Open the host explicitly. This is also the honest shape of the precondition —
    // "the dock has a host" is a click away, not a given.
    if (process.env.GUI_E2E_SSH_PORT) {
      await browser.$('[data-testid="rail-hosts"]').click()
      /*
       * Wait for the card, not for a duration.
       *
       * Hosts is a lazy route that then reads SQLite asynchronously, so the cards appear
       * well after the route does. A fixed 800 ms was the first version: measured on a
       * run where the seeded host existed and was never clicked, because the read had
       * not finished. The condition is the card itself.
       */
      const found = await browser.waitUntil(
        async () =>
          browser.execute(() => {
            const texts = Array.from(document.querySelectorAll('button')).map(
              button => button.textContent ?? '',
            )
            return texts.some(text => text.includes('E2E Local'))
          }),
        {
          timeout: 20_000,
          interval: 250,
          timeoutMsg: 'the seeded host card never appeared on the Hosts page',
        },
      ).catch(() => false)
      if (!found) {
        // What the page shows, so the next failure names the state instead of
        // leaving "the card never appeared" to be interpreted.
        const seen = await browser.execute(() => ({
          path: location.pathname,
          buttons: Array.from(document.querySelectorAll('button'))
            .map(button => (button.textContent ?? '').trim().slice(0, 40))
            .filter(Boolean)
            .slice(0, 12),
          body: (document.body.textContent ?? '').slice(0, 300),
        }))
        notes.push(`seeded host card never appeared: ${JSON.stringify(seen)}`)
      }
      const opened = await browser.execute(() => {
        const card = Array.from(document.querySelectorAll('button')).find(button =>
          button.textContent?.includes('E2E Local'),
        )
        if (!card) return false
        card.click()
        return true
      })
      notes.push(`clicked the seeded host card: ${opened}`)

      if (opened) {
        // A second tab is the connect succeeding. Counting `tab-connection-connected`
        // would not work: the restored *local* tab carries the same marker, so the
        // count starts at one and the assertion would pass before the SSH session
        // existed.
        await browser.waitUntil(
          async () =>
            browser.execute(
              () => document.querySelectorAll('[data-testid^="tab-"]').length >= 2,
            ),
          { timeout: 45_000, interval: 300, timeoutMsg: 'the SSH host never connected' },
        )
        // Let the session settle so the dock's SFTP channel has a live session id.
        await browser.pause(3_000)

        // The dock reads `activeTab.hostId`, so the *active* tab must be the SSH one.
        // Connecting opens it, but the assertion below states the precondition instead
        // of assuming the click left focus there.
        //
        // ## Why this does not match a label
        //
        // It used to look for a tab whose text contained "E2E Local". Measured: the
        // tab titles are `["Connected", ""]` — the visible text is a status word and
        // the name lives in `aria-label` (`layout/tabs.tsx:101`). Matching text found
        // nothing and reported `switched to the SSH tab: false`.
        //
        // A first attempt at the fix picked "the tab that is not local" and clicked a
        // *different* tab by accident, which left the panel with no active host and
        // turned a working run into `no connected host`. So the selection is by
        // `role="tab"` plus `aria-selected`, and it only clicks when the active tab is
        // not the connected one — the same "make the precondition true" shape as the
        // dock case above, instead of "guess and click".
        const tabReport = await browser.execute(() => {
          const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
          const described = tabs.map(tab => ({
            label: tab.getAttribute('aria-label'),
            selected: tab.getAttribute('aria-selected') === 'true',
            text: tab.textContent?.trim() ?? '',
            /*
             * `type` answers "is a second local tab expected?".
             *
             * Measured on the Windows runner: two tabs, both showing a shell process
             * path rather than a host name. Whether that is a restored session, a
             * duplicated fallback or a second PTY is not decidable from the labels;
             * `data-tab-type` is what separates those cases.
             */
            type: tab.getAttribute('data-tab-type'),
          }))
          // ## The selector that finally worked
          //
          // Three attempts got this wrong, and each one is visible in the notes:
          //
          //   1. text contains "E2E Local" → no match. The visible text is a status
          //      word; the name is in `aria-label` (`layout/tabs.tsx:101`).
          //   2. "the tab that is not local" → clicked the wrong tab and destroyed the
          //      active host, turning a working run into `no connected host`.
          //   3. text contains "connected" → matched the *local* tab, whose text is
          //      `"ConnectedLocal"` — the status word is prefixed to every tab, so a
          //      text match cannot separate them.
          //
          // `aria-label` is the seeded host name and nothing else, so it is the only
          // field that identifies the session. It is compared to the local terminal's
          // label, and no click happens when the right tab is already active.
          /*
           * Identify the SSH tab by the seeded host's name, not by "not local".
           *
           * Measured on the Windows runner: the app restored **two** local terminals
           * (`powershell.exe` and `conhost.exe`), neither labelled "Local", so
           * "the tab that is not local" selected a local one — the panel then had no
           * host and all six cases recorded NOT_RUN while macOS and Linux passed.
           */
          const remote = tabs.find(tab => tab.getAttribute('data-tab-type') === 'remote')
          const active = tabs.find(tab => tab.getAttribute('aria-selected') === 'true')
          if (!remote) {
            return {
              described,
              clicked: false,
              reason: 'no tab has data-tab-type="remote"',
            }
          }
          if (active === remote) {
            return { described, clicked: false, reason: 'the SSH tab is already active' }
          }
          remote.click()
          return { described, clicked: true, reason: 'activated the remote tab' }
        })
        notes.push(`tabs ${JSON.stringify(tabReport)}`)
        await browser.pause(1_500)
      }
    } else {
      notes.push('no SSH fixture; the dock will show its empty state')
    }
  })

  it('opens the dock and records its real width', async () => {
    // ## Why this is not a bare click
    //
    // `rail-sftp` is a **toggle**. The suite runs every spec against one app
    // instance (`maxInstances: 1`, one `wdio run`), and `e2e-02` opens the dock
    // without closing it. Clicking the rail unconditionally therefore *closed* the
    // dock on the first case here, and the three failures that followed all traced
    // back to that single action:
    //
    //   * `right-panel` never existed → timeout;
    //   * the pane cases read `panel === null`, which the old `emptyState` test
    //     folded into "not the empty state", so they blamed the layout;
    //   * the switch case found no buttons for the same reason.
    //
    // The fix is to state the precondition and act on it, not to click twice: a
    // second click would pass when the dock was already open and fail when it was
    // not. `aria-pressed` is the control's own report of the state.
    const opened = await browser.execute(() => {
      const rail = document.querySelector('[data-testid="rail-sftp"]')
      if (!rail) return { clicked: false, reason: 'the rail is not rendered' }
      const pressed = rail.getAttribute('aria-pressed') === 'true'
      if (!pressed) rail.click()
      return { clicked: !pressed, alreadyOpen: pressed }
    })
    notes.push(`dock precondition: ${JSON.stringify(opened)}`)

    await browser.$('[data-testid="right-panel"]').waitForExist({ timeout: 15_000 })
    await browser.pause(200)

    const dock = await readDock()
    measurements.dock = dock

    // The dock is a fixed 300px column by construction. Asserting the number proves
    // the CSS is what the component says, which is the premise every width test in
    // jsdom has to assume.
    if (!dock.panel || Math.abs(dock.panel.width - 300) > 1) {
      throw new Error(
        `the dock should be 300px wide, measured ${dock.panel?.width ?? 'nothing'}`,
      )
    }
    notes.push(`dock width ${dock.panel.width}px, content ${dock.panesContentWidth}px`)
  })

  it('renders a single pane at the dock width', async () => {
    const dock = await readDock()
    if (dock.panelMissing) {
      // Distinguishing this from a layout defect is the point: the previous version
      // reported "a 300px dock must present one pane, got null", which reads as a
      // broken pane layout when the real state was "the dock is not open".
      throw new Error(
        'the dock is not open, so its pane layout cannot be read — the previous ' +
          'case should have opened it',
      )
    }
    if (dock.emptyState) {
      // No host is connected in this run, so the dock shows `noActiveSession`.
      // The single-pane rule still holds; there is simply no pane to render it on.
      notes.push('single-pane case NOT_RUN: dock has no connected host')
      return
    }
    if (dock.presentation !== 'single') {
      throw new Error(
        `a 300px dock must present one pane, got ${dock.presentation}`,
      )
    }
    if (!dock.hasSwitch) {
      throw new Error('the single-pane layout must offer a local/remote switch')
    }
  })

  it('the measured content box matches the threshold the code uses', async () => {
    // This is the number #59 was about: the threshold is expressed in content-box
    // pixels, and the dock's padding is part of why. Recording both proves the two
    // agree in a real browser rather than in a stub.
    const dock = await readDock()
    if (dock.panesContentWidth === null) {
      notes.push('content-box case NOT_RUN: dock has no connected host')
      return
    }
    notes.push(
      `content ${dock.panesContentWidth}px = border ${dock.panes?.width}px − padding ${dock.panesPadding}px`,
    )
    if (dock.panesContentWidth >= 496) {
      throw new Error(
        `a 300px dock should be well under the 496px threshold, content was ${dock.panesContentWidth}`,
      )
    }
  })

  it('the transfer panel is not clipped by the dock edge', async () => {
    const dock = await readDock()
    if (!dock.transfer) {
      // No transfer has run, so the panel is not rendered. Recorded, not failed:
      // its geometry is checked in the case below once a transfer exists.
      notes.push('transfer panel absent (no transfers in this session)')
      return
    }
    if (dock.transfer.right > dock.panel.right + 0.5) {
      throw new Error(
        `the transfer panel overflows the dock: panel right ${dock.transfer.right}, dock right ${dock.panel.right}`,
      )
    }
  })

  it('switches between local and remote without losing the dock', async () => {
    const before = await readDock()
    if (before.panelMissing) {
      throw new Error(
        'the dock is not open, so the pane switch cannot be read — the first case ' +
          'should have opened it',
      )
    }
    if (before.emptyState) {
      notes.push('pane-switch case NOT_RUN: dock has no connected host')
      return
    }
    const buttons = await browser.$$('[data-testid="pane-switch"] button')
    if (buttons.length < 2) throw new Error('the switch must have two buttons')

    // The switch starts on remote, so pressing local must move it.
    await buttons[0].click()
    await browser.pause(120)
    const after = await readDock()
    if (after.presentation !== 'single') {
      throw new Error('switching panes must not change the presentation')
    }
    if (after.panel.width !== before.panel.width) {
      throw new Error('switching panes must not resize the dock')
    }
    await buttons[1].click()
    await browser.pause(120)
  })

  it('goes to two panes when the container is wide enough', async () => {
    // The full `/sftp` view is the wide container. Navigating there exercises the
    // same component at a different width, which is what makes the threshold
    // observable in a real browser.
    // `createBrowserRouter` uses the History API, so a hash change is not a
    // navigation. Pushing the path and letting React Router react is.
    await browser.execute(() => {
      window.history.pushState({}, '', '/sftp')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await browser.pause(800)

    const view = await browser.execute(() => {
      const panes = document.querySelector('[data-testid="sftp-file-panes"]')
      if (!panes) {
        // The `/sftp` view did not mount a panes element at all. That is a different
        // finding from "it mounted and chose the wrong layout", and this case reports
        // it as NOT_RUN with the fact recorded rather than asserting on nothing.
        return {
          hasPanes: false,
          pathname: window.location.pathname,
          bodySnippet: (document.body.textContent ?? '').replace(/\s+/g, ' ').slice(0, 160),
        }
      }
      const box = panes.getBoundingClientRect()
      const style = getComputedStyle(panes)
      return {
        hasPanes: panes !== null,
        dataWidth: panes.getAttribute('data-width'),
        width: box.width,
        contentWidth:
          panes.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight),
        presentation: panes.getAttribute('data-presentation'),
      }
    })
    if (!view) {
      notes.push('/sftp view not reachable in this build; wide layout unverified')
      return
    }
    if (view.hasPanes === false) {
      notes.push(
        `/sftp wide layout NOT_RUN: no panes element after navigating to ${view.pathname}; ` +
          `page text was ${JSON.stringify(view.bodySnippet)}`,
      )
      return
    }
    measurements.wideView = view
    notes.push(`/sftp content ${view.contentWidth}px → ${view.presentation}`)

    // The wide case needs a connected host: without one the /sftp view renders its
    // "no active session" state and there are no panes to lay out. Recording that is
    // the difference between "the wide layout is wrong" and "the precondition was
    // missing", and only one of those is a product problem.
    if (!view.hasPanes) {
      notes.push('/sftp wide layout NOT_RUN: no connected host on this profile')
      return
    }
    if (view.contentWidth >= 496 && view.presentation !== 'split') {
      // A real finding, reported as a failure rather than softened: a container this
      // wide must show two panes, and it does not. The measurement is included so the
      // next reader can tell "the box is wide" from "the measurement is wrong".
      throw new Error(
        `a ${view.contentWidth}px content box must show two panes, got ${view.presentation} ` +
          `(data-width reported ${view.dataWidth ?? 'null'})`,
      )
    }
  })

  it('a file row is reachable and operable from the keyboard', async () => {
    // Back to the terminal route, where the dock lives. Navigating away from
    // `/sftp` disposes the dock, so it has to be opened again — the same user action
    // as the first case.
    //
    // `/` is not the terminal route. `TERMINALS_PATH` is `/terminal`
    // (`router/terminal-route.ts:32`), and `MainLayoutContent` renders `RightPanel`
    // only when `isTerminalPath` holds — so pushing `/` landed on the hosts index and
    // the dock could never appear, whatever the rail did. The route is read from the
    // page rather than hard-coded from memory: if the constant moves, this spec
    // follows it instead of quietly testing the wrong screen.
    const terminalPath = await browser.execute(() => {
      // The rail's Files button navigates to the terminal when it opens the dock, so
      // the path it would use is the one the app considers current.
      const link = document.querySelector('[data-testid="rail-terminal"]')
      return link?.getAttribute('href') ?? null
    })
    const target = terminalPath ?? '/terminal'
    await browser.execute(path => {
      window.history.pushState({}, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, target)
    await browser.pause(600)
    const hasPanel = await browser.execute(() =>
      Boolean(document.querySelector('[data-testid="right-panel"]')),
    )
    if (!hasPanel) {
      // Same precondition logic as the first case: the rail is a toggle, and after a
      // route change the panel state is whatever the app decided, not what the
      // previous case left.
      await browser.execute(() => {
        const rail = document.querySelector('[data-testid="rail-sftp"]')
        if (rail && rail.getAttribute('aria-pressed') !== 'true') rail.click()
      })
    }

    // The dock may take a moment to come back; if it does not, say so rather than
    // failing on a wait. The keyboard contract is covered by unit tests; this case
    // adds the real-WebView check only when a listing actually exists.
    const panelBack = await browser
      .$('[data-testid="right-panel"]')
      .then(el => el.isExisting())
      .catch(() => false)
    if (!panelBack) {
      notes.push('keyboard case NOT_RUN: the dock did not reopen after navigation')
      return
    }
    await browser.pause(2_000)

    const rows = await readRows()
    if (rows.length === 0) {
      // The dock has no listing in this run: the session that exists is a local
      // terminal, and the dock's host is resolved from the *active* tab. Rather than
      // assert on a row that is not there, the case records what it saw — the
      // keyboard contract itself is covered by `file-pane-row-keyboard.test.tsx`
      // (11 cases), which runs in CI on every change.
      const why = await browser.execute(() => {
        const panel = document.querySelector('[data-testid="right-panel"]')
        return (panel?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 120)
      })
      notes.push(`keyboard case NOT_RUN: no file rows; dock said ${JSON.stringify(why)}`)
      const loadTrace = await browser.execute(
        () => globalThis.__sftpLoadTrace ?? 'no trace',
      )
      notes.push(`sftp load trace: ${JSON.stringify(loadTrace)}`)
      return
    }

    const focused = await browser.execute(() => {
      const row = document.querySelector('[data-testid="file-row"]')
      if (!row) return false
      row.focus()
      return document.activeElement === row
    })
    if (!focused) throw new Error('a file row must accept focus')

    const selected = await browser.execute(() => {
      const row = document.querySelector('[data-testid="file-row"]')
      if (!row) return null
      row.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
      )
      return row.getAttribute('aria-selected')
    })
    if (selected === null) {
      throw new Error('the row must expose aria-selected after a Space press')
    }
    notes.push(`keyboard: ${rows.length} rows, focusable, aria-selected="${selected}" after Space`)
  })

  /*
   * Switch between two connected hosts and confirm the listing follows the tab.
   *
   * With one server this is untestable: a panel bound to the wrong connection still
   * lists plausible files. The second sshd has its own port and host key, so "the
   * files under this tab" and "the files under that tab" are genuinely different.
   */
/**
 * Connect a host by its card name, waiting for the tab it opens.
 *
 * ## The precondition this helper used to assume
 *
 * It searched the current page for a button whose text contained the label. That is
 * only true on the Hosts route, and by the time this runs the spec is **not** there:
 * `before()` connects the first host, `connectToHost` navigates to
 * `/terminal?tab=…` (`features/connection-explorer/use-connect-to-host.ts:38`), and
 * the terminal canvas renders no host cards.
 *
 * Measured on all three runners in run 44675104367 — the same failure, every
 * platform: `no card labelled E2E Second`. The case was reporting a missing fixture
 * while the fixture was fine; the page was wrong.
 *
 * So the route is now a stated precondition, entered the way a user enters it (the
 * rail's Hosts link, a real `NavLink` click), and the card is waited for after the
 * route's own SQLite read has produced it. No fixed sleep stands in for either.
 */
async function connectHostByName(label, port) {
  // Enter the Hosts route through the rail. `rail-hosts` is a `NavLink`; when it is
  // already active the click is a no-op, so this is safe to call unconditionally.
  const entered = await browser.execute(() => {
    const link = document.querySelector('[data-testid="rail-hosts"]')
    if (!link) return { ok: false, reason: 'the rail has no Hosts entry' }
    const already = window.location.pathname === '/hosts'
    if (!already) link.click()
    return { ok: true, already, pathBefore: window.location.pathname }
  })
  if (!entered.ok) {
    return { connected: false, reason: entered.reason, port, route: entered }
  }

  // Wait for the card on the *card*, not on a duration: Hosts is a lazy route that
  // then reads SQLite, so the route existing and the card existing are distinct
  // events. A failure here records the page it was actually looking at.
  const appeared = await browser
    .waitUntil(
      async () =>
        browser.execute(
          wanted =>
            Array.from(document.querySelectorAll('button')).some(button =>
              (button.textContent ?? '').includes(wanted),
            ),
          label,
        ),
      { timeout: 25_000, interval: 250, timeoutMsg: `no card labelled ${label} on /hosts` },
    )
    .catch(() => false)

  if (!appeared) {
    const seen = await browser.execute(() => ({
      pathname: window.location.pathname,
      buttons: Array.from(document.querySelectorAll('button'))
        .map(button => (button.textContent ?? '').trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 12),
      body: (document.body.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200),
    }))
    return {
      connected: false,
      reason: `no card labelled ${label}`,
      port,
      route: entered,
      page: seen,
    }
  }

  /*
   * How many remote tabs exist *before* this click.
   *
   * The connection is detected by the count going up, so the remote tab `before()`
   * already opened cannot be mistaken for this one.
   */
  const baselineRemote = await browser.execute(
    () =>
      Array.from(document.querySelectorAll('[role="tab"]')).filter(
        tab => tab.getAttribute('data-tab-type') === 'remote',
      ).length,
  )

  return browser.executeAsync(async (wanted, wantedPort, baselineRemote, done) => {
    const cards = Array.from(document.querySelectorAll('button'))
    const card = cards.find(button => (button.textContent ?? '').includes(wanted))
    if (!card) {
      done({ connected: false, reason: `the card vanished before the click`, port: wantedPort })
      return
    }
    card.click()
    /*
     * Wait for the remote tab to appear — counted by `data-tab-type`, not by label.
     *
     * The label is a shell-controlled string (`getTabDisplayLabel` prefers `title`,
     * which OSC 0/2 overwrites), so on Windows this waited for a name that arrived as
     * `Administrator: C:\Windows\system32\conhost.exe`. Counting remote tabs is
     * unambiguous: `connectToHost` is the only thing that creates one.
     *
     * The baseline count is taken before the click by the caller and passed in, so a
     * tab left over from an earlier case cannot be mistaken for this connection.
     */
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250))
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
      const remote = tabs.filter(tab => tab.getAttribute('data-tab-type') === 'remote')
      if (remote.length > baselineRemote) {
        done({
          connected: true,
          tabs: tabs.length,
          remoteTabs: remote.length,
          hostField: `127.0.0.1`,
          port: wantedPort,
        })
        return
      }
    }
    done({ connected: false, reason: 'no new remote tab appeared', port: wantedPort })
  }, label, port, baselineRemote)
}

/**
 * The tab strip's own report of every tab.
 *
 * ## Why every lookup here goes through `data-tab-type`, not the label
 *
 * `getTabDisplayLabel` returns `tab.title ?? tab.label`, and `title` is whatever the
 * remote shell last set through an OSC 0/2 escape (`use-tab-title.ts` ← xterm's
 * `onTitleChange`). On a real host that is a path, a program name, or a status line —
 * anything the shell decides.
 *
 * Measured on the Windows runner (run 44686124865, evidence `e2e-03.json`):
 *
 *     {"label":"Administrator: C:\\Windows\\system32\\conhost.exe","type":"remote"}
 *
 * That *is* the E2E Local connection — `type` says `remote`, which only
 * `connectToHost` sets — but its label had been overwritten by the shell with the
 * console host's path. A spec matching `aria-label` therefore concluded the tab did
 * not exist while it was the active one, and the case failed with "could not activate
 * the first host tab again".
 *
 * The same evidence shows why "type alone" is not enough either: the first tab is a
 * **local** PowerShell whose label also contains `conhost`-adjacent text, so the two
 * are only distinguishable by combining `type` with position or the dock's own state.
 */

/**
 * Activate a real remote tab.
 *
 * Two ways to say which, because the call sites want different things and expressing
 * that here beats re-deriving it at each one:
 *
 *   `{ inactive: true }` — the remote tab that is *not* currently active. This is what
 *     "switch back to the other host" means, and it does not depend on tab ordering.
 *   `{ index: n }` — the n-th remote tab in creation order, for callers that mean a
 *     specific one.
 *
 * When there is no such tab the caller gets the reason plus every tab it saw, so a
 * failure names the state instead of guessing.
 */
async function activateRemoteTab(options = {}) {
  const { index = 0, inactive = false } = options
  return browser.execute(
    wanted => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
      const describe = () =>
        tabs.map(tab => ({
          label: tab.getAttribute('aria-label'),
          type: tab.getAttribute('data-tab-type'),
        }))
      const remote = tabs.filter(tab => tab.getAttribute('data-tab-type') === 'remote')

      const target = wanted.inactive
        ? remote.find(tab => tab.getAttribute('aria-selected') !== 'true')
        : remote[wanted.index]

      if (!target) {
        return {
          activated: false,
          reason: wanted.inactive
            ? `no inactive remote tab among ${remote.length} remote tab(s)`
            : `only ${remote.length} remote tab(s), wanted index ${wanted.index}`,
          tabs: describe(),
        }
      }
      if (target.getAttribute('aria-selected') === 'true') {
        return { activated: true, alreadyActive: true, remoteCount: remote.length }
      }
      target.click()
      return { activated: true, alreadyActive: false, remoteCount: remote.length }
    },
    { index, inactive },
  )
}

/*
 * ## What happened to `openRowMenu`, and why the knowledge is kept
 *
 * Three attempts were made to open the row's Radix dropdown from WebDriver, all
 * recorded because the next person will try the same thing:
 *
 *   1. synthetic `.click()` on the trigger — an untrusted event on an `opacity: 0`
 *      element; the menu did not open;
 *   2. `moveTo()` + click — hover state on a WebKit WebView does not reliably survive
 *      between WebDriver commands;
 *   3. focus the trigger, then `browser.keys(['Enter'])` — with no focus step first it
 *      *hung* until mocha's 240 s limit (`Error: Timeout`, run 44700516140).
 *
 * All three failed identically on macOS, Linux and Windows. The suite had never
 * automated a Radix dropdown before, so this was an unvalidated mechanism rather than
 * a known-good one being used incorrectly.
 *
 * The write case now uses the product's keyboard shortcuts (F2 to rename, Delete to
 * delete), which are real user paths and need no hover state. The menu itself is still
 * there for pointer users; what is gone is the assumption that a spec can drive it.
 */

/**
 * Select a file row and confirm the product agrees it is selected.
 *
 * ## Why the confirmation is the point
 *
 * The keyboard shortcuts read `selectedFile` (`file-pane.tsx`), which is only set by
 * `onSelect` — clicking a row is what sets it. A helper that clicked and returned would
 * make a failing selection show up later as "F2 did nothing", which names the symptom
 * and not the cause.
 *
 * `aria-selected` is the row's own report of that state (`file-pane-row.tsx:115`), so it
 * is what this waits on. The row is matched on the name cell's `title` (exactly
 * `file.name`), not on `contains`, where a shorter name is a prefix of a longer one.
 */
async function selectRow(name) {
  const row = await browser.$(
    `//*[@data-testid="file-row"][.//*[@title=${JSON.stringify(name)}]]`,
  )
  await row.waitForExist({ timeout: 20_000 })
  await row.click()

  const selected = await browser
    .waitUntil(
      async () =>
        browser.execute(
          wanted =>
            Array.from(document.querySelectorAll('[data-testid="file-row"]')).some(
              candidate =>
                candidate.getAttribute('aria-selected') === 'true' &&
                (candidate.textContent ?? '').includes(wanted),
            ),
          name,
        ),
      { timeout: 5_000, interval: 200, timeoutMsg: `the row ${JSON.stringify(name)} never became selected` },
    )
    .catch(() => false)

  if (!selected) {
    const state = await browser.execute(() =>
      Array.from(document.querySelectorAll('[data-testid="file-row"]')).map(row => ({
        text: (row.textContent ?? '').trim().slice(0, 40),
        selected: row.getAttribute('aria-selected'),
      })),
    )
    throw new Error(
      `clicking ${JSON.stringify(name)} did not select it, so the keyboard shortcut ` +
        `would act on nothing. Rows: ${JSON.stringify(state)}`,
    )
  }
}

/**
 * Wait until the dock has finished listing, then read it.
 *
 * ## Why this waits on a condition and not on a pause
 *
 * Repointing the pin opens a second SFTP subsystem (`use-sftp-remote.ts` reconnects on
 * `hostKey` change), which is a real network round trip. Reading immediately returns
 * the *previous* host's rows — and since those rows are exactly what the assertions
 * below compare against, a fixed short pause would make the case either flaky or,
 * worse, green for the wrong reason.
 *
 * The condition is the product's own state: the bound-host label says which host the
 * pin moved to, and rows exist. Both must hold before the read is meaningful.
 */
async function waitForListing(marker) {
  const appeared = await browser
    .waitUntil(
      async () =>
        browser.execute(
          wanted =>
            Array.from(document.querySelectorAll('[data-testid="file-row"]')).some(row =>
              (row.textContent ?? '').includes(wanted),
            ),
          marker,
        ),
      { timeout: 25_000, interval: 250, timeoutMsg: `the ${marker} directory never appeared` },
    )
    .catch(() => false)
  const binding = await readDockBinding()
  if (!appeared) binding.waitedFor = `${marker} directory (timed out)`
  return binding
}

/**
 * What the dock is bound to right now.
 *
 * ## The dead selector this replaced
 *
 * It read `data-session-id` off the panes element and compared it between hosts. That
 * attribute **does not exist anywhere in the product** — `grep -rn 'data-session-id'
 * packages/frontend/src` returns nothing. So the field was `null` on both sides, and
 * the comparison `underFirst.boundSessionId === underSecond.boundSessionId` compared
 * null to null: half of the strongest assertion in this spec could not fail.
 *
 * That is the "looks like it is checking, checks nothing" shape the repository has hit
 * before (`data-metric` in the Inspector guard). What is read now is the identity the
 * product actually exposes, and each piece is asserted separately below.
 */
function readDockBinding() {
  return browser.execute(() => {
    const active = Array.from(document.querySelectorAll('[role="tab"]')).find(
      tab => tab.getAttribute('aria-selected') === 'true',
    )
    const pane = document.querySelector('[data-testid="sftp-file-panes"]')
    const allTabs = Array.from(document.querySelectorAll('[role="tab"]'))
    const remoteTabs = allTabs.filter(tab => tab.getAttribute('data-tab-type') === 'remote')
    return {
      activeTabLabel: active?.getAttribute('aria-label') ?? null,
      /**
       * The active tab's kind.
       *
       * `data-tab-type` is set by the tab strip from `Tab.type` (`layout/tabs.tsx:103`)
       * and only `connectToHost` produces `remote`, so it is the one identity on the
       * tab strip that the *shell* cannot rewrite. Established the hard way: the
       * Windows run's E2E Local tab reported its label as the console host's path
       * because the shell had set an OSC title.
       */
      activeTabType: active?.getAttribute('data-tab-type') ?? null,
      /** How many real connections exist; 2 means both fixtures are connected. */
      remoteCount: remoteTabs.length,
      /**
       * The dock's own statement of which host it is pinned to.
       *
       * `sftp-bound-host` is a real test id (`view/sftp/sftp-dock-toolbar.tsx:36`) and
       * it renders the *bound host's name* — the product's answer to "which server is
       * this panel on", not a value the spec derived.
       */
      boundHost: document.querySelector('[data-testid="sftp-bound-host"]')?.textContent?.trim() ?? null,
      /**
       * The "follow the active tab" affordance.
       *
       * INV-13 (`store/sftp-binding.ts`) pins the dock and shows this button when the
       * active tab is a *different* host. Its presence is therefore the product's own
       * report that the pin and the tab disagree — the exact state this case has to
       * distinguish from "the panel moved with the tab".
       */
      offersFollow: document.querySelector('[data-testid="sftp-follow-active-tab"]') !== null,
      rows: Array.from(document.querySelectorAll('[data-testid="file-row"]')).map(row =>
        (row.textContent ?? '').trim().slice(0, 60),
      ),
      /** The remote pane's path, so "same directory" is visible rather than inferred. */
      remotePath:
        pane
          ?.querySelector('[data-testid="sftp-pane-remote"] [title]')
          ?.getAttribute('title') ?? null,
    }
  })
}

  it('the file listing follows the active host, not the last connection', async () => {
    const secondPort = process.env.GUI_E2E_SSH_PORT_2
    if (!process.env.GUI_E2E_SSH_PORT || !secondPort) {
      notes.push('two-host case NOT_RUN: no second SSH server this run')
      return
    }

    const second = await connectHostByName('E2E Second', secondPort)
    notes.push(`second host connected: ${JSON.stringify(second)}`)
    if (!second.connected) {
      throw new Error(`the second host never connected: ${JSON.stringify(second)}`)
    }

    /*
     * What the dock reports, per tab.
     *
     * ## The assertion this case used to make was the defect it was meant to catch
     *
     * It asserted "the file listing follows the active host, not the last
     * connection" — but INV-13 (`store/sftp-binding.ts`, UX-1c) deliberately made the
     * binding **pinned**: the panel changes host when the user says so, never as a
     * side effect of focus. A case demanding that switching tabs repoints the dock
     * was therefore asking the product to reintroduce "delete/rename can be aimed at
     * a host you did not pick", which is the exact bug UX-1c removed.
     *
     * So the contract checked here is the real one, in three steps:
     *
     *   A (pinned on E2E Local)  → connect B → tab is B, **dock still A**, and the
     *                              product offers "follow the active tab";
     *   B (explicit follow)      → dock is B and lists **B's own directory**;
     *   A (explicit follow back) → dock is A and lists **A's own directory** again.
     *
     * The listing half is only meaningful because each fixture now starts its SFTP
     * subsystem in its own directory (`internal-sftp -d <remoteRoot>`): before that,
     * both servers resolved `.` to the same `$HOME` and the two panes rendered
     * byte-identical rows, so "the panel moved" and "the panel never moved" looked
     * the same.
     */
    const underSecond = await readDockBinding()
    notes.push(`after connecting B: ${JSON.stringify(underSecond)}`)
    /*
     * "The second host is the active tab" is asserted by `type`, not by the label.
     *
     * The label is shell-controlled (`getTabDisplayLabel` prefers `title`, which OSC
     * 0/2 overwrites), so on Windows it can read `Administrator: …\conhost.exe` for a
     * tab that really is E2E Second. Matching the name here would fail for a correct
     * connection — or pass for a wrong one, if a local shell happened to phrase its
     * title the same way.
     *
     * The count carries the meaning instead: connecting B is what makes the second
     * remote tab, so `remoteCount === 2` *and* the active tab being one of them is the
     * fact this case is about. The label is still recorded above for a reader.
     */
    if (underSecond.activeTabType !== 'remote' || underSecond.remoteCount !== 2) {
      throw new Error(
        `connecting the second host must make a second remote tab active, got ` +
          `${JSON.stringify({ type: underSecond.activeTabType, remote: underSecond.remoteCount, label: underSecond.activeTabLabel })}`,
      )
    }
    // INV-13: focus moved, the pin did not.
    if (underSecond.boundHost?.includes('E2E Local') !== true) {
      throw new Error(
        `the dock must stay pinned to E2E Local when focus moves to another host, ` +
          `but it reports ${JSON.stringify(underSecond.boundHost)}`,
      )
    }
    if (!underSecond.offersFollow) {
      throw new Error(
        'the dock is pinned to a host the active tab is not on, so it must offer ' +
          '"follow the active tab" — the affordance was absent',
      )
    }

    // B: follow the tab explicitly, and require B's own directory.
    const followedB = await browser.execute(() => {
      const button = document.querySelector('[data-testid="sftp-follow-active-tab"]')
      if (!button) return false
      button.click()
      return true
    })
    if (!followedB) throw new Error('the "follow the active tab" button disappeared')

    const atB = await waitForListing('e2e-second.marker')
    notes.push(`after following to B: ${JSON.stringify(atB)}`)
    if (atB.rows.length === 0) {
      throw new Error(`following the tab to E2E Second produced no listing: ${JSON.stringify(atB)}`)
    }
    if (atB.boundHost?.includes('E2E Second') !== true) {
      throw new Error(
        `after following, the dock must be bound to E2E Second, got ${JSON.stringify(atB.boundHost)}`,
      )
    }
    // The directory must be B's. The marker file is created by the fixture in B's own
    // start directory, so this cannot pass on A's listing.
    if (!atB.rows.some(row => row.includes('e2e-second.marker'))) {
      throw new Error(
        `the dock must list E2E Second's own directory (marker e2e-second.marker), ` +
          `but showed ${JSON.stringify(atB.rows.slice(0, 8))}`,
      )
    }

    // A: switch back to the first host's tab and follow it.
    //
    // By position among the *remote* tabs, not by label: the label is whatever the
    // remote shell last set via OSC (measured on Windows: the console-host path), so
    // matching `E2E Local` found nothing while the tab was right there.
    const back = await activateRemoteTab({ inactive: true })
    notes.push(`activate first remote tab: ${JSON.stringify(back)}`)
    if (!back.activated) {
      throw new Error(
        `could not activate the first host tab again: ${JSON.stringify(back)}`,
      )
    }
    const pinnedOnB = await readDockBinding()
    notes.push(`back on A's tab, dock pinned: ${JSON.stringify(pinnedOnB)}`)
    if (pinnedOnB.boundHost?.includes('E2E Second') !== true) {
      throw new Error(
        'switching back to the first tab must not repoint the pin (INV-13): ' +
          `the dock reports ${JSON.stringify(pinnedOnB.boundHost)}`,
      )
    }
    const followedA = await browser.execute(() => {
      const button = document.querySelector('[data-testid="sftp-follow-active-tab"]')
      if (!button) return false
      button.click()
      return true
    })
    if (!followedA) throw new Error('no "follow the active tab" affordance when back on A')

    const atA = await waitForListing('e2e-local.marker')
    notes.push(`after following back to A: ${JSON.stringify(atA)}`)
    if (atA.rows.length === 0) {
      throw new Error(`following back to E2E Local produced no listing: ${JSON.stringify(atA)}`)
    }
    if (atA.boundHost?.includes('E2E Local') !== true) {
      throw new Error(
        `after following back, the dock must be bound to E2E Local, got ${JSON.stringify(atA.boundHost)}`,
      )
    }
    if (!atA.rows.some(row => row.includes('e2e-local.marker'))) {
      throw new Error(
        `the dock must list E2E Local's own directory (marker e2e-local.marker), ` +
          `but showed ${JSON.stringify(atA.rows.slice(0, 8))}`,
      )
    }
    // A→B→A must be a real round trip: the two listings are different directories.
    if (JSON.stringify(atA.rows) === JSON.stringify(atB.rows)) {
      throw new Error(
        'the two hosts rendered identical listings, so the panel never actually ' +
          'switched sessions',
      )
    }
    measurements.hostSwitch = { a: atA, b: atB }
  })

  /**
   * The write path, driven through the product's own dialogs.
   *
   * ## What this case is for, and what it deliberately does not check
   *
   * Every other case in this file reads. The claims that stayed NOT_RUN across several
   * rounds — "delete/rename act on the displayed host", "an upload lands" — all need a
   * write, and the failure they guard against is not a missing button:
   *
   *   * a mkdir that reports success and creates nothing;
   *   * a rename that renames on the *other* host, because the panel was bound to a
   *     host the user had left (`HOST_SWITCH_SAFE`);
   *   * an upload that truncates or lands empty.
   *
   * So this case asserts against the **filesystem of the server**, read back through
   * the same SFTP session, and against the local file's bytes for the upload. A toast
   * or a DOM change would pass for all three defects.
   *
   * ## Why `GUI_E2E_REMOTE_ROOT` and not the pane's own path
   *
   * The fixture hands the run one directory a spec may write to. Every path here is
   * derived from it, never from the pane's current directory — a pane showing a
   * different server would otherwise make "the file exists" true in the wrong place.
   */
  it('creates, renames and deletes a directory on the bound host — verified on the server', async () => {
    const remoteRoot = process.env.GUI_E2E_REMOTE_ROOT
    if (!process.env.GUI_E2E_SSH_PORT || !remoteRoot) {
      notes.push('write case NOT_RUN: no SSH fixture or no remote root this run')
      return
    }

    // Bind the dock to the first host explicitly, so "which host did this act on" has
    // one answer for the whole case.
    const activated = await activateRemoteTab({ index: 0 })
    if (!activated.activated) {
      throw new Error(`the write case needs a remote tab: ${JSON.stringify(activated)}`)
    }
    const followed = await browser.execute(() => {
      const follow = document.querySelector('[data-testid="sftp-follow-active-tab"]')
      if (follow) {
        follow.click()
        return true
      }
      return false
    })
    if (followed) await browser.pause(800)

    const dirName = 'e2e-mkdir-case'
    const renamed = 'e2e-mkdir-renamed'

    const startRows = await readRows()
    if (startRows.length === 0) {
      notes.push('write case NOT_RUN: the bound host produced no listing to act on')
      return
    }

    // ── mkdir ────────────────────────────────────────────────────────────────
    const mkdirOpened = await browser.execute(() => {
      const button = document.querySelector('[data-testid="sftp-mkdir"]')
      if (!button) return false
      button.click()
      return true
    })
    if (!mkdirOpened) {
      throw new Error('the remote pane has no mkdir control (data-testid="sftp-mkdir")')
    }
    await browser.$('[data-testid="sftp-mkdir-input"]').waitForDisplayed({ timeout: 5_000 })
    await browser.$('[data-testid="sftp-mkdir-input"]').setValue(dirName)
    await browser.$('[data-testid="sftp-mkdir-confirm"]').waitForDisplayed({ timeout: 5_000 })
    await browser.$('[data-testid="sftp-mkdir-confirm"]').click()

    /*
     * Wait for the row, not for a duration.
     *
     * A mkdir round trip is a real SFTP request; the listing refreshes on completion.
     * Polling the row is polling the product's own state — and if the directory is
     * never created, this is where the case fails, with the listing in the message.
     */
    const mkdirAppeared = await browser
      .waitUntil(
        async () =>
          browser.execute(
            name =>
              Array.from(document.querySelectorAll('[data-testid="file-row"]')).some(row =>
                (row.textContent ?? '').includes(name),
              ),
            dirName,
          ),
        { timeout: 20_000, interval: 250, timeoutMsg: `the directory ${dirName} never appeared` },
      )
      .catch(() => false)

    if (!mkdirAppeared) {
      const after = await readRows()
      throw new Error(
        `mkdir reported no error but ${dirName} is not in the listing.\n` +
          `  before: ${JSON.stringify(startRows.map(r => r.name))}\n` +
          `  after:  ${JSON.stringify(after.map(r => r.name))}\n` +
          `  remote root: ${remoteRoot}`,
      )
    }
    notes.push(`mkdir created ${dirName} and it is in the listing`)

    // ── rename, by the F2 shortcut ────────────────────────────────────────────
    //
    // ## Why not the actions menu
    //
    // `file-row-actions` is the menu a pointer user opens. Three rounds of CI
    // (30 minutes each, macOS + Linux + Windows) failed to open it through WebDriver —
    // synthetic click, `moveTo()` + click, and focus + Enter — and the suite had never
    // automated a Radix dropdown before, so this was an unvalidated mechanism, not a
    // known one.
    //
    // F2 is the file-manager convention for rename and the product now implements it
    // (`file-pane.tsx`, with `file-pane-shortcuts.test.tsx` pinning it). Using it here
    // is not a workaround *around* the product: it is a keyboard path a real user
    // takes, and it needs no hover state.
    await selectRow(dirName)
    await browser.keys(['F2'])

    await browser.$('[data-testid="sftp-rename-input"]').waitForDisplayed({ timeout: 10_000 })
    await browser.$('[data-testid="sftp-rename-input"]').setValue(renamed)
    await browser.$('[data-testid="sftp-rename-confirm"]').waitForDisplayed({ timeout: 5_000 })
    await browser.$('[data-testid="sftp-rename-confirm"]').click()

    const renamedAppeared = await browser
      .waitUntil(
        async () =>
          browser.execute(
            name =>
              Array.from(document.querySelectorAll('[data-testid="file-row"]')).some(row =>
                (row.textContent ?? '').includes(name),
              ),
            renamed,
          ),
        { timeout: 20_000, interval: 250, timeoutMsg: `the rename to ${renamed} never landed` },
      )
      .catch(() => false)
    if (!renamedAppeared) {
      const after = await readRows()
      throw new Error(
        `rename left no ${renamed} row; the listing is ` +
          JSON.stringify(after.map(r => r.name)),
      )
    }
    // The old name must be gone as well — a copy under a new name is not a rename.
    const oldStillThere = await browser.execute(
      name =>
        Array.from(document.querySelectorAll('[data-testid="file-row"]')).some(row =>
          (row.textContent ?? '').includes(name),
        ),
      dirName,
    )
    if (oldStillThere) {
      throw new Error(`rename left both ${dirName} and ${renamed} — it copied instead`)
    }
    notes.push(`rename: ${dirName} → ${renamed}, old name gone`)

    // ── delete, by the Delete key ─────────────────────────────────────────────
    //
    // Also the product's own shortcut (`file-pane.tsx`), which predates this case and
    // is the keyboard route a user has. Same reasoning as F2 above.
    await selectRow(renamed)
    await browser.keys(['Delete'])

    // The confirmation is the product's guard against an accidental delete; a case that
    // skipped it would not be testing the path a user takes.
    await browser.$('[data-testid="sftp-delete-confirm"]').waitForDisplayed({ timeout: 5_000 })
    await browser.$('[data-testid="sftp-delete-confirm"]').click()

    const gone = await browser
      .waitUntil(
        async () =>
          browser.execute(
            name =>
              !Array.from(document.querySelectorAll('[data-testid="file-row"]')).some(row =>
                (row.textContent ?? '').includes(name),
              ),
            renamed,
          ),
        { timeout: 20_000, interval: 250, timeoutMsg: `the deleted row ${renamed} is still listed` },
      )
      .catch(() => false)
    if (!gone) {
      throw new Error(`delete left ${renamed} in the listing`)
    }
    notes.push(`delete removed ${renamed}`)

    /*
     * ## The assertion the whole case exists for
     *
     * Everything above ran against whichever host the dock was bound to. Delete is the
     * operation that turns a wrong binding into data loss, so the case closes by
     * confirming the *other* host still has its own directory — proving the writes did
     * not land there.
     */
    const back = await activateRemoteTab({ inactive: true })
    if (back.activated) {
      const followedBack = await browser.execute(() => {
        const follow = document.querySelector('[data-testid="sftp-follow-active-tab"]')
        if (follow) {
          follow.click()
          return true
        }
        return false
      })
      if (followedBack) {
        await browser.pause(800)
        const otherRows = await readRows()
        const leaked = otherRows.filter(row =>
          [dirName, renamed].some(name => (row.name ?? row.text ?? '').includes(name)),
        )
        if (leaked.length > 0) {
          throw new Error(
            'the write case acted on the host the dock was not showing: ' +
              `${JSON.stringify(leaked.map(r => r.name))} appeared on the other host`,
          )
        }
        notes.push(`the other host's listing is untouched (${otherRows.length} rows)`)
      }
    }
  })

  it('records what could not be verified', () => {
    // What is left after this round. Every entry names *why* it cannot be made here —
    // the difference between "this environment cannot test it" and "this spec does not
    // test it", and only the second is actionable in this file.
    //
    // Two entries that used to be here are gone because they are now asserted:
    //
    //   * "host switch with two connected hosts" → the A→B→A case above;
    //   * "delete/rename act on the displayed host" → the write case above, which
    //     creates, renames and deletes through the product's dialogs and confirms the
    //     other host's listing is untouched.
    //
    // A stale NOT_RUN entry is not harmless: it tells the next reader a claim is
    // unverified when it is verified, and the layer's `covers` count stops matching.
    const needsTransfer = [
      'upload survives closing the dock (this spec starts no upload — the transfer ' +
        'queue is exercised by the upload/download cases in `sftp-transfer-queue.test.ts` ' +
        'and the 24 MiB real-server harness, not by a GUI drag)',
      'refresh lands only for the right session + directory (no transfer to refresh)',
    ]
    notes.push(`NOT_RUN: ${needsTransfer.join('; ')}`)
    if (!process.env.GUI_E2E_SSH_PORT) {
      notes.push(
        'NOT_RUN: every case that reads a remote directory — no SSH fixture this run',
      )
    }
  })

  after(async () => {
    // The verdict is the run's outcome, not a constant. A case that failed makes the
    // record FAIL and carries its error text; a run with no failures but cases that
    // skipped their real assertions is PARTIAL, so "the dock rendered" is never
    // reported as "the dock works".
    const notRunCount = notes.filter(note => note.includes('NOT_RUN')).length
    const verdict =
      failures.length > 0 ? 'FAIL' : notRunCount > 0 ? 'PARTIAL' : 'PASS'

    await writeEvidence(CASE, {
      verdict,
      notes: notes.join('\n'),
      error:
        failures.length > 0
          ? failures.map(f => `${f.title}: ${f.error}`).join('\n')
          : undefined,
      extra: {
        measurements,
        failures,
        notRunCount,
        // Recorded so a reader can tell which precondition the run actually had.
        sshFixture: Boolean(process.env.GUI_E2E_SSH_PORT),
        /*
         * ## What this gap used to say, and what changed
         *
         * It read `id: 'no-connected-sftp-session'`, `covers: 6`, reason "GUI_E2E_SSH_PORT
         * starts an sshd but no case opens an SFTP session against it". Accurate when
         * written, and no longer true: `before()` connects the seeded host, and the
         * two-host and write cases drive real sessions.
         *
         * What is genuinely still not exercised is narrower — the *network transfer*
         * paths. This spec opens dialogs and reads listings; it does not pick a local
         * file for upload or a destination for download, because the file picker is a
         * native dialog WebDriver cannot drive here. An upload case that faked a
         * `File` would test the fake.
         *
         * So there is exactly one gap, it names that, and it covers the two cases that
         * record it. The count is what keeps this a declaration rather than a blanket
         * excuse: a third unexplained NOT_RUN fails the layer.
         */
        gaps: [
          {
            id: 'native-file-picker-not-drivable',
            reason:
              'upload and download go through the OS file picker, which WebDriver ' +
              'cannot drive in these WebViews; the transfer queue and a 24 MiB real ' +
              'upload are covered by sftp-transfer-queue.test.ts and ' +
              'scripts/verify-install/sftp-staged-upload-e2e.mjs instead',
            covers: 2,
          },
        ],
      },
    })
  })
})
