// F21 — the failure log must never carry a secret.
//
// ## The surface this covers
//
// F18 added a `connection_logs` row built from a `TerminalFailure`. That row is written to
// SQLite, shown in the Logs view, and exported in backups — so anything the failure text
// carries ends up somewhere a person can read it later.
//
// The classifier's `error` string is derived from an IPC error's `message`, which Rust
// composes itself; a password or private key never appears there by design. This file
// pins that: the assertions are canaries planted in the *inputs* a failure could plausibly
// carry, and the check is that none of them reaches the log line.
//
// A canary is used rather than a review of the code because "the message is ours" is an
// invariant nobody can keep by reading — the next person to add an error path will not
// re-read this file.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))
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
vi.mock('./serial', () => ({ serialService: { disconnect: vi.fn(async () => {}) } }))

const logs: string[] = []
vi.mock('./session-connection-logs', () => ({
  recordConnectionFailure: vi.fn(async (_h: unknown, _t: string, detail: string) => {
    logs.push(detail)
    return 'log-1'
  }),
  recordConnectionSuccess: vi.fn(async () => {}),
  finishConnectionLog: vi.fn(async () => {}),
}))

import { startTerminalShell } from './terminal-launcher'
import { recordTerminalConnectionFailure } from './terminal-connection-failure-log'

const PRIVATE_KEY = [
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
  '-----END OPENSSH PRIVATE KEY-----',
].join('\n')

const SECRETS = {
  password: 'CANARY-F21-password-4f2a',
  passphrase: 'CANARY-F21-passphrase-9c1d',
  privateKey: PRIVATE_KEY,
}

const request = {
  tabType: 'remote',
  host: {
    id: 'host-a',
    name: 'prod',
    hostname: 'example.test',
    port: 22,
    username: 'alice',
    authType: 'password' as const,
    password: SECRETS.password,
    privateKey: SECRETS.privateKey,
    isFavorite: false,
    portForwards: [],
    createdAt: 0,
    updatedAt: 0,
  },
  jumpHost: {
    id: 'jump-a',
    name: 'bastion',
    hostname: 'bastion.test',
    port: 22,
    username: 'bob',
    authType: 'password' as const,
    password: SECRETS.passphrase,
    isFavorite: false,
    portForwards: [],
    createdAt: 0,
    updatedAt: 0,
  },
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('F21 — the connection log carries no secret', () => {
  beforeEach(() => {
    logs.length = 0
    vi.mocked(startTerminalShell).mockReset()
  })

  it('the host credentials never reach the log line', async () => {
    /*
     * The failure text is what Rust sent, not what the host row holds. Everything the
     * request carries — password, private key, the jump host's passphrase — is planted
     * here and must be absent from the line.
     */
    recordTerminalConnectionFailure(request as never, {
      error: 'authentication rejected',
      hop: 'bastion',
      stage: 'authentication',
      diagnosis: 'bastion-auth-rejected',
    })
    await settle()

    expect(logs).toHaveLength(1)
    const line = logs[0]!
    for (const [name, secret] of Object.entries(SECRETS)) {
      expect(line, `${name} must not appear in the log line`).not.toContain(secret)
    }
    // The classification, which is what the log is for, is still there.
    expect(line).toContain('hop=bastion')
    expect(line).toContain('diagnosis=bastion-auth-rejected')
  })

  it('a message that itself contains a secret is not the log helper\'s to redact', async () => {
    /*
     * Scope statement, not a pass. If Rust ever put a secret in `message`, this helper
     * would write it verbatim — and that is the right division: the log formats, the
     * redactor redacts, and redaction happens at the evidence boundary
     * (`e2e/gui/fixtures/evidence.mjs`), which is the one place a human could publish it.
     *
     * Asserted explicitly so the boundary is a decision rather than an oversight, and so
     * this test fails loudly if someone later assumes the helper sanitises.
     */
    recordTerminalConnectionFailure(request as never, {
      error: `connection failed for ${SECRETS.password}`,
    })
    await settle()

    expect(logs[0]).toContain(SECRETS.password)
    // The failure text is written as given — that is the point of this case.
    expect(logs[0]).toContain('connection failed for')
    // The jump marker follows the request, not the failure, and is not a secret.
    expect(logs[0]).toContain('via=jump')
  })

  it('a local tab writes nothing at all', async () => {
    recordTerminalConnectionFailure(
      { tabType: 'local' } as never,
      { error: 'shell exited' },
    )
    await settle()
    expect(logs).toHaveLength(0)
  })
})
