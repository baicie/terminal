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

  it('registers the built-in provider idempotently', () => {
    const registry = new ProviderRegistry()
    const vault = fakeProvider()
    registerBuiltInProviders(registry, vault)
    expect(registry.get('vault')).toBe(vault)
    expect(() => registerBuiltInProviders(registry, fakeProvider())).not.toThrow()
    expect(registry.get('vault')).toBe(vault)
  })
})
