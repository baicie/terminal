/**
 * A second `SecretProvider`, for tests.
 *
 * ## Why this exists
 *
 * Every credential path in this app goes through `vaultSecretProvider`, and there is
 * exactly one implementation of `SecretProvider`. That means "the boundary works" has
 * only ever been demonstrated against one storage discipline — a provider that throws
 * on a missing key, keeps versions, and unlocks with a password.
 *
 * A second implementation with deliberately different internals (plain `Map`, no
 * encryption, synchronous availability) is what turns "the resolver is correct" into
 * "the resolver is correct *given only the interface*". The first is a property of the
 * vault; the second is a property of the design.
 *
 * It is not a product provider. It has no encryption, it does not persist, and nothing
 * outside tests should construct it — the name says so.
 */
import type {
  CredentialKind,
  CredentialResource,
  SecretProvider,
} from './credential-boundary'

interface Entry {
  value: string
}

function keyOf(resource: CredentialResource, version: number, kind: CredentialKind): string {
  return `${resource.type}:${resource.id}:${version}:${kind}`
}

export class InMemorySecretProvider implements SecretProvider {
  private readonly entries = new Map<string, Entry>()
  private available = true
  private unavailableState: 'uninitialized' | 'locked' | 'unusable' = 'locked'

  /** How many writes and removes have happened, for assertions about cleanup. */
  readonly stats = { writes: 0, removes: 0 }

  constructor(options: { available?: boolean } = {}) {
    this.available = options.available ?? true
  }

  /** Make the provider report a specific unavailable state. */
  setUnavailable(state: 'uninitialized' | 'locked' | 'unusable'): void {
    this.available = false
    this.unavailableState = state
  }

  /** Make it available again, keeping whatever is stored. */
  setAvailable(): void {
    this.available = true
  }

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async availabilityState(): Promise<
    { ok: true } | { ok: false, state: 'uninitialized' | 'locked' | 'unusable' }
  > {
    return this.available ? { ok: true } : { ok: false, state: this.unavailableState }
  }

  async read(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
  ): Promise<string | undefined> {
    if (!this.available) throw new Error('the secret store is not available')
    return this.entries.get(keyOf(resource, version, kind))?.value
  }

  async write(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
    value: string,
  ): Promise<void> {
    if (!this.available) throw new Error('the secret store is not available')
    this.stats.writes += 1
    this.entries.set(keyOf(resource, version, kind), { value })
  }

  async remove(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
  ): Promise<void> {
    if (!this.available) throw new Error('the secret store is not available')
    this.stats.removes += 1
    this.entries.delete(keyOf(resource, version, kind))
  }

  /** Every key currently stored, for assertions about what was left behind. */
  keys(): string[] {
    return [...this.entries.keys()].sort()
  }
}
