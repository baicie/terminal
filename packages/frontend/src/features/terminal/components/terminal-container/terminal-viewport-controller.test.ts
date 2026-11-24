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

describe('R08 — the last resize of a burst is not discarded', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    )
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('runs a second fit when a resize arrives while one is already scheduled', () => {
    /*
     * ## Why this asserts a call count and not a width
     *
     * A first attempt at this test recorded the container width each fit saw and asserted
     * the last one matched the newest width. It passed on the **broken** code: with only
     * one fit scheduled, that single fit already saw the container's *current* width,
     * because the test changed the width before the queued frame ran. The assertion was
     * satisfied by accident — a vacuous guard, which this repository has a name for.
     *
     * The observable difference between the two implementations is that the broken one
     * schedules **one** fit for a burst of two resizes and the fixed one schedules a
     * second pass for the request it could not take immediately. So the assertion is on
     * that second pass existing.
     *
     * It matters because the second resize may be the last one: no further event will ask
     * for a fit, and the terminal stays at a width the container no longer has. That is
     * the 768 px row measured on the Linux runner — `canvasWidth: 540`, `cols: 50`.
     */
    const fits: number[] = []
    const controller = new TerminalViewportController(
      {
        buffer: { active: { viewportY: 0, baseY: 0 } },
        rows: 24,
        scrollToBottom: () => {},
        scrollToLine: () => {},
        refresh: () => {},
        write: (_data: string, callback?: () => void) => callback?.(),
      },
      () => { fits.push(Date.now()) },
      document.createElement('div'),
    )

    controller.requestFit()   // schedules a fit
    controller.requestFit()   // arrives while that fit is still queued
    vi.runAllTimers()

    expect(fits.length).toBe(2)
  })

  it('does not schedule extra passes when nothing arrives during the fit', () => {
    // The other half: the extra pass is for a *request*, not a timer that always fires.
    // Without this, the fix would double every fit and the throttle would stop meaning
    // anything.
    const fits: number[] = []
    const controller = new TerminalViewportController(
      {
        buffer: { active: { viewportY: 0, baseY: 0 } },
        rows: 24,
        scrollToBottom: () => {},
        scrollToLine: () => {},
        refresh: () => {},
        write: (_data: string, callback?: () => void) => callback?.(),
      },
      () => { fits.push(Date.now()) },
      document.createElement('div'),
    )

    controller.requestFit()
    vi.runAllTimers()

    expect(fits.length).toBe(1)
  })
})
