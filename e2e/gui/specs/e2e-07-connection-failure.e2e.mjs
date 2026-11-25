/**
 * F22 — the minimum user-visible loop: a failed connection says *why*, in the pane.
 *
 * ## What the audit found
 *
 * `NATIVE_GUI_VERIFIED` was reached by **no** SSH row in the acceptance matrix. Every
 * diagnosis test in the repository asserted against a component tree, and
 * `e2e/gui/specs/*` had no failure case at all — so "the user sees which machine refused"
 * was true only in the sense that a React test said so.
 *
 * ## What this case drives, and what it refuses to do
 *
 * A real host row is seeded into a throwaway profile, pointed at a port that refuses
 * connections. The app starts, the spec asks it to connect, and the assertion is on the
 * **rendered overlay text** — not on a Zustand store, and not by `browser.execute`
 * writing state directly. Injecting a fake failure would test the fixture.
 *
 * ## Why a refused port and not a wrong password
 *
 * The password path needs a password-authenticating daemon, which on this machine means
 * either Docker or `sudo`; the key path needs `authorized_keys` management. A closed port
 * is a real transport failure that needs neither, and it is the one the pane has to
 * explain without any server having said anything. It exercises the same
 * classify → diagnose → render chain the credential cases do; the credential cases
 * additionally assert *which* machine, which they already do at the component level.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { browser } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'

const CASE = 'e2e-07'

/** A loopback port with nothing listening: bound, then released. */
async function closedPort() {
  const server = createServer()
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
  await new Promise(resolve => server.close(resolve))
  return port
}

