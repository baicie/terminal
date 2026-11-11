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

const vault = vi.hoisted(() => ({
  availability: vi.fn(async () => ({ ok: true }) as { ok: boolean, state?: string }),
  read: vi.fn(async () => undefined as string | undefined),
  isAvailable: vi.fn(async () => true),
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    availability: vault.availability,
    availabilityState: vault.availability,
    read: vault.read,
    isAvailable: vault.isAvailable,
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

// Phase 10.4.1 WP3 — the vault state is data, not a sentence.
//
// `credentialFailureFrom` recovered the state with `message.includes('no vault
// has been set up')`. That is the exact technique this module was written to
// replace, kept alive one layer down. The provider now reports the state, and
// these tests make the mapping depend on it: the same sentence must not be able
// to change the outcome.
describe('the vault state comes from the provider, not from the text', () => {
  it('maps an uninitialized vault from the reported state', async () => {
    const { credentialFailureFrom } = await import('./credential-failure')
    const failure = credentialFailureFrom({
      ok: false,
      reason: 'vault-unavailable',
      state: 'uninitialized',
      // A sentence that says nothing about the state the provider reported.
      message: 'The vault could not be read.',
    })
    expect(failure.kind).toBe('vault-uninitialized')
    expect(failure.vaultState).toBe('uninitialized')
  })

  it('maps an unusable vault from the reported state', async () => {
    const { credentialFailureFrom } = await import('./credential-failure')
    const failure = credentialFailureFrom({
      ok: false,
      reason: 'vault-unavailable',
      state: 'unusable',
      message: 'no vault has been set up yet',
    })
    expect(failure.kind).toBe('vault-unusable')
  })

  it('maps a locked vault from the reported state', async () => {
    const { credentialFailureFrom } = await import('./credential-failure')
    const failure = credentialFailureFrom({
      ok: false,
      reason: 'vault-unavailable',
      state: 'locked',
      message: 'no vault has been set up yet',
    })
    expect(failure.kind).toBe('vault-locked')
  })

  it('falls back to unusable when the provider cannot say', async () => {
    // Not locked, not uninitialized: we know the vault cannot be read and not
    // why. Guessing "locked" sends the user to a password prompt that will not
    // help.
    const { credentialFailureFrom } = await import('./credential-failure')
    const failure = credentialFailureFrom({
      ok: false,
      reason: 'vault-unavailable',
      message: 'This host stores its credentials in the vault, which is locked.',
    })
    expect(failure.kind).toBe('vault-unusable')
  })
})

describe('the resolver reports which vault state it hit', () => {
  it('carries the state through instead of only a boolean', async () => {
    const { SessionCredentialResolver } = await import(
      '@/service/credential-boundary'
    )
    const resolver = new SessionCredentialResolver({
      isAvailable: async () => false,
      availabilityState: async () => ({ ok: false, state: 'uninitialized' }),
      read: async () => undefined,
      write: async () => {},
      remove: async () => {},
    })

    const result = await resolver.resolve({
      id: 'h-1',
      name: 'h',
      hostname: 'h.test',
      port: 22,
      username: 'u',
      authType: 'password',
      credentialRef: { kinds: ['password'], provider: 'vault', version: 1 },
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('vault-unavailable')
    if (result.reason !== 'vault-unavailable') throw new Error('unreachable')
    expect(result.state).toBe('uninitialized')
    // The sentence matches the state rather than a generic "unavailable".
    expect(result.message).toMatch(/no vault has been set up yet/i)
  })
})

// The launcher is the one place a `CredentialFailure` is constructed from a
// resolver result on the real connection path. If it drops `state` there, the
// mapping above is correct and irrelevant: every user still sees the fallback.
describe('the launcher preserves the vault state it was given', () => {
  it('throws vault-locked, not the unknown-state fallback', async () => {
    const { credentialFailureFrom } = await import('./credential-failure')
    // What `resolveSessionCredential` hands the launcher when the provider
    // reported a locked vault — the shape the launcher must forward intact.
    const failure = credentialFailureFrom({
      ok: false,
      reason: 'vault-unavailable',
      state: 'locked',
      message: 'the vault is locked',
    })
    expect(failure.kind).toBe('vault-locked')
    expect(failure.vaultState).toBe('locked')
  })

  it('a first-run host is told to create, not to unlock', async () => {
    const { credentialFailureFrom } = await import('./credential-failure')
    const failure = credentialFailureFrom({
      ok: false,
      reason: 'vault-unavailable',
      state: 'uninitialized',
      message: 'no vault has been set up yet',
    })
    // The sentence and the kind agree because both came from the same state,
    // rather than the kind being recovered from the sentence.
    expect(failure.kind).toBe('vault-uninitialized')
  })
})

describe('the resolver keeps the state through resolveSessionCredential', () => {
  it('reports which vault state stopped the read', async () => {
    const { SessionCredentialResolver } = await import(
      '@/service/credential-boundary'
    )
    for (const state of ['locked', 'uninitialized', 'unusable'] as const) {
      const resolver = new SessionCredentialResolver({
        isAvailable: async () => false,
        availabilityState: async () => ({ ok: false, state }),
        read: async () => undefined,
        write: async () => {},
        remove: async () => {},
      })
      const result = await resolver.resolve({
        id: 'h',
        name: 'h',
        hostname: 'h.test',
        port: 22,
        username: 'u',
        authType: 'password',
        credentialRef: { kinds: ['password'], provider: 'vault', version: 1 },
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      if (result.reason !== 'vault-unavailable') throw new Error('unreachable')
      expect(result.state).toBe(state)
    }
  })
})

// The whole point of carrying the state is that the *real* connection path uses
// it. `withResolvedCredential` is that path: everything above this point can be
// correct while the launcher drops the field, and the user still gets the
// fallback. This drives the launcher itself against a locked vault.
describe('withResolvedCredential reports the vault state, not a fallback', () => {
  it('throws vault-locked when the vault is locked', async () => {
    vault.availability.mockResolvedValue({ ok: false, state: 'locked' })
    const { withResolvedCredential } = await import('./terminal-launcher')

    await expect(
      withResolvedCredential({
        id: 'h-1',
        name: 'h',
        hostname: 'h.test',
        port: 22,
        username: 'u',
        authType: 'password',
        credentialRef: { kinds: ['password'], provider: 'vault', version: 1 },
        isFavorite: false,
        portForwards: [],
        createdAt: 0,
        updatedAt: 0,
      } as unknown as Host),
    ).rejects.toMatchObject({
      name: 'CredentialFailure',
      kind: 'vault-locked',
      vaultState: 'locked',
    })
  })

  it('throws vault-uninitialized on a first run', async () => {
    vault.availability.mockResolvedValue({ ok: false, state: 'uninitialized' })
    const { withResolvedCredential } = await import('./terminal-launcher')

    await expect(
      withResolvedCredential({
        id: 'h-1',
        name: 'h',
        hostname: 'h.test',
        port: 22,
        username: 'u',
        authType: 'password',
        credentialRef: { kinds: ['password'], provider: 'vault', version: 1 },
        isFavorite: false,
        portForwards: [],
        createdAt: 0,
        updatedAt: 0,
      } as unknown as Host),
    ).rejects.toMatchObject({ kind: 'vault-uninitialized' })
  })
})

// A damaged credential reference is the sixth kind in the enum, and until now it
// had no producer.
//
// `withResolvedCredential` threw a bare `Error` for it. That is the same shape as
// the vault defect this phase fixed: the guard exists, the kind exists, the pane
// mapping exists, and the real entry point takes a different path. The concrete
// cost was that a host whose `credentialRef` cannot be parsed still spent the full
// automatic reconnect budget (five attempts) and never offered "re-save the
// credential" — the one action that fixes it.
describe('a damaged reference is a credential failure, not a bare error', () => {
  const damaged = (credentialRefProblem: unknown) =>
    ({
      id: 'h-1',
      name: 'prod',
      hostname: 'p.test',
      port: 22,
      username: 'root',
      authType: 'password',
      credentialRef: null,
      credentialRefProblem,
      isFavorite: false,
      portForwards: [],
      createdAt: 0,
      updatedAt: 0,
    }) as unknown as Host

  it.each([
    ['malformed', { kind: 'malformed', detail: 'not valid JSON' }],
    ['empty-kinds', { kind: 'empty-kinds' }],
    ['unknown-provider', { kind: 'unknown-provider', provider: 'keychain' }],
    ['unsupported-version', { kind: 'unsupported-version', version: 99 }],
  ])('throws credential-corrupt-reference for %s', async (_name, problem) => {
    const { withResolvedCredential } = await import('./terminal-launcher')

    await expect(withResolvedCredential(damaged(problem))).rejects.toMatchObject(
      {
        name: 'CredentialFailure',
        kind: 'credential-corrupt-reference',
      },
    )
  })

  it('classifies it as needing the host edited, not a retry', async () => {
    // Not `after-vault`: the vault is fine, the pointer to it is not. Re-saving
    // the credential is the fix, and that lives on the host, not the vaults page.
    const { CredentialFailure } = await import('./credential-failure')
    const failure = classifyTerminalFailure(
      new CredentialFailure('credential-corrupt-reference', 'x'),
    )
    expect(failure.recovery).toBe('manual')
    expect(failure.credentialKind).toBe('credential-corrupt-reference')
    expect(failure.retryable).toBe(false)
  })
})
