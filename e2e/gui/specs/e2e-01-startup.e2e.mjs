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
  const observed = { terminal: null, window: null, command: null, failures: [] }
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
    // ## Why the assertion is shaped this way
    //
    // The first version required the token to appear **twice** — once in the
    // echoed command line and once in the output. That holds on a developer's
    // zsh but not on the CI runner's shell, where the echoed line can be
    // redrawn or scrolled such that the marker count differs. Counting
    // occurrences measures the *shell's* echo behaviour, not that the command
    // ran.
    //
    // What is actually invariant: after sending the line, a line consisting
    // exactly of the token appears, and then a *new prompt* appears after it.
    // A prompt after the output is the shell saying "done" — that is the
    // completion signal, and it does not depend on how the shell echoes input.
    //
    // Uniqueness comes from a token that cannot appear by accident; alphanumeric
    // only, because WebDriver parses `-` in a key string as a modifier separator.
    const token = `guie2e${Date.now()}`
    const promptPattern = /[$#%]\s*$/

    const before = await terminalSnapshot()
    const promptMatchesBefore = (before.text.match(/[$#%]\s*$/gm) ?? []).length

    // Real keyboard path: W3C *Element Send Keys* against the focused helper
    // textarea. Not a synthesized DOM event.
    const helper = await browser.$('.xterm-helper-textarea')
    await helper.addValue(`echo ${token}`)
    await browser.keys('Enter')

    // 1. The command produced its own output line.
    await browser
      .waitUntil(
        async () => {
          const { text } = await terminalSnapshot()
          return text.split('\n').some(line => line.trim() === token)
        },
        { timeout: 30_000, interval: 250, timeoutMsg: 'the command output line never appeared' },
      )
      .catch(async err => {
        const snap = await terminalSnapshot()
        throw new Error(`${err.message}\n--- buffer tail ---\n${snap.text.slice(-600)}`)
      })

    // 2. A new prompt followed it — the shell is done with the command.
    await browser
      .waitUntil(
        async () => {
          const { text } = await terminalSnapshot()
          const lines = text.split('\n').filter(line => line.length > 0)
          const outputIndex = lines.findIndex(line => line.trim() === token)
          if (outputIndex === -1) return false
          return lines.slice(outputIndex + 1).some(line => promptPattern.test(line))
        },
        { timeout: 30_000, interval: 250, timeoutMsg: 'no new prompt appeared after the output' },
      )
      .catch(async err => {
        const snap = await terminalSnapshot()
        throw new Error(`${err.message}\n--- buffer tail ---\n${snap.text.slice(-600)}`)
      })

    const after = await terminalSnapshot()
    // 3. Ran exactly once: one output line, not two.
    const outputLines = after.text.split('\n').filter(line => line.trim() === token)
    expect(outputLines.length).toBe(1)

    // 4. More prompts than before: the shell returned to its input state.
    const promptMatchesAfter = (after.text.match(/[$#%]\s*$/gm) ?? []).length
    expect(promptMatchesAfter).toBeGreaterThan(promptMatchesBefore)

    // 5. Keep the raw buffer in the evidence so a CI-only difference is
    //    diagnosable without re-running.
    observed.command = {
      token,
      outputLines: outputLines.length,
      promptMatchesBefore,
      promptMatchesAfter,
      bufferTail: after.text.slice(-400),
    }
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
      command: observed.command,
      error:
        observed.failures.length > 0
          ? observed.failures.map(f => `${f.test}: ${f.error}`).join('\n')
          : undefined,
    })
  })
})
