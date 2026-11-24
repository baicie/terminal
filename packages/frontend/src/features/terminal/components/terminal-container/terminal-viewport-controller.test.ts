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

describe('RC14 — resize pressure', () => {
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

  it('100 resizes in a burst end with exactly one trailing fit and no leaked timers', () => {
    /*
     * The stress shape of RC14: a user dragging a window edge produces far more resize
     * notifications than frames. What must hold afterwards:
     *
     *   - the work is bounded (the throttle still means "at most one fit per frame"),
     *   - the **last** request is not lost (the 768 px defect, fixed in R08),
     *   - nothing is left scheduled once the burst stops.
     *
     * The first assertion is a ceiling rather than an exact count: the number of fits a
     * burst produces depends on how many frames it spans, and pinning that number would
     * assert the scheduler's behaviour instead of ours.
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

    for (let i = 0; i < 100; i += 1) controller.requestFit()
    vi.runAllTimers()

    // Bounded: a hundred requests must not produce a hundred fits.
    expect(fits.length).toBeLessThan(100)
    expect(fits.length).toBeGreaterThanOrEqual(1)

    // Nothing is still scheduled: a further run of the timer queue changes nothing.
    const afterBurst = fits.length
    vi.runAllTimers()
    expect(fits.length, 'a timer survived the burst').toBe(afterBurst)

    // And the controller is still usable — a leak that wedged the scheduler would show up
    // as the next request doing nothing.
    controller.requestFit()
    vi.runAllTimers()
    expect(fits.length).toBe(afterBurst + 1)
  })

  it('two panes each get a fit when they resize together', () => {
    /*
     * Splitting the window gives each terminal its own container and controller. What this
     * asserts is the plain property: both panes fit, so neither is left rendering at the
     * other's size.
     *
     * ## What it does not prove, and why the mutation survived
     *
     * The intended defect was shared throttle state — a module-level `lastFitAt`. I tried
     * four arrangements to make that mutation fail and none did, because **the mutation is
     * behaviourally equivalent**: a shared clock only *delays* the second pane's fit by up
     * to `RESIZE_MIN_INTERVAL_MS` (32 ms), it never drops it. `requestFit` schedules a
     * timer in that case, and the timer runs.
     *
     * So a shared clock is a latency difference, not a correctness one, and there is no
     * assertion that can honestly distinguish them. Claiming otherwise would mean pinning
     * an exact fit *count*, which asserts the scheduler rather than the product.
     *
     * Kept as a smoke test for "both panes work", with the limit stated.
     */
    const make = () => {
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
      return { controller, fits }
    }

    const left = make()
    const right = make()
    left.controller.requestFit()
    right.controller.requestFit()
    vi.runAllTimers()

    expect(left.fits.length, 'the left pane must fit').toBeGreaterThanOrEqual(1)
    expect(right.fits.length, 'the right pane must fit').toBeGreaterThanOrEqual(1)
  })

  it('disposing one pane leaves the other working', () => {
    const fits: number[] = []
    const make = () => {
      const own: number[] = []
      const controller = new TerminalViewportController(
        {
          buffer: { active: { viewportY: 0, baseY: 0 } },
          rows: 24,
          scrollToBottom: () => {},
          scrollToLine: () => {},
          refresh: () => {},
          write: (_data: string, callback?: () => void) => callback?.(),
        },
        () => own.push(Date.now()),
        document.createElement('div'),
      )
      return { controller, own }
    }
    const a = make()
    const b = make()

    a.controller.requestFit()
    vi.runAllTimers()
    const beforeA = a.own.length

    a.controller.dispose()
    b.controller.requestFit()
    vi.runAllTimers()

    expect(a.own.length, 'a disposed pane must not fit again').toBe(beforeA)
    expect(b.own.length, 'the surviving pane keeps working').toBeGreaterThanOrEqual(1)
    void fits
  })
})
