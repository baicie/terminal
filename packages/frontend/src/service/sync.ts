import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { getUserProfile, select } from '@/service/database'
import { getWorkspaces, getWorkspaceLayout } from '@/service/database/workspaces'
import { getSSHKeys } from '@/service/database/ssh-keys'
import { getKnownHosts } from '@/service/database/known-hosts'
import { storageUpload, storageDownload } from '@/service/storage'

export interface ExportData {
  version: string
  exportedAt: number
  exportedBy?: string
  type: 'full' | 'team'
  hosts: unknown[]
  groups: unknown[]
  snippets: unknown[]
  snippetPackages: unknown[]
  workspaces: unknown[]
  workspaceLayouts: unknown[]
  sshKeys: unknown[]
  knownHosts: unknown[]
  settings: Record<string, unknown>
  // Team package fields
  team?: {
    id: string
    name: string
    members: unknown[]
    sharedHosts: unknown[]
    sharedSnippets: unknown[]
  }
}

export interface TeamPackageExport {
  version: '1.0'
  teamName: string
  exportedAt: string
  exportedBy: string
  members: unknown[]
  hosts: unknown[]
  groups: unknown[]
  snippets: unknown[]
  snippetPackages: unknown[]
  sshKeys: unknown[]
  knownHosts: unknown[]
  workspaces: unknown[]
  workspaceLayouts: unknown[]
}

export interface SyncService {
  exportData: () => Promise<ExportData>
  importData: (data: ExportData) => Promise<void>
  exportToFile: () => Promise<string | null>
  importFromFile: () => Promise<void>
}

// Collect all data for export
async function collectExportData(includeTeam = false): Promise<ExportData> {
  const [hosts, groups, snippets, snippetPackages, settingsRows, workspaces, sshKeys, knownHosts] =
    await Promise.all([
      select<Record<string, unknown>>('SELECT * FROM hosts'),
      select<Record<string, unknown>>('SELECT * FROM groups'),
      select<Record<string, unknown>>('SELECT * FROM snippets'),
      select<Record<string, unknown>>('SELECT * FROM snippet_packages'),
      select<{ key: string; value: string }>('SELECT * FROM settings'),
      getWorkspaces(),
      getSSHKeys(),
      getKnownHosts(),
    ])

  // Collect workspace layouts
  const workspaceLayouts = await Promise.all(
    workspaces.map(async (ws) => {
      const layout = await getWorkspaceLayout(ws.id)
      return {
        workspaceId: ws.id,
        layoutData: layout,
      }
    }),
  )

  const settingsDict = settingsRows.reduce<Record<string, unknown>>(
    (acc, row) => {
      if (row.key) {
        acc[row.key] = row.value
      }
      return acc
    },
    {},
  )

  const userProfile = await getUserProfile()

  return {
    version: '1.0.0',
    exportedAt: Date.now(),
    exportedBy: userProfile?.id,
    type: 'full',
    hosts,
    groups,
    snippets,
    snippetPackages,
    workspaces,
    workspaceLayouts,
    sshKeys,
    knownHosts,
    settings: settingsDict,
    ...(includeTeam && userProfile
      ? {
          team: {
            id: '',
            name: '',
            members: [],
            sharedHosts: [],
            sharedSnippets: [],
          },
        }
      : {}),
  }
}

/**
 * Export team package as a standalone JSON file for local sharing.
 * This includes the team metadata, members, and selected resources (hosts/snippets).
 */
