import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terminal as XTerminal } from '@baicie/xterm'
import { registerTerminalInput } from '@/hooks/terminal-input-registration'

const OPEN_TERMINALS: XTerminal[] = []
const WEBKIT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

/**
 * xterm measures glyphs during open(). jsdom has no canvas implementation, so
 * provide only the measurement surface needed by the real core renderer.
 */
function stubCanvasContext(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      const noop = () => {}
      const base: Record<string, unknown> = {
        canvas: this,
        font: '',
        measureText: (text: string) => ({ width: (text?.length ?? 0) * 8 }),
      }
      return new Proxy(base, {
        get: (target, property) =>
          property in target ? target[property as string] : noop,
        set: (target, property, value) => {
          target[property as string] = value
          return true
        },
      }) as unknown as CanvasRenderingContext2D
    } as never,
  )
}

function stubMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

function stubCharMetrics(): void {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('xterm-char-measure-element') ? 8 * 32 : 0
    },
  )
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('xterm-char-measure-element') ? 16 : 0
    },
  )
}

function overrideNavigator(userAgent: string): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  })
  Object.defineProperty(window.navigator, 'platform', {
    value: 'MacIntel',
    configurable: true,
  })
}

async function openTerminal(): Promise<XTerminal> {
  vi.resetModules()
  stubMatchMedia()
  stubCanvasContext()
  stubCharMetrics()
  overrideNavigator(WEBKIT_UA)
  const { Terminal } = await import('@baicie/xterm')
  const term = new Terminal({
    cols: 100,
    rows: 40,
    allowProposedApi: true,
  })
  const container = document.createElement('div')
  document.body.append(container)
  term.open(container)
  OPEN_TERMINALS.push(term)
  return term
}

async function writeOutput(term: XTerminal, data: string): Promise<void> {
  await new Promise<void>(resolve => term.write(data, resolve))
}

function installScreenGeometry(term: XTerminal): {
  cellWidth: number
  cellHeight: number
} {
  const dimensions = (
    term as unknown as {
      dimensions?: { css?: { cell?: { width?: number; height?: number } } }
    }
  ).dimensions
  const cellWidth = dimensions?.css?.cell?.width || 8
  const cellHeight = dimensions?.css?.cell?.height || 16
  const rect = () =>
    ({
      left: 0,
      top: 0,
      width: term.cols * cellWidth,
      height: term.rows * cellHeight,
      right: term.cols * cellWidth,
      bottom: term.rows * cellHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
  for (const target of [term.element, term.screenElement]) {
    if (target) {
      Object.defineProperty(target, 'getBoundingClientRect', {
        configurable: true,
        value: rect,
      })
    }
  }
  return { cellWidth, cellHeight }
}

function dispatchMouseDown(
  term: XTerminal,
  cellWidth: number,
  cellHeight: number,
  col: number,
  row: number,
): void {
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    clientX: col * cellWidth + 1,
    clientY: row * cellHeight + 1,
  })
  term.element?.dispatchEvent(event)
}

describe('xterm terminal input protocols', () => {
  afterEach(() => {
    for (const term of OPEN_TERMINALS.splice(0)) term.dispose()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('forwards an SGR mouse report through the text FIFO', async () => {
    const term = await openTerminal()
    const { cellWidth, cellHeight } = installScreenGeometry(term)
    const write = vi.fn()
    const writeRaw = vi.fn()
    const cleanup = registerTerminalInput({
      term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
      writeRaw,
    })

    await writeOutput(term, '\u001b[?1000h\u001b[?1006h')
    dispatchMouseDown(term, cellWidth, cellHeight, 2, 3)

    expect(write).toHaveBeenCalledWith('\u001b[<0;3;4M')
    expect(writeRaw).not.toHaveBeenCalled()
    for (const dispose of cleanup) dispose()
  })

  it('forwards bracketed paste markers and normalizes line endings', async () => {
    const term = await openTerminal()
    const write = vi.fn()
    const cleanup = registerTerminalInput({
      term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
    })

    await writeOutput(term, '\u001b[?2004h')
    term.paste('first\nsecond')

    expect(write).toHaveBeenCalledWith(
      '\u001b[200~first\rsecond\u001b[201~',
    )
    for (const dispose of cleanup) dispose()
  })

  it('keeps high-bit X10 mouse bytes on the raw FIFO', async () => {
    const term = await openTerminal()
    const { cellWidth, cellHeight } = installScreenGeometry(term)
    const write = vi.fn()
    const writeRaw = vi.fn()
    const cleanup = registerTerminalInput({
      term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
      writeRaw,
    })

    await writeOutput(term, '\u001b[?1000h')
    dispatchMouseDown(term, cellWidth, cellHeight, 96, 30)

    expect(write).not.toHaveBeenCalled()
    expect(writeRaw).toHaveBeenCalledOnce()
    expect(Array.from(writeRaw.mock.calls[0]?.[0] ?? [])).toEqual([
      0x1b,
      0x5b,
      0x4d,
      0x20,
      0x81,
      0x3f,
    ])
    for (const dispose of cleanup) dispose()
  })
})
