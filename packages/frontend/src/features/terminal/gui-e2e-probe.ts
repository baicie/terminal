/**
 * Read-only terminal probe for native GUI E2E.
 *
 * ## Why this exists
 *
 * The terminal renders through WebGL/canvas, so `document.querySelectorAll('.xterm-rows > div')`
 * returns nothing and the buffer text is unreachable from the DOM. The status
 * bar already exposes the measured cols×rows, but a GUI test that needs to prove
 * "the shell echoed my command" needs the buffer contents too.
 *
 * ## What it is allowed to do
 *
 * Exactly two reads: the terminal geometry and a text snapshot of the visible
 * buffer. It cannot write, cannot execute shell commands, cannot reach a session
 * id, and never touches credentials or Vault state.
 *
 * ## Why it cannot ship
 *
 * The whole module is behind `import.meta.env.VITE_TERMINAL_GUI_E2E`, which the
 * production build never sets — so the install call and this file are dead code
 * and are tree-shaken out. `scripts/check-gui-e2e-isolation.mjs` asserts the
 * marker string is absent from a production `dist/`.
 *
 * This is a test *observation* surface, not a test control surface. If a future
 * step needs to drive application state it must go through the real UI.
 */

/**
 * Marker the isolation gate greps for in the production bundle.
 *
 * It lives inside the `isGuiE2EEnabled()` branch below so the bundler drops it
 * when the flag is off. A top-level `export const` here survived into a
 * production chunk during the first attempt — the string was present in
 * `dist/js/container.*.js` even though nothing called the probe. Keeping the
 * marker behind the same condition is what makes "absent from the product"
 * checkable by grepping the bundle.
 */
const GUI_E2E_PROBE_MARKER = 'terminal-gui-e2e-probe'

interface ProbeTerminal {
  cols: number
  rows: number
  buffer: {
    active: {
      length: number
      getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined
    }
  }
  options?: { fontSize?: number; fontFamily?: string }
}

interface ProbeWindow extends Window {
  __terminalGuiE2E?: {
    marker: string
    snapshot(): { cols: number; rows: number; lines: number; text: string }
  }
}

/**
 * Is this build instrumented for GUI E2E?
 *
 * Written as a direct `import.meta.env` comparison so Vite substitutes a literal
 * at build time; the production value is `undefined`, the comparison folds to
 * `false`, and every branch behind it is dead code.
 */
export function isGuiE2EEnabled(): boolean {
  return import.meta.env.VITE_TERMINAL_GUI_E2E === '1'
}

/**
 * Expose a read-only snapshot of the terminal.
 *
 * Returns a disposer so the caller can remove it on unmount — a lingering global
 * after the terminal is gone would report stale numbers.
 */
export function installGuiE2EProbe(terminal: ProbeTerminal): () => void {
  if (typeof window === 'undefined') return () => undefined
  if (!isGuiE2EEnabled()) return () => undefined

  const target = window as ProbeWindow
  target.__terminalGuiE2E = {
    marker: GUI_E2E_PROBE_MARKER,
    snapshot() {
      const buffer = terminal.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buffer.length; i += 1) {
        const line = buffer.getLine(i)
        if (!line) continue
        lines.push(line.translateToString(true))
      }
      // Trim trailing blank rows: a terminal that has not scrolled yet is mostly
      // empty, and shipping 1000 empty lines into a JSON evidence file is noise.
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      return {
        cols: terminal.cols,
        rows: terminal.rows,
        lines: buffer.length,
        text: lines.join('\n'),
      }
    },
  }

  return () => {
    if (target.__terminalGuiE2E?.marker === GUI_E2E_PROBE_MARKER) {
      delete target.__terminalGuiE2E
    }
  }
}
