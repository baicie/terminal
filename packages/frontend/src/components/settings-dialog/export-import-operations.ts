import { readTextFile } from '@tauri-apps/plugin-fs'
import { previewImportData } from '@/service/sync'

export { importDataFromFile as importExportData } from '@/service/sync'

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

export async function selectImportFile(): Promise<{
  content: string
  preview: ImportPreview
} | null> {
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
  }
}
