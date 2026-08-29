import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  terminalSmokeRoundResult,
  terminalSmokeTestConfig,
} from './terminal-smoke-test-fixtures'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  dispose: vi.fn(),
  emitStaleOutput: vi.fn(),
  focus: vi.fn(),
  invoke: vi.fn(),
  open: vi.fn(),
  reportConnected: vi.fn(),
  reportReconnect: vi.fn(),
  resourceSnapshot: vi.fn(),
  run: vi.fn(),
  submit: vi.fn(),
  useTerminal: vi.fn(),
}))

vi.mock('@baicie/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    buffer = { active: { length: 0, getLine: () => undefined } }
    onWriteParsed = () => ({ dispose: vi.fn() })
    input = vi.fn()
    resize = vi.fn()
    reset = vi.fn()
    dispose = mocks.dispose
    focus = mocks.focus
    open = mocks.open
  },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@/hooks/use-terminal', () => ({ useTerminal: mocks.useTerminal }))
vi.mock('@/features/terminal/services/terminal-session-manager', () => ({
  terminalSessionManager: {
    close: mocks.close,
    resourceSnapshot: mocks.resourceSnapshot,
  },
}))
vi.mock('./run-terminal-smoke', () => ({ runTerminalSmoke: mocks.run }))

import TerminalSmokeRoot from './terminal-smoke-root'

const config = terminalSmokeTestConfig
const result = terminalSmokeRoundResult

beforeEach(() => {
  mocks.close.mockResolvedValue(undefined)
  mocks.invoke.mockResolvedValue({
    managerSessions: [],
    metadata: [],
    channels: [],
    sshPool: [],
    sshRegistry: [],
    outputControls: [],
  })
  mocks.reportConnected.mockResolvedValue(100)
  mocks.reportReconnect.mockResolvedValue(undefined)
  mocks.emitStaleOutput.mockResolvedValue({
    staleMarker: 'TERMINAL_SMOKE_STALE_OUTPUT_CANARY',
    barrierMarker: 'TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER',
  })
  mocks.resourceSnapshot.mockReturnValue({
    recordTabIds: [],
    sessionMappings: [],
  })
  mocks.run.mockResolvedValue(result)
  mocks.submit.mockResolvedValue(undefined)
  mocks.useTerminal.mockImplementation((_term, request) => ({
    sessionId: `ssh-session-${request.tabId}`,
    status: 'connected',
    error: null,
    write: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  }))
})

afterEach(async () => {
  cleanup()
  await Promise.resolve()
  await Promise.resolve()
  vi.clearAllMocks()
})

it('reports the first connection once and submits ten completed rounds', async () => {
  const view = render(
    <TerminalSmokeRoot
      config={config}
      submitResult={mocks.submit}
      reportConnected={mocks.reportConnected}
    />,
  )

  await waitFor(() =>
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        roundsCompleted: 10,
        uniqueSessionCount: 10,
        resourcesRecovered: true,
      }),
    ),
  )
  view.rerender(
    <TerminalSmokeRoot
      config={config}
      submitResult={mocks.submit}
      reportConnected={mocks.reportConnected}
    />,
  )

  expect(mocks.useTerminal).toHaveBeenCalled()
  expect(mocks.reportConnected).toHaveBeenCalledTimes(1)
  expect(mocks.run).toHaveBeenCalledTimes(10)
  expect(mocks.reportConnected.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.run.mock.invocationCallOrder[0],
  )
})

