import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terminal as XTerminal } from '@baicie/xterm'

/**
 * Regression tests for the WebKit double-echo bug.
 *
 * On WKWebView (Tauri on macOS/iOS) a single keystroke used to reach the PTY
 * twice: the keydown path emits the character, and - because that path
 * intentionally does not preventDefault so IME and dead keys keep working -
 * the browser also inserts the character into the hidden textarea, which fires
 * an `input` event that emitted the same character again. Typing `a` rendered
 * `aa`, and `ls` was executed as `llss`.
 *
 * Upstream xterm.js guards the `input` event with `ev.composed &&
 * this._keyDownSeen`; the `@baicie/xterm` fork short-circuits on `isWebKitBased`
 * before that guard. The fix remembers the payload the keydown path already
 * emitted and drops the duplicated `input` event.
 */
const WKWEBVIEW_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
// `isWebKitBased` is `isSafari || userAgent.includes('AppleWebKit')`, so only a
// Gecko UA reaches the fork's non-WebKit branch.
const FIREFOX_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0'

const OPEN_TERMINALS: XTerminal[] = []

/**
 * jsdom has no canvas backend, but xterm measures glyph widths before it will
 * open. A permissive proxy keeps the renderer happy for input-only tests.
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

function overrideNavigator(userAgent: string, platform = 'MacIntel'): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  })
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true,
  })
}

async function openTerminal(
  userAgent: string,
  options: { macOptionIsMeta?: boolean } = {},
): Promise<XTerminal> {
  vi.resetModules()
  stubMatchMedia()
  stubCanvasContext()
  overrideNavigator(userAgent)
  const { Terminal } = await import('@baicie/xterm')
  const term = new Terminal({
    cols: 80,
    rows: 24,
    allowProposedApi: true,
    ...options,
  })
  const container = document.createElement('div')
  document.body.append(container)
  term.open(container)
  OPEN_TERMINALS.push(term)
  return term
}

function dispatchKeyDown(textarea: HTMLTextAreaElement, key: string): void {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'keyCode', {
    value: key.toUpperCase().charCodeAt(0),
    configurable: true,
  })
  textarea.dispatchEvent(event)
}

function dispatchOptionKeyDown(
  textarea: HTMLTextAreaElement,
  key: string,
  keyCode: number,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code: 'KeyF',
    altKey: true,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'keyCode', {
    value: keyCode,
    configurable: true,
  })
  textarea.dispatchEvent(event)
  return event
}

function dispatchInsertText(textarea: HTMLTextAreaElement, data: string): void {
  textarea.value = data
  textarea.dispatchEvent(
    new InputEvent('input', {
      data,
      inputType: 'insertText',
      bubbles: true,
    }),
  )
}

function dispatchInput(
  textarea: HTMLTextAreaElement,
  data: string,
  inputType: string,
): void {
  textarea.value = data
  textarea.dispatchEvent(
    new InputEvent('input', { data, inputType, bubbles: true }),
  )
}

function dispatchPaste(textarea: HTMLTextAreaElement, text: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => text },
  })
  textarea.dispatchEvent(event)
}

function dispatchKeyUp(textarea: HTMLTextAreaElement, key: string): void {
  const event = new KeyboardEvent('keyup', { key, bubbles: true })
  Object.defineProperty(event, 'keyCode', {
    value: key.toUpperCase().charCodeAt(0),
    configurable: true,
  })
  textarea.dispatchEvent(event)
}

function dispatchEscapeDown(textarea: HTMLTextAreaElement): void {
  const keyDown = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(keyDown, 'keyCode', {
    value: 27,
    configurable: true,
  })
  textarea.dispatchEvent(keyDown)
}

function dispatchEscapeUp(textarea: HTMLTextAreaElement): void {
  const keyUp = new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })
  Object.defineProperty(keyUp, 'keyCode', {
    value: 27,
    configurable: true,
  })
  textarea.dispatchEvent(keyUp)
}

function dispatchEscape(textarea: HTMLTextAreaElement): void {
  dispatchEscapeDown(textarea)
  dispatchEscapeUp(textarea)
}

/** Reproduces one physical keystroke on WKWebView. */
function typeCharacter(term: XTerminal, key: string): void {
  const textarea = term.textarea
  if (!textarea) throw new Error('xterm did not create its helper textarea')
  dispatchKeyDown(textarea, key)
  // WKWebView performs the default action because the keydown path returns
  // true without calling preventDefault for printable characters.
  dispatchInsertText(textarea, key)
  dispatchKeyUp(textarea, key)
}