export async function exportTeamPackage(options?: {
  teamId?: string
  teamName?: string
  includeHosts?: boolean
  includeSnippets?: boolean
  includeMembers?: boolean
  includeSSHKeys?: boolean
  includeKnownHosts?: boolean
  includeWorkspaces?: boolean
}): Promise<string | null> {
  try {
    const userProfile = await getUserProfile()
    const userId = userProfile?.id || ''

    const [
      hosts,
      groups,
      snippets,
      snippetPackages,
      members,
      sshKeys,
      knownHosts,
      workspaces,
    ] = await Promise.all([
      options?.includeHosts
        ? select<Record<string, unknown>>('SELECT * FROM hosts')
        : [],
      options?.includeHosts
        ? select<Record<string, unknown>>('SELECT * FROM groups')
        : [],
      options?.includeSnippets
        ? select<Record<string, unknown>>('SELECT * FROM snippets')
        : [],
      options?.includeSnippets
        ? select<Record<string, unknown>>('SELECT * FROM snippet_packages')
        : [],
      options?.includeMembers
        ? select<Record<string, unknown>>(
            `SELECT user_id, user_name, user_email, role, joined_at FROM team_members WHERE team_id = ?`,
            [options.teamId || ''],
          )
        : [],
      options?.includeSSHKeys ? getSSHKeys() : [],
      options?.includeKnownHosts ? getKnownHosts() : [],
      options?.includeWorkspaces ? getWorkspaces() : [],
    ])

    // Collect workspace layouts
    const workspaceLayouts = options?.includeWorkspaces
      ? await Promise.all(
          workspaces.map(async (ws) => {
            const layout = await getWorkspaceLayout(ws.id)
            return {
              workspaceId: ws.id,
              layoutData: layout,
            }
          }),
        )
      : []

    const packageData: TeamPackageExport = {
      version: '1.0',
      teamName: options?.teamName || 'Team',
      exportedAt: new Date().toISOString(),
      exportedBy: userId,
      members,
      hosts,
      groups,
      snippets,
      snippetPackages,
      sshKeys,
      knownHosts,
      workspaces,
      workspaceLayouts,
    }

    const jsonContent = JSON.stringify(packageData, null, 2)
    const fileName = `team-${(options?.teamName || 'package')
      .toLowerCase()
      .replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`

    const filePath = await save({
      defaultPath: fileName,
      filters: [
        { name: 'Team Package', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (filePath) {
      await writeTextFile(filePath, jsonContent)
      return filePath
    }

    return null
  } catch (error) {
    console.error('Team package export failed:', error)
    throw error
  }
}

/**
 * Preview a team package import - validate and return stats.
 */
export function previewTeamPackage(content: string): TeamPackageExport | null {
  try {
    const data = JSON.parse(content) as TeamPackageExport
    if (data.version !== '1.0' || !data.teamName) {
      return null
    }
    return data
  } catch {
    return null
  }
}

/**
 * Import a team package from JSON content.
 * Returns statistics about what was imported.
 */
export async function importTeamPackage(
  content: string,
  mergeMode: 'replace' | 'merge' = 'merge',
): Promise<{
  hosts: number
  groups: number
  snippets: number
  snippetPackages: number
  sshKeys: number
  knownHosts: number
  workspaces: number
  members: number
}> {
  const data = previewTeamPackage(content)
  if (!data) {
    throw new Error('Invalid team package format')
  }

  const stats = {
    hosts: 0,
    groups: 0,
    snippets: 0,
    snippetPackages: 0,
    sshKeys: 0,
    knownHosts: 0,
    workspaces: 0,
    members: 0,
  }

  // Import groups first
  for (const group of data.groups || []) {
    const g = group as Record<string, unknown>
    const existing = await select<{ id: string }>(
      'SELECT id FROM groups WHERE id = ?',
      [g.id as string],
    )
    if (existing.length === 0) {
      await importExecute(
        `INSERT INTO groups (id, name, parent_id, color, inherit_settings, settings, "order") VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          g.id,
          g.name,
          g.parent_id,
          g.color,
          g.inherit_settings,
          g.settings,
          g.order,
        ],
      )
      stats.groups++
    } else if (mergeMode === 'replace') {
      await importExecute(
        `UPDATE groups SET name = ?, parent_id = ?, color = ?, inherit_settings = ?, settings = ?, "order" = ? WHERE id = ?`,
        [
          g.name,
          g.parent_id,
          g.color,
          g.inherit_settings,
          g.settings,
          g.order,
          g.id,
        ],
      )
      stats.groups++
    }
  }

  // Import hosts
  for (const host of data.hosts || []) {
    const h = host as Record<string, unknown>
    const existing = await select<{ id: string }>(
      'SELECT id FROM hosts WHERE id = ?',
      [h.id as string],
    )
    if (existing.length === 0) {
      await importExecute(
        `INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, certificate, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, jump_host_id, jump_host_auth_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          h.id,
          h.name,
          h.hostname,
          h.port,
          h.username,
          h.auth_type,
          h.password,
          h.private_key,
          h.certificate ?? null,
          h.group_id,
          h.is_favorite,
          h.color,
          h.tags,
          h.port_forwards,
          h.startup_command,
          h.environment,
          h.jump_host_id ?? null,
          h.jump_host_auth_type ?? null,
          h.created_at,
          h.updated_at,
        ],
      )
      stats.hosts++
    } else if (mergeMode === 'replace') {
      await importExecute(
        `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = ?, private_key = ?, certificate = ?, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, updated_at = ? WHERE id = ?`,
        [
          h.name,
          h.hostname,
          h.port,
          h.username,
          h.auth_type,
          h.password,
          h.private_key,
          h.certificate ?? null,
          h.group_id,
          h.is_favorite,
          h.color,
          h.tags,
          h.port_forwards,
          h.startup_command,
          h.environment,
          h.jump_host_id ?? null,
          h.jump_host_auth_type ?? null,
          Date.now(),
          h.id,
        ],
      )
      stats.hosts++
    }
  }

  // Import snippet packages
  for (const pkg of data.snippetPackages || []) {
    const p = pkg as Record<string, unknown>
    const existing = await select<{ id: string }>(
      'SELECT id FROM snippet_packages WHERE id = ?',
      [p.id as string],
    )
    if (existing.length === 0) {
      await importExecute(
        `INSERT INTO snippet_packages (id, name, description) VALUES (?, ?, ?)`,
        [p.id, p.name, p.description],
      )
      stats.snippetPackages++
    } else if (mergeMode === 'replace') {
      await importExecute(
        `UPDATE snippet_packages SET name = ?, description = ? WHERE id = ?`,
        [p.name, p.description, p.id],
      )
      stats.snippetPackages++
    }
  }

  // Import snippets
  for (const snippet of data.snippets || []) {
    const s = snippet as Record<string, unknown>
    const existing = await select<{ id: string }>(
      'SELECT id FROM snippets WHERE id = ?',
      [s.id as string],
    )
    if (existing.length === 0) {
      await importExecute(
        `INSERT INTO snippets (id, name, description, script, package_id, tags, variables) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          s.id,
          s.name,
          s.description,
          s.script,
          s.package_id,
          s.tags,
          s.variables,
        ],
      )
      stats.snippets++
    } else if (mergeMode === 'replace') {
      await importExecute(
        `UPDATE snippets SET name = ?, description = ?, script = ?, package_id = ?, tags = ?, variables = ? WHERE id = ?`,
        [
          s.name,
          s.description,
          s.script,
          s.package_id,
          s.tags,
          s.variables,
          s.id,
        ],
      )
      stats.snippets++
    }
  }

  // Import SSH Keys
  for (const key of data.sshKeys || []) {
    const k = key as Record<string, unknown>
    const existing = await select<{ id: string }>(
      'SELECT id FROM ssh_keys WHERE id = ?',
      [k.id as string],
    )
    if (existing.length === 0) {
      await importExecute(
        `INSERT INTO ssh_keys (id, name, key_type, private_key, public_key, certificate, passphrase, is_encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          k.id,
          k.name,
          k.key_type,
          k.private_key,
          k.public_key,
          k.certificate,
          k.passphrase,
          k.is_encrypted,
          k.created_at,
          k.updated_at,
        ],
      )
      stats.sshKeys++
    } else if (mergeMode === 'replace') {
      await importExecute(
        `UPDATE ssh_keys SET name = ?, key_type = ?, private_key = ?, public_key = ?, certificate = ?, passphrase = ?, is_encrypted = ?, updated_at = ? WHERE id = ?`,
        [
          k.name,
          k.key_type,
          k.private_key,
          k.public_key,
          k.certificate,
          k.passphrase,
          k.is_encrypted,
          Date.now(),
          k.id,
        ],
      )
      stats.sshKeys++
    }
  }

  // Import Known Hosts
  for (const knownHost of data.knownHosts || []) {
    const kh = knownHost as Record<string, unknown>
    const existing = await select<{ id: string }>(
      'SELECT id FROM known_hosts WHERE hostname = ? AND port = ?',
      [kh.hostname as string, kh.port as number],
    )
    if (existing.length === 0) {
      await importExecute(
        `INSERT INTO known_hosts (id, hostname, port, fingerprint, key_type, added_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          kh.hostname,
          kh.port,
          kh.fingerprint,
          kh.key_type,
          kh.added_at,
        ],
      )
      stats.knownHosts++
    }
  }

  // Import Workspaces
  for (const workspace of data.workspaces || []) {
    const ws = workspace as Record<string, unknown>
    const existing = await select<{ id: string }>(
      'SELECT id FROM workspaces WHERE id = ?',
      [ws.id as string],
    )
    if (existing.length === 0) {
      await importExecute(
        `INSERT INTO workspaces (id, name, description, icon, color, "order", is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ws.id,
          ws.name,
          ws.description,
          ws.icon,
          ws.color,
          ws.order,
          ws.is_active,
          ws.created_at,
          ws.updated_at,
        ],
      )
      stats.workspaces++
    } else if (mergeMode === 'replace') {
      await importExecute(
        `UPDATE workspaces SET name = ?, description = ?, icon = ?, color = ?, "order" = ?, is_active = ?, updated_at = ? WHERE id = ?`,
        [
          ws.name,
          ws.description,
          ws.icon,
          ws.color,
          ws.order,
          ws.is_active,
          Date.now(),
          ws.id,
        ],
      )
      stats.workspaces++
    }
  }

  // Import Workspace Layouts
  for (const wl of data.workspaceLayouts || []) {
    const wld = wl as Record<string, unknown>
    const layoutData = wld.layoutData as Record<string, unknown> | null
    if (layoutData) {
      await importExecute(
        `INSERT OR REPLACE INTO workspace_layouts (workspace_id, layout_data) VALUES (?, ?)`,
        [wld.workspaceId as string, JSON.stringify(layoutData)],
      )
    }
  }

  return stats
}

async function importExecute(sql: string, params: unknown[]): Promise<void> {
  await import('@tauri-apps/plugin-sql').then(async m => {
    const db = await m.default.load('sqlite:terminal.db')
    await db.execute(sql, params)
  })
}

// Export data to a JSON file
export async function exportDataToFile(): Promise<string | null> {
  try {
    const data = await collectExportData()
    const jsonContent = JSON.stringify(data, null, 2)

    const filePath = await save({
      defaultPath: `terminal-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (filePath) {
      await writeTextFile(filePath, jsonContent)
      return filePath
    }

    return null
  } catch (error) {
    console.error('Export failed:', error)
    throw error
  }
}

// Import data from a JSON file
export async function importDataFromFile(
  content: string,
  mergeMode: 'replace' | 'merge' = 'merge',
): Promise<{
  hosts: number
  groups: number
  snippets: number
  snippetPackages: number
  sshKeys: number
  knownHosts: number
  workspaces: number
}> {
  try {
    const data = JSON.parse(content) as ExportData

    // Validate data structure
    if (!data.version || !data.exportedAt) {
      throw new Error('Invalid export file format')
    }

    const stats = {
      hosts: 0,
      groups: 0,
      snippets: 0,
      snippetPackages: 0,
      sshKeys: 0,
      knownHosts: 0,
      workspaces: 0,
    }

    // Import groups first (dependencies for hosts)
    for (const group of data.groups || []) {
      const g = group as Record<string, unknown>
      const existing = await select<{ id: string }>(
        'SELECT id FROM groups WHERE id = ?',
        [g.id as string],
      )
      if (existing.length === 0) {
        await importExecute(
          `INSERT INTO groups (id, name, parent_id, color, inherit_settings, settings, "order") VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            g.id,
            g.name,
            g.parent_id,
            g.color,
            g.inherit_settings,
            g.settings,
            g.order,
          ],
        )
        stats.groups++
      } else if (mergeMode === 'replace') {
        await importExecute(
          `UPDATE groups SET name = ?, parent_id = ?, color = ?, inherit_settings = ?, settings = ?, "order" = ? WHERE id = ?`,
          [
            g.name,
            g.parent_id,
            g.color,
            g.inherit_settings,
            g.settings,
            g.order,
            g.id,
          ],
        )
        stats.groups++
      }
    }

    // Import hosts
    for (const host of data.hosts || []) {
      const h = host as Record<string, unknown>
      const existing = await select<{ id: string }>(
        'SELECT id FROM hosts WHERE id = ?',
        [h.id as string],
      )
      if (existing.length === 0) {
        await importExecute(
          `INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, certificate, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, jump_host_id, jump_host_auth_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            h.id,
            h.name,
            h.hostname,
            h.port,
            h.username,
            h.auth_type,
            h.password,
            h.private_key,
            h.certificate ?? null,
            h.group_id,
            h.is_favorite,
            h.color,
            h.tags,
            h.port_forwards,
            h.startup_command,
            h.environment,
            h.jump_host_id ?? null,
            h.jump_host_auth_type ?? null,
            h.created_at,
            h.updated_at,
          ],
        )
        stats.hosts++
      } else if (mergeMode === 'replace') {
        await importExecute(
          `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = ?, private_key = ?, certificate = ?, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, updated_at = ? WHERE id = ?`,
          [
            h.name,
            h.hostname,
            h.port,
            h.username,
            h.auth_type,
            h.password,
            h.private_key,
            h.certificate ?? null,
            h.group_id,
            h.is_favorite,
            h.color,
            h.tags,
            h.port_forwards,
            h.startup_command,
            h.environment,
            h.jump_host_id ?? null,
            h.jump_host_auth_type ?? null,
            Date.now(),
            h.id,
          ],
        )
        stats.hosts++
      }
    }

    // Import snippet packages first (dependencies for snippets)
    for (const pkg of data.snippetPackages || []) {
      const p = pkg as Record<string, unknown>
      const existing = await select<{ id: string }>(
        'SELECT id FROM snippet_packages WHERE id = ?',
        [p.id as string],
      )
      if (existing.length === 0) {
        await importExecute(
          `INSERT INTO snippet_packages (id, name, description) VALUES (?, ?, ?)`,
          [p.id, p.name, p.description],
        )
        stats.snippetPackages++
      } else if (mergeMode === 'replace') {
        await importExecute(
          `UPDATE snippet_packages SET name = ?, description = ? WHERE id = ?`,
          [p.name, p.description, p.id],
        )
        stats.snippetPackages++
      }
    }

    // Import snippets
    for (const snippet of data.snippets || []) {
      const s = snippet as Record<string, unknown>
      const existing = await select<{ id: string }>(
        'SELECT id FROM snippets WHERE id = ?',
        [s.id as string],
      )
      if (existing.length === 0) {
        await importExecute(
          `INSERT INTO snippets (id, name, description, script, package_id, tags, variables) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            s.id,
            s.name,
            s.description,
            s.script,
            s.package_id,
            s.tags,
            s.variables,
          ],
        )
        stats.snippets++
      } else if (mergeMode === 'replace') {
        await importExecute(
          `UPDATE snippets SET name = ?, description = ?, script = ?, package_id = ?, tags = ?, variables = ? WHERE id = ?`,
          [
            s.name,
            s.description,
            s.script,
            s.package_id,
            s.tags,
            s.variables,
            s.id,
          ],
        )
        stats.snippets++
      }
    }

    // Import SSH Keys
    for (const key of data.sshKeys || []) {
      const k = key as Record<string, unknown>
      const existing = await select<{ id: string }>(
        'SELECT id FROM ssh_keys WHERE id = ?',
        [k.id as string],
      )
      if (existing.length === 0) {
        await importExecute(
          `INSERT INTO ssh_keys (id, name, key_type, private_key, public_key, certificate, passphrase, is_encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            k.id,
            k.name,
            k.key_type,
            k.private_key,
            k.public_key,
            k.certificate,
            k.passphrase,
            k.is_encrypted,
            k.created_at,
            k.updated_at,
          ],
        )
        stats.sshKeys++
      } else if (mergeMode === 'replace') {
        await importExecute(
          `UPDATE ssh_keys SET name = ?, key_type = ?, private_key = ?, public_key = ?, certificate = ?, passphrase = ?, is_encrypted = ?, updated_at = ? WHERE id = ?`,
          [
            k.name,
            k.key_type,
            k.private_key,
            k.public_key,
            k.certificate,
            k.passphrase,
            k.is_encrypted,
            Date.now(),
            k.id,
          ],
        )
        stats.sshKeys++
      }
    }

    // Import Known Hosts
    for (const knownHost of data.knownHosts || []) {
      const kh = knownHost as Record<string, unknown>
      const existing = await select<{ id: string }>(
        'SELECT id FROM known_hosts WHERE hostname = ? AND port = ?',
        [kh.hostname as string, kh.port as number],
      )
      if (existing.length === 0) {
        await importExecute(
          `INSERT INTO known_hosts (id, hostname, port, fingerprint, key_type, added_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            kh.hostname,
            kh.port,
            kh.fingerprint,
            kh.key_type,
            kh.added_at,
          ],
        )
        stats.knownHosts++
      }
    }

    // Import Workspaces
    for (const workspace of data.workspaces || []) {
      const ws = workspace as Record<string, unknown>
      const existing = await select<{ id: string }>(
        'SELECT id FROM workspaces WHERE id = ?',
        [ws.id as string],
      )
      if (existing.length === 0) {
        await importExecute(
          `INSERT INTO workspaces (id, name, description, icon, color, "order", is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ws.id,
            ws.name,
            ws.description,
            ws.icon,
            ws.color,
            ws.order,
            ws.is_active,
            ws.created_at,
            ws.updated_at,
          ],
        )
        stats.workspaces++
      } else if (mergeMode === 'replace') {
        await importExecute(
          `UPDATE workspaces SET name = ?, description = ?, icon = ?, color = ?, "order" = ?, is_active = ?, updated_at = ? WHERE id = ?`,
          [
            ws.name,
            ws.description,
            ws.icon,
            ws.color,
            ws.order,
            ws.is_active,
            Date.now(),
            ws.id,
          ],
        )
        stats.workspaces++
      }
    }

    // Import Workspace Layouts
    for (const wl of data.workspaceLayouts || []) {
      const wld = wl as Record<string, unknown>
      const layoutData = wld.layoutData as Record<string, unknown> | null
      if (layoutData) {
        await importExecute(
          `INSERT OR REPLACE INTO workspace_layouts (workspace_id, layout_data) VALUES (?, ?)`,
          [wld.workspaceId as string, JSON.stringify(layoutData)],
        )
      }
    }

    return stats
  } catch (error) {
    console.error('Import failed:', error)
    throw error
  }
}

// Generate a preview of what would be imported
export function previewImportData(content: string): ExportData | null {
  try {
    const data = JSON.parse(content) as ExportData
    return {
      ...data,
      hosts: data.hosts || [],
      groups: data.groups || [],
      snippets: data.snippets || [],
      snippetPackages: data.snippetPackages || [],
      workspaces: data.workspaces || [],
      workspaceLayouts: data.workspaceLayouts || [],
      sshKeys: data.sshKeys || [],
      knownHosts: data.knownHosts || [],
      settings: data.settings || {},
    }
  } catch {
    return null
  }
}

// Sync all data to the remote storage server
// Uploads to terminal-sync-{timestamp}.json and terminal-latest.json
export async function syncToServer(): Promise<{
  success: boolean
  timestamp: string
  stats?: {
    hosts: number
    groups: number
    snippets: number
    snippetPackages: number
    sshKeys: number
    knownHosts: number
    workspaces: number
  }
}> {
  try {
    // Collect all export data
    const data = await collectExportData()
    const jsonContent = JSON.stringify(data, null, 2)

    // Generate timestamp-based filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const timestampedPath = `terminal-sync-${timestamp}.json`
    const latestPath = 'terminal-latest.json'

    // Upload to timestamped backup file
    const timestampResult = await storageUpload(timestampedPath, jsonContent)
    if (!timestampResult.success) {
      throw new Error(`Failed to upload timestamped backup: ${timestampResult.message}`)
    }

    // Also update the latest backup (overwrites previous)
    const latestResult = await storageUpload(latestPath, jsonContent)
    if (!latestResult.success) {
      throw new Error(`Failed to update latest backup: ${latestResult.message}`)
    }

    // Save last sync time to localStorage for UI display
    localStorage.setItem('terminal.lastSyncTime', String(Date.now()))

    return {
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        hosts: data.hosts.length,
        groups: data.groups.length,
        snippets: data.snippets.length,
        snippetPackages: data.snippetPackages.length,
        sshKeys: data.sshKeys.length,
        knownHosts: data.knownHosts.length,
        workspaces: data.workspaces.length,
      },
    }
  } catch (error) {
    console.error('Sync to server failed:', error)
    throw error
  }
}

// Download and import data from the remote storage server
export async function downloadFromServer(
  mergeMode: 'replace' | 'merge' = 'merge',
): Promise<{
  success: boolean
  data?: ExportData
  stats?: {
    hosts: number
    groups: number
    snippets: number
    snippetPackages: number
    sshKeys: number
    knownHosts: number
    workspaces: number
  }
}> {
  try {
    const latestPath = 'terminal-latest.json'

    // Download the latest backup
    const content = await storageDownload(latestPath)

    if (!content) {
      return { success: false }
    }

    // Parse and validate the data
    const data = previewImportData(content)
    if (!data) {
      throw new Error('Invalid data format from server')
    }

    // Import the data
    const stats = await importDataFromFile(content, mergeMode)

    // Update last sync time
    localStorage.setItem('terminal.lastSyncTime', String(Date.now()))

    return {
      success: true,
      data,
      stats,
    }
  } catch (error) {
    console.error('Download from server failed:', error)
    throw error
  }
}

// Get the last sync time from localStorage
export function getLastSyncTime(): number | null {
  const stored = localStorage.getItem('terminal.lastSyncTime')
  if (stored) {
    const time = parseInt(stored, 10)
    return isNaN(time) ? null : time
  }
  return null
}

// Format last sync time for display
export function formatLastSyncTime(): string | null {
  const lastSync = getLastSyncTime()
  if (!lastSync) return null

  const now = Date.now()
  const diff = now - lastSync

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`
  }
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  }
  if (seconds > 10) {
    return `${seconds} seconds ago`
  }
  return 'just now'
}
