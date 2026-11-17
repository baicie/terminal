// Dispatching on the provider a reference names.
//
// The defect this closes: `SessionCredentialResolver` took one provider in its
// constructor, and `CredentialRef.provider` was a literal type nobody read. A
// reference naming another backend would have been resolved against the vault —
// reading a different secret, or none — and a corrupt pointer arrives as
// `credentialRef: null`, so it would read as "nothing stored" and send an empty
// password.

import { describe, expect, it, vi } from 'vitest'
import type { SecretProvider } from './credential-boundary'
import {
  IMPLEMENTED_PROVIDER_IDS,
  ProviderRegistry,
  isImplementedProvider,
  isKnownProvider,
  registerBuiltInProviders,
} from './credential-provider-registry'

function fakeProvider(overrides: Partial<SecretProvider> = {}): SecretProvider {
  return {
    isAvailable: vi.fn(async () => true),
    availabilityState: vi.fn(async () => ({ ok: true as const })),
    read: vi.fn(async () => 'secret'),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    ...overrides,
  } as SecretProvider
}

function registryWith(provider: SecretProvider): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register('vault', provider)
  return registry
}

describe('the provider registry', () => {
  it('resolves the vault and reports the rest as unsupported', async () => {
    const registry = registryWith(fakeProvider())
    expect(registry.get('vault')).toBeDefined()
    expect(registry.get('system-keychain')).toBeUndefined()

    const availability = await registry.listAvailability()
    const byId = Object.fromEntries(availability.map(entry => [entry.provider, entry.availability]))
    expect(byId.vault.state).toBe('available')
    // Known but not built: reported, not omitted, so a settings page can explain it.
    expect(byId['system-keychain'].state).toBe('unsupported')
    expect(byId['secret-service'].state).toBe('unsupported')
  })

  it('refuses to register one provider id twice', () => {
    const registry = registryWith(fakeProvider())
    // Two backends under one id makes the resolver's answer depend on load order.
    expect(() => registry.register('vault', fakeProvider())).toThrow(/already registered/)
  })

  it('distinguishes known provider ids from implemented ones', () => {
    expect(isKnownProvider('system-keychain')).toBe(true)
    expect(isImplementedProvider('system-keychain')).toBe(false)
    expect(isImplementedProvider('vault')).toBe(true)
    expect([...IMPLEMENTED_PROVIDER_IDS]).toEqual(['vault'])
    expect(isKnownProvider('made-up')).toBe(false)
  })
})

describe('registering the shipped providers', () => {
  it('registers the vault once and is safe to call twice', () => {
    // The singleton is created at import time, but the vault provider pulls in
    // Tauri; registration is a call the connection path makes, so a second call
    // must be a no-op rather than a throw.
    const registry = new ProviderRegistry()
    const vault = fakeProvider()
    registerBuiltInProviders(registry, vault)
    expect(registry.get('vault')).toBe(vault)
    expect(() => registerBuiltInProviders(registry, vault)).not.toThrow()
    expect(registry.get('vault')).toBe(vault)
  })
})

describe('a different provider under the same id', () => {
  it('takes over instead of being silently ignored', () => {
    // Found by adversarial review. The first version kept the incumbent, so a second
    // caller's provider was discarded and every later read answered from a backend
    // nobody passed in — the load-order dependence the registry exists to remove,
    // moved from two callers to two registrations.
    const registry = new ProviderRegistry()
    const first = fakeProvider()
    const second = fakeProvider()
    registerBuiltInProviders(registry, first)
    registerBuiltInProviders(registry, second)
    expect(registry.get('vault')).toBe(second)
  })

  it('direct registration still refuses a duplicate, so only the helper is quiet', () => {
    // Keeping the two distinct means a bug that registers twice through the normal
    // API is still loud.
    const registry = new ProviderRegistry()
    registry.register('vault', fakeProvider())
    expect(() => registry.register('vault', fakeProvider())).toThrow(/already registered/)
  })
})
