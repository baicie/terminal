import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terminal as XTerminal } from '@baicie/xterm'
import { registerTerminalInput } from './terminal-input-registration'

type DataHandler = (data: string) => void

function createTerminalStub(withTextarea = false) {
  const dataHandlers = new Set<DataHandler>()
  const binaryHandlers = new Set<DataHandler>()
  const textarea = withTextarea ? document.createElement('textarea') : null
  const element = withTextarea ? document.createElement('div') : undefined
  if (textarea) element?.append(textarea)
  const term = {
    onData: vi.fn((handler: DataHandler) => {
      dataHandlers.add(handler)
      return { dispose: vi.fn(() => dataHandlers.delete(handler)) }
    }),
    onBinary: vi.fn((handler: DataHandler) => {
      binaryHandlers.add(handler)
      return { dispose: vi.fn(() => binaryHandlers.delete(handler)) }
    }),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
    element,
  }

  return {
    term: term as unknown as XTerminal,
    textarea,
    emitData(data: string) {
      if (dataHandlers.size === 0) {
        throw new Error('onData handler was not registered')
      }
      for (const handler of dataHandlers) handler(data)
    },
    emitBinary(data: string) {
      if (binaryHandlers.size === 0) {
        throw new Error('onBinary handler was not registered')
      }
      for (const handler of binaryHandlers) handler(data)
    },
  }
}

function inputEvent(
  data: string,
  options: { isComposing?: boolean; inputType?: string } = {},
): InputEvent {
  return new InputEvent('input', {
    data,
    inputType: options.inputType ?? 'insertText',
    isComposing: options.isComposing ?? false,
  })
}

