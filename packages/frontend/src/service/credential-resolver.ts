/**
 * Resolving the secrets one connection needs, and saying why when it cannot.
 *
 * Split out of `credential-boundary.ts` for the size gate, along the seam that
 * was already there: that module defines *what* a credential is (the types, the
 * key naming, the reference format), and this one performs the read.
 *
 * The vault state travels as data. `vault-unavailable` covers three situations
 * with three different next steps, and recovering which one from the sentence —
 * which this module and the terminal classifier both used to do — is the string
 * matching the whole credential boundary exists to avoid.
 */

import type {
  CredentialKind,
  CredentialRef,
  CredentialResolution,
  CredentialResource,
  HostMetadata,
  ResolvedCredential,
  SecretProvider,
} from './credential-boundary'
import { refVersion } from './credential-boundary'
import type { ProviderRegistry } from './credential-provider-registry'

const KINDS: CredentialKind[] = ['password', 'privateKey', 'passphrase']

/**
 * What to say per vault state.
 *
 * One sentence per situation, because the next step differs and a single generic
 * "the vault is unavailable" sends a first-run user to unlock a vault that does
 * not exist. These are constants this repository owns, not user input.
 */
const VAULT_UNAVAILABLE_MESSAGES: Record<
  'uninitialized' | 'locked' | 'unusable',
  string
> = {
  uninitialized:
    'This host stores its credentials in the vault, but no vault has been set up yet. Create a vault and connect again.',
  locked:
    'This host stores its credentials in the vault, which is locked. Unlock the vault and connect again.',
  unusable:
    'This host stores its credentials in the vault, but the vault could not be read. Open the Vaults page and check it, then connect again.',
}

/**
 * Resolves the secrets a connection needs, at the moment it needs them.
 *
 * The resolver takes the metadata (not a full host object with embedded
 * secrets), so a caller cannot accidentally connect with a plaintext field that
 * was never meant to exist.
 */
export class SessionCredentialResolver {
  /**
   * `provider` is the fallback used when no registry is supplied — it keeps the
   * existing single-backend call sites and their tests working unchanged.
   *
   * `registry` is the dispatch path: when present, `resolve` asks it for the
   * backend the reference *names*, instead of the one this resolver was built
   * with. That is the whole point of `CredentialRef.provider` existing.
   */
  constructor(
    private readonly provider: SecretProvider,
    private readonly registry?: ProviderRegistry,
  ) {}

  /**
   * Which backend answers this reference.
   *
   * Three outcomes, and the middle one is why this is not an inline lookup:
   *
   * - no registry → the single provider (legacy behaviour, unchanged);
   * - registry and the reference's provider resolves → that backend;
   * - registry and the provider is missing → `null`, which the caller reports as
   *   an unsupported provider. It must NOT fall back to `this.provider`: reading
   *   the vault for a reference that names another backend returns a different
   *   secret or none, and either way the user is told the wrong thing.
   */
  private providerFor(ref: CredentialRef): SecretProvider | null {
    if (!this.registry) return this.provider
    const named = ref.provider
    if (named === undefined) return this.provider
    return this.registry.get(named) ?? null
  }

  /**
   * Ask *this* backend why it cannot answer, when it can say.
   *
   * A provider that only implements `isAvailable` still works: the state is then
   * unknown, and `unusable` is the honest answer — we know the vault cannot be
   * read and we do not know why, which is exactly what that state means.
   */
  private async availabilityOf(provider: SecretProvider): Promise<
    | { ok: true }
    | { ok: false, state: 'uninitialized' | 'locked' | 'unusable' }
  > {
    if (provider.availabilityState) {
      return provider.availabilityState()
    }
    return (await provider.isAvailable())
      ? { ok: true }
      : { ok: false, state: 'unusable' }
  }

  async resolve(host: HostMetadata): Promise<CredentialResolution> {
    const ref: CredentialRef | null = host.credentialRef
    // No reference: nothing is stored. The caller connects with the Agent, or
    // asks the user for a password. This is a success with empty credentials.
    if (ref === null || ref.kinds.length === 0) {
      return { ok: true, credential: {} }
    }

    // Dispatch FIRST, then ask that backend whether it can answer.
    //
    // The original order was the reverse, and it was wrong in a way that sends the
    // user to the wrong place: `availability()` consults `this.provider` — always
    // the vault, because that is what the connection path injects — so a reference
    // naming another provider was judged by the vault's state. With a locked vault,
    // a `system-keychain` reference was reported as "the vault is locked, unlock it",
    // an instruction that cannot possibly fix it; the correct answer is that this
    // build cannot read that provider and the reference must be re-bound.
    //
    // A reference with no readable backend is a failure, not an empty password: the
    // user did store a secret and it must not silently vanish.
    const backend = this.providerFor(ref)
    if (backend === null) {
      return {
        ok: false,
        reason: 'corrupt-reference',
        message:
          `This host's credentials are stored with "${String(ref.provider)}", which ` +
          'this build cannot read. Re-save the credentials to store them here.',
        detail: `unsupported provider ${String(ref.provider)}`,
      }
    }

    const availability = await this.availabilityOf(backend)
    if (!availability.ok) {
      return {
        ok: false,
        reason: 'vault-unavailable',
        state: availability.state,
        message: VAULT_UNAVAILABLE_MESSAGES[availability.state],
      }
    }

    const resource: CredentialResource = { type: 'host', id: host.id }
    const version = refVersion(ref)
    const credential: ResolvedCredential = {}
    for (const kind of KINDS) {
      if (!ref.kinds.includes(kind)) continue
      let value: string | undefined
      try {
        value = await backend.read(resource, version, kind)
      } catch (error) {
        return {
          ok: false,
          reason: 'read-failed',
          message: `Reading the stored ${kind} for this host failed.`,
          cause: error,
        }
      }
      if (value === undefined) {
        // The reference promised this secret and the store does not have it.
        // Continuing would send a connection with a missing half.
        return {
          ok: false,
          reason: 'read-failed',
          message: `This host records a stored ${kind}, but the vault holds none. Re-save the host's credentials.`,
          cause: null,
        }
      }
      credential[kind] = value
    }
    return { ok: true, credential }
  }
}
