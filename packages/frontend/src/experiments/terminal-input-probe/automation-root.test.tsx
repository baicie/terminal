import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ focus: vi.fn(), close: vi.fn() }))
vi.mock('@baicie/xterm', () => ({
  Terminal: class {
    open = vi.fn()
    focus = mocks.focus
    dispose = vi.fn()
    onKey = vi.fn(() => ({ dispose: vi.fn() }))
  },
}))
vi.mock('@/hooks/use-terminal', () => ({
  useTerminal: () => ({ status: 'idle', write: vi.fn() }),
}))
vi.mock('@/features/terminal/services/terminal-session-manager', () => ({
  terminalSessionManager: { close: mocks.close },
}))
vi.mock('./probe-automation', () => ({
  focusInputProbeWindow: vi.fn().mockResolvedValue(undefined),
  publishInputProbeDiag: vi.fn().mockResolvedValue(undefined),
  publishInputProbeReady: vi.fn().mockResolvedValue(undefined),
  publishInputProbeResult: vi.fn().mockResolvedValue(undefined),
}))

import TerminalInputProbeAutomation from './automation-root'

afterEach(cleanup)

it('focuses xterm after clicking blank space in the probe surface', () => {
  render(
    <TerminalInputProbeAutomation
      config={{
        rounds: 30,
        expectedText: 'asd',
        readyPath: '/tmp/ready',
        resultPath: '/tmp/result',
      }}
    />,
  )
  mocks.focus.mockClear()
  fireEvent.click(screen.getByRole('main'))
  expect(mocks.focus).toHaveBeenCalledOnce()
})