it('runs the probe only after reconnecting with a new SSH session', async () => {
  const reconnectConfig = { ...config, reconnectRequired: true }
  let firstRound: {
    sessionId: string | null
    status: string
    error: string | null
  } = {
    sessionId: 'ssh-session-before-reconnect',
    status: 'connected',
    error: null as string | null,
  }
  mocks.useTerminal.mockImplementation((_term, request) => ({
    ...(request.tabId === 'terminal-smoke-ssh-1'
      ? firstRound
      : {
          sessionId: `ssh-session-${request.tabId}`,
          status: 'connected',
          error: null,
        }),
    write: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  }))
  mocks.run.mockImplementation(async (_term, _config, options) => {
    await options.staleOutputProbe?.()
    return { ...result, staleOutputRejected: true }
  })

  const view = render(
    <TerminalSmokeRoot
      config={reconnectConfig}
      submitResult={mocks.submit}
      reportConnected={mocks.reportConnected}
      reportReconnect={mocks.reportReconnect}
      emitStaleOutput={mocks.emitStaleOutput}
    />,
  )

  await waitFor(() => expect(mocks.reportReconnect).toHaveBeenCalledTimes(1))
  expect(mocks.run).not.toHaveBeenCalled()

  firstRound = { sessionId: null, status: 'reconnecting', error: null }
  view.rerender(
    <TerminalSmokeRoot
      config={reconnectConfig}
      submitResult={mocks.submit}
      reportConnected={mocks.reportConnected}
      reportReconnect={mocks.reportReconnect}
      emitStaleOutput={mocks.emitStaleOutput}
    />,
  )
  firstRound = {
    sessionId: 'ssh-session-after-reconnect',
    status: 'connected',
    error: null,
  }
  view.rerender(
    <TerminalSmokeRoot
      config={reconnectConfig}
      submitResult={mocks.submit}
      reportConnected={mocks.reportConnected}
      reportReconnect={mocks.reportReconnect}
      emitStaleOutput={mocks.emitStaleOutput}
    />,
  )

  await waitFor(() =>
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        reconnectObserved: true,
        roundsCompleted: 10,
        uniqueSessionCount: 11,
        staleOutputRejected: true,
      }),
    ),
  )
  expect(mocks.run).toHaveBeenCalledTimes(10)
  expect(mocks.reportConnected).toHaveBeenCalledTimes(1)
  expect(mocks.emitStaleOutput).toHaveBeenCalledWith(
    'ssh-session-before-reconnect',
    'ssh-session-after-reconnect',
  )
})

it('closes the tab session before disposing xterm on unmount', async () => {
  let releaseClose: (() => void) | undefined
  mocks.close.mockReturnValue(
    new Promise<void>(resolve => {
      releaseClose = resolve
    }),
  )
  mocks.useTerminal.mockReturnValue({
    sessionId: null,
    status: 'idle',
    error: null,
    write: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  })
  const view = render(
    <TerminalSmokeRoot
      config={config}
      submitResult={mocks.submit}
      reportConnected={mocks.reportConnected}
    />,
  )

  await waitFor(() => expect(mocks.useTerminal).toHaveBeenCalled())
  view.unmount()
  expect(mocks.close).toHaveBeenCalledWith('terminal-smoke-ssh-1')
  expect(mocks.dispose).not.toHaveBeenCalled()

  await act(async () => releaseClose?.())
  expect(mocks.dispose).toHaveBeenCalledTimes(1)
})

it('uses one absolute 10 second connection deadline across status changes', async () => {
  vi.useFakeTimers()
  let status = 'idle'
  mocks.useTerminal.mockImplementation(() => ({
    sessionId: null,
    status,
    error: null,
    write: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  }))
  const view = render(
    <TerminalSmokeRoot
      config={config}
      submitResult={mocks.submit}
      reportConnected={mocks.reportConnected}
    />,
  )

  try {
    await act(async () => vi.advanceTimersByTimeAsync(9_000))
    expect(mocks.submit).not.toHaveBeenCalled()

    status = 'connecting'
    view.rerender(
      <TerminalSmokeRoot
        config={config}
        submitResult={mocks.submit}
        reportConnected={mocks.reportConnected}
      />,
    )
    await act(async () => vi.advanceTimersByTimeAsync(999))
    expect(mocks.submit).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(26))
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        stage: 'connecting',
        error: expect.stringContaining('within 10000 ms'),
      }),
    )
  } finally {
    view.unmount()
    vi.useRealTimers()
  }
})
