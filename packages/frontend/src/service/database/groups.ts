/**
 * Group CRUD 操作
 */
import type { Group } from '@/types'
import { executeQuery, select } from './connection'
import type { GroupRecord } from './types'

export async function getGroups(): Promise<Group[]> {
  const rows = await select<GroupRecord>(
    'SELECT * FROM groups ORDER BY "order"',
  )
  return rows.map(rowToGroup)
}

export async function getGroupById(id: string): Promise<Group | null> {
  const rows = await select<GroupRecord>('SELECT * FROM groups WHERE id = ?', [
    id,
  ])
  if (rows.length === 0) return null
  return rowToGroup(rows[0])
}

export async function createGroup(group: Group): Promise<void> {
  await executeQuery(
    `INSERT INTO groups (id, name, parent_id, color, inherit_settings, settings, "order") VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      group.id,
      group.name,
      group.parentId ?? null,
      group.color ?? null,
      group.inheritSettings ? 1 : 0,
      group.settings ? JSON.stringify(group.settings) : null,
      group.order,
    ],
  )
}

export async function updateGroup(
  id: string,
  updates: Partial<Group>,
): Promise<void> {
  await executeQuery(
    `UPDATE groups SET name = ?, parent_id = ?, color = ?, inherit_settings = ?, settings = ?, "order" = ? WHERE id = ?`,
    [
      updates.name,
      updates.parentId ?? null,
      updates.color ?? null,
      updates.inheritSettings !== undefined
        ? updates.inheritSettings
          ? 1
          : 0
        : undefined,
      updates.settings ? JSON.stringify(updates.settings) : null,
      updates.order,
      id,
    ],
  )
}

export async function deleteGroup(id: string): Promise<void> {
  await executeQuery('DELETE FROM groups WHERE id = ?', [id])
}

export async function getChildGroups(
  parentId: string | null,
): Promise<Group[]> {
  if (parentId === null) {
    const rows = await select<GroupRecord>(
      'SELECT * FROM groups WHERE parent_id IS NULL ORDER BY "order"',
    )
    return rows.map(rowToGroup)
  }
  const rows = await select<GroupRecord>(
    'SELECT * FROM groups WHERE parent_id = ? ORDER BY "order"',
    [parentId],
  )
  return rows.map(rowToGroup)
}

function rowToGroup(row: GroupRecord): Group {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? undefined,
    color: row.color ?? undefined,
    inheritSettings: row.inherit_settings === 1,
    settings: row.settings ? JSON.parse(row.settings) : undefined,
    order: row.order,
  }
}
