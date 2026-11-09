// The credential boundary: what may be stored, what may be read and when, and
// what must fail loudly instead of degrading into "no password".

import { beforeEach, describe, expect, it } from 'vitest'
import {
  SessionCredentialResolver,
  credentialKindsOf,
  splitHostSecrets,
} from './credential-boundary'
import type {
  CredentialKind,
  HostMetadata,
  SecretProvider,
} from './credential-boundary'

class FakeProvider implements SecretProvider {
  available = true
  readonly store = new Map<string, string>()
  readonly reads: CredentialKind[] = []
  failRead: Error | null = null

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async read(hostId: string, kind: CredentialKind): Promise<string | undefined> {
    this.reads.push(kind)
    if (this.failRead) throw this.failRead
    return this.store.get(`${hostId}:${kind}`)
  }

  async write(hostId: string, kind: CredentialKind, value: string): Promise<void> {
    this.store.set(`${hostId}:${kind}`, value)
  }

  async remove(hostId: string, kind: CredentialKind): Promise<void> {
    this.store.delete(`${hostId}:${kind}`)
  }
}

function host(overrides: Partial<HostMetadata> = {}): HostMetadata {
  return {
    id: 'host-1',
    name: 'prod',
    hostname: 'prod.example.test',
    port: 22,
    username: 'alice',
    authType: 'password',
    credentialRef: null,
    ...overrides,
  }
}

let provider: FakeProvider
let resolver: SessionCredentialResolver

beforeEach(() => {
  provider = new FakeProvider()
  resolver = new SessionCredentialResolver(provider)
})

describe('SessionCredentialResolver', () => {
  it('returns no credential when the host stores none', async () => {
    const result = await resolver.resolve(host())
    expect(result).toEqual({ ok: true, credential: {} })
    // Nothing is read: an agent/prompt host must not touch the vault at all.
    expect(provider.reads).toEqual([])
  })

  it('returns no credential when the reference carries no kinds', async () => {
    const result = await resolver.resolve(
      host({ credentialRef: { kinds: [], provider: 'vault' } }),
    )
    expect(result).toEqual({ ok: true, credential: {} })
  })

  it('reads exactly the stored kinds', async () => {
    await provider.write('host-1', 'privateKey', 'KEY')
    await provider.write('host-1', 'passphrase', 'PASS')
    const result = await resolver.resolve(
      host({
        authType: 'key',
        credentialRef: { kinds: ['privateKey', 'passphrase'], provider: 'vault' },
      }),
    )
    expect(result).toEqual({
      ok: true,
      credential: { privateKey: 'KEY', passphrase: 'PASS' },
    })
    // The password was never stored, so it is never read.
    expect(provider.reads).toEqual(['privateKey', 'passphrase'])
  })

  it('fails loudly when the vault is locked instead of sending an empty password', async () => {
    await provider.write('host-1', 'password', 'SECRET')
    provider.available = false
    const result = await resolver.resolve(
      host({ credentialRef: { kinds: ['password'], provider: 'vault' } }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('vault-unavailable')
    // The error must explain the fix and must not contain the secret.
    expect(result.message).toMatch(/unlock the vault/i)
    expect(result.message).not.toContain('SECRET')
    expect(provider.reads).toEqual([])
  })

  it('fails when a recorded secret is missing from the store', async () => {
    const result = await resolver.resolve(
      host({ credentialRef: { kinds: ['password'], provider: 'vault' } }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('read-failed')
    expect(result.message).toMatch(/vault holds none/i)
  })

  it('surfaces a read error without leaking the underlying value', async () => {
    provider.failRead = new Error('decrypt failed for secret=hunter2')
    const result = await resolver.resolve(
      host({ credentialRef: { kinds: ['password'], provider: 'vault' } }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('read-failed')
    expect(result.message).not.toContain('hunter2')
  })
})

describe('splitHostSecrets', () => {
  it('produces a reference and the values, never a reference alone', () => {
    const split = splitHostSecrets({
      password: 'P',
      privateKey: 'K',
      passphrase: null,
    })
    expect(split.ref).toEqual({
      kinds: ['password', 'privateKey'],
      provider: 'vault',
    })
    expect(split.secrets).toEqual([
      { kind: 'password', value: 'P' },
      { kind: 'privateKey', value: 'K' },
    ])
  })

  it('returns a null reference when nothing is stored', () => {
    expect(splitHostSecrets({})).toEqual({ ref: null, secrets: [] })
    expect(splitHostSecrets({ password: '', privateKey: null })).toEqual({
      ref: null,
      secrets: [],
    })
  })

  it('keeps an empty-string secret out of the reference', () => {
    const split = splitHostSecrets({ password: '', passphrase: 'pp' })
    expect(split.ref).toEqual({ kinds: ['passphrase'], provider: 'vault' })
  })
})

describe('credentialKindsOf', () => {
  it('reports the present kinds in a stable order', () => {
    expect(credentialKindsOf({ privateKey: 'k', password: 'p' })).toEqual([
      'password',
      'privateKey',
    ])
    expect(credentialKindsOf({})).toEqual([])
  })
})
