/**
 * SSH Keys CRUD 操作
 */
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import { executeQuery, select } from './connection'
import type { SSHKeyRecord } from './types'

/**
 * Moves a key's secret material into the vault.
 *
 * Same rule as hosts: the row keeps identity and the public half, the vault keeps
 * the private key and its passphrase. A vault that cannot take them fails the save
 * rather than silently storing plaintext.
 */
async function persistKeySecrets(
  id: string,
  secrets: { privateKey?: string | null, passphrase?: string | null },
): Promise<void> {
  const entries: Array<['privateKey' | 'passphrase', string]> = []
  if (secrets.privateKey) entries.push(['privateKey', secrets.privateKey])
  if (secrets.passphrase) entries.push(['passphrase', secrets.passphrase])
  if (entries.length === 0) return
  if (!(await vaultSecretProvider.isAvailable())) {
    throw new Error(
      "This SSH key has private material, but the vault is locked. Unlock the vault to save it.",
    )
  }
  for (const [kind, value] of entries) {
    await vaultSecretProvider.write(id, kind, value)
  }
}

/** Reads a key's stored secret back, for a connection that needs it. */
export async function getSSHKeySecret(
  id: string,
  kind: 'privateKey' | 'passphrase',
): Promise<string | undefined> {
  return vaultSecretProvider.read(id, kind)
}

export async function createSSHKey(
  key: Omit<SSHKeyRecord, 'created_at' | 'updated_at'>,
): Promise<string> {
  const now = Date.now()
  await persistKeySecrets(key.id, {
    privateKey: key.private_key,
    passphrase: key.passphrase,
  })
  await executeQuery(
    `INSERT INTO ssh_keys (id, name, key_type, private_key, public_key, certificate, passphrase, is_encrypted, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)`,
    [
      key.id,
      key.name,
      key.key_type,
      key.public_key,
      key.certificate,
      key.is_encrypted,
      now,
      now,
    ],
  )
  return key.id
}

export async function updateSSHKey(
  id: string,
  updates: Partial<SSHKeyRecord>,
): Promise<void> {
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.key_type !== undefined) {
    fields.push('key_type = ?')
    values.push(updates.key_type)
  }
  if (updates.private_key !== undefined) {
    // The value goes to the vault; only the "it is now stored" fact reaches the
    // row, and the column is explicitly cleared so no leftover plaintext remains.
    await persistKeySecrets(id, { privateKey: updates.private_key })
    fields.push('private_key = NULL')
  }
  if (updates.public_key !== undefined) {
    fields.push('public_key = ?')
    values.push(updates.public_key)
  }
  if (updates.certificate !== undefined) {
    fields.push('certificate = ?')
    values.push(updates.certificate)
  }
  if (updates.passphrase !== undefined) {
    await persistKeySecrets(id, { passphrase: updates.passphrase })
    fields.push('passphrase = NULL')
  }
  if (updates.is_encrypted !== undefined) {
    fields.push('is_encrypted = ?')
    values.push(updates.is_encrypted)
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)
    await executeQuery(
      `UPDATE ssh_keys SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

export async function deleteSSHKey(id: string): Promise<void> {
  await executeQuery('DELETE FROM ssh_keys WHERE id = ?', [id])
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
