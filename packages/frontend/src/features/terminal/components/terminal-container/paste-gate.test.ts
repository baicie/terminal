// Every paste route must hit the policy, and each confirmed paste must be
// delivered exactly once (a double delivery would run a command twice).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPasteGate } from './paste-gate'

function fakeTerminal() {
  return { paste: vi.fn() }
}

function pasteEvent(text: string): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    configurable: true,
  })
  return event
}

let container: HTMLElement
let terminal: ReturnType<typeof fakeTerminal>
let confirm: (request: unknown) => Promise<boolean>
let onPasted: () => void
let dispose: () => void

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  terminal = fakeTerminal()
  confirm = vi.fn(async () => true) as unknown as (request: unknown) => Promise<boolean>
  onPasted = vi.fn() as unknown as () => void
  dispose = installPasteGate(container, () => terminal as never, {
    confirm,
    onPasted,
  })
})

afterEach(() => {
  dispose()
  container.remove()
})

describe('plain text', () => {
  it('is delivered immediately without asking', async () => {
    container.dispatchEvent(pasteEvent('ls -la'))
    expect(confirm as unknown as { mock: { calls: unknown[] } }).not.toHaveBeenCalled()
    expect(terminal.paste).toHaveBeenCalledWith('ls -la')
    expect(onPasted as unknown as { mock: { calls: unknown[] } }).toHaveBeenCalled()
  })

  it('is delivered exactly once', async () => {
    container.dispatchEvent(pasteEvent('pwd'))
    expect(terminal.paste).toHaveBeenCalledTimes(1)
  })
})

describe('risky text', () => {
  it('asks before a multi-line paste', async () => {
    container.dispatchEvent(pasteEvent('cd /tmp\nrm -rf ./build'))
    expect(confirm as unknown as { mock: { calls: unknown[] } }).toHaveBeenCalledTimes(1)
    const request = (confirm as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { lineCount: number, risks: string[] }
    expect(request.risks).toContain('multiline')
    expect(request.lineCount).toBe(2)
  })

  it('delivers the exact text when the user confirms, and only then', async () => {
    container.dispatchEvent(pasteEvent('a\nb'))
    await Promise.resolve()
    await Promise.resolve()
    expect(terminal.paste).toHaveBeenCalledTimes(1)
    // The text is not altered: no added return, no stripped newline.
    expect(terminal.paste).toHaveBeenCalledWith('a\nb')
  })

  it('delivers nothing when the user cancels', async () => {
    ;(confirm as unknown as { mockResolvedValue: (v: boolean) => void }).mockResolvedValue(false)
    container.dispatchEvent(pasteEvent('a\nb'))
    await Promise.resolve()
    await Promise.resolve()
    expect(terminal.paste).not.toHaveBeenCalled()
    expect(onPasted as unknown as { mock: { calls: unknown[] } }).not.toHaveBeenCalled()
  })

  it('asks for control characters', () => {
    container.dispatchEvent(pasteEvent('echo hi\u001b[2J'))
    expect(confirm as unknown as { mock: { calls: unknown[] } }).toHaveBeenCalled()
  })
})

describe('the event is always taken from xterm', () => {
  it('cancels the browser paste so the text is not delivered twice', () => {
    const event = pasteEvent('single')
    container.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('cancels even when the user will be asked', () => {
    const event = pasteEvent('a\nb')
    container.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('empty clipboard', () => {
  it('reports an empty paste instead of sending one', () => {
    const onEmpty = vi.fn()
    dispose()
    dispose = installPasteGate(container, () => terminal as never, {
      confirm,
      onPasted,
      onEmpty,
    })
    container.dispatchEvent(pasteEvent(''))
    expect(onEmpty).toHaveBeenCalled()
    expect(terminal.paste).not.toHaveBeenCalled()
  })
})

describe('gating and cleanup', () => {
  it('does nothing when there is no terminal yet', () => {
    dispose()
    dispose = installPasteGate(container, () => null, { confirm, onPasted })
    container.dispatchEvent(pasteEvent('x'))
    expect(terminal.paste).not.toHaveBeenCalled()
  })

  it('stops listening after dispose', () => {
    dispose()
    container.dispatchEvent(pasteEvent('x'))
    expect(terminal.paste).not.toHaveBeenCalled()
  })
})
