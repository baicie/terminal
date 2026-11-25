// F19 — one connection, one story.
//
// ## The invariant
//
// The same failure is shown in four places: the terminal's error overlay, a toast, the
// `connection_logs` row, and (in the smoke harness) the structured `failureReason`. Each
// may say *less* than another — a log line is shorter than an overlay — but none may
// contradict another. A user who reads "check the bastion's account" in the pane and then
// finds "target" in the log has been told two different things about one event, and the
// one they trust is whichever they read last.
//
// ## What "contradict" means here, precisely
//
// Not "different strings". The overlay renders a sentence, the log stores a detail line,
// the toast shows the raw message. What must agree is the **classification**: which
// machine (`hop`), which step (`stage`), and which situation (`diagnosis`). Those three
// are the product's own vocabulary, produced once by the classifier — so the test asserts
// that every surface reproduces the classifier's answer rather than deriving its own.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const eventHandlers = new Map<string, (event: { payload: unknown }) => void>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      eventHandlers.set(name, handler)
      return () => eventHandlers.delete(name)
    },
  ),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}))

vi.mock('./terminal-launcher', () => ({
  startTerminalShell: vi.fn(async () => 'session-1'),
}))

vi.mock('./terminal-session-transport', () => ({
  terminalSessionTransport: {
    write: vi.fn(async () => {}),
    writeRaw: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    ackOutput: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    cancelConnection: vi.fn(async () => {}),
  },
}))

vi.mock('./serial', () => ({
  serialService: { disconnect: vi.fn(async () => {}) },
}))

const recordedLogs: string[] = []

vi.mock('./session-connection-logs', () => ({
  recordConnectionFailure: vi.fn(async (_host: unknown, _type: string, detail: string) => {
    recordedLogs.push(detail)
    return 'log-1'
  }),
  recordConnectionSuccess: vi.fn(async () => {}),
  finishConnectionLog: vi.fn(async () => {}),
}))

import { startTerminalShell } from './terminal-launcher'
import { classifyTerminalFailure } from './terminal-session-manager-errors'
import { diagnoseFailure } from './terminal-failure-diagnostic'
import {
  TerminalSessionManager,
  type TerminalSessionSnapshot,
} from './terminal-session-manager'

const host = {
  id: 'host-a',
  name: 'prod',
  hostname: 'example.test',
  port: 22,
  username: 'alice',
  authType: 'password' as const,
  password: 'secret',
  isFavorite: false,
  portForwards: [],
  createdAt: 0,
  updatedAt: 0,
}

const jumpHost = { ...host, id: 'jump-a', name: 'bastion', hostname: 'bastion.test' }

function request(withJump: boolean) {
  return {
    tabId: 'f19-tab',
    tabType: 'remote' as const,
    host,
    ...(withJump ? { jumpHost } : {}),
    cols: 80,
    rows: 24,
  }
}

