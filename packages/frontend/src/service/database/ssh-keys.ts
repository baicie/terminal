/**
 * SSH Keys CRUD 操作
 */
import { executeQuery, select } from './connection'
import type { SSHKeyRecord } from './types'

export async function createSSHKey(
  key: Omit<SSHKeyRecord, 'created_at' | 'updated_at'>,
): Promise<string> {
  const now = Date.now()
  await executeQuery(
    `INSERT INTO ssh_keys (id, name, key_type, private_key, public_key, certificate, passphrase, is_encrypted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      key.id,
      key.name,
      key.key_type,
      key.private_key,
      key.public_key,
      key.certificate,
      key.passphrase,
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
    fields.push('private_key = ?')
    values.push(updates.private_key)
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
    fields.push('passphrase = ?')
    values.push(updates.passphrase)
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
