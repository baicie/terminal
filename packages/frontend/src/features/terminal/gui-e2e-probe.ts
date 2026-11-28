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
 * Reads: the terminal geometry and a text snapshot of the visible buffer.
 *
 * Writes: **typing into the terminal the user is looking at**, and selecting text
 * already on screen. Both go through the same `terminal.paste()` / `select()` calls
 * the product's own input path uses, so what a spec drives is what a keystroke would
 * drive — the alternative (writing to the session over IPC) would bypass the very
 * layer a "can the user still type after this?" case is about.
 *
 * It cannot execute a command directly, cannot reach a session id, and never touches
 * credentials or Vault state. The distinction that matters: a spec that types
 * `echo marker\r` is asking the *shell* to run it, and reading the echo back proves
 * the PTY is alive end to end. A helper that executed on the session's behalf would
 * prove only that the helper works.
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
  /**
   * The product's own write path. Optional so a terminal that only supports reads
   * still installs a probe — the snapshot cases keep working.
   */
  paste?(data: string): void
  /** The product's own selection API; `xterm` exposes `select`. */
  select?(column: number, row: number, length: number): void
  /** The terminal's DOM node, when the caller had one to give. */
  element?: Element
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
    /**
     * Type into the terminal as if the user did.
     *
     * Deliberately append-only: the caller supplies characters, not a command
     * channel. `\r` submits, exactly as pressing Return does.
     */
    typeIntoActiveTerminal(text: string): boolean
    focusActiveTerminal(): boolean
    /** The visible-buffer tail, so a spec can poll for its own echo. */
    readActiveTerminalTail(): string
    /** Select a string already on screen, returning what was actually selected. */
    selectTextInActiveTerminal(text: string): { ok: boolean; reason?: string; selected?: string }
    extensionSnapshot(): unknown
    findSnippetByName(name: string): Promise<unknown>
    readSetting(key: string): Promise<unknown>
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
export function installGuiE2EProbe(
  terminal: ProbeTerminal,
  /** The terminal's DOM node; xterm exposes none on its own type. */
  element?: Element,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  if (!isGuiE2EEnabled()) return () => undefined

  /** The visible buffer as lines, trailing blanks trimmed. */
  const bufferLines = (which: ProbeTerminal = activeTerminal()): string[] => {
    const buffer = which.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i += 1) {
      const line = buffer.getLine(i)
      if (!line) continue
      lines.push(line.translateToString(true))
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines
  }

  /*
   * Probes are kept per terminal and the global resolves the **visible** one. The old
   * code assigned `window.__terminalGuiE2E` outright, so with two tabs the last mounted
   * terminal won and every read described that one — measured on DDQ11, where a command
   * typed into host A was read back from B. Invisible with a single tab, which is why
   * `e2e-01`..`e2e-08` never caught it.
   */
  const target = window as ProbeWindow
  const registry: ProbeTerminal[] = (target as unknown as { __terminalGuiE2EProbes?: ProbeTerminal[] })
    .__terminalGuiE2EProbes ?? []
  ;(target as unknown as { __terminalGuiE2EProbes?: ProbeTerminal[] }).__terminalGuiE2EProbes =
    registry
  if (element !== undefined) {
    ;(terminal as unknown as { element?: Element }).element = element
  }
  registry.push(terminal)

  /** Newest registered terminal outside an `.invisible` ancestor; falls back to newest. */
  const activeTerminal = (): ProbeTerminal => {
    // `.xterm` nodes appear in mount order = registry order, so position pairs them.
    // (Passing an element through the installer was measured to stop it installing.)
    const nodes = Array.from(document.querySelectorAll('.xterm'))
    if (nodes.length === registry.length) {
      for (let index = registry.length - 1; index >= 0; index -= 1) {
        if (nodes[index].closest('.invisible') === null) return registry[index]
      }
    }
    for (let index = registry.length - 1; index >= 0; index -= 1) {
      const candidate = registry[index]
      const node = candidate.element
      if (!node || typeof node.closest !== 'function') continue
      if (node.closest('.invisible') === null) return candidate
    }
    return registry[registry.length - 1] ?? terminal
  }

  target.__terminalGuiE2E = {
    marker: GUI_E2E_PROBE_MARKER,

    /**
     * Type, through the same `paste` path a keystroke reaches.
     *
     * Returns false rather than throwing when the terminal has no write path: a spec
     * should be able to say "this build cannot be driven" instead of failing with a
     * TypeError that looks like a product defect.
     */
    /** Focus the terminal the user is looking at, as the product does on tab activate. */
    focusActiveTerminal() {
      const current = activeTerminal() as ProbeTerminal & { focus?: () => void }
      if (typeof current.focus !== 'function') return false
      current.focus()
      return true
    },

    typeIntoActiveTerminal(text: string) {
      const current = activeTerminal()
      if (typeof current.paste !== 'function') return false
      current.paste(text)
      return true
    },

    readActiveTerminalTail() {
      return bufferLines().slice(-12).join('\n')
    },

    /**
     * Select text that is already on screen.
     *
     * Implemented by locating the string in the buffer and calling xterm's own
     * `select(column, row, length)` — the same call a drag ends in. Pasting a string
     * into the clipboard and simulating a drag would be a different mechanism than the
     * one the product reads from, and would test the simulation.
     */
    selectTextInActiveTerminal(text: string) {
      const current = activeTerminal()
      if (typeof current.select !== 'function') {
        return { ok: false, reason: 'this terminal exposes no select()' }
      }
      const buffer = current.buffer.active
      for (let row = 0; row < buffer.length; row += 1) {
        const line = buffer.getLine(row)
        if (!line) continue
        const rendered = line.translateToString(true)
        const column = rendered.indexOf(text)
        if (column < 0) continue
        current.select(column, row, text.length)
        return { ok: true, selected: text }
      }
      return { ok: false, reason: `"${text}" is not in the buffer` }
    },

    /**
     * What the extension registry thinks is active.
     *
     * Read-only and deliberately tiny: a spec needs to know whether the switch it
     * clicked actually changed the runtime, because a switch can render "checked"
     * while the registry still has the extension disabled — and that split is a
     * defect, not a detail.
     */
    /**
     * Look a snippet up by name through the app's own database module.
     *
     * Read-only and narrow: a spec that claims "the snippet was saved" needs the row,
     * not a rendered list. Dynamic `import()` from inside `browser.execute` does not
     * work over Tauri's custom protocol (measured: `'text/html' is not a valid
     * JavaScript MIME type`), so the query runs here, where the module is already
     * loaded by the product.
     */
    async findSnippetByName(name: string) {
      const reader = (globalThis as {
        __terminalSnippetProbe?: (name: string) => Promise<unknown>
      }).__terminalSnippetProbe
      if (typeof reader !== 'function') return { ok: false, reason: 'probe not installed' }
      try {
        return { ok: true, rows: await reader(name) }
      } catch (error) {
        return { ok: false, reason: String(error) }
      }
    },

    /**
     * One `app_settings` row, parsed.
     *
     * The registry answers "is it running now"; this answers "is the choice stored",
     * and a toggle that applies without persisting differs between them.
     */
    async readSetting(key: string) {
      const reader = (globalThis as {
        __terminalSettingsProbe?: (key: string) => Promise<unknown>
      }).__terminalSettingsProbe
      if (typeof reader !== 'function') return { ok: false, reason: 'probe not installed' }
      try {
        return { ok: true, value: await reader(key) }
      } catch (error) {
        return { ok: false, reason: String(error) }
      }
    },

    extensionSnapshot() {
      const read = (globalThis as { __terminalExtensionProbe?: () => unknown })
        .__terminalExtensionProbe
      return typeof read === 'function' ? read() : { unsupported: true }
    },

    snapshot() {
      const lines = bufferLines()
      return {
        cols: activeTerminal().cols,
        rows: activeTerminal().rows,
        lines: activeTerminal().buffer.active.length,
        text: lines.join('\n'),
      }
    },
  }

  return () => {
    /*
     * Remove **this** terminal from the registry, not the global.
     *
     * A closing tab must not blind the probe for the tabs that are still open — the old
     * disposer deleted `window.__terminalGuiE2E` outright, so closing any one terminal
     * made every later `readActiveTerminalTail()` return `''`.
     */
    const index = registry.indexOf(terminal)
    if (index >= 0) registry.splice(index, 1)
    if (registry.length === 0 && target.__terminalGuiE2E?.marker === GUI_E2E_PROBE_MARKER) {
      delete target.__terminalGuiE2E
    }
  }
}
