/**
 * Connection Logs CRUD 操作
 */
import { executeQuery, select } from './connection'
import type { ConnectionLogRecord } from './types'

export async function addConnectionLog(
  log: Omit<ConnectionLogRecord, 'id'>,
): Promise<string> {
  const id = crypto.randomUUID()
  await executeQuery(
    `INSERT INTO connection_logs (id, host_id, host_name, host_address, username, connection_type, started_at, ended_at, duration_seconds, is_saved, notes, error_message, error_raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      log.host_id,
      log.host_name,
      log.host_address,
      log.username,
      log.connection_type,
      log.started_at,
      log.ended_at,
      log.duration_seconds,
      log.is_saved,
      log.notes,
      log.error_message,
      log.error_raw,
    ],
  )
  return id
}

export async function updateConnectionLog(
  id: string,
  updates: Partial<ConnectionLogRecord>,
): Promise<void> {
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.ended_at !== undefined) {
    fields.push('ended_at = ?')
    values.push(updates.ended_at)
  }
  if (updates.duration_seconds !== undefined) {
    fields.push('duration_seconds = ?')
    values.push(updates.duration_seconds)
  }
  if (updates.is_saved !== undefined) {
    fields.push('is_saved = ?')
    values.push(updates.is_saved)
  }
  if (updates.notes !== undefined) {
    fields.push('notes = ?')
    values.push(updates.notes)
  }
  if (updates.error_message !== undefined) {
    fields.push('error_message = ?')
    values.push(updates.error_message)
  }
  if (updates.error_raw !== undefined) {
    fields.push('error_raw = ?')
    values.push(updates.error_raw)
  }

  if (fields.length > 0) {
    values.push(id)
    await executeQuery(
      `UPDATE connection_logs SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

export async function deleteConnectionLog(id: string): Promise<void> {
  await executeQuery('DELETE FROM connection_logs WHERE id = ?', [id])
}

export async function clearConnectionLogs(): Promise<void> {
  await executeQuery('DELETE FROM connection_logs WHERE is_saved = 0')
}

export async function getConnectionLogs(
  limit = 100,
): Promise<ConnectionLogRecord[]> {
  return select<ConnectionLogRecord>(
    'SELECT * FROM connection_logs ORDER BY started_at DESC LIMIT ?',
    [limit],
  )
}

export async function getConnectionLogsByHost(
  hostId: string,
): Promise<ConnectionLogRecord[]> {
  return select<ConnectionLogRecord>(
    'SELECT * FROM connection_logs WHERE host_id = ? ORDER BY started_at DESC',
    [hostId],
  )
}

export async function searchConnectionLogs(
  query: string,
): Promise<ConnectionLogRecord[]> {
  const escapedQuery = query.replace(/[%_]/g, '\\$&')
  return select<ConnectionLogRecord>(
    'SELECT * FROM connection_logs WHERE host_name LIKE ? ESCAPE "\\" OR host_address LIKE ? ESCAPE "\\" OR username LIKE ? ESCAPE "\\" ORDER BY started_at DESC LIMIT 50',
    [`%${escapedQuery}%`, `%${escapedQuery}%`, `%${escapedQuery}%`],
  )
}

export async function toggleConnectionLogSaved(id: string): Promise<void> {
  await executeQuery(
    'UPDATE connection_logs SET is_saved = CASE WHEN is_saved = 1 THEN 0 ELSE 1 END WHERE id = ?',
    [id],
  )
}
