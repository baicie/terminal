/**
 * Scripts CRUD 操作
 */
import { executeQuery, select } from './connection'
import type { ScriptRecord, ScriptExecutionRecord } from './types'

export async function createScript(script: ScriptRecord): Promise<string> {
  await executeQuery(
    `INSERT INTO scripts (id, name, description, script, host_ids, schedule_type, schedule_value, enabled, timeout_seconds, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      script.id,
      script.name,
      script.description,
      script.script,
      script.host_ids,
      script.schedule_type,
      script.schedule_value,
      script.enabled,
      script.timeout_seconds,
      script.retry_count,
      script.created_at,
      script.updated_at,
    ],
  )
  return script.id
}

export async function updateScript(script: ScriptRecord): Promise<void> {
  await executeQuery(
    `UPDATE scripts SET name = ?, description = ?, script = ?, host_ids = ?, schedule_type = ?, schedule_value = ?, enabled = ?, timeout_seconds = ?, retry_count = ?, updated_at = ?
     WHERE id = ?`,
    [
      script.name,
      script.description,
      script.script,
      script.host_ids,
      script.schedule_type,
      script.schedule_value,
      script.enabled,
      script.timeout_seconds,
      script.retry_count,
      script.updated_at,
      script.id,
    ],
  )
}

export async function deleteScript(id: string): Promise<void> {
  await executeQuery('DELETE FROM scripts WHERE id = ?', [id])
}

export async function getScripts(): Promise<ScriptRecord[]> {
  return select<ScriptRecord>('SELECT * FROM scripts ORDER BY name')
}

export async function getScriptById(id: string): Promise<ScriptRecord | null> {
  const results = await select<ScriptRecord>(
    'SELECT * FROM scripts WHERE id = ?',
    [id],
  )
  return results[0] || null
}

export async function getEnabledScripts(): Promise<ScriptRecord[]> {
  return select<ScriptRecord>(
    'SELECT * FROM scripts WHERE enabled = 1 ORDER BY name',
  )
}

export async function searchScripts(query: string): Promise<ScriptRecord[]> {
  const escapedQuery = query.replace(/[%_]/g, '\\$&')
  return select<ScriptRecord>(
    'SELECT * FROM scripts WHERE name LIKE ? ESCAPE "\\" OR description LIKE ? ESCAPE "\\" ORDER BY name LIMIT 50',
    [`%${escapedQuery}%`, `%${escapedQuery}%`],
  )
}

export async function toggleScriptEnabled(id: string): Promise<void> {
  await executeQuery(
    'UPDATE scripts SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?',
    [Date.now(), id],
  )
}

// Script Execution
export async function addScriptExecution(
  execution: Omit<ScriptExecutionRecord, 'id'>,
): Promise<string> {
  const id = crypto.randomUUID()
  await executeQuery(
    `INSERT INTO script_executions (id, script_id, script_name, host_id, host_name, host_address, status, output, error, started_at, ended_at, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      execution.script_id,
      execution.script_name,
      execution.host_id,
      execution.host_name,
      execution.host_address,
      execution.status,
      execution.output,
      execution.error,
      execution.started_at,
      execution.ended_at,
      execution.duration_ms,
    ],
  )
  return id
}

export async function updateScriptExecution(
  id: string,
  updates: Partial<ScriptExecutionRecord>,
): Promise<void> {
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
  }
  if (updates.output !== undefined) {
    fields.push('output = ?')
    values.push(updates.output)
  }
  if (updates.error !== undefined) {
    fields.push('error = ?')
    values.push(updates.error)
  }
  if (updates.ended_at !== undefined) {
    fields.push('ended_at = ?')
    values.push(updates.ended_at)
  }
  if (updates.duration_ms !== undefined) {
    fields.push('duration_ms = ?')
    values.push(updates.duration_ms)
  }

  if (fields.length > 0) {
    values.push(id)
    await executeQuery(
      `UPDATE script_executions SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

export async function getScriptExecutions(
  scriptId?: string,
  limit = 100,
): Promise<ScriptExecutionRecord[]> {
  if (scriptId) {
    return select<ScriptExecutionRecord>(
      'SELECT * FROM script_executions WHERE script_id = ? ORDER BY started_at DESC LIMIT ?',
      [scriptId, limit],
    )
  }
  return select<ScriptExecutionRecord>(
    'SELECT * FROM script_executions ORDER BY started_at DESC LIMIT ?',
    [limit],
  )
}

export async function getScriptExecutionById(
  id: string,
): Promise<ScriptExecutionRecord | null> {
  const results = await select<ScriptExecutionRecord>(
    'SELECT * FROM script_executions WHERE id = ?',
    [id],
  )
  return results[0] || null
}

export async function deleteScriptExecution(id: string): Promise<void> {
  await executeQuery('DELETE FROM script_executions WHERE id = ?', [id])
}

export async function clearScriptExecutions(scriptId?: string): Promise<void> {
  if (scriptId) {
    await executeQuery('DELETE FROM script_executions WHERE script_id = ?', [
      scriptId,
    ])
  } else {
    await executeQuery('DELETE FROM script_executions')
  }
}