/** Let the dynamic import inside the log helper settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('F19 — every surface tells the same story', () => {
  beforeEach(() => {
    eventHandlers.clear()
    recordedLogs.length = 0
    vi.mocked(startTerminalShell).mockReset()
    vi.mocked(startTerminalShell).mockResolvedValue('session-1')
  })

  const cases = [
    {
      name: 'a bastion credential refusal',
      error: { type: 'authentication_rejected', message: 'denied', hop: 'bastion', stage: 'authentication' },
      withJump: true,
      hop: 'bastion',
      stage: 'authentication',
      diagnosis: 'bastion-auth-rejected',
    },
    {
      name: 'a target credential refusal',
      error: { type: 'authentication_rejected', message: 'denied', hop: 'target', stage: 'authentication' },
      withJump: true,
      hop: 'target',
      stage: 'authentication',
      diagnosis: 'target-auth-rejected',
    },
    {
      name: 'a bastion host-key refusal',
      error: { type: 'host_key_rejected', message: 'changed', hop: 'bastion', stage: 'host_key_verification' },
      withJump: true,
      hop: 'bastion',
      stage: 'host_key_verification',
      diagnosis: 'bastion-host-key-rejected',
    },
    {
      name: 'a refused tunnel',
      error: { type: 'connection_failed', message: 'denied', hop: 'bastion', stage: 'tunnel_open' },
      withJump: true,
      hop: 'bastion',
      stage: 'tunnel_open',
      diagnosis: 'tunnel-failed',
    },
    {
      name: 'a direct unreachable host',
      error: { type: 'connection_failed', message: 'timed out' },
      withJump: false,
      hop: undefined,
      stage: undefined,
      diagnosis: undefined,
    },
  ] as const

  for (const testCase of cases) {
    it(`${testCase.name}: pane, classifier and log agree`, async () => {
      vi.mocked(startTerminalShell).mockRejectedValue(testCase.error)
      const states: TerminalSessionSnapshot[] = []
      const manager = new TerminalSessionManager({ sleep: async () => {} })
      manager.attach(request(testCase.withJump), {
        onOutput: () => {},
        onState: state => states.push(state),
      })

      await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
      await settle()

      // What the classifier decided — the single source every surface must reproduce.
      const classified = classifyTerminalFailure(testCase.error)
      expect(classified.hop).toBe(testCase.hop)
      expect(classified.stage).toBe(testCase.stage)
      expect(
        diagnoseFailure({
          kind: testCase.error.type,
          hop: classified.hop,
          stage: classified.stage,
        }),
      ).toBe(testCase.diagnosis)

      // What the pane renders from (the snapshot the overlay reads).
      expect(states.at(-1)).toMatchObject({
        status: 'error',
        ...(testCase.hop === undefined ? {} : { hop: testCase.hop }),
        ...(testCase.stage === undefined ? {} : { stage: testCase.stage }),
        ...(testCase.diagnosis === undefined
          ? {}
          : { diagnosis: testCase.diagnosis }),
      })
      // Absent must mean absent, not a default that reads as "target".
      if (testCase.hop === undefined) expect(states.at(-1)?.hop).toBeUndefined()
      if (testCase.diagnosis === undefined) {
        expect(states.at(-1)?.diagnosis).toBeUndefined()
      }

      // What the log records.
      expect(recordedLogs).toHaveLength(1)
      const log = recordedLogs[0]!
      expect(log).toContain(classified.error)
      if (testCase.hop !== undefined) expect(log).toContain(`hop=${testCase.hop}`)
      else expect(log).not.toContain('hop=')
      if (testCase.stage !== undefined) expect(log).toContain(`stage=${testCase.stage}`)
      else expect(log).not.toContain('stage=')
      if (testCase.diagnosis !== undefined) {
        expect(log).toContain(`diagnosis=${testCase.diagnosis}`)
      } else {
        expect(log).not.toContain('diagnosis=')
      }
      // The jump marker follows the request, not the failure.
      if (testCase.withJump) expect(log).toContain('via=jump')
      else expect(log).not.toContain('via=jump')

      await manager.close(request(testCase.withJump).tabId)
    })
  }

  it('a vault failure is logged as a credential problem, not a network one', async () => {
    /*
     * The distinction the whole `recovery` field exists for. If the log said "connection
     * failed" for a locked vault, a user reading their history would go looking at their
     * network — the exact misdirection Phase 10.4 removed from the pane.
     */
    const { CredentialFailure } = await import('./credential-failure')
    vi.mocked(startTerminalShell).mockRejectedValue(
      new CredentialFailure('vault-locked', 'The vault is locked.', {
        reason: 'vault-unavailable',
        vaultState: 'locked',
      }),
    )
    const states: TerminalSessionSnapshot[] = []
    const manager = new TerminalSessionManager({ sleep: async () => {} })
    manager.attach(request(false), {
      onOutput: () => {},
      onState: state => states.push(state),
    })

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    await settle()

    expect(states.at(-1)?.credentialKind).toBe('vault-locked')
    expect(states.at(-1)?.recovery).toBe('after-vault')
    expect(states.at(-1)?.retryable).toBe(false)
    expect(recordedLogs[0]).toContain('locked')
    await manager.close(request(false).tabId)
  })
})
