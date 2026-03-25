/**
 * Known Hosts CRUD 操作
 */
import { executeQuery, select } from './connection'
import type { KnownHostRecord } from './types'

export async function addKnownHost(
  host: Omit<KnownHostRecord, 'id'>,
): Promise<string> {
  const id = crypto.randomUUID()
  await executeQuery(
    `INSERT INTO known_hosts (id, hostname, port, fingerprint, key_type, added_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      host.hostname,
      host.port,
      host.fingerprint,
      host.key_type,
      host.added_at,
    ],
  )
  return id
}

export async function addKnownHosts(
  hosts: Omit<KnownHostRecord, 'id'>[],
): Promise<void> {
  for (const host of hosts) {
    // Check if already exists
    const existing = await select<KnownHostRecord[]>(
      'SELECT * FROM known_hosts WHERE hostname = ? AND port = ?',
      [host.hostname, host.port],
    )
    if (existing.length === 0) {
      const id = crypto.randomUUID()
      await executeQuery(
        `INSERT INTO known_hosts (id, hostname, port, fingerprint, key_type, added_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          host.hostname,
          host.port,
          host.fingerprint,
          host.key_type,
          host.added_at,
        ],
      )
    }
  }
}

export async function deleteKnownHost(id: string): Promise<void> {
  await executeQuery('DELETE FROM known_hosts WHERE id = ?', [id])
}

export async function clearAllKnownHosts(): Promise<void> {
  await executeQuery('DELETE FROM known_hosts')
}

export async function getKnownHosts(): Promise<KnownHostRecord[]> {
  return select<KnownHostRecord[]>('SELECT * FROM known_hosts ORDER BY added_at DESC')
}

export async function searchKnownHosts(
  query: string,
): Promise<KnownHostRecord[]> {
  const escapedQuery = query.replace(/[%_]/g, '\\$&')
  return select<KnownHostRecord[]>(
    'SELECT * FROM known_hosts WHERE hostname LIKE ? ESCAPE "\\" ORDER BY added_at DESC LIMIT 50',
    [`%${escapedQuery}%`],
  )
}
