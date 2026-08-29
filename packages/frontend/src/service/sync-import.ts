import { select } from '@/service/database'
import type { ExportData, ImportStats, MergeMode } from './sync-types'

type Resource = Record<string, unknown>
type ResourceKey = keyof ImportStats

export async function importExecute(
  sql: string,
  params: unknown[],
): Promise<void> {
  await import('@tauri-apps/plugin-sql').then(async module => {
    const database = await module.default.load('sqlite:terminal.db')
    await database.execute(sql, params)
  })
}

export function createImportStats(): ImportStats {
  return {
    hosts: 0,
    groups: 0,
    snippets: 0,
    snippetPackages: 0,
    sshKeys: 0,
    knownHosts: 0,
    workspaces: 0,
  }
}

export function normalizeImportedAgentForwarding(value: unknown): 0 | 1 {
  return value === true || value === 1 ? 1 : 0
}

async function upsert(
  key: ResourceKey,
  stats: ImportStats,
  mergeMode: MergeMode,
  existsSql: string,
  existsParams: unknown[],
  insertSql: string,
  insertParams: unknown[],
  updateSql?: string,
  updateParams?: unknown[],
): Promise<void> {
  const existing = await select<{ id: string }>(existsSql, existsParams)
  if (existing.length === 0) {
    await importExecute(insertSql, insertParams)
    stats[key]++
  } else if (mergeMode === 'replace' && updateSql && updateParams) {
    await importExecute(updateSql, updateParams)
    stats[key]++
  }
}

