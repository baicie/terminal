import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  backendResourceBaseline,
  frontendResourceBaseline,
  terminalSmokeResourceSequences,
  terminalSmokeRoundResult,
  terminalSmokeTestConfig,
} from './terminal-smoke-test-fixtures'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  invoke: vi.fn(),
  reportConnected: vi.fn(),
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
    dispose = vi.fn()
    focus = vi.fn()
    input = vi.fn()
    onWriteParsed = () => ({ dispose: vi.fn() })
    open = vi.fn()
    resize = vi.fn()
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
const roundResult = terminalSmokeRoundResult

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reportConnected.mockResolvedValue(100)
  mocks.submit.mockResolvedValue(undefined)
})

afterEach(() => cleanup())

it('runs ten isolated SSH rounds and waits for exact resource recovery', async () => {
  const sequences = terminalSmokeResourceSequences(config.rounds)

  let frontReads = 0
  let backReads = 0
  const roundStarts = new Map<string, { front: number; back: number }>()
  const closeResolved = new Map<string, { front: number; back: number }>()
  const terminalTabs = new WeakMap<object, string>()
  const runTabs: string[] = []
  const events: string[] = []

  mocks.resourceSnapshot.mockImplementation(() => {
    const snapshot = sequences.frontend[frontReads] ?? frontendResourceBaseline
    frontReads += 1
    return snapshot
  })
  mocks.invoke.mockImplementation(async (command: string) => {
    expect(command).toBe('terminal_smoke_resources')
    const snapshot = sequences.backend[backReads] ?? backendResourceBaseline
    backReads += 1
    return snapshot
  })
  mocks.useTerminal.mockImplementation((term, request) => {
    terminalTabs.set(term, request.tabId)
    if (!roundStarts.has(request.tabId)) {
      roundStarts.set(request.tabId, { front: frontReads, back: backReads })
    }
    return {
      sessionId: `ssh-session-${request.tabId}`,
      status: 'connected',
      error: null,
      write: vi.fn(),
      reconnect: vi.fn(),
      disconnect: vi.fn(),
    }
  })
  mocks.run.mockImplementation(async term => {
    const tabId = terminalTabs.get(term)
    if (!tabId) throw new Error('round terminal was not bound to a tab')
    events.push(`run:${tabId}`)
    runTabs.push(tabId)
    return roundResult
  })
  mocks.close.mockImplementation(async (tabId: string) => {
    events.push(`close:${tabId}`)
    await Promise.resolve()
    if (!closeResolved.has(tabId)) {
      closeResolved.set(tabId, { front: frontReads, back: backReads })
    }
  })

  render(
    <TerminalSmokeRoot
      config={config}
      submitResult={mocks.submit}
      reportConnected={mocks.reportConnected}
    />,
  )

  await waitFor(() => expect(mocks.submit).toHaveBeenCalled(), {
    timeout: 10_000,
  })
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      ok: true,
      roundsCompleted: 10,
      uniqueSessionCount: 10,
      resourcesRecovered: true,
    }),
  )

  const requests = new Map(
    mocks.useTerminal.mock.calls.map(([, request]) => [request.tabId, request]),
  )
  expect(requests.size).toBe(10)
  expect(runTabs).toEqual([...requests.keys()])
  expect(new Set(runTabs).size).toBe(10)
  expect(new Set(runTabs.map(tabId => `ssh-session-${tabId}`)).size).toBe(10)
  for (const request of requests.values()) {
    expect(request).toMatchObject({
      workspaceId: 'terminal-smoke',
      tabType: 'remote',
      expectedHostKey: config.ssh.expectedHostKey,
      cols: config.initialCols,
      rows: config.initialRows,
      host: {
        hostname: config.ssh.host,
        port: config.ssh.port,
        username: config.ssh.username,
        authType: 'key',
        privateKey: config.ssh.privateKey,
      },
    })
  }

  const expectedReads = Array.from({ length: 10 }, (_, index) => 3 + index * 5)
  expect([...roundStarts.values()].map(value => value.front)).toEqual(
    expectedReads,
  )
  expect([...roundStarts.values()].map(value => value.back)).toEqual(
    expectedReads,
  )
  expect([...closeResolved.values()].map(value => value.front)).toEqual(
    expectedReads,
  )
  expect([...closeResolved.values()].map(value => value.back)).toEqual(
    expectedReads,
  )
  expect(frontReads).toBe(53)
  expect(backReads).toBe(53)
  for (const tabId of runTabs) {
    expect(events.indexOf(`run:${tabId}`)).toBeLessThan(
      events.indexOf(`close:${tabId}`),
    )
  }
}, 15_000)

it('preserves the round failure when resource recovery also fails', async () => {
  mocks.resourceSnapshot.mockReturnValue(frontendResourceBaseline)
  mocks.invoke
    .mockResolvedValueOnce(backendResourceBaseline)
    .mockResolvedValueOnce(backendResourceBaseline)
    .mockRejectedValueOnce(new Error('resource recovery failed'))
  mocks.close.mockResolvedValue(undefined)
  mocks.useTerminal.mockImplementation((_term, request) => ({
    sessionId: `ssh-session-${request.tabId}`,
    status: 'connected',
    error: null,
    write: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  }))
  mocks.run.mockResolvedValue({
    ...roundResult,
    ok: false,
    stage: 'load',
    error: 'load marker timed out',
    loadBytes: 0,
    loadEndVisible: false,
  })

  render(
    <TerminalSmokeRoot
      config={config}
      submitResult={mocks.submit}
      reportConnected={mocks.reportConnected}
    />,
  )

  await waitFor(() => expect(mocks.submit).toHaveBeenCalled())

  expect(mocks.close).toHaveBeenCalledWith('terminal-smoke-ssh-1')
  expect(mocks.submit).toHaveBeenCalledTimes(1)
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      ok: false,
      stage: 'load',
      error: 'load marker timed out',
      resourcesRecovered: false,
      roundsCompleted: 0,
      uniqueSessionCount: 1,
    }),
  )
})
