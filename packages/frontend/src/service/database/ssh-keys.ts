/**
 * SSH Keys CRUD 操作
 *
 * Same contract as hosts: the row keeps identity and the public half, the vault
 * keeps the private key and its passphrase, and the row carries a reference that
 * names the *version* of that secret. The namespace is `ssh-key:<id>:…`, separate
 * from hosts — the two used to share `host:` and could collide on an id.
 *
 * The private half is never returned by a list read. Reading it is a separate,
 * explicit call (`getSSHKeySecret`) that the UI makes only when the user asks to
 * view or copy a key, and that a connection makes only when it needs one.
 */
import {
  parseCredentialRef,
  refVersion,
  serializeCredentialRef,
} from '@/service/credential-boundary'
import type { CredentialKind, CredentialRef } from '@/service/credential-boundary'
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import { vaultUnavailableMessage } from '@/service/vault-unavailable-message'
import { executeQuery, select } from './connection'
import type { SSHKeyRecord } from './types'

function nextVersion(current: CredentialRef | null): number {
  if (current === null) return 1
  return refVersion(current) + 1
}

/** The reference stored on a key row, read back the same way hosts read theirs. */
export function readKeyCredentialRef(
  raw: string | null | undefined,
): CredentialRef | null {
  const parsed = parseCredentialRef(raw)
  return parsed.ok ? parsed.ref : null
}

/**
 * Move a key's secret material into the vault under a new version.
 *
 * Returns the reference to store and the version it replaced. Writing under a fresh
 * version is what makes "the private key landed but the passphrase did not"
 * recoverable: nothing the row points at has been touched.
 */
async function persistKeySecrets(
  id: string,
  secrets: { privateKey?: string | null, passphrase?: string | null },
  current: CredentialRef | null,
): Promise<{ ref: CredentialRef | null, previous: CredentialRef | null }> {
  const entries: Array<[CredentialKind, string]> = []
  if (secrets.privateKey) entries.push(['privateKey', secrets.privateKey])
  if (secrets.passphrase) entries.push(['passphrase', secrets.passphrase])
  if (entries.length === 0) return { ref: current, previous: null }

  const availability = await vaultSecretProvider.availability()
  if (!availability.ok) {
    throw new Error(vaultUnavailableMessage(availability.state))
  }

  const version = nextVersion(current)
  const resource = { type: 'ssh-key' as const, id }
  const written: CredentialKind[] = []
  try {
    for (const [kind, value] of entries) {
      await vaultSecretProvider.write(resource, version, kind, value)
      written.push(kind)
    }
    for (const [kind, value] of entries) {
      const readBack = await vaultSecretProvider.read(resource, version, kind)
      if (readBack !== value) {
        throw new Error(`the vault did not return the ${kind} it was just given`)
      }
    }
  } catch (error) {
    await vaultSecretProvider.removeVersion(resource, version, written)
    throw error
  }

  // The new reference carries every kind this key now has: kinds that were already
  // stored keep their values, so they must stay listed or a connection would stop
  // reading them.
  const kinds = Array.from(
    new Set<CredentialKind>([...(current?.kinds ?? []), ...written]),
  )
  return {
    ref: { kinds, provider: 'vault', version },
    previous: current,
  }
}

/** Retire a key's previous version after the row stopped pointing at it. */
async function retireKeyVersion(
  id: string,
  previous: CredentialRef | null,
): Promise<void> {
  if (!previous) return
  await vaultSecretProvider.removeVersion(
    { type: 'ssh-key', id },
    refVersion(previous),
    previous.kinds,
  )
}

/**
 * Reads a key's stored secret back, for a connection that needs it.
 *
 * The only way a private key leaves the vault, and it is per-kind and per-call:
 * nothing here caches, logs or returns the value to a list read.
 */
export async function getSSHKeySecret(
  id: string,
  kind: 'privateKey' | 'passphrase',
): Promise<string | undefined> {
  const key = await getSSHKeyById(id)
  if (!key) return undefined
  const ref = readKeyCredentialRef(key.credential_ref)
  if (ref === null) return undefined
  if (!ref.kinds.includes(kind)) return undefined
  return vaultSecretProvider.read({ type: 'ssh-key', id }, refVersion(ref), kind)
}

/** Both halves of a key's secret, for a connection that authenticates with it. */
export async function getSSHKeyCredentials(id: string): Promise<{
  privateKey?: string
  passphrase?: string
}> {
  const result: { privateKey?: string, passphrase?: string } = {}
  const privateKey = await getSSHKeySecret(id, 'privateKey')
  if (privateKey !== undefined) result.privateKey = privateKey
  const passphrase = await getSSHKeySecret(id, 'passphrase')
  if (passphrase !== undefined) result.passphrase = passphrase
  return result
}

