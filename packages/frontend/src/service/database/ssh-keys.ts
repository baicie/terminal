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
import { refVersion, serializeCredentialRef } from '@/service/credential-boundary'
import type { CredentialRef } from '@/service/credential-boundary'
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import { executeQuery, select } from './connection'
import {
  discardKeyVersion,
  persistKeySecrets,
  readKeyCredentialRef,
  retireKeyVersion,
} from './ssh-key-credentials'
import { keyIdExists, keyOwnsNoRow, withKeyWriteLock } from './key-write-lock'
import type { SSHKeyRecord } from './types'

export { readKeyCredentialRef } from './ssh-key-credentials'

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
  /*
   * RC03: same per-key lock as the host path, and for the same measured reason. A
   * duplicate id would write version 1 over the live key's generation and then have
   * `discardKeyVersion` delete it — the surviving row keeps `credential_ref` and loses
   * its private key (`privateKeyStillReadable: undefined`, `vaultAfter: {}`).
   */
  return withKeyWriteLock(key.id, () => createSSHKeyLocked(key))
}

async function createSSHKeyLocked(
  key: Omit<SSHKeyRecord, 'created_at' | 'updated_at'>,
): Promise<string> {
  const now = Date.now()
  if (await keyIdExists(key.id)) {
    throw new Error(
      `An SSH key with id ${key.id} already exists; refusing to overwrite its credentials`,
    )
  }
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
    // Only when nothing owns the id: a racing create that won reads this very version.
    if (persisted.ref && (await keyOwnsNoRow(key.id))) {
      await discardKeyVersion(key.id, persisted.ref)
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
  // RC03: the same per-key lock `createSSHKey` takes. Two saves that both read version N
  // compute N+1, and the second overwrites the first's ciphertext while each retires "N".
  return withKeyWriteLock(id, () => updateSSHKeyLocked(id, updates))
}

async function updateSSHKeyLocked(
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
    if (newRef) await discardKeyVersion(id, newRef)
    throw error
  }

  if (hasSecrets) await retireKeyVersion(id, previousRef)
}

/**
 * Forget a key's stored secret, keeping the key itself.
 *
 * The mirror of `updateHost({ clearCredential: true })`, and it was missing: the
 * keychain could write a private key, read it back, and delete the whole key, but
 * had no way to stop storing just the secret. `updateSSHKey` writes
 * `credential_ref = COALESCE(?, credential_ref)`, which is correct for an edit that
 * carries no secret and means there is no path through it that drops the pointer.
 *
 * Ordering is the same rule hosts follow: the row stops pointing at the secret
 * first, then the ciphertext is removed. A failure after the UPDATE leaves an
 * unreferenced secret — recoverable, and reported — rather than a key whose
 * reference names a secret that is already gone.
 *
 * A *damaged* reference is the case this has to handle and the reason it does not
 * route through `readKeyCredentialRef` to decide whether to run: when the pointer
 * cannot be parsed there is no version to retire, but the row still has to lose the
 * pointer or the user is stuck with a key that refuses to work and cannot be fixed
 * short of deleting it. So the UPDATE always runs; only the retirement step depends
 * on whether a readable version exists.
 */
export async function clearSSHKeyCredential(id: string): Promise<void> {
  const existing = await getSSHKeyById(id)
  if (!existing) return

  await executeQuery(
    `UPDATE ssh_keys SET
       private_key = CASE WHEN ? = 1 THEN NULL ELSE private_key END,
       passphrase = CASE WHEN ? = 1 THEN NULL ELSE passphrase END,
       credential_ref = NULL,
       updated_at = ?
     WHERE id = ?`,
    [
      // A pre-migration row keeps its plaintext in these columns; blanking the row
      // here is what the user asked for, so the marker is 1 when a secret is being
      // cleared. (The vault-held values never live in these columns.)
      1,
      1,
      Date.now(),
      id,
    ],
  )

  // The row no longer names it, so a failure here is orphaned ciphertext rather
  // than a dangling reference. `retireKeyVersion` already swallows and documents
  // that; repeating the guard would imply it does not.
  const ref = readKeyCredentialRef(existing.credential_ref)
  if (!ref) return
  await retireKeyVersion(id, ref)
}

export async function deleteSSHKey(id: string): Promise<void> {
  // RC03: without this, a recreate that lands between the row read and the vault
  // cleanup writes version 1 again, and the cleanup retires the *new* key's secret.
  return withKeyWriteLock(id, () => deleteSSHKeyLocked(id))
}

async function deleteSSHKeyLocked(id: string): Promise<void> {
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
