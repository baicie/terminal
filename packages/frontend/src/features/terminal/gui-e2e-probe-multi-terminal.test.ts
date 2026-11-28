// The probe is one surface over **many** terminals, and "active" has to mean what the
// user is looking at.
//
// ## The defect these pin, measured on DDQ11
//
// `installGuiE2EProbe` used to assign `window.__terminalGuiE2E` outright, so with two
// remote tabs open the **last mounted** terminal won. Every call — `snapshot`,
// `readActiveTerminalTail`, `typeIntoActiveTerminal` — then described that terminal no
// matter which tab was selected.
//
// The first run of the two-host isolation case typed a command into host A, read host
// B's buffer, and reported "A never echoed its first nonce": a harness defect wearing the
// exact shape of a product failure. Every existing GUI spec runs against a single
// terminal, which is why nothing caught it.
//
// The disposer had the mirror bug: it deleted the global when *any* terminal unmounted,
// so closing one tab blinded the probe for every tab still open.

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

/**
 * A terminal stand-in, optionally attached to a DOM node so its visibility is testable.
 *
 * `hiddenBy` renders the terminal inside an ancestor carrying that class — the app uses
 * `invisible` on the non-terminal layer, which is the signal `activeTerminal()` reads.
 */
function fakeTerminal(
  lines: string[] = ['$ echo hi', 'hi'],
  { hiddenBy = null }: { hiddenBy?: string | null } = {},
) {
  const pasted: string[] = []
  let element: HTMLElement | undefined

  if (hiddenBy !== null || hiddenBy === null) {
    const wrapper = document.createElement('div')
    if (hiddenBy !== null) wrapper.className = hiddenBy
    const node = document.createElement('div')
    wrapper.appendChild(node)
    document.body.appendChild(wrapper)
    element = node
  }

  return {
    pasted,
    terminal: {
      cols: 80,
      rows: 24,
      element,
      paste: (data: string) => pasted.push(data),
      select: () => {},
      buffer: {
        active: {
          length: lines.length,
          getLine: (index: number) =>
            index < lines.length ? { translateToString: () => lines[index] } : undefined,
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
  delete (window as { __terminalGuiE2EProbes?: unknown }).__terminalGuiE2EProbes
  document.body.innerHTML = ''
})

describe('the probe follows the terminal the user is looking at', () => {
  it('reads the visible terminal, not the last one mounted', async () => {
    /*
     * The measured failure: two terminals, A visible and B mounted later. The old
     * implementation always reported B. This is the assertion that would have caught it
     * before a GUI run was needed.
     */
    const { installGuiE2EProbe } = await loadProbe()
    const a = fakeTerminal(['alpha-line'], { hiddenBy: null })
    const b = fakeTerminal(['beta-line'], { hiddenBy: 'invisible' })

    const disposeA = installGuiE2EProbe(a.terminal as never)
    const disposeB = installGuiE2EProbe(b.terminal as never)

    // B was installed last but is hidden, so the answer must be A's buffer.
    expect(window.__terminalGuiE2E?.readActiveTerminalTail()).toBe('alpha-line')

    disposeA()
    disposeB()
  })

  it('moves to the other terminal when the visible one changes', async () => {
    /*
     * Switching tabs does not reinstall a probe — the same two instances swap which one
     * is on screen. Reading through the registry on every call is what makes that work;
     * capturing a terminal at install time cannot.
     */
    const { installGuiE2EProbe } = await loadProbe()
    const a = fakeTerminal(['alpha'], { hiddenBy: null })
    const b = fakeTerminal(['beta'], { hiddenBy: 'invisible' })

    installGuiE2EProbe(a.terminal as never)
    installGuiE2EProbe(b.terminal as never)

    expect(window.__terminalGuiE2E?.readActiveTerminalTail()).toBe('alpha')

    // The app swaps which layer is `invisible`; nothing is reinstalled.
    a.terminal.element?.closest('div')?.classList.add('invisible')
    b.terminal.element?.closest('div')?.classList.remove('invisible')

    expect(window.__terminalGuiE2E?.readActiveTerminalTail()).toBe('beta')
  })

  it('types into the visible terminal, not the newest one', async () => {
    // The write path has the same requirement as the read path: a command meant for the
    // tab on screen must not land in a background terminal.
    const { installGuiE2EProbe } = await loadProbe()
    const a = fakeTerminal(['alpha'], { hiddenBy: null })
    const b = fakeTerminal(['beta'], { hiddenBy: 'invisible' })
    installGuiE2EProbe(a.terminal as never)
    installGuiE2EProbe(b.terminal as never)

    expect(window.__terminalGuiE2E?.typeIntoActiveTerminal('echo hi\r')).toBe(true)
    expect(a.pasted).toEqual(['echo hi\r'])
    expect(b.pasted).toEqual([])
  })

  it('keeps working after one of several terminals is torn down', async () => {
    /*
     * The disposer used to delete the global outright, so closing a tab blinded the probe
     * for every tab still open. A spec that closes a session and then reads another would
     * get `''` and conclude the product had gone silent.
     */
    const { installGuiE2EProbe } = await loadProbe()
    const a = fakeTerminal(['alpha'], { hiddenBy: null })
    const b = fakeTerminal(['beta'], { hiddenBy: 'invisible' })

    const disposeA = installGuiE2EProbe(a.terminal as never)
    const disposeB = installGuiE2EProbe(b.terminal as never)

    disposeB()
    expect(window.__terminalGuiE2E).toBeDefined()
    expect(window.__terminalGuiE2E?.readActiveTerminalTail()).toBe('alpha')

    disposeA()
    // Last one gone: the global must disappear, or a later spec reads a dead terminal.
    expect(window.__terminalGuiE2E).toBeUndefined()
  })
})
