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
 *
 * ## Versions
 *
 * A reference names a *version* of the credential, and the vault key embeds it:
 * `host:<id>:<version>:password`. The version is what makes a multi-secret update
 * recoverable. Writing both a password and a private key under fixed keys means a
 * failure after the first write leaves a host whose password is new and whose key
 * is old — a combination that never existed and cannot be rolled back. With a
 * version, the new secrets are written under a *new* key set, the row is switched
 * in one statement, and the old key set is removed afterwards. Every crash point
 * leaves either the old version (fully consistent) or the new one (fully
 * consistent), plus at most some orphaned keys that nothing references.
 *
 * The version is a monotonically increasing integer per resource. It is stored in
 * the reference so a reader can tell which key set the row points at without
 * consulting the vault.
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
  /**
   * Which generation of the credential this is.
   *
   * Absent on references written before Phase 10.1, which used one fixed key per
   * kind. Those still resolve — see `LEGACY_VERSION` — because refusing them would
   * make every host saved by the previous build unable to connect.
   */
  version?: number
}

/**
 * The version a pre-10.1 reference resolves to.
 *
 * Those references have no version field, and their secrets live under
 * `host:<id>:<kind>`. Keeping one constant for "the unversioned key set" means the
 * migration and the resolver cannot disagree about where the old secret is.
 */
export const LEGACY_VERSION = 0

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

/**
 * Storage backend for secrets. `VaultSecretProvider` is the only implementation.
 *
 * `read`/`write`/`remove` take the *version*, because a write must never overwrite
 * the credentials a live row still points at. A provider that ignored it would
 * reintroduce the partial-update defect the version exists to prevent.
 */
export interface SecretProvider {
  /** True when the backend can be read right now (e.g. the vault is unlocked). */
  isAvailable(): Promise<boolean>
  /**
   * The same check with the reason kept, when the provider can say it.
   *
   * Optional so existing providers keep compiling, but the resolver prefers it:
   * a boolean is what forced the state to be recovered from a sentence later.
   */
  availabilityState?(): Promise<
    | { ok: true }
    | { ok: false; state: 'uninitialized' | 'locked' | 'unusable' }
  >
  read(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
  ): Promise<string | undefined>
  write(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
    value: string,
  ): Promise<void>
  remove(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
  ): Promise<void>
}

/** Which kind of row owns a secret. The two namespaces never overlap. */
export interface CredentialResource {
  type: 'host' | 'ssh-key'
  id: string
}

export type CredentialResolutionFailure =
  | {
      ok: false
      reason: 'vault-unavailable'
      message: string
      /**
       * Which vault situation stopped the read.
       *
       * `reason` alone cannot say it: "unavailable" covers three states with
       * three different next steps (create, unlock, check the vault). The
       * provider already knows which one it is; carrying it here keeps callers
       * from reverse-engineering the state out of an English sentence.
       */
      state?: 'uninitialized' | 'locked' | 'unusable'
    }
  | { ok: false; reason: 'read-failed'; message: string; cause: unknown }
  | {
      ok: false
      reason: 'corrupt-reference'
      message: string
      /** Why the reference could not be trusted, without any secret material. */
      detail: string
    }

export type CredentialResolution =
  | { ok: true; credential: ResolvedCredential }
  | CredentialResolutionFailure

// The parsing rules live in their own module; re-exported here so callers keep one
// import for the boundary as a whole.
export {
  MAX_SUPPORTED_VERSION,
  parseCredentialRef,
} from './credential-ref'
export type {
  CredentialRefParse,
  CredentialRefProblem,
} from './credential-ref'

// Resolution reads secrets, so it lives beside the boundary rather than inside it.
// Re-exported for the same reason as the parse rules.
export { SessionCredentialResolver } from './credential-resolver'

/** The version a reference resolves to, with the legacy fallback made explicit. */
export function refVersion(ref: CredentialRef): number {
  return ref.version ?? LEGACY_VERSION
}

/**
 * The vault key for one secret.
 *
 * Two namespaces, never merged: `host:<id>:…` and `ssh-key:<id>:…`. They used to
 * share one, which meant a host and a key that happened to have the same id could
 * read each other's secret.
 */
export function vaultKey(
  resource: CredentialResource,
  version: number,
  kind: CredentialKind,
): string {
  const namespace = resource.type === 'host' ? 'host' : 'ssh-key'
  if (version === LEGACY_VERSION) {
    // Pre-10.1 keys carried no version segment. Reconstructing them exactly is what
    // lets an un-migrated host keep connecting.
    return `${namespace}:${resource.id}:${kind}`
  }
  return `${namespace}:${resource.id}:${version}:${kind}`
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
 *
 * `version` is supplied by the caller, which is the only place that knows the
 * previous version. Passing the version it is *replacing* here would overwrite a
 * live credential in place and reintroduce the partial-update defect.
 */
export function splitHostSecrets(
  input: {
    password?: string | null
    privateKey?: string | null
    passphrase?: string | null
  },
  version: number,
): {
  ref: CredentialRef | null
  secrets: Array<{ kind: CredentialKind, value: string }>
} {
  const secrets: Array<{ kind: CredentialKind, value: string }> = []
  if (input.password) secrets.push({ kind: 'password', value: input.password })
  if (input.privateKey) {
    secrets.push({ kind: 'privateKey', value: input.privateKey })
  }
  if (input.passphrase) {
    secrets.push({ kind: 'passphrase', value: input.passphrase })
  }
  if (secrets.length === 0) return { ref: null, secrets }
  return {
    ref: {
      kinds: secrets.map(secret => secret.kind),
      provider: 'vault',
      version,
    },
    secrets,
  }
}

/** Serialise a reference for the `credential_ref` column. */
export function serializeCredentialRef(ref: CredentialRef): string {
  return JSON.stringify(ref)
}
