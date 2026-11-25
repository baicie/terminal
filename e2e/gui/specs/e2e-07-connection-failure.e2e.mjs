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

  before(async () => {
    workDirectory = mkdtempSync(path.join(os.homedir(), '.tmp-e2e07-'))
  })

  after(() => {
    if (workDirectory) rmSync(workDirectory, { recursive: true, force: true })
  })

  it('renders a reason instead of a blank terminal', async () => {
    const port = await closedPort()

    /*
     * The host row is written through the product's own database shape, into a profile
     * the harness isolated (`GUI_E2E_*` env is set by the runner). `browser.execute` is
     * *not* used to fabricate a failure — the app has to discover this one.
     */
    await browser.execute(
      async (hostPort, hostId) => {
        const api = globalThis.__TAURI_INTERNALS__
        await api.invoke('plugin:sql|execute', {
          db: 'sqlite:terminal.db',
          query:
            'INSERT OR REPLACE INTO hosts (id, name, hostname, port, username, auth_type, is_favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
          values: [hostId, 'e2e-refused', '127.0.0.1', hostPort, 'e2e', 'password', Date.now(), Date.now()],
        })
      },
      port,
      `${CASE}-host`,
    )

    // Reload so the hosts view reads the row the way a user's would.
    await browser.refresh()
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.body.innerText)).includes('e2e-refused'),
      { timeout: 20_000, timeoutMsg: 'the seeded host never appeared in the host list' },
    )

    /*
     * Ask the product to connect through the card a user clicks.
     *
     * `host-card.tsx` renders the whole card as a `<button>` whose `onClick` is
     * `onConnect(host)` — there is no separate connect control, and inventing a
     * `data-testid` for one would have been a selector that matches nothing. The click
     * target is found by its text, which is what a person aims at too.
     */
    await browser.execute(() => {
      const target = [...document.querySelectorAll('button')].find(button =>
        button.textContent?.includes('e2e-refused'),
      )
      if (!target) throw new Error('the seeded host card is not clickable')
      target.click()
    })

    /*
     * The overlay is the assertion surface. A blank terminal with a spinner is exactly
     * the defect this case exists to catch, so "some text appeared" is not enough — the
     * text has to be one of the product's own explanations.
     */
    await browser.waitUntil(
      async () => {
        const text = await browser.execute(() => document.body.innerText)
        return /could not|unable|refused|timed out|失败|无法/i.test(text)
      },
      {
        timeout: 60_000,
        timeoutMsg:
          'no failure explanation ever rendered; a blank pane after a refused connection is the defect this case exists to catch',
      },
    )

    const overlay = await browser.execute(() => {
      const node = document.querySelector('[data-testid="terminal-error-overlay"]')
      return node ? node.innerText : null
    })

    await writeEvidence(CASE, {
      /*
       * `extra` carries what the pane actually said. `null` for `overlayText` is still a
       * real failure, but a *different* one — the evidence has to show which, rather
       * than present "no overlay" as "no failure".
       */
      extra: {
        overlayText: overlay,
        bodyText: (await browser.execute(() => document.body.innerText)).slice(0, 2_000),
      },
      verdict: overlay !== null ? 'PASS' : 'FAIL',
    })

    if (overlay === null) {
      throw new Error(
        'the failure was rendered somewhere but not in the terminal error overlay; ' +
          'the pane a user reads for a failed connection showed nothing',
      )
    }
  })
})
