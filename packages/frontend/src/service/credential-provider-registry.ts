/**
 * Which backend a reference names, and how a resolver gets hold of it.
 *
 * ## The problem this solves
 *
 * `CredentialRef.provider` has been `'vault'` — a literal type, not a choice. The
 * resolver took a `SecretProvider` in its constructor, so it could only ever talk
 * to the one backend it was built with. That was the right shape while there was
 * one store; it is the wrong shape the moment a second exists, because the
 * reference already carries `provider` and *nothing reads it*. A reference naming a
 * provider this build does not have must be reported as such, not silently
 * resolved against the vault (which would read a different secret, or none) and not
 * flattened to `null` (which reads as "nothing stored").
 *
 * ## What is deliberately not here
 *
 * No OS provider is implemented. `system-keychain`, `windows-credential-manager`
 * and `secret-service` are named so the union is stable and a future registry entry
 * is a case rather than a new boolean; `registry.get()` returns `undefined` for
 * them and the resolver reports `unsupported-provider`. The default provider stays
 * `vault` until the platform gates in `05-ux2-credentials.md` §6 pass, and this
 * module enforces that by simply not registering anything else.
 *
 * ## Why the registry is a plain map and not a class hierarchy
 *
 * The interesting behaviour is *dispatch* — picking a backend from a value that
 * came out of the database — and that is testable with a map. A registry that also
 * owned lifecycle, caching or async initialisation would make the one thing that
 * matters harder to assert.
 */

import type { SecretProvider } from './credential-boundary'

/**
 * Every provider id a reference may name.
 *
 * `vault` is the only one this build can resolve. The others are named so that a
 * reference written by a future build is recognised as *known but unsupported*
 * rather than as garbage — the two need different messages and different recovery.
 */
export const CREDENTIAL_PROVIDER_IDS = [
  'vault',
  'system-keychain',
  'windows-credential-manager',
  'secret-service',
] as const

export type ProviderId = (typeof CREDENTIAL_PROVIDER_IDS)[number]

/** Providers this build can actually resolve. Exactly one, on purpose. */
export const IMPLEMENTED_PROVIDER_IDS = ['vault'] as const

export function isKnownProvider(value: unknown): value is ProviderId {
  return (
    typeof value === 'string' &&
    (CREDENTIAL_PROVIDER_IDS as readonly string[]).includes(value)
  )
}

export function isImplementedProvider(value: unknown): value is ProviderId {
  return (
    typeof value === 'string' &&
    (IMPLEMENTED_PROVIDER_IDS as readonly string[]).includes(value)
  )
}

/**
 * Why a provider cannot answer.
 *
 * `unsupported` is a different state from `unusable`, and conflating them is how a
 * future-provider reference would be reported as a broken vault and send the user
 * to a page that cannot help. `unavailable` is the OS-refusing case: the backend
 * exists but the platform will not give us access (permission denied, no DBus, user
 * cancelled a keychain prompt) — never a reason to retry as if it were a network
 * blip.
 */
export type ProviderAvailability =
  | { state: 'available' }
  | { state: 'uninitialized' }
  | { state: 'locked' }
  | { state: 'unsupported', reason: string }
  | { state: 'unusable', reason: string }

/** The provider interface a registry entry must satisfy. */
export type RegisteredProvider = SecretProvider

/**
 * Provider id → backend.
 *
 * Registration is explicit and synchronous: an async `init()` would let a resolver
 * run against a half-populated registry, and the failure would look like "unknown
 * provider" rather than "not ready".
 */
