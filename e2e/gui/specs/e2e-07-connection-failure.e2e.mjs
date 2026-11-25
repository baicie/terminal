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
 * ## Why this case now asserts on two surfaces
 *
 * The first version asserted only on `terminal-error-overlay`. Measured on a macOS GUI
 * run, that element never mounts for a refused port, and the reason is structural: the
 * SSH host-key **preflight** runs before the session does, so a machine that never
 * answered is caught by the gate and the session is never started. The pane did explain
 * itself — through the gate overlay — but the case had asserted on a surface that
 * failure can never reach. A selector that cannot match is not a test of anything.
 *
 * The two surfaces are the two real orders of events, and both are driven here:
 *
 *   1. **Preflight fails** (closed port): the gate overlay must name the step and must
 *      not claim a host-key problem for a machine that never opened a socket.
 *   2. **Session fails after a trusted key** (a key the server refuses): the terminal
 *      error overlay must mount with text. This is the surface the first version was
 *      aiming at, and it is reachable only *after* the preflight passes — so it needs a
 *      server that answers and presents a key, not a closed port.
 *
 * ## Why a refused port and not a wrong password
 *
 * The password path needs a password-authenticating daemon, which on this machine means
 * either Docker or `sudo`; the key path needs `authorized_keys` management. A closed port
 * is a real transport failure that needs neither, and it is the one the pane has to
 * explain without any server having said anything.
 *
 * Case 2 reuses the fixture's **second** sshd rather than starting another: its host key
 * is the one trusted into this profile, and the row carries a private key the daemon does
 * not authorise. Transport and host key are genuine; only the credential is refused. When
 * that key cannot be minted the runner leaves `GUI_E2E_REJECTING_LABEL` empty and the
 * case records NOT_RUN against a declared gap instead of passing quietly.
 */

import { browser } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'

const CASE = 'e2e-07'

/**
 * The precondition case 2 depends on, declared so a missing third-party failure is
 * visible as a gap rather than absorbed into a pass count.
 */
const GAPS = [
  {
    id: 'no-rejecting-fixture',
    covers: 1,
    reason:
      'the second sshd or its un-authorised key could not be prepared, so the ' +
      'post-preflight failure path had no target',
  },
]