function collectData(term: XTerminal): string[] {
  const received: string[] = []
  term.onData(data => received.push(data))
  return received
}

describe('xterm WebKit input handling', () => {
  afterEach(() => {
    for (const term of OPEN_TERMINALS.splice(0)) term.dispose()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('emits a single data event per keystroke on WebKit', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)

    typeCharacter(term, 'a')

    expect(received).toEqual(['a'])
  })

  it('keeps every character of a word intact on WebKit', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)

    for (const key of 'ls') typeCharacter(term, key)

    expect(received).toEqual(['l', 's'])
  })

  it('still emits repeated characters typed intentionally', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)

    typeCharacter(term, 'c')
    typeCharacter(term, 'c')

    expect(received).toEqual(['c', 'c'])
  })

  it('prevents WebKit text insertion for an Option-as-Meta key', async () => {
    const term = await openTerminal(WKWEBVIEW_UA, { macOptionIsMeta: true })
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')

    const event = dispatchOptionKeyDown(textarea, 'ƒ', 70)

    expect(received).toEqual(['\x1bf'])
    expect(event.defaultPrevented).toBe(true)
  })

  it('keeps an Option dead key on the native composition path', async () => {
    const term = await openTerminal(WKWEBVIEW_UA, { macOptionIsMeta: true })
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')

    const deadKey = new KeyboardEvent('keydown', {
      key: 'Dead',
      code: 'KeyE',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(deadKey, 'keyCode', { value: 69, configurable: true })
    textarea.dispatchEvent(deadKey)
    dispatchInsertText(textarea, 'é')

    expect(deadKey.defaultPrevented).toBe(false)
    expect(received).toEqual(['é'])
  })

  it('deduplicates delayed WebKit input events for overlapping keydowns', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')

    // WebKit can deliver the native input events after more than one keydown.
    // Keep the two keydowns in flight before replaying their default-action
    // input events to ensure the compatibility marker is not single-valued.
    dispatchKeyDown(textarea, 'a')
    dispatchKeyDown(textarea, 's')
    dispatchInsertText(textarea, 'a')
    dispatchInsertText(textarea, 's')
    dispatchKeyUp(textarea, 'a')
    dispatchKeyUp(textarea, 's')

    expect(received).toEqual(['a', 's'])
  })

  it('consumes matching markers one at a time for repeated overlapping keys', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')

    dispatchKeyDown(textarea, 'a')
    dispatchKeyDown(textarea, 'a')
    dispatchInsertText(textarea, 'a')
    dispatchInsertText(textarea, 'a')
    dispatchKeyUp(textarea, 'a')

    expect(received).toEqual(['a', 'a'])
  })

  it('does not write terminal input payloads to the WebView console', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')
    const debug = vi.spyOn(console, 'debug')

    try {
      dispatchKeyDown(textarea, 'x')
      dispatchInsertText(textarea, 'x')
      dispatchInput(textarea, 'sensitive-command', 'insertText')

      const loggedArguments = JSON.stringify(debug.mock.calls)
      expect(received).toEqual(['x', 'sensitive-command'])
      expect(loggedArguments).not.toContain('x')
      expect(loggedArguments).not.toContain('sensitive-command')
    } finally {
      debug.mockRestore()
    }
  })

  it('bounds delayed keydown markers to the newest 32 payloads', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')
    const keys = [...'abcdefghijklmnopqrstuvwxyz0123456']

    for (const key of keys) dispatchKeyDown(textarea, key)
    for (const key of keys) dispatchInsertText(textarea, key)

    // The oldest marker is evicted at the cap; the retained 32 still dedupe.
    expect(received).toEqual([...keys, keys[0]])
  })

  it('expires unmatched keydown markers before later text input', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)

    dispatchKeyDown(textarea, 'a')
    now.mockReturnValue(1001)
    dispatchInsertText(textarea, 'a')

    expect(received).toEqual(['a', 'a'])
  })

  it('still emits IME commits that never produced a keydown payload', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')

    // IME input: keydown reports a process/dead key that carries no payload,
    // the committed text arrives through the input event alone.
    const imeKeyDown = new KeyboardEvent('keydown', {
      key: 'Process',
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(imeKeyDown, 'keyCode', {
      value: 229,
      configurable: true,
    })
    textarea.dispatchEvent(imeKeyDown)
    dispatchInsertText(textarea, '中')
    dispatchKeyUp(textarea, 'Process')

    expect(received).toEqual(['中'])
  })

  it('sends a composition commit once and clears stale keydown markers', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')

    dispatchKeyDown(textarea, 'a')
    textarea.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    textarea.value = 'a'
    textarea.dispatchEvent(
      new CompositionEvent('compositionupdate', { data: 'a', bubbles: true }),
    )
    textarea.dispatchEvent(
      new InputEvent('input', {
        data: 'a',
        inputType: 'insertFromComposition',
        bubbles: true,
      }),
    )
    textarea.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    dispatchKeyDown(textarea, 'a')
    dispatchInsertText(textarea, 'a')

    expect(received).toEqual(['a', 'a', 'a'])
  })

  it('still emits text from native insertText input events', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')

    dispatchInsertText(textarea, 'pasted')

    expect(received).toEqual(['pasted'])
  })

  it('keeps native paste and insertFromPaste outside the keydown FIFO', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')

    dispatchKeyDown(textarea, 'a')
    dispatchPaste(textarea, 'pasted')
    dispatchInput(textarea, 'pasted', 'insertFromPaste')
    dispatchKeyDown(textarea, 'a')
    dispatchInsertText(textarea, 'a')

    expect(received).toEqual(['a', 'pasted', 'a'])
  })

  it('cancels an active IME composition without sending Escape, then sends a later Escape', async () => {
    const term = await openTerminal(WKWEBVIEW_UA)
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')

    textarea.value = 'nihao'
    textarea.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    textarea.dispatchEvent(
      new CompositionEvent('compositionupdate', {
        data: 'nihao',
        bubbles: true,
      }),
    )

    dispatchEscapeDown(textarea)
    expect(received).toEqual([])

    // A native IME cancellation clears the marked text before compositionend.
    textarea.value = ''
    textarea.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
    dispatchEscapeUp(textarea)
    expect(received).toEqual([])
    await new Promise(resolve => setTimeout(resolve, 0))
    dispatchEscape(textarea)

    expect(received).toEqual(['\x1b'])
  })

  it('also deduplicates on Chromium, whose UA reports AppleWebKit', async () => {
    const term = await openTerminal(CHROME_UA)
    const received = collectData(term)

    typeCharacter(term, 'a')

    expect(received).toEqual(['a'])
  })

  it('leaves the upstream non-WebKit guard untouched', async () => {
    // Only a Gecko UA skips the fork's WebKit branch, where xterm.js still
    // deduplicates through `ev.composed && this._keyDownSeen`.
    const term = await openTerminal(FIREFOX_UA)
    const received = collectData(term)
    const textarea = term.textarea
    if (!textarea) throw new Error('xterm did not create its helper textarea')

    dispatchKeyDown(textarea, 'a')
    textarea.value = 'a'
    textarea.dispatchEvent(
      new InputEvent('input', {
        data: 'a',
        inputType: 'insertText',
        composed: true,
        bubbles: true,
      }),
    )
    dispatchKeyUp(textarea, 'a')

    expect(received).toEqual(['a'])
  })
})