export async function importResources(
  data: ExportData,
  mergeMode: MergeMode,
  stats: ImportStats,
): Promise<void> {
  for (const group of data.groups || []) {
    const item = group as Resource
    await upsert(
      'groups',
      stats,
      mergeMode,
      'SELECT id FROM groups WHERE id = ?',
      [item.id],
      'INSERT INTO groups (id, name, parent_id, color, inherit_settings, settings, "order") VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        item.id,
        item.name,
        item.parent_id,
        item.color,
        item.inherit_settings,
        item.settings,
        item.order,
      ],
      'UPDATE groups SET name = ?, parent_id = ?, color = ?, inherit_settings = ?, settings = ?, "order" = ? WHERE id = ?',
      [
        item.name,
        item.parent_id,
        item.color,
        item.inherit_settings,
        item.settings,
        item.order,
        item.id,
      ],
    )
  }
  for (const host of data.hosts || []) {
    const item = host as Resource
    await upsert(
      'hosts',
      stats,
      mergeMode,
      'SELECT id FROM hosts WHERE id = ?',
      [item.id],
      'INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, certificate, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, jump_host_id, jump_host_auth_type, agent_forwarding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        item.id,
        item.name,
        item.hostname,
        item.port,
        item.username,
        item.auth_type,
        item.password,
        item.private_key,
        item.certificate ?? null,
        item.group_id,
        item.is_favorite,
        item.color,
        item.tags,
        item.port_forwards,
        item.startup_command,
        item.environment,
        item.jump_host_id ?? null,
        item.jump_host_auth_type ?? null,
        normalizeImportedAgentForwarding(item.agent_forwarding),
        item.created_at,
        item.updated_at,
      ],
      'UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = ?, private_key = ?, certificate = ?, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, agent_forwarding = ?, updated_at = ? WHERE id = ?',
      [
        item.name,
        item.hostname,
        item.port,
        item.username,
        item.auth_type,
        item.password,
        item.private_key,
        item.certificate ?? null,
        item.group_id,
        item.is_favorite,
        item.color,
        item.tags,
        item.port_forwards,
        item.startup_command,
        item.environment,
        item.jump_host_id ?? null,
        item.jump_host_auth_type ?? null,
        normalizeImportedAgentForwarding(item.agent_forwarding),
        Date.now(),
        item.id,
      ],
    )
  }
  for (const pkg of data.snippetPackages || []) {
    const item = pkg as Resource
    await upsert(
      'snippetPackages',
      stats,
      mergeMode,
      'SELECT id FROM snippet_packages WHERE id = ?',
      [item.id],
      'INSERT INTO snippet_packages (id, name, description) VALUES (?, ?, ?)',
      [item.id, item.name, item.description],
      'UPDATE snippet_packages SET name = ?, description = ? WHERE id = ?',
      [item.name, item.description, item.id],
    )
  }
  for (const snippet of data.snippets || []) {
    const item = snippet as Resource
    await upsert(
      'snippets',
      stats,
      mergeMode,
      'SELECT id FROM snippets WHERE id = ?',
      [item.id],
      'INSERT INTO snippets (id, name, description, script, package_id, tags, variables) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        item.id,
        item.name,
        item.description,
        item.script,
        item.package_id,
        item.tags,
        item.variables,
      ],
      'UPDATE snippets SET name = ?, description = ?, script = ?, package_id = ?, tags = ?, variables = ? WHERE id = ?',
      [
        item.name,
        item.description,
        item.script,
        item.package_id,
        item.tags,
        item.variables,
        item.id,
      ],
    )
  }
  for (const key of data.sshKeys || []) {
    const item = key as Resource
    await upsert(
      'sshKeys',
      stats,
      mergeMode,
      'SELECT id FROM ssh_keys WHERE id = ?',
      [item.id],
      'INSERT INTO ssh_keys (id, name, key_type, private_key, public_key, certificate, passphrase, is_encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        item.id,
        item.name,
        item.key_type,
        item.private_key,
        item.public_key,
        item.certificate,
        item.passphrase,
        item.is_encrypted,
        item.created_at,
        item.updated_at,
      ],
      'UPDATE ssh_keys SET name = ?, key_type = ?, private_key = ?, public_key = ?, certificate = ?, passphrase = ?, is_encrypted = ?, updated_at = ? WHERE id = ?',
      [
        item.name,
        item.key_type,
        item.private_key,
        item.public_key,
        item.certificate,
        item.passphrase,
        item.is_encrypted,
        Date.now(),
        item.id,
      ],
    )
  }
  for (const knownHost of data.knownHosts || []) {
    const item = knownHost as Resource
    await upsert(
      'knownHosts',
      stats,
      mergeMode,
      'SELECT id FROM known_hosts WHERE hostname = ? AND port = ?',
      [item.hostname as string, item.port as number],
      'INSERT INTO known_hosts (id, hostname, port, fingerprint, key_type, added_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        crypto.randomUUID(),
        item.hostname,
        item.port,
        item.fingerprint,
        item.key_type,
        item.added_at,
      ],
    )
  }
  for (const workspace of data.workspaces || []) {
    const item = workspace as Resource
    await upsert(
      'workspaces',
      stats,
      mergeMode,
      'SELECT id FROM workspaces WHERE id = ?',
      [item.id],
      'INSERT INTO workspaces (id, name, description, icon, color, "order", is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        item.id,
        item.name,
        item.description,
        item.icon,
        item.color,
        item.order,
        item.is_active,
        item.created_at,
        item.updated_at,
      ],
      'UPDATE workspaces SET name = ?, description = ?, icon = ?, color = ?, "order" = ?, is_active = ?, updated_at = ? WHERE id = ?',
      [
        item.name,
        item.description,
        item.icon,
        item.color,
        item.order,
        item.is_active,
        Date.now(),
        item.id,
      ],
    )
  }
  for (const workspaceLayout of data.workspaceLayouts || []) {
    const item = workspaceLayout as Resource
    const layoutData = item.layoutData as Record<string, unknown> | null
    if (layoutData)
      await importExecute(
        'INSERT OR REPLACE INTO workspace_layouts (workspace_id, layout_data) VALUES (?, ?)',
        [item.workspaceId as string, JSON.stringify(layoutData)],
      )
  }
  for (const [key, value] of Object.entries(data.settings || {})) {
    const existing = await select<{ id: string }>(
      'SELECT key AS id FROM settings WHERE key = ?',
      [key],
    )
    if (existing.length === 0 || mergeMode === 'replace')
      await importExecute(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        [key, typeof value === 'string' ? value : JSON.stringify(value)],
      )
  }
}
