import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { getUserProfile, select } from '@/service/database'
import { getKnownHosts } from '@/service/database/known-hosts'
import { getSSHKeys } from '@/service/database/ssh-keys'
import {
  getWorkspaceLayout,
  getWorkspaces,
} from '@/service/database/workspaces'
import { createImportStats, importResources } from './sync-import'
import type {
  MergeMode,
  TeamImportStats,
  TeamPackageExport,
} from './sync-types'

export interface TeamPackageExportOptions {
  teamId?: string
  teamName?: string
  includeHosts?: boolean
  includeSnippets?: boolean
  includeMembers?: boolean
  includeSSHKeys?: boolean
  includeKnownHosts?: boolean
  includeWorkspaces?: boolean
}

export async function exportTeamPackage(
  options?: TeamPackageExportOptions,
): Promise<string | null> {
  try {
    const userProfile = await getUserProfile()
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
            'SELECT user_id, user_name, user_email, role, joined_at FROM team_members WHERE team_id = ?',
            [options.teamId || ''],
          )
        : [],
      options?.includeSSHKeys ? getSSHKeys() : [],
      options?.includeKnownHosts ? getKnownHosts() : [],
      options?.includeWorkspaces ? getWorkspaces() : [],
    ])
    const workspaceLayouts = options?.includeWorkspaces
      ? await Promise.all(
          workspaces.map(async workspace => ({
            workspaceId: workspace.id,
            layoutData: await getWorkspaceLayout(workspace.id),
          })),
        )
      : []
    const data: TeamPackageExport = {
      version: '1.0',
      teamName: options?.teamName || 'Team',
      exportedAt: new Date().toISOString(),
      exportedBy: userProfile?.id || '',
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
    const jsonContent = JSON.stringify(data, null, 2)
    const path = await save({
      defaultPath: `team-${(options?.teamName || 'package').toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [
        { name: 'Team Package', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (!path) return null
    await writeTextFile(path, jsonContent)
    return path
  } catch (error) {
    console.error('Team package export failed:', error)
    throw error
  }
}

export function previewTeamPackage(content: string): TeamPackageExport | null {
  try {
    const data = JSON.parse(content) as TeamPackageExport
    return data.version === '1.0' && data.teamName ? data : null
  } catch {
    return null
  }
}

export async function importTeamPackage(
  content: string,
  mergeMode: MergeMode = 'merge',
): Promise<TeamImportStats> {
  const data = previewTeamPackage(content)
  if (!data) throw new Error('Invalid team package format')
  const stats: TeamImportStats = { ...createImportStats(), members: 0 }
  await importResources(
    { ...data, exportedAt: 0, type: 'team', settings: {} },
    mergeMode,
    stats,
  )
  return stats
}