export async function createSSHKey(
  key: Omit<SSHKeyRecord, 'created_at' | 'updated_at'>,
): Promise<string> {
  const now = Date.now()
  const persisted = await persistKeySecrets(
    key.id,
    { privateKey: key.private_key, passphrase: key.passphrase },
    null,
  )
  try {
    await executeQuery(
      `INSERT INTO ssh_keys (id, name, key_type, private_key, public_key, certificate, passphrase, credential_ref, is_encrypted, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        key.id,
        key.name,
        key.key_type,
        key.public_key,
        key.certificate,
        persisted.ref === null ? null : serializeCredentialRef(persisted.ref),
        key.is_encrypted,
        now,
        now,
      ],
    )
  } catch (error) {
    if (persisted.ref && persisted.ref.version !== undefined) {
      await vaultSecretProvider.removeVersion(
        { type: 'ssh-key', id: key.id },
        persisted.ref.version,
        persisted.ref.kinds,
      )
    }
    throw error
  }
  return key.id
}

/**
 * Update a key's metadata and, when new secret material is supplied, move it into
 * the vault under a new version.
 *
 * The SQL is a fixed statement rather than a `fields.join(', ')` list. A dynamic
 * list is how a future field could reintroduce a secret column with a placeholder:
 * adding `private_key = ?` to the list would look like every other line, and the
 * only thing standing between it and plaintext in SQLite would be the reviewer
 * noticing. Fixed text with a literal `NULL` cannot be extended that way — it has to
 * be rewritten, which is a visible change.
 *
 * `COALESCE(?, credential_ref)` keeps the existing reference when this call carries
 * no secret; the new reference is supplied only after the vault write succeeded.
 */
export async function updateSSHKey(
  id: string,
  updates: Partial<SSHKeyRecord>,
): Promise<void> {
  const hasSecrets =
    updates.private_key !== undefined || updates.passphrase !== undefined

  const existing = await getSSHKeyById(id)
  if (!existing) return

  let previousRef: CredentialRef | null = null
  let newRef: CredentialRef | null = null
  if (hasSecrets) {
    const current = readKeyCredentialRef(existing.credential_ref)
    const persisted = await persistKeySecrets(
      id,
      { privateKey: updates.private_key, passphrase: updates.passphrase },
      current,
    )
    newRef = persisted.ref
    previousRef = persisted.previous
  }

  // Only fields the update actually names are replaced; everything else is the
  // stored value, read back through the same merge rule hosts use.
  const merged: SSHKeyRecord = { ...existing, ...updates }

  try {
    await executeQuery(
      `UPDATE ssh_keys SET
         name = ?, key_type = ?,
         private_key = CASE WHEN ? = 1 THEN NULL ELSE private_key END,
         public_key = ?, certificate = ?,
         passphrase = CASE WHEN ? = 1 THEN NULL ELSE passphrase END,
         credential_ref = COALESCE(?, credential_ref),
         is_encrypted = ?, updated_at = ?
       WHERE id = ?`,
      [
        merged.name,
        merged.key_type,
        // The marker says "this call is the one moving the secret". A plain edit
        // leaves both columns alone, because a pre-migration row still keeps its
        // plaintext there and blanking it would destroy the user's only copy
        // before the migration has run.
        hasSecrets ? 1 : 0,
        merged.public_key,
        merged.certificate,
        hasSecrets ? 1 : 0,
        newRef === null ? null : serializeCredentialRef(newRef),
        merged.is_encrypted,
        Date.now(),
        id,
      ],
    )
  } catch (error) {
    // The row still points at the previous version; this attempt's generation is
    // unreachable. Remove it so a retry does not accumulate ciphertext.
    if (newRef && newRef.version !== undefined) {
      await vaultSecretProvider.removeVersion(
        { type: 'ssh-key', id },
        newRef.version,
        newRef.kinds,
      )
    }
    throw error
  }

  if (hasSecrets) await retireKeyVersion(id, previousRef)
}

export async function deleteSSHKey(id: string): Promise<void> {
  // Same ordering as hosts: the row goes first, so a failure after it leaves an
  // unreferenced secret rather than a key whose secret is already gone.
  const existing = await getSSHKeyById(id)
  const ref = existing ? readKeyCredentialRef(existing.credential_ref) : null
  await executeQuery('DELETE FROM ssh_keys WHERE id = ?', [id])
  if (!ref) return
  try {
    await vaultSecretProvider.removeVersion(
      { type: 'ssh-key', id },
      refVersion(ref),
      ref.kinds,
    )
  } catch {
    // A locked vault must not make a completed delete look failed.
  }
}

export async function getSSHKeys(): Promise<SSHKeyRecord[]> {
  return select<SSHKeyRecord>('SELECT * FROM ssh_keys ORDER BY name')
}

export async function getSSHKeyById(id: string): Promise<SSHKeyRecord | null> {
  const results = await select<SSHKeyRecord>(
    'SELECT * FROM ssh_keys WHERE id = ?',
    [id],
  )
  return results[0] || null
}

export async function searchSSHKeys(query: string): Promise<SSHKeyRecord[]> {
  const escapedQuery = query.replace(/[%_]/g, '\\$&')
  return select<SSHKeyRecord>(
    'SELECT * FROM ssh_keys WHERE name LIKE ? ESCAPE "\\" ORDER BY name LIMIT 50',
    [`%${escapedQuery}%`],
  )
}
