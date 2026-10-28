import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const handleHostWake = vi.fn()

vi.mock('@/features/terminal/services/terminal-session-manager', () => ({
  terminalSessionManager: {
    handleHostWake: () => handleHostWake(),
  },
}))

import { useTerminalHostWake } from './use-terminal-host-wake'

function Probe() {
  useTerminalHostWake()
  return null
}

function setVisibility(state: string) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
}

describe('useTerminalHostWake', () => {
  afterEach(() => {
    handleHostWake.mockReset()
    setVisibility('visible')
    vi.useRealTimers()
  })

  it('resumes sessions when the window becomes visible again', () => {
    const view = render(<Probe />)
    setVisibility('hidden')

    document.dispatchEvent(new Event('visibilitychange'))
    expect(handleHostWake).not.toHaveBeenCalled()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(handleHostWake).toHaveBeenCalledTimes(1)

    view.unmount()
  })

  it('resumes sessions when the window regains focus', () => {
    render(<Probe />)

    window.dispatchEvent(new Event('focus'))

    expect(handleHostWake).toHaveBeenCalledTimes(1)
  })

  it('resumes sessions when the network returns while the window never lost focus', () => {
    // A Wi-Fi dropout on an awake, focused Mac raises no visibility or focus
    // event at all: the OS keeps asserting the link is up while traffic goes
    // nowhere. Without the connectivity event an exhausted session would sit
    // in its retryable error until the user noticed and pressed reconnect.
    render(<Probe />)

    window.dispatchEvent(new Event('online'))

    expect(handleHostWake).toHaveBeenCalledTimes(1)
  })

  it('resumes sessions from Page Lifecycle wake events', () => {
    render(<Probe />)

    window.dispatchEvent(new Event('pageshow'))
    document.dispatchEvent(new Event('resume'))

    expect(handleHostWake).toHaveBeenCalledTimes(2)
  })

  it('detects a suspended timer by wall-clock drift after host sleep', async () => {
    vi.useFakeTimers()
    const view = render(<Probe />)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(handleHostWake).not.toHaveBeenCalled()

    vi.setSystemTime(Date.now() + 20_000)
    await vi.advanceTimersByTimeAsync(15_000)

    expect(handleHostWake).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('stops listening after unmount so a stale hook cannot resume sessions', () => {
    vi.useFakeTimers()
    const view = render(<Probe />)
    view.unmount()

    document.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new Event('resume'))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('pageshow'))
    vi.setSystemTime(Date.now() + 20_000)
    vi.advanceTimersByTime(15_000)

    expect(handleHostWake).not.toHaveBeenCalled()
  })
})