describe('F22 — a failed connection explains itself in the pane', () => {
  let workDirectory

  /*
   * ## Why the verdict comes from Mocha, not from this spec
   *
   * `after()` runs whatever the outcome. A spec that decides PASS from its own captured
   * values writes PASS for a run Mocha marked failed — measured on e2e-02, whose counter
   * only moved inside its width loop, so every other failure left it at 0.
   *
   * So: collect the failures in `afterEach`, and let that decide.
   */
  const failures = []

  afterEach(function () {
    if (this.currentTest?.state !== 'failed') return
    const err = this.currentTest.err
    const text =
      (typeof err === 'string' ? err : undefined) ??
      err?.message ??
      err?.stack?.split('\n')[0] ??
      err?.toString?.() ??
      null
    failures.push({
      title: this.currentTest.title,
      error: text ?? `(no error text for "${this.currentTest.title}")`,
    })
  })

  before(async () => {
    workDirectory = mkdtempSync(path.join(os.homedir(), '.tmp-e2e07-'))
  })

  after(async () => {
    try {
      await writeEvidence(CASE, {
        ...(failures.length > 0
          ? { error: failures.map(failure => `${failure.title}: ${failure.error}`).join('\n') }
          : {}),
        verdict: failures.length > 0 ? 'FAIL' : 'PASS',
        extra: { failures },
      })
    } finally {
      if (workDirectory) rmSync(workDirectory, { recursive: true, force: true })
    }
  })

  it('renders a reason instead of a blank terminal', async () => {
    /*
     * ## Why this uses the fixture's own host row
     *
     * `scripts/run-gui-e2e.mjs` seeds an `E2E Unreachable` row into every per-spec
     * profile **before** the app starts, pointed at a port nothing listens on. The first
     * version of this case tried to insert its own row at runtime through
     * `plugin:sql|execute`; measured on Linux CI, the row never appeared in the list, so
     * the case failed before it exercised anything — and a row written after the app has
     * started is not how a user's profile comes to hold one anyway.
     *
     * The port is closed, not opened-then-closed, so there is no window in which the
     * connection could succeed. The assertion does not depend on *which* error comes
     * back; it depends on the pane saying something rather than staying blank.
     */
    /*
     * ## Two preconditions the first version assumed
     *
     * Measured on Linux CI, twice:
     *
     *   1. the app boots into a restored **local terminal**, not the Hosts page — the
     *      only buttons present were `["Local","Vaults","Ctrl+K"]`. The seeded host was
     *      never on screen because the Hosts route had not been opened.
     *   2. Hosts is a lazy route that then reads SQLite asynchronously, so the cards
     *      appear well after the route does. `e2e-03` learned this the same way: a
     *      fixed 800 ms wait passed on a run where the card existed and was never
     *      clicked.
     *
     * So: open the route, then wait for the **card**, not for a duration.
     */
    await browser.$('[data-testid="rail-hosts"]').click()
    const found = await browser
      .waitUntil(
        async () =>
          browser.execute(() => {
            const texts = Array.from(document.querySelectorAll('button')).map(
              button => button.textContent ?? '',
            )
            return texts.some(text => text.includes('E2E Unreachable'))
          }),
        {
          timeout: 20_000,
          interval: 250,
          timeoutMsg: 'the seeded unreachable host card never appeared on the Hosts page',
        },
      )
      .catch(() => false)
    if (!found) {
      // Name the state instead of leaving "the card never appeared" to be interpreted.
      const seen = await browser.execute(() => ({
        path: location.pathname,
        buttons: Array.from(document.querySelectorAll('button'))
          .map(button => (button.textContent ?? '').trim().slice(0, 40))
          .filter(Boolean)
          .slice(0, 12),
        body: (document.body.textContent ?? '').slice(0, 300),
      }))
      throw new Error(`the seeded host card never appeared: ${JSON.stringify(seen)}`)
    }

    /*
     * Ask the product to connect through the card a user clicks.
     *
     * `host-card.tsx` renders the whole card as a `<button>` whose `onClick` is
     * `onConnect(host)` — there is no separate connect control, and inventing a
     * `data-testid` for one would have been a selector that matches nothing.
     */
    await browser.execute(() => {
      const target = [...document.querySelectorAll('button')].find(button =>
        button.textContent?.includes('E2E Unreachable'),
      )
      if (!target) throw new Error('the seeded host card is not clickable')
      target.click()
    })

    /*
     * ## Wait for the overlay, not for "some text"
     *
     * The first version waited for `document.body.innerText` to match
     * `/could not|unable|refused|timed out/i`. Measured on Linux CI: it was satisfied
     * 1.6 s after the click — by the **host list still on screen**, whose own copy and
     * the seeded card's address match that pattern. The overlay had not been mounted at
     * all, and the case then failed on a selector it had never waited for.
     *
     * `terminal-surface.tsx` mounts `TerminalErrorOverlay` only when `readableError` is
     * non-null, so that element's existence *is* the claim: the pane decided there is a
     * failure worth showing. Waiting on the element makes the wait and the assertion the
     * same fact instead of two guesses.
     */
    let overlay = null
    try {
      await browser.waitUntil(
        async () =>
          browser.execute(
            () => document.querySelector('[data-testid="terminal-error-overlay"]') !== null,
          ),
        {
          timeout: 60_000,
          interval: 250,
          timeoutMsg:
            'the terminal error overlay never mounted; a pane that shows nothing after a refused connection is the defect this case exists to catch',
        },
      )
      overlay = await browser.execute(() => {
        const node = document.querySelector('[data-testid="terminal-error-overlay"]')
        return node ? node.innerText : null
      })
    } catch (error) {
      // Say what the page looked like, so the next failure is diagnosable from the log.
      const seen = await browser.execute(() => ({
        path: location.pathname,
        overlay: document.querySelector('[data-testid="terminal-error-overlay"]')?.innerText ?? null,
        body: (document.body.innerText ?? '').slice(0, 600),
      }))
      throw new Error(`${error.message}; page was ${JSON.stringify(seen)}`)
    }

    /*
     * The element existing is the claim; this is the second half — it has to *say*
     * something. An empty overlay would satisfy "the pane decided to show a failure" and
     * still leave the user with nothing to read, which is the blank-pane defect wearing
     * a different shape.
     */
    if (overlay.trim() === '') {
      throw new Error('the error overlay mounted but rendered no text')
    }
  })
})
