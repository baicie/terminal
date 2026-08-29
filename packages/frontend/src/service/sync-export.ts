import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { getUserProfile, select } from '@/service/database'
import { getKnownHosts } from '@/service/database/known-hosts'
import { getSSHKeys } from '@/service/database/ssh-keys'
import {
  getWorkspaceLayout,
  getWorkspaces,
} from '@/service/database/workspaces'
import type { ExportData } from './sync-types'

export async function collectExportData(
  includeTeam = false,
): Promise<ExportData> {
  const [
    hosts,
    groups,
    snippets,
    snippetPackages,
    settingsRows,
    workspaces,
    sshKeys,
    knownHosts,
  ] = await Promise.all([
    select<Record<string, unknown>>('SELECT * FROM hosts'),
    select<Record<string, unknown>>('SELECT * FROM groups'),
    select<Record<string, unknown>>('SELECT * FROM snippets'),
    select<Record<string, unknown>>('SELECT * FROM snippet_packages'),
    select<{ key: string; value: string }>('SELECT * FROM settings'),
    getWorkspaces(),
    getSSHKeys(),
    getKnownHosts(),
  ])
  const workspaceLayouts = await Promise.all(
    workspaces.map(async workspace => ({
      workspaceId: workspace.id,
      layoutData: await getWorkspaceLayout(workspace.id),
    })),
  )
  const settings = settingsRows.reduce<Record<string, unknown>>(
    (result, row) => {
      if (row.key) result[row.key] = row.value
      return result
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
    settings,
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
    if (!filePath) return null
    await writeTextFile(filePath, jsonContent)
    return filePath
  } catch (error) {
    console.error('Export failed:', error)
    throw error
  }
}