describe('registerTerminalInput', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('forwards control keys and pasted data without interpreting shell state', () => {
    const terminal = createTerminalStub()
    const write = vi.fn()
    const cleanup = registerTerminalInput({
      term: terminal.term,
      tabType: 'local',
      sessionIdRef: { current: null },
      write,
    })

    terminal.emitData('\t')
    terminal.emitData('\x1b[A')
    terminal.emitData('\x1b[B')
    terminal.emitData('\x03')
    terminal.emitData('中文🙂\r\n')

    expect(write).toHaveBeenCalledTimes(5)
    expect(write.mock.calls.map(([data]) => data)).toEqual([
      '\t',
      '\x1b[A',
      '\x1b[B',
      '\x03',
      '中文🙂\r\n',
    ])
    for (const dispose of cleanup) dispose()
  })

  it('does not drop input while the session id is still pending when a queue writer is supplied', () => {
    const terminal = createTerminalStub()
    const write = vi.fn()
    const cleanup = registerTerminalInput({
      term: terminal.term,
      tabType: 'remote',
      sessionIdRef: { current: null },
      write,
    })

    terminal.emitData('echo before ready\r')

    expect(write).toHaveBeenCalledWith('echo before ready\r')
    for (const dispose of cleanup) dispose()
  })

  it('forwards every onBinary byte through the raw writer', () => {
    const terminal = createTerminalStub()
    const write = vi.fn()
    const writeRaw = vi.fn()
    const cleanup = registerTerminalInput({
      term: terminal.term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
      writeRaw,
    })

    terminal.emitBinary(String.fromCharCode(0, 0x7f, 0xc3, 0xa9))

    expect(write).not.toHaveBeenCalled()
    expect(writeRaw).toHaveBeenCalledWith(
      Uint8Array.from([0, 0x7f, 0xc3, 0xa9]),
    )
    for (const dispose of cleanup) dispose()
  })

  it('reports text and raw input in the same order they enter the FIFO', () => {
    const terminal = createTerminalStub()
    const write = vi.fn()
    const writeRaw = vi.fn()
    const onInput = vi.fn()
    const cleanup = registerTerminalInput({
      term: terminal.term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
      writeRaw,
      onInput,
    })

    terminal.emitData('asd')
    terminal.emitBinary(String.fromCharCode(0x80, 0xff))

    expect(onInput.mock.calls.map(([event]) => event)).toEqual([
      { kind: 'text', data: 'asd', bytes: 3 },
      { kind: 'raw', data: Uint8Array.from([0x80, 0xff]), bytes: 2 },
    ])
    expect(write).toHaveBeenCalledWith('asd')
    expect(writeRaw).toHaveBeenCalledWith(Uint8Array.from([0x80, 0xff]))
    for (const dispose of cleanup) dispose()
  })

  it('forwards non-UTF-8 onBinary bytes without rewriting them', () => {
    const terminal = createTerminalStub()
    const write = vi.fn()
    const writeRaw = vi.fn()
    const cleanup = registerTerminalInput({
      term: terminal.term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
      writeRaw,
    })

    terminal.emitBinary(String.fromCharCode(0x80))

    expect(write).not.toHaveBeenCalled()
    expect(writeRaw).toHaveBeenCalledWith(Uint8Array.from([0x80]))
    for (const dispose of cleanup) dispose()
  })

  it('does not duplicate delayed xterm data after a WebKit DOM input event', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    )
    const terminal = createTerminalStub(true)
    const write = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const cleanup = registerTerminalInput({
      term: terminal.term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
    })

    terminal.textarea?.dispatchEvent(inputEvent('x'))
    frames.splice(0).forEach(callback => callback(0))
    terminal.emitData('x')

    expect(write.mock.calls.map(([data]) => data)).toEqual(['x'])
    for (const dispose of cleanup) dispose()
  })

  it('forwards repeated characters only through the xterm onData contract', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    )
    const terminal = createTerminalStub(true)
    const write = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const cleanup = registerTerminalInput({
      term: terminal.term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
    })

    terminal.textarea?.dispatchEvent(inputEvent('c'))
    terminal.textarea?.dispatchEvent(inputEvent('c'))
    frames.splice(0).forEach(callback => callback(0))
    expect(write).not.toHaveBeenCalled()

    terminal.emitData('c')
    terminal.emitData('c')

    expect(write.mock.calls.map(([data]) => data)).toEqual(['c', 'c'])
    for (const dispose of cleanup) dispose()
  })

  it('skips unrelated WebKit control data when matching text input', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    )
    const terminal = createTerminalStub(true)
    const write = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const cleanup = registerTerminalInput({
      term: terminal.term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
    })

    terminal.emitData('\x1b[A')
    terminal.emitData('a')
    terminal.textarea?.dispatchEvent(inputEvent('a'))
    frames.splice(0).forEach(callback => callback(0))

    expect(write.mock.calls.map(([data]) => data)).toEqual(['\x1b[A', 'a'])
    for (const dispose of cleanup) dispose()
  })

  it('matches split WebKit input events to one multi-character onData event', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    )
    const terminal = createTerminalStub(true)
    const write = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const cleanup = registerTerminalInput({
      term: terminal.term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
    })

    terminal.emitData('ab')
    terminal.textarea?.dispatchEvent(inputEvent('a'))
    terminal.textarea?.dispatchEvent(inputEvent('b'))
    frames.splice(0).forEach(callback => callback(0))

    expect(write.mock.calls.map(([data]) => data)).toEqual(['ab'])
    for (const dispose of cleanup) dispose()
  })

  it('does not forward intermediate WebKit IME composition text', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    )
    const terminal = createTerminalStub(true)
    const write = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const cleanup = registerTerminalInput({
      term: terminal.term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
    })

    terminal.textarea?.dispatchEvent(new CompositionEvent('compositionstart'))
    terminal.textarea?.dispatchEvent(
      inputEvent('中', {
        isComposing: true,
        inputType: 'insertCompositionText',
      }),
    )
    terminal.textarea?.dispatchEvent(
      inputEvent('中文', {
        isComposing: true,
        inputType: 'insertCompositionText',
      }),
    )
    frames.splice(0).forEach(callback => callback(0))
    terminal.textarea?.dispatchEvent(new CompositionEvent('compositionend'))
    terminal.emitData('中文')
    terminal.textarea?.dispatchEvent(
      inputEvent('中文', { inputType: 'insertFromComposition' }),
    )
    frames.splice(0).forEach(callback => callback(1))

    expect(write.mock.calls.map(([data]) => data)).toEqual(['中文'])
    for (const dispose of cleanup) dispose()
  })

  it('disposes xterm data and binary listeners on cleanup', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    )
    const terminal = createTerminalStub(true)
    const write = vi.fn()
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const cleanup = registerTerminalInput({
      term: terminal.term,
      tabType: 'local',
      sessionIdRef: { current: 'session-1' },
      write,
    })

    terminal.textarea?.dispatchEvent(inputEvent('z'))
    for (const dispose of cleanup) dispose()
    for (const callback of frames.values()) callback(0)

    expect(write).not.toHaveBeenCalled()
    expect(() => terminal.emitData('a')).toThrow(
      'onData handler was not registered',
    )
    expect(() => terminal.emitBinary('a')).toThrow(
      'onBinary handler was not registered',
    )
  })
})
