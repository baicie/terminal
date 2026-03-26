/**
 * Command History CRUD 操作
 */
import { executeQuery, select } from './connection'
import type { CommandHistoryRecord } from './types'

export async function addCommandHistory(
  record: Omit<CommandHistoryRecord, 'id'>,
): Promise<void> {
  await executeQuery(
    'INSERT INTO command_history (host_id, command, executed_at, session_id) VALUES (?, ?, ?, ?)',
    [
      record.host_id,
      record.command,
      record.executed_at,
      record.session_id || null,
    ],
  )
}

export async function getCommandHistory(
  hostId?: string,
  limit = 100,
): Promise<CommandHistoryRecord[]> {
  if (hostId) {
    return select<CommandHistoryRecord>(
      'SELECT * FROM command_history WHERE host_id = ? ORDER BY executed_at DESC LIMIT ?',
      [hostId, limit],
    )
  }
  return select<CommandHistoryRecord>(
    'SELECT * FROM command_history ORDER BY executed_at DESC LIMIT ?',
    [limit],
  )
}

export async function searchCommandHistory(
  query: string,
  limit = 20,
): Promise<CommandHistoryRecord[]> {
  // Escape special LIKE characters to prevent ReDoS attacks
  const escapedQuery = query.replace(/[%_]/g, '\\$&')
  return select<CommandHistoryRecord>(
    'SELECT * FROM command_history WHERE command LIKE ? ESCAPE "\\" ORDER BY executed_at DESC LIMIT ?',
    [`%${escapedQuery}%`, Math.min(limit, 100)],
  )
}

export async function clearCommandHistory(hostId?: string): Promise<void> {
  if (hostId) {
    await executeQuery('DELETE FROM command_history WHERE host_id = ?', [
      hostId,
    ])
  } else {
    await executeQuery('DELETE FROM command_history')
  }
}
