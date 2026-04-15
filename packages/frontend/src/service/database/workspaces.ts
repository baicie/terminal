/**
 * Workspaces CRUD 操作
 */
import { executeQuery, select } from './connection'
import type { WorkspaceRecord, WorkspaceLayoutRecord } from './types'
import type { WorkspaceLayout } from '@/types'

export async function getWorkspaces(): Promise<WorkspaceRecord[]> {
  return select<WorkspaceRecord>('SELECT * FROM workspaces ORDER BY "order"')
}

export async function getActiveWorkspace(): Promise<WorkspaceRecord | null> {
  const results = await select<WorkspaceRecord>(
    'SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1',
  )
  return results[0] || null
}

export async function createWorkspace(
  workspace: WorkspaceRecord,
): Promise<void> {
  await executeQuery(
    'INSERT INTO workspaces (id, name, description, icon, color, "order", is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      workspace.id,
      workspace.name,
      workspace.description,
      workspace.icon,
      workspace.color,
      workspace.order,
      workspace.is_active,
      workspace.created_at,
      workspace.updated_at,
    ],
  )
}

export async function updateWorkspace(
  id: string,
  updates: Partial<WorkspaceRecord>,
): Promise<void> {
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.description !== undefined) {
    fields.push('description = ?')
    values.push(updates.description)
  }
  if (updates.icon !== undefined) {
    fields.push('icon = ?')
    values.push(updates.icon)
  }
  if (updates.color !== undefined) {
    fields.push('color = ?')
    values.push(updates.color)
  }
  if (updates.order !== undefined) {
    fields.push('"order" = ?')
    values.push(updates.order)
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?')
    values.push(updates.is_active)
  }
  if (updates.updated_at !== undefined) {
    fields.push('updated_at = ?')
    values.push(updates.updated_at)
  }

  if (fields.length > 0) {
    values.push(id)
    await executeQuery(
      `UPDATE workspaces SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }
}

export async function deleteWorkspace(id: string): Promise<void> {
  await executeQuery('DELETE FROM workspaces WHERE id = ?', [id])
}

export async function setActiveWorkspace(id: string): Promise<void> {
  await executeQuery('UPDATE workspaces SET is_active = 0')
  await executeQuery('UPDATE workspaces SET is_active = 1 WHERE id = ?', [id])
}

export async function saveWorkspaceLayout(
  workspaceId: string,
  layoutData: WorkspaceLayout,
): Promise<void> {
  const jsonData = JSON.stringify(layoutData)
  await executeQuery(
    'INSERT OR REPLACE INTO workspace_layouts (workspace_id, layout_data) VALUES (?, ?)',
    [workspaceId, jsonData],
  )
}

export async function getWorkspaceLayout(
  workspaceId: string,
): Promise<WorkspaceLayout | null> {
  const results = await select<WorkspaceLayoutRecord>(
    'SELECT * FROM workspace_layouts WHERE workspace_id = ?',
    [workspaceId],
  )
  if (results.length === 0) return null
  try {
    return JSON.parse(results[0].layout_data)
  } catch {
    return null
  }
}
