// Dispatching on the provider a reference names, through the resolver the
// connection path actually builds.
//
// The defect this closes: `CredentialRef.provider` was a literal type nobody read.
// `SessionCredentialResolver` took one provider in its constructor, so a reference
// naming another backend was resolved against the vault regardless — reading a
// different secret, or none, and reporting it as an authentication failure or a
// missing credential rather than as "this build cannot read that provider".

import { describe, expect, it, vi } from 'vitest'
import type { CredentialRef, HostMetadata, SecretProvider } from './credential-boundary'
import { SessionCredentialResolver } from './credential-boundary'
import { ProviderRegistry, registerBuiltInProviders } from './credential-provider-registry'

function fakeProvider(readValue: string | undefined = 'secret'): SecretProvider {
  return {
    isAvailable: vi.fn(async () => true),
    availabilityState: vi.fn(async () => ({ ok: true as const })),
    read: vi.fn(async () => readValue),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  } as unknown as SecretProvider
}

function hostWith(ref: CredentialRef): HostMetadata {
  return {
    id: 'h-1',
    name: 'prod',
    hostname: 'prod.test',
    port: 22,
    username: 'deploy',
    authType: 'password',
    credentialRef: ref,
  }
}

function registryWith(provider: SecretProvider): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register('vault', provider)
  return registry
}

describe('dispatch through the connection-path resolver', () => {
  it('refuses a foreign provider instead of reading the vault', async () => {
    // The assertion the previous implementation fails: it reads the vault no matter
    // what `provider` says. Verified by mutation — reverting `credential-resolver.ts`
    // to the pre-dispatch version turns exactly this test red.
    const vault = fakeProvider('vault-secret')
    const resolved = await new SessionCredentialResolver(
      vault,
      registryWith(vault),
    ).resolve(
      hostWith({
        kinds: ['password'],
        provider: 'system-keychain' as never,
        version: 1,
      }),
    )

    expect(resolved.ok).toBe(false)
    expect(resolved.ok === false && resolved.reason).toBe('corrupt-reference')
    expect(vault.read).not.toHaveBeenCalled()
  })

  it('names the provider it could not read', async () => {
    const vault = fakeProvider()
    const resolved = await new SessionCredentialResolver(vault, registryWith(vault)).resolve(
      hostWith({ kinds: ['password'], provider: 'secret-service' as never, version: 1 }),
    )
    expect(resolved.ok === false && resolved.message).toContain('secret-service')
  })

  it('still resolves a vault reference when a registry is supplied', async () => {
    // Supplying the registry is additive: the one provider that exists must keep
    // working exactly as before.
    const vault = fakeProvider('pw')
    const resolved = await new SessionCredentialResolver(vault, registryWith(vault)).resolve(
      hostWith({ kinds: ['password'], provider: 'vault', version: 2 }),
    )
    expect(resolved).toEqual({ ok: true, credential: { password: 'pw' } })
  })

  it('keeps working without a registry, for single-backend call sites', async () => {
    // Existing callers construct with one provider and no registry. That path must
    // behave exactly as it did, or this change silently alters every un-migrated
    // caller — including the script and batch paths.
    const vault = fakeProvider('pw')
    const resolved = await new SessionCredentialResolver(vault).resolve(
      hostWith({ kinds: ['password'], provider: 'vault', version: 1 }),
    )
    expect(resolved).toEqual({ ok: true, credential: { password: 'pw' } })
  })

  it('registers the built-in provider idempotently for the same instance', () => {
    const registry = new ProviderRegistry()
    const vault = fakeProvider()
    registerBuiltInProviders(registry, vault)
    expect(registry.get('vault')).toBe(vault)
    expect(() => registerBuiltInProviders(registry, vault)).not.toThrow()
    expect(registry.get('vault')).toBe(vault)
  })
})

// ---------------------------------------------------------------------------
// The availability check must probe the provider the reference NAMES
// ---------------------------------------------------------------------------
//
// Found by adversarial review. The first version dispatched *after* the
// availability check and asked `this.provider` (always the vault), so a reference
// naming another backend was judged by the vault's state: with a locked vault the
// user was told to unlock it, when the reference had nothing to do with the vault
// and the real answer was "this build cannot read that provider — re-bind it".
//
// Every earlier test missed it because `fakeProvider()` reported `{ok:true}`
// unconditionally and every unknown-provider case supplied a healthy vault.

function lockedProvider(): SecretProvider {
  return {
    isAvailable: vi.fn(async () => false),
    availabilityState: vi.fn(async () => ({ ok: false as const, state: 'locked' as const })),
    read: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  } as unknown as SecretProvider
}

describe('availability is asked of the named provider, not the vault', () => {
  it('a foreign provider reference is corrupt even when the vault is locked', async () => {
    // The production shape: the resolver is always constructed with the vault plus a
    // registry. A `system-keychain` reference must not be described as a vault
    // problem — unlocking the vault cannot fix it.
    const vault = lockedProvider()
    const registry = new ProviderRegistry()
    registry.register('vault', vault)

    const resolved = await new SessionCredentialResolver(vault, registry).resolve(
      hostWith({ kinds: ['password'], provider: 'system-keychain' as never, version: 1 }),
    )

    expect(resolved.ok).toBe(false)
    expect(resolved.ok === false && resolved.reason).toBe('corrupt-reference')
    expect(resolved.ok === false && resolved.message).toMatch(/system-keychain/)
    // And the vault's own state never leaked into the answer.
    expect(resolved.ok === false && 'state' in resolved).toBe(false)
  })

  it('never probes the vault for a reference that names another provider', async () => {
    const vault = lockedProvider()
    const registry = new ProviderRegistry()
    registry.register('vault', vault)
    await new SessionCredentialResolver(vault, registry).resolve(
      hostWith({ kinds: ['password'], provider: 'secret-service' as never, version: 1 }),
    )
    expect(vault.availabilityState).not.toHaveBeenCalled()
    expect(vault.isAvailable).not.toHaveBeenCalled()
    expect(vault.read).not.toHaveBeenCalled()
  })

  it('a vault reference still reports the vault state it actually has', async () => {
    // The behaviour that must survive the fix: the three vault states keep their
    // three different next steps.
    const vault = lockedProvider()
    const registry = new ProviderRegistry()
    registry.register('vault', vault)
    const resolved = await new SessionCredentialResolver(vault, registry).resolve(
      hostWith({ kinds: ['password'], provider: 'vault', version: 1 }),
    )
    expect(resolved).toMatchObject({ ok: false, reason: 'vault-unavailable', state: 'locked' })
    expect(resolved.ok === false && resolved.message).toMatch(/unlock/i)
  })

  it('without a registry, the single provider is still the one asked', async () => {
    // The legacy path: no registry, one provider, unchanged behaviour.
    const vault = lockedProvider()
    const resolved = await new SessionCredentialResolver(vault).resolve(
      hostWith({ kinds: ['password'], provider: 'vault', version: 1 }),
    )
    expect(resolved).toMatchObject({ ok: false, reason: 'vault-unavailable', state: 'locked' })
  })
})
