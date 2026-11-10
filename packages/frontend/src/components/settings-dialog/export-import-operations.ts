import { readTextFile } from '@tauri-apps/plugin-fs'
import { diagnoseImport, previewImportData } from '@/service/sync'
import type { ImportSecretsDiagnosis } from '@/service/sync'

export {
  importDataFromFile as importExportData,
  importWithSecretPolicy,
} from '@/service/sync'

export type ImportMode = 'merge' | 'replace'
export type ImportPreview = {
  hosts: number
  groups: number
  snippets: number
  snippetPackages: number
  workspaces: number
  sshKeys: number
  knownHosts: number
}

export interface ImportFileSelection {
  content: string
  preview: ImportPreview
  /** What the file's plaintext credentials require, decided before any write. */
  secrets: ImportSecretsDiagnosis
}

export async function selectImportFile(): Promise<ImportFileSelection | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    multiple: false,
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (!selected) return null
  const content = await readTextFile(selected as string)
  const data = previewImportData(content)
  if (!data) throw new Error('Invalid export file format')
  return {
    content,
    preview: {
      hosts: data.hosts?.length || 0,
      groups: data.groups?.length || 0,
      snippets: data.snippets?.length || 0,
      snippetPackages: data.snippetPackages?.length || 0,
      workspaces: data.workspaces?.length || 0,
      sshKeys: data.sshKeys?.length || 0,
      knownHosts: data.knownHosts?.length || 0,
    },
    // Computed from the parsed file, so the prompt is decided before a single row
    // is written. Nothing here reads a value out; the diagnosis is ids and kinds.
    secrets: diagnoseImport(data),
  }
}
