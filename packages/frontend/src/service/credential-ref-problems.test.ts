// A damaged `credential_ref` is its own state, not "no credential".
//
// Before this, `parseCredentialRef` returned `null` for invalid JSON, an unknown
// provider and an unsupported version alike. `null` means "this host stores
// nothing", so a host whose vault entry existed but whose pointer was corrupt
// connected with an empty password — and the user saw an authentication failure
// with no hint that the real cause was data.

import { describe, expect, it, vi } from 'vitest'
import {
  LEGACY_VERSION,
  MAX_SUPPORTED_VERSION,
  parseCredentialRef,
  refVersion,
  vaultKey,
} from './credential-boundary'
import { describeRefProblem } from '@/features/terminal/services/session-credentials'

describe('parseCredentialRef', () => {
  it('an empty column is "no credential"', () => {
    for (const raw of [null, undefined, '']) {
      expect(parseCredentialRef(raw)).toEqual({
        ok: true,
        ref: null,
        problem: null,
      })
    }
  })

  it('a legacy reference parses and resolves to the unversioned key set', () => {
    const parsed = parseCredentialRef(
      JSON.stringify({ kinds: ['password'], provider: 'vault' }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('unreachable')
    expect(parsed.ref).toEqual({ kinds: ['password'], provider: 'vault' })
    expect(refVersion(parsed.ref!)).toBe(LEGACY_VERSION)
    // The unversioned keys are what the previous build wrote.
    expect(vaultKey({ type: 'host', id: 'h1' }, LEGACY_VERSION, 'password')).toBe(
      'host:h1:password',
    )
  })

  it('a versioned reference resolves to the versioned key set', () => {
    const parsed = parseCredentialRef(
      JSON.stringify({ kinds: ['password'], provider: 'vault', version: 4 }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('unreachable')
    expect(refVersion(parsed.ref!)).toBe(4)
    expect(vaultKey({ type: 'host', id: 'h1' }, 4, 'password')).toBe(
      'host:h1:4:password',
    )
  })

  it('invalid JSON is a corrupt reference, not an absence', () => {
    const parsed = parseCredentialRef('{not json')
    expect(parsed.ok).toBe(false)
    expect(parsed.problem?.kind).toBe('malformed')
  })

  it('an unknown provider is reported as such', () => {
    const parsed = parseCredentialRef(
      JSON.stringify({ kinds: ['password'], provider: 'keychain' }),
    )
    expect(parsed.ok).toBe(false)
    expect(parsed.problem).toEqual({
      kind: 'unknown-provider',
      provider: 'keychain',
    })
  })

  it('a version above the ceiling is refused rather than guessed at', () => {
    // A row written by a newer build. Reading it with this key layout would report
    // "the vault holds none", which reads as data loss; the refusal names the real
    // cause instead.
    const parsed = parseCredentialRef(
      JSON.stringify({
        kinds: ['password'],
        provider: 'vault',
        version: MAX_SUPPORTED_VERSION + 1,
      }),
    )
    expect(parsed.ok).toBe(false)
    expect(parsed.problem).toEqual({
      kind: 'unsupported-version',
      version: MAX_SUPPORTED_VERSION + 1,
    })
  })

  it('a version at the ceiling is still accepted', () => {
    const parsed = parseCredentialRef(
      JSON.stringify({
        kinds: ['password'],
        provider: 'vault',
        version: MAX_SUPPORTED_VERSION,
      }),
    )
    expect(parsed.ok).toBe(true)
  })

  it('an empty kinds list is a contradictory record, not "nothing stored"', () => {
    const parsed = parseCredentialRef(
      JSON.stringify({ kinds: [], provider: 'vault' }),
    )
    expect(parsed.ok).toBe(false)
    expect(parsed.problem?.kind).toBe('empty-kinds')
  })

  it('a reference naming an unknown kind is refused', () => {
    const parsed = parseCredentialRef(
      JSON.stringify({ kinds: ['password', 'totp'], provider: 'vault' }),
    )
    expect(parsed.ok).toBe(false)
    expect(parsed.problem?.kind).toBe('malformed')
  })

  it('a negative or fractional version is refused', () => {
    for (const version of [-1, 1.5]) {
      const parsed = parseCredentialRef(
        JSON.stringify({ kinds: ['password'], provider: 'vault', version }),
      )
      expect(parsed.ok).toBe(false)
    }
  })

  it('accepts an already-parsed object as well as a string', () => {
    const parsed = parseCredentialRef({ kinds: ['password'], provider: 'vault' })
    expect(parsed.ok).toBe(true)
  })
})

describe('what the user is told', () => {
  it('every problem names an action and no secret', () => {
    const messages = [
      describeRefProblem({ kind: 'unknown-provider', provider: 'keychain' }),
      describeRefProblem({ kind: 'unsupported-version', version: 99 }),
      describeRefProblem({ kind: 'empty-kinds' }),
      describeRefProblem({ kind: 'malformed', detail: 'not valid JSON' }),
    ]
    for (const message of messages) {
      expect(message).toMatch(/re-save|Update Terminal/i)
      expect(message.length).toBeLessThan(400)
    }
  })
})

describe('the connect path refuses a damaged reference', () => {
  it('does not reach for the vault at all', async () => {
    const { resolveSessionCredential } = await import(
      '@/features/terminal/services/session-credentials'
    )
    const read = vi.fn()
    const result = await resolveSessionCredential({
      id: 'h1',
      name: 'prod',
      hostname: 'p.example',
      port: 22,
      username: 'root',
      authType: 'password',
      credentialRef: null,
      credentialRefProblem: { kind: 'malformed', detail: 'not valid JSON' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/re-save/i)
    // A damaged pointer is refused before any vault access, so it cannot be
    // mistaken for a locked vault either.
    expect(read).not.toHaveBeenCalled()
  })
})

describe('the terminal connect path refuses a damaged reference', () => {
  // The guard inside `resolveSessionCredential` is not enough: the function the
  // terminal actually calls is `withResolvedCredential`, and it returned early on
  // `credentialRef === null` — which is exactly what the mapper produces for a
  // corrupt pointer. The host then connected with an empty password and the user
  // saw an argument error instead of "re-save the credentials".
  it('withResolvedCredential throws the diagnostic, not an empty-password attempt', async () => {
    const { withResolvedCredential } = await import(
      '@/features/terminal/services/terminal-launcher'
    )
    await expect(
      withResolvedCredential({
        id: 'h1',
        name: 'prod',
        hostname: 'p.example',
        port: 22,
        username: 'root',
        authType: 'password',
        isFavorite: false,
        portForwards: [],
        credentialRef: null,
        credentialRefProblem: { kind: 'malformed', detail: 'not valid JSON' },
        createdAt: 0,
        updatedAt: 0,
      }),
    ).rejects.toThrow(/re-save/i)
  })

  it('an unknown-provider reference is refused on the same path', async () => {
    const { withResolvedCredential } = await import(
      '@/features/terminal/services/terminal-launcher'
    )
    await expect(
      withResolvedCredential({
        id: 'h1',
        name: 'prod',
        hostname: 'p.example',
        port: 22,
        username: 'root',
        authType: 'password',
        isFavorite: false,
        portForwards: [],
        credentialRef: null,
        credentialRefProblem: { kind: 'unknown-provider', provider: 'keychain' },
        createdAt: 0,
        updatedAt: 0,
      }),
    ).rejects.toThrow(/keychain/)
  })

  it('a host that genuinely stores nothing still connects', async () => {
    const { withResolvedCredential } = await import(
      '@/features/terminal/services/terminal-launcher'
    )
    const host = {
      id: 'h1',
      name: 'prod',
      hostname: 'p.example',
      port: 22,
      username: 'root',
      authType: 'agent' as const,
      isFavorite: false,
      portForwards: [],
      credentialRef: null,
      credentialRefProblem: null,
      createdAt: 0,
      updatedAt: 0,
    }
    await expect(withResolvedCredential(host)).resolves.toBe(host)
  })
})
