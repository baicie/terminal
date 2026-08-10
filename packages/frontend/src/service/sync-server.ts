import { select } from '@/service/database'
import { storageDownload, storageUpload } from '@/service/storage'
import { collectExportData } from './sync-export'
import { importDataFromFile, previewImportData } from './sync-file'
import type { ExportData, ImportStats, MergeMode } from './sync-types'

type SyncCounts = ImportStats
export interface SyncResult {
  success: boolean
  timestamp: string
  stats?: SyncCounts
}
export interface DownloadResult {
  success: boolean
  data?: ExportData
  stats?: SyncCounts
}
export interface ServerPreview {
  success: boolean
  data?: ExportData
  localCounts?: SyncCounts
  remoteCounts?: SyncCounts
  conflictCounts?: SyncCounts
  error?: string
}

export async function syncToServer(): Promise<SyncResult> {
  try {
    const data = await collectExportData()
    const content = JSON.stringify(data, null, 2)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const timestampResult = await storageUpload(
      `terminal-sync-${timestamp}.json`,
      content,
    )
    if (!timestampResult.success)
      throw new Error(
        `Failed to upload timestamped backup: ${timestampResult.message}`,
      )
    const latestResult = await storageUpload('terminal-latest.json', content)
    if (!latestResult.success)
      throw new Error(`Failed to update latest backup: ${latestResult.message}`)
    localStorage.setItem('terminal.lastSyncTime', String(Date.now()))
    return {
      success: true,
      timestamp: new Date().toISOString(),
      stats: countData(data),
    }
  } catch (error) {
    console.error('Sync to server failed:', error)
    throw error
  }
}

export async function downloadFromServer(
  mergeMode: MergeMode = 'merge',
): Promise<DownloadResult> {
  try {
    const content = await storageDownload('terminal-latest.json')
    if (!content) return { success: false }
    const data = previewImportData(content)
    if (!data) throw new Error('Invalid data format from server')
    const stats = await importDataFromFile(content, mergeMode)
    localStorage.setItem('terminal.lastSyncTime', String(Date.now()))
    return { success: true, data, stats }
  } catch (error) {
    console.error('Download from server failed:', error)
    throw error
  }
}

export function getLastSyncTime(): number | null {
  const stored = localStorage.getItem('terminal.lastSyncTime')
  if (!stored) return null
  const time = parseInt(stored, 10)
  return isNaN(time) ? null : time
}

export async function previewServerData(): Promise<ServerPreview> {
  try {
    const [
      hosts,
      groups,
      snippets,
      snippetPackages,
      sshKeys,
      knownHosts,
      workspaces,
    ] = await Promise.all([
      select<Record<string, unknown>>('SELECT id FROM hosts'),
      select<Record<string, unknown>>('SELECT id FROM groups'),
      select<Record<string, unknown>>('SELECT id FROM snippets'),
      select<Record<string, unknown>>('SELECT id FROM snippet_packages'),
      select<Record<string, unknown>>('SELECT id FROM ssh_keys'),
      select<Record<string, unknown>>('SELECT id FROM known_hosts'),
      select<Record<string, unknown>>('SELECT id FROM workspaces'),
    ])
    const content = await storageDownload('terminal-latest.json')
    if (!content) return { success: false, error: 'No backup found on server' }
    const data = previewImportData(content)
    if (!data) return { success: false, error: 'Invalid backup format' }
    const remote = resourceRecords(data)
    const localIds = {
      hosts: new Set(hosts.map(item => item.id)),
      groups: new Set(groups.map(item => item.id)),
      snippets: new Set(snippets.map(item => item.id)),
      snippetPackages: new Set(snippetPackages.map(item => item.id)),
      sshKeys: new Set(sshKeys.map(item => item.id)),
      knownHosts: new Set(
        knownHosts.map(item => `${item.hostname}:${item.port}`),
      ),
      workspaces: new Set(workspaces.map(item => item.id)),
    }
    const conflictCounts = {
      hosts: remote.hosts.filter(item => localIds.hosts.has(item.id)).length,
      groups: remote.groups.filter(item => localIds.groups.has(item.id)).length,
      snippets: remote.snippets.filter(item => localIds.snippets.has(item.id))
        .length,
      snippetPackages: remote.snippetPackages.filter(item =>
        localIds.snippetPackages.has(item.id),
      ).length,
      sshKeys: remote.sshKeys.filter(item => localIds.sshKeys.has(item.id))
        .length,
      knownHosts: remote.knownHosts.filter(item =>
        localIds.knownHosts.has(`${item.hostname}:${item.port}`),
      ).length,
      workspaces: remote.workspaces.filter(item =>
        localIds.workspaces.has(item.id),
      ).length,
    }
    return {
      success: true,
      data,
      localCounts: {
        hosts: hosts.length,
        groups: groups.length,
        snippets: snippets.length,
        snippetPackages: snippetPackages.length,
        sshKeys: sshKeys.length,
        knownHosts: knownHosts.length,
        workspaces: workspaces.length,
      },
      remoteCounts: countData(data),
      conflictCounts,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export function formatLastSyncTime(): string | null {
  const lastSync = getLastSyncTime()
  if (!lastSync) return null
  const seconds = Math.floor((Date.now() - lastSync) / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  return seconds > 10 ? `${seconds} seconds ago` : 'just now'
}

function countData(data: ExportData): SyncCounts {
  return {
    hosts: data.hosts.length,
    groups: data.groups.length,
    snippets: data.snippets.length,
    snippetPackages: data.snippetPackages.length,
    sshKeys: data.sshKeys.length,
    knownHosts: data.knownHosts.length,
    workspaces: data.workspaces.length,
  }
}

function resourceRecords(
  data: ExportData,
): Record<keyof SyncCounts, Array<Record<string, string>>> {
  return {
    hosts: data.hosts,
    groups: data.groups,
    snippets: data.snippets,
    snippetPackages: data.snippetPackages,
    sshKeys: data.sshKeys,
    knownHosts: data.knownHosts,
    workspaces: data.workspaces,
  } as Record<keyof SyncCounts, Array<Record<string, string>>>
}
