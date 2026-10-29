/**
 * Port Forward Rules CRUD 操作
 */
import { executeQuery, select } from './connection'
import type { PortForwardRuleRecord } from './types'

export async function getPortForwardRules(): Promise<PortForwardRuleRecord[]> {
  return select<PortForwardRuleRecord>(
    'SELECT * FROM port_forward_rules ORDER BY created_at DESC',
  )
}

export async function getPortForwardRulesByHost(
  hostId: string,
): Promise<PortForwardRuleRecord[]> {
  return select<PortForwardRuleRecord>(
    'SELECT * FROM port_forward_rules WHERE host_id = ? ORDER BY created_at DESC',
    [hostId],
  )
}

export async function createPortForwardRule(
  rule: Omit<PortForwardRuleRecord, 'created_at' | 'updated_at'>,
): Promise<void> {
  const now = Date.now()
  await executeQuery(
    `INSERT INTO port_forward_rules
      (id, name, type, local_host, local_port, remote_host, remote_port, host_id, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rule.id,
      rule.name,
      rule.type,
      rule.local_host,
      rule.local_port,
      rule.remote_host,
      rule.remote_port,
      rule.host_id ?? null,
      rule.enabled,
      now,
      now,
    ],
  )
}

export async function updatePortForwardRule(
  id: string,
  updates: Partial<Omit<PortForwardRuleRecord, 'id' | 'created_at'>>,
): Promise<void> {
  const now = Date.now()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.type !== undefined) {
    fields.push('type = ?')
    values.push(updates.type)
  }
  if (updates.local_host !== undefined) {
    fields.push('local_host = ?')
    values.push(updates.local_host)
  }
  if (updates.local_port !== undefined) {
    fields.push('local_port = ?')
    values.push(updates.local_port)
  }
  if (updates.remote_host !== undefined) {
    fields.push('remote_host = ?')
    values.push(updates.remote_host)
  }
  if (updates.remote_port !== undefined) {
    fields.push('remote_port = ?')
    values.push(updates.remote_port)
  }
  if (updates.host_id !== undefined) {
    fields.push('host_id = ?')
    values.push(updates.host_id ?? null)
  }
  if (updates.enabled !== undefined) {
    fields.push('enabled = ?')
    values.push(updates.enabled)
  }

  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)

  await executeQuery(
    `UPDATE port_forward_rules SET ${fields.join(', ')} WHERE id = ?`,
    values,
  )
}

export async function deletePortForwardRule(id: string): Promise<void> {
  await executeQuery('DELETE FROM port_forward_rules WHERE id = ?', [id])
}
