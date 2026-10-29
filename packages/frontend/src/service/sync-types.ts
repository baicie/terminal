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

export type ImportStats = {
  hosts: number
  groups: number
  snippets: number
  snippetPackages: number
  sshKeys: number
  knownHosts: number
  workspaces: number
}

export type TeamImportStats = ImportStats & { members: number }
export type MergeMode = 'replace' | 'merge'