describe('F22 — a failed connection explains itself in the pane', () => {

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
  const notes = []

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

  after(async () => {
    await writeEvidence(CASE, {
      ...(failures.length > 0
        ? { error: failures.map(failure => `${failure.title}: ${failure.error}`).join('\n') }
        : {}),
      verdict:
        failures.length > 0
          ? 'FAIL'
          : notes.some(note => note.includes('NOT_RUN'))
            ? 'PARTIAL'
            : 'PASS',
      extra: {
        failures,
        notRunCount: notes.filter(note => note.includes('NOT_RUN')).length,
        notes,
        gaps: GAPS,
      },
    })
  })

  /**
   * Open the Hosts route and click the card with this label.
   *
   * Two preconditions the first version of this case got wrong, both measured on Linux
   * CI: the app boots into a restored **local terminal**, so the Hosts route has to be
   * opened first; and Hosts is a lazy route that reads SQLite asynchronously, so the
   * cards appear well after the route does. Wait for the card, not for a duration.
   */
  async function connectThroughCard(label) {
    await browser.$('[data-testid="rail-hosts"]').click()
    const found = await browser
      .waitUntil(
        async () =>
          browser.execute(candidate => {
            const texts = Array.from(document.querySelectorAll('button')).map(
              button => button.textContent ?? '',
            )
            return texts.some(text => text.includes(candidate))
          }, label),
        {
          timeout: 20_000,
          interval: 250,
          timeoutMsg: `the seeded "${label}" host card never appeared on the Hosts page`,
        },
      )
      .catch(() => false)
    if (!found) {
      const seen = await pageState()
      throw new Error(`the seeded host card "${label}" never appeared: ${JSON.stringify(seen)}`)
    }

    /*
     * `host-card.tsx` renders the whole card as a `<button>` whose `onClick` is
     * `onConnect(host)` — there is no separate connect control, and inventing a
     * `data-testid` for one would have been a selector that matches nothing.
     */
    await browser.execute(candidate => {
      const target = [...document.querySelectorAll('button')].find(button =>
        button.textContent?.includes(candidate),
      )
      if (!target) throw new Error('the seeded host card is not clickable')
      target.click()
    }, label)
  }

  /** What the page looked like, so the next failure is diagnosable from the log. */
  async function pageState() {
    return browser.execute(() => ({
      path: location.pathname,
      gate: document.querySelector('[data-testid="ssh-host-key-gate-error"]')?.innerText ?? null,
      gateFailure:
        document.querySelector('[data-testid="ssh-host-key-gate-error"]')?.dataset.failure ?? null,
      overlay: document.querySelector('[data-testid="terminal-error-overlay"]')?.innerText ?? null,
      body: (document.body.innerText ?? '').slice(0, 600),
    }))
  }

  /**
   * Case 1 — the preflight is the surface a closed port reaches.
   *
   * The seeded row points at port 1, which the runner never binds, so a connect is
   * refused immediately rather than hanging. The assertion is deliberately on the
   * *headline*, because that is the part that was wrong: "Could not verify the SSH host
   * key" sends the user to known_hosts for a machine that never answered TCP.
   */
  it('names the step that failed when the server does not answer', async () => {
    await connectThroughCard('E2E Unreachable')

    let gate = null
    try {
      await browser.waitUntil(
        async () =>
          browser.execute(
            () => document.querySelector('[data-testid="ssh-host-key-gate-error"]') !== null,
          ),
        {
          timeout: 60_000,
          interval: 250,
          timeoutMsg:
            'the preflight error surface never mounted; a pane that shows nothing after a refused connection is the defect this case exists to catch',
        },
      )
      gate = await browser.execute(() => {
        const node = document.querySelector('[data-testid="ssh-host-key-gate-error"]')
        return node
          ? { title: node.querySelector('[data-testid="ssh-host-key-gate-title"]')?.textContent ?? '', text: node.innerText, failure: node.dataset.failure }
          : null
      })
    } catch (error) {
      throw new Error(`${error.message}; page was ${JSON.stringify(await pageState())}`)
    }

    if (gate === null || gate.text.trim() === '') {
      throw new Error(
        `the preflight error surface mounted but rendered no text: ${JSON.stringify(await pageState())}`,
      )
    }
    /*
     * The defect, stated as an assertion. A closed port is not a host-key problem, and
     * a pane that says it is sends the user to the one file that is certainly fine.
     * `failure` is the structured classification the overlay chose its headline from.
     */
    if (gate.failure !== 'unreachable') {
      throw new Error(
        `a refused connect must be classified unreachable, got ${JSON.stringify(gate.failure)}; surface said ${JSON.stringify(gate.text)}`,
      )
    }
    if (gate.title.trim() === 'Could not verify the SSH host key') {
      throw new Error(
        `a refused connect must not be reported as a host-key problem; surface said ${JSON.stringify(gate.text)}`,
      )
    }
  })

  /**
   * Case 2 — the terminal overlay, reached the only way it can be.
   *
   * The gate has to be satisfied before the session runs, which means a real server with
   * a real host key. The seeded `E2E Rejecting` row points at the fixture's second sshd,
   * which authorises a key this row does not hold: the preflight succeeds (the server
   * answers, and its key is trusted into this profile), and the *session* is refused.
   * That refusal is the terminal error overlay's surface.
   *
   * The case does not assert *which* error came back. It asserts the pane said something,
   * because the defect it exists to catch is the blank pane, not any particular wording.
   */
  it('renders a reason in the terminal pane when the session is refused', async () => {
    const label = process.env.GUI_E2E_REJECTING_LABEL
    if (!label) {
      /*
       * Not a skip dressed as a pass, and not a thrown error either: this is a missing
       * precondition, and the evidence records NOT_RUN against the declared gap so the
       * summary shows a PARTIAL rather than counting an unrun case as green.
       */
      notes.push(
        'NOT_RUN post-preflight failure path: GUI_E2E_REJECTING_LABEL is unset ' +
          '(the second sshd or its un-authorised key could not be prepared)',
      )
      return
    }
    await connectThroughCard(label)

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
      throw new Error(`${error.message}; page was ${JSON.stringify(await pageState())}`)
    }

    /*
     * The element existing is the claim; this is the second half — it has to *say*
     * something. An empty overlay would satisfy "the pane decided to show a failure" and
     * still leave the user with nothing to read, which is the blank-pane defect wearing
     * a different shape.
     */
    if (overlay === null || overlay.trim() === '') {
      throw new Error('the error overlay mounted but rendered no text')
    }
  })
})
