import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { UseTerminalOptions } from '@/hooks/terminal-session-types'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  useTerminal: vi.fn(),
  write: vi.fn(),
}))

vi.mock('@baicie/xterm', () => ({
  Terminal: class {
    cols = 96
    rows = 24
    open = vi.fn()
    focus = vi.fn()
    dispose = vi.fn()
  },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/hooks/use-terminal', () => ({ useTerminal: mocks.useTerminal }))
vi.mock('@/features/terminal/services/terminal-session-manager', () => ({
  terminalSessionManager: { close: mocks.close },
}))

import TerminalInputProbe from './index'

let request: UseTerminalOptions

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useTerminal.mockImplementation(
    (_term: unknown, options: UseTerminalOptions) => {
      request = options
      return {
        status: 'connected',
        error: null,
        write: mocks.write,
        getInputDiagnostics: () => null,
      }
    },
  )
})

it('starts a PTY probe with the marker-safe shell command', () => {
  render(<TerminalInputProbe />)

  fireEvent.click(screen.getByRole('button', { name: 'experiments.inputProbeStart' }))

  expect(mocks.write).toHaveBeenCalledWith(
    expect.stringContaining('stty -echo'),
  )
  expect(request.tabType).toBe('local')
  expect(request.onInput).toEqual(expect.any(Function))
  expect(request.onOutput).toEqual(expect.any(Function))
})

it('marks a one-round ready/result exchange as passed', () => {
  render(<TerminalInputProbe />)
  fireEvent.change(screen.getByLabelText('experiments.inputProbeRounds'), {
    target: { value: '1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'experiments.inputProbeStart' }))

  const command = String(mocks.write.mock.calls[0]?.[0])
  const nonce = command.match(/__tip_n='([^']+)'/)?.[1]
  expect(nonce).toBeTruthy()
  const ready = `__TERMINAL_INPUT_PROBE_${nonce}_READY__`
  const result = `__TERMINAL_INPUT_PROBE_${nonce}_RESULT__617364__END__`

  request.onOutput?.({ data: ready, bytes: new TextEncoder().encode(ready).byteLength })
  request.onInput?.({ kind: 'text', data: 'asd\r', bytes: 4 })
  request.onOutput?.({ data: result, bytes: new TextEncoder().encode(result).byteLength })

  expect(screen.getAllByText('1/1').length).toBeGreaterThan(0)
})
