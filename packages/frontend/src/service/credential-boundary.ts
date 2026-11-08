/**
 * Credential boundary for host connections.
 *
 * The host row is metadata: name, address, user, auth type, references. The
 * secret behind a reference lives in exactly one place — the Vault, or nowhere
 * at all when the user authenticates with the SSH Agent or types the password at
 * connect time. Nothing in this module puts a secret into a Zustand store, a
 * log line, an error message or an export.
 *
 * Design notes that the tests hold us to:
 *
 * - A host whose `credentialRef` is absent has no stored secret. That is a valid
 *   state (Agent, or prompt-at-connect), never an error.
 * - A host that *does* have a reference and whose secret cannot be read is an
 *   error the caller must surface. Answering "no password" there turns a locked
 *   vault into a bare authentication failure with no explanation.
 * - Reading is on demand, at connect time. Nothing here caches a plaintext secret
 *   beyond the single call that needs it.
 */

/** What kind of secret a host refers to. */
export type CredentialKind = 'password' | 'privateKey' | 'passphrase'

/**
 * A pointer to a stored secret. It deliberately carries no secret material, so a
 * host row can be logged, synced or exported as-is.
 */
export interface CredentialRef {
  /** Which secret fields this host has stored. Empty means "nothing stored". */
  kinds: CredentialKind[]
  /** Where the secret lives. Only the vault exists today. */
  provider: 'vault'
}

/** The non-secret half of a host: everything a connection needs except the secret. */
export interface HostMetadata {
  id: string
  name: string
  hostname: string
  port: number
  username: string
  authType: string
  credentialRef: CredentialRef | null
}

/** Secrets for one connection attempt. Never persisted, never logged. */
export interface ResolvedCredential {
  password?: string
  privateKey?: string
  passphrase?: string
}

/** Storage backend for secrets. `VaultSecretProvider` is the only implementation. */
export interface SecretProvider {
  /** True when the backend can be read right now (e.g. the vault is unlocked). */
  isAvailable(): Promise<boolean>
  read(hostId: string, kind: CredentialKind): Promise<string | undefined>
  write(hostId: string, kind: CredentialKind, value: string): Promise<void>
  remove(hostId: string, kind: CredentialKind): Promise<void>
}

export type CredentialResolutionFailure =
  | { ok: false; reason: 'vault-unavailable'; message: string }
  | { ok: false; reason: 'read-failed'; message: string; cause: unknown }

export type CredentialResolution =
  | { ok: true; credential: ResolvedCredential }
  | CredentialResolutionFailure

const KINDS: CredentialKind[] = ['password', 'privateKey', 'passphrase']

/**
 * Resolves the secrets a connection needs, at the moment it needs them.
 *
 * The resolver takes the metadata (not a full host object with embedded
 * secrets), so a caller cannot accidentally connect with a plaintext field that
 * was never meant to exist.
 */
export class SessionCredentialResolver {
  constructor(private readonly provider: SecretProvider) {}

  async resolve(host: HostMetadata): Promise<CredentialResolution> {
    const ref = host.credentialRef
    // No reference: nothing is stored. The caller connects with the Agent, or
    // asks the user for a password. This is a success with empty credentials.
    if (ref === null || ref.kinds.length === 0) {
      return { ok: true, credential: {} }
    }

    // A reference with no readable backend is a failure, not an empty password:
    // the user did store a secret and it must not silently vanish.
    if (!(await this.provider.isAvailable())) {
      return {
        ok: false,
        reason: 'vault-unavailable',
        message:
          'This host stores its credentials in the vault, which is locked. Unlock the vault and connect again.',
      }
    }

    const credential: ResolvedCredential = {}
    for (const kind of KINDS) {
      if (!ref.kinds.includes(kind)) continue
      let value: string | undefined
      try {
        value = await this.provider.read(host.id, kind)
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

/** The credential kinds present in a set of secrets, in a stable order. */
export function credentialKindsOf(secrets: {
  password?: string | null
  privateKey?: string | null
  passphrase?: string | null
}): CredentialKind[] {
  const kinds: CredentialKind[] = []
  if (secrets.password) kinds.push('password')
  if (secrets.privateKey) kinds.push('privateKey')
  if (secrets.passphrase) kinds.push('passphrase')
  return kinds
}

/**
 * Splits a host form's secret fields into the reference to store and the values
 * to hand the provider. The caller writes the values and persists the reference;
 * it must never persist the values themselves.
 */
export function splitHostSecrets(input: {
  password?: string | null
  privateKey?: string | null
  passphrase?: string | null
}): {
  ref: CredentialRef | null
  secrets: Array<{ kind: CredentialKind; value: string }>
} {
  const secrets: Array<{ kind: CredentialKind; value: string }> = []
  if (input.password) secrets.push({ kind: 'password', value: input.password })
  if (input.privateKey) {
    secrets.push({ kind: 'privateKey', value: input.privateKey })
  }
  if (input.passphrase) {
    secrets.push({ kind: 'passphrase', value: input.passphrase })
  }
  if (secrets.length === 0) return { ref: null, secrets }
  return {
    ref: { kinds: secrets.map(secret => secret.kind), provider: 'vault' },
    secrets,
  }
}
