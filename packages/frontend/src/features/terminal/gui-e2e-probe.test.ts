// The GUI E2E probe is a test-only surface inside the product bundle, gated on a
// build flag. Two things matter and neither was tested before: that its write helpers
// go through the terminal's own input path (so a spec drives what a keystroke drives),
// and that it refuses to do anything when the build flag is off.
import { afterEach, describe, expect, it, vi } from 'vitest'

declare global {
  interface Window {
    __terminalGuiE2E?: {
      marker: string
      snapshot(): { cols: number; rows: number; lines: number; text: string }
      typeIntoActiveTerminal(text: string): boolean
      readActiveTerminalTail(): string
      selectTextInActiveTerminal(text: string): { ok: boolean; reason?: string; selected?: string }
    }
  }
}

/** A terminal stand-in recording what the probe asked it to do. */
function fakeTerminal(lines: string[] = ['$ echo hi', 'hi']) {
  const pasted: string[] = []
  const selections: Array<{ column: number; row: number; length: number }> = []
  return {
    pasted,
    selections,
    terminal: {
      cols: 80,
      rows: 24,
      paste: (data: string) => pasted.push(data),
      select: (column: number, row: number, length: number) =>
        selections.push({ column, row, length }),
      buffer: {
        active: {
          length: lines.length,
          getLine: (index: number) =>
            index < lines.length
              ? { translateToString: () => lines[index] }
              : undefined,
        },
      },
    },
  }
}

async function loadProbe() {
  vi.resetModules()
  vi.stubEnv('VITE_TERMINAL_GUI_E2E', '1')
  return import('./gui-e2e-probe')
}

afterEach(() => {
  vi.unstubAllEnvs()
  delete (window as { __terminalGuiE2E?: unknown }).__terminalGuiE2E
})

describe('the probe drives the terminal through its own input path', () => {
  it('types with paste(), not by writing to a session', async () => {
    const { installGuiE2EProbe } = await loadProbe()
    const { terminal, pasted } = fakeTerminal()
    const dispose = installGuiE2EProbe(terminal)

    expect(window.__terminalGuiE2E?.typeIntoActiveTerminal('echo x\r')).toBe(true)
    expect(pasted).toEqual(['echo x\r'])

    dispose()
  })

  it('reads the buffer tail so a spec can poll for its own echo', async () => {
    const { installGuiE2EProbe } = await loadProbe()
    const { terminal } = fakeTerminal(['one', 'two', 'three'])
    const dispose = installGuiE2EProbe(terminal)

    expect(window.__terminalGuiE2E?.readActiveTerminalTail()).toBe('one\ntwo\nthree')

    dispose()
  })

  it('selects by locating the text and calling select()', async () => {
    const { installGuiE2EProbe } = await loadProbe()
    const { terminal, selections } = fakeTerminal(['$ echo marker', 'marker'])
    const dispose = installGuiE2EProbe(terminal)

    const result = window.__terminalGuiE2E?.selectTextInActiveTerminal('marker')
    expect(result).toEqual({ ok: true, selected: 'marker' })
    // Row 0, column 7 — where 'marker' actually starts on that line.
    expect(selections).toEqual([{ column: 7, row: 0, length: 6 }])

    dispose()
  })

  it('reports why a selection failed instead of throwing', async () => {
    const { installGuiE2EProbe } = await loadProbe()
    const { terminal } = fakeTerminal(['nothing here'])
    const dispose = installGuiE2EProbe(terminal)

    const result = window.__terminalGuiE2E?.selectTextInActiveTerminal('absent')
    expect(result?.ok).toBe(false)
    expect(result?.reason).toContain('absent')

    dispose()
  })

  it('refuses to type when the terminal exposes no write path', async () => {
    const { installGuiE2EProbe } = await loadProbe()
    const base = fakeTerminal()
    const readOnly = {
      cols: base.terminal.cols,
      rows: base.terminal.rows,
      buffer: base.terminal.buffer,
    }
    const dispose = installGuiE2EProbe(readOnly)

    expect(window.__terminalGuiE2E?.typeIntoActiveTerminal('x')).toBe(false)

    dispose()
  })

  it('installs nothing when the build flag is off', async () => {
    // The production path. Without this the probe would be reachable from a shipped
    // app, which is the leak the isolation gate exists to prevent.
    vi.resetModules()
    vi.stubEnv('VITE_TERMINAL_GUI_E2E', '0')
    const { installGuiE2EProbe } = await import('./gui-e2e-probe')
    const { terminal } = fakeTerminal()
    const dispose = installGuiE2EProbe(terminal)

    expect(window.__terminalGuiE2E).toBeUndefined()
    dispose()
  })

  it('removes the global on dispose', async () => {
    const { installGuiE2EProbe } = await loadProbe()
    const { terminal } = fakeTerminal()
    const dispose = installGuiE2EProbe(terminal)
    expect(window.__terminalGuiE2E).toBeDefined()
    dispose()
    expect(window.__terminalGuiE2E).toBeUndefined()
  })
})
