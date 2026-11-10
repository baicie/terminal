// Phase 10.4 WP-A — a locked vault is not a network problem.
//
// Today every non-listed failure is retryable. `classifyTerminalFailure` knows a
// fixed set of terminal kinds (`authentication_failed`, `key_parse_failed`, …) and
// treats everything else as transient. "The vault is locked" is not in that set,
// so the session manager spends its automatic reconnect budget on it — five
// attempts and a 30 s recovery timer — while the UI says "Waiting to retry".
//
// The user's actual next step is to unlock the vault. Nothing about waiting
// helps, and the retry budget is then unavailable for the network outage that
// might genuinely follow.
//
// The fix cannot be a message match. The resolver already knows *why* it failed
// (`vault-unavailable`, `read-failed`, `corrupt-reference`); that reason has to
// survive to the classifier instead of being flattened into an `Error` with only
// a string.

import { describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    availability: vi.fn(async () => ({ ok: true })),
    read: vi.fn(async () => undefined),
    isAvailable: vi.fn(async () => true),
  },
}))
import { classifyTerminalFailure } from './terminal-session-manager-errors'

describe('a vault failure is terminal, not retryable', () => {
  it('a locked vault does not enter the reconnect budget', () => {
    const failure = classifyTerminalFailure(
      new Error(
        'This host stores its credentials in the vault, which is locked. Unlock the vault and connect again.',
      ),
    )
    expect(failure.retryable).toBe(false)
  })

  it('an uninitialized vault does not enter the reconnect budget', () => {
    const failure = classifyTerminalFailure(
      new Error(
        'This host has a password or private key, but no vault has been set up yet.',
      ),
    )
    expect(failure.retryable).toBe(false)
  })

  it('an unusable vault does not enter the reconnect budget', () => {
    const failure = classifyTerminalFailure(
      new Error(
        'This host has a password or private key, but the vault could not be read.',
      ),
    )
    expect(failure.retryable).toBe(false)
  })

  it('a damaged credential reference does not enter the reconnect budget', () => {
    const failure = classifyTerminalFailure(
      new Error('This host has a stored credential this build cannot read.'),
    )
    expect(failure.retryable).toBe(false)
  })
})

describe('real network failures still retry', () => {
  it('a timeout during authentication stays retryable', () => {
    const failure = classifyTerminalFailure({
      type: 'authentication_failed',
      message: 'connection timed out',
    })
    expect(failure.retryable).toBe(true)
  })

  it('a reset connection stays retryable', () => {
    const failure = classifyTerminalFailure({
      type: 'authentication_failed',
      message: 'connection reset by peer',
    })
    expect(failure.retryable).toBe(true)
  })

  it('rejected credentials do not retry', () => {
    const failure = classifyTerminalFailure({
      type: 'authentication_failed',
      message: 'Permission denied (publickey)',
    })
    expect(failure.retryable).toBe(false)
  })

  it('a vpn switch that looks like a closed transport stays retryable', () => {
    const failure = classifyTerminalFailure({
      type: 'authentication_failed',
      message: 'transport closed',
    })
    expect(failure.retryable).toBe(true)
  })
})

describe('the decision is made on structure, not on text', () => {
  it('a CredentialFailure with an unrecognisable message is still terminal', async () => {
    const { CredentialFailure } = await import('./credential-failure')
    // The message says nothing the classifier could match on. If the decision
    // were text-based this would be retryable.
    const failure = classifyTerminalFailure(
      new CredentialFailure('vault-locked', 'x'),
    )
    expect(failure.retryable).toBe(false)
  })

  it('a plain error whose text merely resembles a network fault stays retryable', async () => {
    // The inverse: no structured kind, and the text is a genuine transient fault.
    const failure = classifyTerminalFailure(
      new Error('connection reset by peer while opening channel'),
    )
    expect(failure.retryable).toBe(true)
  })

  it('the launcher throws a CredentialFailure, not a bare Error', async () => {
    const { withResolvedCredential } = await import('./terminal-launcher')
    const host = {
      id: 'h-1',
      name: 'h',
      hostname: 'h.test',
      port: 22,
      username: 'u',
      authType: 'key',
      credentialRef: null,
      identityFilePath: '~/.ssh/id_ed25519',
      isFavorite: false,
      portForwards: [],
      createdAt: 0,
      updatedAt: 0,
    } as unknown as Host

    await expect(withResolvedCredential(host)).rejects.toMatchObject({
      name: 'CredentialFailure',
      kind: 'credential-not-bound',
    })
  })
})
