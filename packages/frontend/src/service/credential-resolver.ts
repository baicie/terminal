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
  constructor(private readonly provider: SecretProvider) {}

  /**
   * Ask the provider why it cannot answer, when it can say.
   *
   * A provider that only implements `isAvailable` still works: the state is then
   * unknown, and `unusable` is the honest answer — we know the vault cannot be
   * read and we do not know why, which is exactly what that state means.
   */
  private async availability(): Promise<
    | { ok: true }
    | { ok: false, state: 'uninitialized' | 'locked' | 'unusable' }
  > {
    if (this.provider.availabilityState) {
      return this.provider.availabilityState()
    }
    return (await this.provider.isAvailable())
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

    // A reference with no readable backend is a failure, not an empty password:
    // the user did store a secret and it must not silently vanish.
    const availability = await this.availability()
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
        value = await this.provider.read(resource, version, kind)
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