export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, RegisteredProvider>()

  register(id: ProviderId, provider: RegisteredProvider): void {
    // Re-registering is a bug in the caller, not a feature: two providers under one
    // id means the resolver's answer depends on load order.
    if (this.providers.has(id)) {
      throw new Error(`credential provider "${id}" is already registered`)
    }
    this.providers.set(id, provider)
  }

  /**
   * Replace whatever is registered under this id.
   *
   * Deliberately separate from `register`, which refuses a duplicate on purpose. This
   * exists for one case: the built-in registration helper being handed a *different*
   * instance of the same provider (a test reset, or a future re-initialisation). The
   * alternative — silently keeping the first — means the caller's provider is ignored
   * and every later read answers from a backend nobody asked for.
   */
  replace(id: ProviderId, provider: RegisteredProvider): void {
    this.providers.set(id, provider)
  }

  get(id: string): RegisteredProvider | undefined {
    if (!isKnownProvider(id)) return undefined
    return this.providers.get(id)
  }

  has(id: string): boolean {
    return this.get(id) !== undefined
  }

  /**
   * Which providers are usable right now, and why the rest are not.
   *
   * Reports *known* providers including the unimplemented ones, so a settings page
   * can say "the system keychain is not available in this build" instead of
   * omitting it and leaving the user to conclude it was removed.
   */
  async listAvailability(): Promise<
    Array<{ provider: ProviderId, availability: ProviderAvailability }>
  > {
    const result: Array<{ provider: ProviderId, availability: ProviderAvailability }> = []
    for (const provider of CREDENTIAL_PROVIDER_IDS) {
      const backend = this.providers.get(provider)
      if (!backend) {
        result.push({
          provider,
          availability: {
            state: 'unsupported',
            reason: 'This build does not include this credential provider.',
          },
        })
        continue
      }
      result.push({ provider, availability: await probeAvailability(backend) })
    }
    return result
  }
}

/**
 * Ask a backend whether it can be read, keeping the reason.
 *
 * A provider that only implements `isAvailable` still works: the state is then
 * `unusable` — we know it cannot be read and do not know why, which is exactly what
 * that state means. This is the same rule the resolver applies, kept in one place
 * so the two cannot disagree.
 */
export async function probeAvailability(
  provider: RegisteredProvider,
): Promise<ProviderAvailability> {
  if (provider.availabilityState) {
    const state = await provider.availabilityState()
    if (state.ok) return { state: 'available' }
    return toProviderAvailability(state.state)
  }
  try {
    return (await provider.isAvailable())
      ? { state: 'available' }
      : { state: 'unusable', reason: 'The credential provider could not be read.' }
  } catch (error) {
    return {
      state: 'unusable',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}


/**
 * Map the provider-level tri-state onto the registry's availability shape.
 *
 * `SecretProvider.availabilityState()` reports the three states without carrying a
 * reason — the vault knows *that* it is unusable, not why. The registry's shape
 * requires a reason for `unusable` so a settings page has something to show, and
 * this is the one place that invents one rather than leaving it to each caller.
 */
function toProviderAvailability(
  state: 'uninitialized' | 'locked' | 'unusable',
): ProviderAvailability {
  if (state === 'unusable') {
    return {
      state: 'unusable',
      reason: 'The credential provider could not be read.',
    }
  }
  return { state }
}
/**
 * The process-wide registry.
 *
 * One instance, populated at startup with the vault. Kept as a module singleton for
 * the same reason `vaultService` is: the resolver is constructed on the connection
 * path, which has no dependency-injection container to reach for.
 */
export const providerRegistry = new ProviderRegistry()

/**
 * Register the providers this build ships.
 *
 * Idempotent on purpose: the module singleton is created at import time, but the
 * vault provider imports `vaultService`, which talks to Tauri — pulling it into a
 * module that a unit test imports would make every credential test require a Tauri
 * host. So registration is a call the connection path makes, and calling it twice
 * must not throw.
 */
export function registerBuiltInProviders(
  registry: ProviderRegistry,
  vault: RegisteredProvider,
): ProviderRegistry {
  const existing = registry.get('vault')
  if (existing === undefined) {
    registry.register('vault', vault)
    return registry
  }
  // Same instance: nothing to do, so repeated calls on the connection path are free.
  if (existing === vault) return registry
  // A *different* provider under the same id. Keeping the incumbent would make the
  // caller's argument meaningless and every later read answer from a backend nobody
  // passed in — the load-order dependence this registry exists to remove.
  registry.replace('vault', vault)
  return registry
}

