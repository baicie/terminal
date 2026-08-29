import { createImportStats, importResources } from './sync-import'
import type { ExportData, ImportStats, MergeMode } from './sync-types'

export async function importDataFromFile(
  content: string,
  mergeMode: MergeMode = 'merge',
): Promise<ImportStats> {
  try {
    const data = JSON.parse(content) as ExportData
    if (!data.version || !data.exportedAt)
      throw new Error('Invalid export file format')
    const stats = createImportStats()
    await importResources(data, mergeMode, stats)
    return stats
  } catch (error) {
    console.error('Import failed:', error)
    throw error
  }
}

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
