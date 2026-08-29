/**
 * Host CRUD 操作
 */
import type { Host } from '@/types'
import { hostRowToHost } from '@/store/host-mappers'
import { executeQuery, select } from './connection'
import type { HostRecord } from './types'

export async function getHosts(): Promise<Host[]> {
  const rows = await select<HostRecord>('SELECT * FROM hosts ORDER BY name')
  return rows.map(hostRowToHost)
}

export async function getHostById(id: string): Promise<Host | null> {
  const rows = await select<HostRecord>('SELECT * FROM hosts WHERE id = ?', [
    id,
  ])
  if (rows.length === 0) return null
  return hostRowToHost(rows[0])
}

export async function createHost(
  host: Omit<Host, 'createdAt' | 'updatedAt'>,
): Promise<void> {
  const now = Date.now()
  await executeQuery(
    `INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, certificate, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, jump_host_id, jump_host_auth_type, agent_forwarding, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      host.id,
      host.name,
      host.hostname,
      host.port,
      host.username,
      host.authType,
      host.password ?? null,
      host.privateKey ?? null,
      host.certificate ?? null,
      host.groupId ?? null,
      host.isFavorite ? 1 : 0,
      host.color ?? null,
      host.tags ? JSON.stringify(host.tags) : null,
      JSON.stringify(host.portForwards),
      host.startupCommand ?? null,
      host.environment ? JSON.stringify(host.environment) : null,
      host.jumpHostId ?? null,
      host.jumpHostAuthType ?? null,
      host.agentForwarding ? 1 : 0,
      now,
      now,
    ],
  )
}

export async function updateHost(
  id: string,
  updates: Partial<Host>,
): Promise<void> {
  const now = Date.now()
  await executeQuery(
    `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = ?, private_key = ?, certificate = ?, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, agent_forwarding = ?, updated_at = ? WHERE id = ?`,
    [
      updates.name,
      updates.hostname,
      updates.port,
      updates.username,
      updates.authType,
      updates.password ?? null,
      updates.privateKey ?? null,
      updates.certificate ?? null,
      updates.groupId ?? null,
      updates.isFavorite !== undefined
        ? updates.isFavorite
          ? 1
          : 0
        : undefined,
      updates.color ?? null,
      updates.tags ? JSON.stringify(updates.tags) : null,
      JSON.stringify(updates.portForwards),
      updates.startupCommand ?? null,
      updates.environment ? JSON.stringify(updates.environment) : null,
      updates.jumpHostId ?? null,
      updates.jumpHostAuthType ?? null,
      updates.agentForwarding ? 1 : 0,
      now,
      id,
    ],
  )
}

export async function deleteHost(id: string): Promise<void> {
  await executeQuery('DELETE FROM hosts WHERE id = ?', [id])
}

export async function searchHosts(query: string): Promise<Host[]> {
  const rows = await select<HostRecord>(
    'SELECT * FROM hosts WHERE name LIKE ? OR hostname LIKE ? ORDER BY name LIMIT 50',
    [`%${query}%`, `%${query}%`],
  )
  return rows.map(hostRowToHost)
}

export async function getHostsByGroup(groupId: string | null): Promise<Host[]> {
  if (groupId === null) {
    const rows = await select<HostRecord>(
      'SELECT * FROM hosts WHERE group_id IS NULL ORDER BY name',
    )
    return rows.map(hostRowToHost)
  }
  const rows = await select<HostRecord>(
    'SELECT * FROM hosts WHERE group_id = ? ORDER BY name',
    [groupId],
  )
  return rows.map(hostRowToHost)
}

export async function getFavoriteHosts(): Promise<Host[]> {
  const rows = await select<HostRecord>(
    'SELECT * FROM hosts WHERE is_favorite = 1 ORDER BY name',
  )
  return rows.map(hostRowToHost)
}
