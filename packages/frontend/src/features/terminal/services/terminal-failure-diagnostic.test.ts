// SSH11 — a jump failure must name the machine the user has to go and fix.
//
// ## Why this is not "just copy"
//
// The user has two logins for a jump connection. `authentication_rejected` alone cannot
// say whether the bastion or the host behind it refused. Pick wrong, change a password
// that was never the problem, and get refused again.
//
// ## Why the matrix is the real test
//
// The failure mode worth guarding is not "the sentence is misspelled" — it is a
// diagnosis attached to the wrong machine. So every case asserts the exact diagnosis,
// and the cases that must produce *nothing* are as important as the ones that must:
// a direct connection has no bastion to blame.

import { describe, expect, it } from 'vitest'
import { classifyTerminalFailure } from './terminal-session-manager-errors'
import {
  DIAGNOSIS_KEYS,
  connectionDiagnostic,
  diagnoseFailure,
} from './terminal-failure-diagnostic'

const ipc = (kind: string, extra: Record<string, unknown> = {}) => ({
  type: kind,
  message: `${kind} happened`,
  ...extra,
})

describe('SSH11 — a refusal names the machine that refused', () => {
  it('a bastion authentication refusal points at the bastion', () => {
    const failure = classifyTerminalFailure(
      ipc('authentication_rejected', { hop: 'bastion', stage: 'authentication' }),
    )
    expect(failure.diagnosis).toBe('bastion-auth-rejected')
  })

  it('a target authentication refusal points at the target', () => {
    const failure = classifyTerminalFailure(
      ipc('authentication_rejected', { hop: 'target', stage: 'authentication' }),
    )
    expect(failure.diagnosis).toBe('target-auth-rejected')
  })

  it('the two refusals are distinguishable, which is the entire point', () => {
    const bastion = diagnoseFailure({ kind: 'authentication_rejected', hop: 'bastion' })
    const target = diagnoseFailure({ kind: 'authentication_rejected', hop: 'target' })
    expect(bastion).not.toBe(target)
    expect(bastion).toBeDefined()
  })

  it('a direct authentication refusal claims no machine', () => {
    // Two logins exist only when there is a bastion. Telling a direct-connection user
    // to "check the target account" invents a machine they never configured.
    const failure = classifyTerminalFailure(
      ipc('authentication_rejected', { stage: 'authentication' }),
    )
    expect(failure.diagnosis).toBeUndefined()
  })
})

describe('SSH11 — reachability failures name the hop that did not answer', () => {
  it('a bastion that never answered is reported as unreachable', () => {
    const failure = classifyTerminalFailure(
      ipc('connection_failed', { hop: 'bastion', stage: 'tcp_connect' }),
    )
    expect(failure.diagnosis).toBe('bastion-unreachable')
  })

  it('a target that never answered through an open tunnel is the target', () => {
    const failure = classifyTerminalFailure(
      ipc('connection_failed', { hop: 'target', stage: 'handshake' }),
    )
    expect(failure.diagnosis).toBe('target-handshake-failed')
  })

  it('a tunnel failure blames the path, not either machine', () => {
    /*
     * The bastion holds the channel; the target is at its far end. The SSH API does not
     * say which end refused, so the sentence must not either — claiming the bastion is
     * broken when it merely forbids forwarding sends the user to the wrong machine.
     */
    for (const kind of ['channel_error', 'connection_failed']) {
      const failure = classifyTerminalFailure(
        ipc(kind, { hop: 'bastion', stage: 'tunnel_open' }),
      )
      expect(failure.diagnosis).toBe('tunnel-failed')
    }
  })
})

describe('SSH11 — a changed host key says whose identity changed', () => {
  it('a bastion key mismatch names the bastion', () => {
    const failure = classifyTerminalFailure(
      ipc('host_key_rejected', { hop: 'bastion', stage: 'tcp_connect' }),
    )
    expect(failure.diagnosis).toBe('bastion-host-key-rejected')
  })

  it('a target key mismatch names the target and says the bastion was fine', () => {
    const failure = classifyTerminalFailure(
      ipc('host_key_rejected', { hop: 'target', stage: 'handshake' }),
    )
    expect(failure.diagnosis).toBe('target-host-key-rejected')
  })

  it('the host-key diagnosis wins over the reachability one for the same stage', () => {
    /*
     * Both branches match `hop: bastion, stage: tcp_connect`. A key mismatch is a
     * *different* problem with a different fix, and reporting it as "unreachable" would
     * tell the user to check their network when the server's identity is what changed.
     */
    const failure = classifyTerminalFailure(
      ipc('host_key_rejected', { hop: 'bastion', stage: 'tcp_connect' }),
    )
    expect(failure.diagnosis).not.toBe('bastion-unreachable')
  })
})

describe('SSH11 — a diagnosis never changes the retry decision', () => {
  it('every diagnosis leaves retryable and recovery exactly as the kind decides', () => {
    // SSH10 pinned this for hop; a diagnosis is derived from hop, so it must not leak
    // back into the decision either. A bastion key mismatch and a direct one retry the
    // same way: nothing about a retry can change a server's identity.
    const situations: Array<Record<string, unknown>> = [
      {},
      { hop: 'bastion', stage: 'authentication' },
      { hop: 'target', stage: 'authentication' },
      { hop: 'bastion', stage: 'tunnel_open' },
      { hop: 'bastion', stage: 'tcp_connect' },
      { hop: 'target', stage: 'handshake' },
    ]
    for (const kind of ['authentication_rejected', 'host_key_rejected', 'connection_failed']) {
      const baseline = classifyTerminalFailure(ipc(kind))
      for (const extra of situations) {
        const failure = classifyTerminalFailure(ipc(kind, extra))
        expect(
          { retryable: failure.retryable, recovery: failure.recovery },
          `${kind} with ${JSON.stringify(extra)}`,
        ).toEqual({ retryable: baseline.retryable, recovery: baseline.recovery })
      }
    }
  })
})

describe('SSH11 — the sentence survives a missing translation', () => {
  it('falls back to the original error rather than showing a raw key', () => {
    // i18next renders a missing key as the key itself. `terminal.diagnostic.x` on
    // screen is worse than the error it was meant to explain.
    const t = ((key: string) => key) as never
    expect(connectionDiagnostic('bastion-auth-rejected', 'original', t)).toBe('original')
  })

  it('returns the fallback untouched when there is no diagnosis', () => {
    const t = ((key: string) => `translated:${key}`) as never
    expect(connectionDiagnostic(undefined, 'original', t)).toBe('original')
  })

  it('renders the translated sentence when the key resolves', () => {
    const t = ((key: string) => `translated:${key}`) as never
    expect(connectionDiagnostic('tunnel-failed', 'original', t)).toBe(
      `translated:${DIAGNOSIS_KEYS['tunnel-failed']}`,
    )
  })

  it('every diagnosis has a key', () => {
    // A diagnosis with no key would silently fall back to the plain error, and the
    // feature would look implemented while doing nothing for that case.
    const all = [
      'bastion-auth-rejected',
      'target-auth-rejected',
      'bastion-unreachable',
      'target-handshake-failed',
      'tunnel-failed',
      'bastion-host-key-rejected',
      'target-host-key-rejected',
    ] as const
    for (const diagnosis of all) {
      expect(DIAGNOSIS_KEYS[diagnosis], diagnosis).toBeTruthy()
    }
    expect(Object.keys(DIAGNOSIS_KEYS).sort()).toEqual([...all].sort())
  })
})
