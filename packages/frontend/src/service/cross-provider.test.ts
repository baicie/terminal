// The credential resolver must work against any provider the registry holds.
//
// ## What was never verified
//
// Every credential path runs through `vaultSecretProvider`, and it is the only
// implementation of `SecretProvider`. So "the boundary is correct" has only ever been
// demonstrated against one storage discipline. The resolver's own comment says as
// much: it dispatches on `CredentialRef.provider`, but nothing ever exercised the
// dispatch with a second backend.
//
// This file registers a second, deliberately different implementation — plain `Map`,
// no encryption, synchronous availability — and asserts the *interface-level* contract.
// It is not a test of the vault; it is a test that the design does not secretly depend
// on the vault.
//
// OS keychains remain `BLOCKED_EXTERNAL`: they need real platform access and a signed
// build. This file proves nothing about them, and does not pretend to.

import { beforeEach, describe, expect, it } from 'vitest'
import { InMemorySecretProvider } from './in-memory-secret-provider'
import { ProviderRegistry } from './credential-provider-registry'

const RESOURCE = { type: 'host', id: 'host-1' } as const

beforeEach(() => {
  // Nothing global: each case builds its own registry.
})

describe('a second provider satisfies the same contract', () => {
  it('round-trips a secret through write and read', async () => {
    const provider = new InMemorySecretProvider()
    await provider.write(RESOURCE, 1, 'password', 'hunter2')
    await expect(provider.read(RESOURCE, 1, 'password')).resolves.toBe('hunter2')
  })

  it('keeps versions apart', async () => {
    const provider = new InMemorySecretProvider()
    await provider.write(RESOURCE, 1, 'password', 'old')
    await provider.write(RESOURCE, 2, 'password', 'new')
    await expect(provider.read(RESOURCE, 1, 'password')).resolves.toBe('old')
    await expect(provider.read(RESOURCE, 2, 'password')).resolves.toBe('new')
  })

  it('keeps namespaces apart', async () => {
    // The bug this guards: a host and an ssh-key sharing an id once read each
    // other's secret because the key was `host:<id>:…` for both.
    const provider = new InMemorySecretProvider()
    await provider.write({ type: 'host', id: 'x' }, 1, 'password', 'host-secret')
    await provider.write({ type: 'ssh-key', id: 'x' }, 1, 'password', 'key-secret')
    await expect(provider.read({ type: 'host', id: 'x' }, 1, 'password')).resolves.toBe(
      'host-secret',
    )
    await expect(provider.read({ type: 'ssh-key', id: 'x' }, 1, 'password')).resolves.toBe(
      'key-secret',
    )
  })

  it('removes only the version it is told to', async () => {
    const provider = new InMemorySecretProvider()
    await provider.write(RESOURCE, 1, 'password', 'old')
    await provider.write(RESOURCE, 2, 'password', 'new')
    await provider.remove(RESOURCE, 1, 'password')
    await expect(provider.read(RESOURCE, 1, 'password')).resolves.toBeUndefined()
    await expect(provider.read(RESOURCE, 2, 'password')).resolves.toBe('new')
  })

  it('reports the reason it is unavailable, not just a boolean', async () => {
    const provider = new InMemorySecretProvider({ available: false })
    provider.setUnavailable('locked')
    await expect(provider.availabilityState()).resolves.toEqual({
      ok: false,
      state: 'locked',
    })
  })

  it('refuses a read while unavailable rather than returning undefined', async () => {
    // `undefined` means "nothing stored"; a locked store must not be able to say that.
    const provider = new InMemorySecretProvider()
    await provider.write(RESOURCE, 1, 'password', 'hunter2')
    provider.setUnavailable('locked')
    await expect(provider.read(RESOURCE, 1, 'password')).rejects.toThrow()
  })
})

describe('the registry dispatches by the provider a reference names', () => {
  it('returns the provider registered under that id', () => {
    const registry = new ProviderRegistry()
    const memory = new InMemorySecretProvider()
    // `system-keychain` is a real id in the union; registering an implementation for
    // it is what a future build would do. The point here is dispatch, not the OS.
    registry.register('system-keychain', memory)
    expect(registry.get('system-keychain')).toBe(memory)
  })

  it('returns undefined for an id this build has no implementation for', () => {
    const registry = new ProviderRegistry()
    expect(registry.get('secret-service')).toBeUndefined()
  })

  it('refuses to register two providers under one id', () => {
    // Two providers under one id makes the resolver's answer depend on load order.
    const registry = new ProviderRegistry()
    registry.register('vault', new InMemorySecretProvider())
    expect(() => registry.register('vault', new InMemorySecretProvider())).toThrow(
      /already registered/,
    )
  })
})
