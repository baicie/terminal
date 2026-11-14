// E2E-01 — the app starts, the terminal is real, and typing reaches a shell.
//
// Runs against the actual macOS build through the in-process WebDriver server
// that `@wdio/tauri-service` starts. Nothing is mocked: cols/rows come from
// xterm's own resize callback (the status bar renders what FitAddon measured),
// and the command output is whatever the user's login shell printed.

import { browser } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'

const CASE = 'e2e-01'

/**
 * Read the terminal buffer through the build-gated read-only probe.
 *
 * The terminal renders through WebGL, so `.xterm-rows > div` is empty in the real
 * app — the DOM has nothing to read. The probe is compiled in only when
 * `VITE_TERMINAL_GUI_E2E=1`; a production bundle does not contain it, and this
 * function then throws rather than silently reporting an empty terminal.
 */
async function terminalSnapshot() {
  const snapshot = await browser.execute(
    () => globalThis.__terminalGuiE2E?.snapshot?.() ?? null,
  )
  if (!snapshot) {
    throw new Error(
      'the read-only GUI E2E probe is absent — the frontend was built without ' +
        'VITE_TERMINAL_GUI_E2E=1',
    )
  }
  return snapshot
}

async function terminalText() {
  return (await terminalSnapshot()).text
}

describe('E2E-01 startup and terminal readiness', () => {
  // Collected during the run and written once, in `after`. Writing inside the last
  // `it` would leave no record at all when an earlier assertion fails — and a
  // failing case is exactly when the evidence matters.
  const observed = { terminal: null, window: null, failures: [] }
  let currentTest = ''

  beforeEach(function () {
    currentTest = this.currentTest?.title ?? ''
  })

  afterEach(function () {
    if (this.currentTest?.state === 'failed') {
      observed.failures.push({
        test: currentTest,
        error: this.currentTest.err?.message ?? 'unknown',
      })
    }
  })

  it('reaches the real Tauri route, not about:blank', async () => {
    // The window is created on `tauri://localhost` and the router replaces the
    // path once bootstrap finishes. Poll for the routed URL instead of asserting
    // on whatever it happened to be at the first frame.
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('/terminal'),
      { timeout: 30_000, interval: 200, timeoutMsg: 'the router never reached /terminal' },
    )
    const url = await browser.getUrl()
    expect(url).toContain('tauri://localhost')
    expect(url).toContain('/terminal')
  })

  it('mounts exactly one terminal workbench', async () => {
    const nodes = await browser.$$('[data-terminal-workbench]')
    expect(nodes.length).toBe(1)
    const terminals = await browser.$$('.xterm')
    expect(terminals.length).toBe(1)
  })

  it('waits for the terminal to be ready instead of sleeping', async () => {
    // Poll a real condition: the terminal has printed a prompt. A fixed sleep is
    // exactly the proof the task forbids.
    await browser.waitUntil(
      async () => /[$#%]/.test(await terminalText()),
      {
        timeout: 60_000,
        interval: 250,
        timeoutMsg: 'no shell prompt ever appeared in the terminal buffer',
      },
    )
  })

  it('shows a real shell prompt produced inside the PTY', async () => {
    const text = await terminalText()
    expect(text).toMatch(/[$#%]/)
  })

  it('echoes a command and returns the shell output', async () => {
    // Alphanumeric only: WebDriver's `keys` parses `-` as a modifier separator.
    const token = `guie2e${Date.now()}`
    // Focus the terminal's input surface. `browser.keys` sends to the focused
    // element, and xterm listens on its helper textarea.
    await browser.$('.xterm-helper-textarea').click()
    // Use `addValue` (the W3C *Element Send Keys* command), not the session-level
    // `keys`. Against this WKWebView, `browser.keys()` delivers a multi-character
    // string as a single key event — only the first character reaches xterm — and
    // per-character `keys` calls reorder characters when xterm handles them as
    // shortcuts. `addValue` on the helper textarea is the faithful "user typed
    // this line" path and lands the whole string in order.
    // See docs/testing/native-gui-e2e.md §Keyboard input.
    const helper = await browser.$('.xterm-helper-textarea')
    await helper.addValue(`echo ${token}`)
    await browser.keys('Enter')
    // The shell echoes the command line, then prints the command's own output, so
    // the token appears twice. Waiting for *two* occurrences is what distinguishes
    // "the keystrokes reached the terminal" from "the shell actually ran it".
    await browser.waitUntil(
      async () => (await terminalText()).split(token).length - 1 >= 2,
      {
        timeout: 30_000,
        interval: 250,
        timeoutMsg: 'the echo output never appeared',
      },
    ).catch(async err => {
      const snap = await terminalSnapshot()
      throw new Error(`${err.message}\n--- buffer tail ---\n${snap.text.slice(-500)}`)
    })
    const text = await terminalText()
    const occurrences = text.split(token).length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
    // Exactly twice also proves the input was not delivered twice.
    expect(occurrences).toBe(2)
  })

  it('reports cols and rows that came from xterm, and they are usable', async () => {
    const bar = await browser.$('[data-testid="status-bar"]').getText()
    const match = /(\d+)\s*[×x]\s*(\d+)/.exec(bar)
    expect(match).not.toBeNull()
    const cols = Number(match[1])
    const rows = Number(match[2])
    expect(cols).toBeGreaterThan(60)
    expect(rows).toBeGreaterThan(10)

    const geometry = await browser.execute(() => {
      const term = document.querySelector('.xterm')
      const screen = term?.querySelector('.xterm-screen')
      const rect = (screen ?? term)?.getBoundingClientRect()
      return {
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
        cssWidth: document.documentElement.clientWidth,
        cssHeight: document.documentElement.clientHeight,
        devicePixelRatio: window.devicePixelRatio,
      }
    })
    expect(geometry.width).toBeGreaterThan(400)
    expect(geometry.devicePixelRatio).toBeGreaterThan(0)

    observed.terminal = { cols, rows, statusBarText: bar }
    observed.window = geometry
  })

  after(async () => {
    await writeEvidence(CASE, {
      verdict: observed.failures.length === 0 ? 'PASS' : 'FAIL',
      terminal: observed.terminal,
      window: observed.window,
      error:
        observed.failures.length > 0
          ? observed.failures.map(f => `${f.test}: ${f.error}`).join('\n')
          : undefined,
    })
  })
})
