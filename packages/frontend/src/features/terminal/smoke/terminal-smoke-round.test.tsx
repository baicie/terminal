import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { terminalSmokeTestConfig } from './terminal-smoke-test-fixtures'

const mocks = vi.hoisted(() => ({
  useTerminalSmokeRound: vi.fn(() => ({ current: null })),
}))

vi.mock('./use-terminal-smoke-round', () => ({
  useTerminalSmokeRound: mocks.useTerminalSmokeRound,
}))

import { TerminalSmokeRound } from './terminal-smoke-round'
import { terminalSmokeSessionIsReconnect } from './terminal-smoke-session-reconnect'

it('recognizes a replacement session even when reconnecting states were coalesced', () => {
  expect(
    terminalSmokeSessionIsReconnect(true, false, true, 'ssh-old', 'ssh-new'),
  ).toBe(true)
  expect(
    terminalSmokeSessionIsReconnect(true, false, true, 'ssh-old', 'ssh-old'),
  ).toBe(false)
})

it('forwards the host-wake reporter to the smoke round hook', () => {
  const reportHostWake = vi.fn(async () => {})
  const reportConnected = vi.fn(async () => 1)
  const reportReconnect = vi.fn(async () => {})
  const emitStaleOutput = vi.fn(async () => ({
    staleMarker: 'stale',
    barrierMarker: 'barrier',
  }))
  const onComplete = vi.fn()

  render(
    <TerminalSmokeRound
      applicationStartedAt={0}
      config={terminalSmokeTestConfig}
      roundIndex={0}
      signal={new AbortController().signal}
      reportConnected={reportConnected}
      reportReconnect={reportReconnect}
      reportHostWake={reportHostWake}
      emitStaleOutput={emitStaleOutput}
      onComplete={onComplete}
    />,
  )

  expect(mocks.useTerminalSmokeRound).toHaveBeenCalledWith(
    expect.objectContaining({ reportHostWake }),
  )
  expect(mocks.useTerminalSmokeRound).toHaveBeenCalledWith(
    expect.objectContaining({
      config: terminalSmokeTestConfig,
      roundIndex: 0,
      onComplete,
      emitStaleOutput,
    }),
  )
})
