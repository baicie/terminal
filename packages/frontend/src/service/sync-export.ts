import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { getUserProfile, selectStrict } from '@/service/database'
import { getKnownHosts } from '@/service/database/known-hosts'
import { getSSHKeys } from '@/service/database/ssh-keys'
import { sanitizeHostRow, sanitizeSshKeyRow } from './export-sanitize'
import { exportableSettings } from './settings-export-policy'
import {
  getWorkspaceLayout,
  getWorkspaces,
} from '@/service/database/workspaces'
import type { ExportData } from './sync-types'

/**
 * The `getSSHKeys` / `getKnownHosts` helpers still turn a failed read into an
 * empty list. Probe those tables strictly before exporting: a failed read must
 * abort the export instead of producing a backup that claims the data is gone —
 * that backup would then overwrite a real one on the server.
 */
export async function assertExportTablesReadable(tables: {
  sshKeys: boolean
  knownHosts: boolean
}): Promise<void> {
  if (tables.sshKeys)
    await selectStrict<{ id: string }>('SELECT id FROM ssh_keys')
  if (tables.knownHosts)
    await selectStrict<{ id: string }>('SELECT id FROM known_hosts')
}

export async function collectExportData(
  includeTeam = false,
): Promise<ExportData> {
  await assertExportTablesReadable({ sshKeys: true, knownHosts: true })
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
    selectStrict<Record<string, unknown>>('SELECT * FROM hosts'),
    selectStrict<Record<string, unknown>>('SELECT * FROM groups'),
    selectStrict<Record<string, unknown>>('SELECT * FROM snippets'),
    selectStrict<Record<string, unknown>>('SELECT * FROM snippet_packages'),
    selectStrict<{ key: string; value: string }>('SELECT * FROM settings'),
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
  // Field-level allowlist, not a table-key filter: `syncServiceToken` is a field
  // inside the `app_settings` JSON blob, so removing the key named
  // `syncServiceToken` from the settings table would leave the token in place and
  // look correct while doing it.
  const settings = exportableSettings(settingsRows)
  const userProfile = await getUserProfile()
  return {
    version: '1.0.0',
    exportedAt: Date.now(),
    exportedBy: userProfile?.id,
    type: 'full',
    // Whitelisted, not `SELECT *`: the rows above may still carry pre-migration
    // plaintext, and a column added later must not leak by default.
    hosts: hosts.map(sanitizeHostRow),
    groups,
    snippets,
    snippetPackages,
    workspaces,
    workspaceLayouts,
    sshKeys: sshKeys.map(key =>
      sanitizeSshKeyRow(key as unknown as Record<string, unknown>),
    ),
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
