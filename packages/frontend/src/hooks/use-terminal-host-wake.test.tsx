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

  it('stops listening after unmount so a stale hook cannot resume sessions', () => {
    const view = render(<Probe />)
    view.unmount()

    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))

    expect(handleHostWake).not.toHaveBeenCalled()
  })
})
