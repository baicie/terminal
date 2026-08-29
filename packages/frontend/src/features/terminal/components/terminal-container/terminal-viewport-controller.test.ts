import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalViewportController } from './terminal-viewport-controller'

function createHarness() {
  const host = document.createElement('div')
  const activeBuffer = { viewportY: 40, baseY: 100 }
  const terminal = {
    buffer: { active: activeBuffer },
    rows: 24,
    scrollToBottom: vi.fn(() => {
      activeBuffer.viewportY = activeBuffer.baseY
    }),
    scrollToLine: vi.fn((line: number) => {
      activeBuffer.viewportY = line
    }),
    refresh: vi.fn(),
    write: vi.fn((_data: string, callback?: () => void) => {
      activeBuffer.viewportY = activeBuffer.baseY
      callback?.()
    }),
  }
  const fit = vi.fn(() => {
    activeBuffer.baseY = 120
    activeBuffer.viewportY = 120
  })
  const controller = new TerminalViewportController(terminal, fit, host)
  return { activeBuffer, controller, fit, host, terminal }
}

describe('TerminalViewportController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    )
    vi.stubGlobal('cancelAnimationFrame', (id: number) =>
      window.clearTimeout(id),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('preserves the viewport anchor when a user has scrolled into history', () => {
    const { controller, fit, host, terminal } = createHarness()
    controller.attach()
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }))

    controller.fitNow()

    expect(fit).toHaveBeenCalledOnce()
    expect(terminal.scrollToLine).toHaveBeenCalledWith(40)
    expect(terminal.scrollToBottom).not.toHaveBeenCalled()
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23)
  })

  it('keeps following output when the viewport was pinned to the bottom', () => {
    const { activeBuffer, controller, terminal } = createHarness()
    activeBuffer.viewportY = activeBuffer.baseY

    controller.fitNow()

    expect(terminal.scrollToBottom).toHaveBeenCalledOnce()
    expect(terminal.scrollToLine).not.toHaveBeenCalled()
  })

  it('restores an unpinned viewport only after xterm parses an output batch', () => {
    const { controller, host, terminal } = createHarness()
    controller.attach()
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }))
    const parsed = vi.fn()

    controller.write('output', parsed)

    expect(terminal.write).toHaveBeenCalledWith('output', expect.any(Function))
    expect(terminal.scrollToLine).toHaveBeenCalledWith(40)
    expect(parsed).toHaveBeenCalledOnce()
  })

  it('rate-limits resize reflows while always running a trailing fit', () => {
    const { controller, fit } = createHarness()

    controller.requestFit()
    vi.runOnlyPendingTimers()
    expect(fit).toHaveBeenCalledOnce()

    controller.requestFit()
    controller.requestFit()
    vi.advanceTimersByTime(31)
    expect(fit).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(1)
    vi.runOnlyPendingTimers()
    expect(fit).toHaveBeenCalledTimes(2)
  })

  it('cancels pending reflows and removes user-scroll listeners on dispose', () => {
    const { controller, fit, host, terminal } = createHarness()
    controller.attach()
    controller.requestFit()
    controller.dispose()
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }))

    vi.runAllTimers()
    controller.fitNow()

    expect(fit).not.toHaveBeenCalled()
    expect(terminal.scrollToLine).not.toHaveBeenCalled()
  })
})
