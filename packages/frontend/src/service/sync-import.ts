/** Restore a backup through one transactional Rust command. */
import { invoke } from '@tauri-apps/api/core'
import {
  normalizeImportedAgentForwarding,
  normalizeImportedShellIntegration,
  runImportTransaction,
} from './sync-import-support'
import type { ExportData, ImportStats, MergeMode } from './sync-types'

export { createImportStats } from './sync-import-support'

type Resource = Record<string, unknown>

/** Rust command that executes the whole restore in one transaction. */
const IMPORT_COMMAND = 'import_backup_data'

/**
 * One object per table plus the two decisions Rust must not invent: the merge
 * mode and the timestamp used for `updated_at` rewrites. Table and column names
 * never cross the boundary; the command holds them as constants.
 */
export interface ImportPayload {
  mergeMode: MergeMode
  now: number
  groups: unknown[]
  hosts: unknown[]
  snippetPackages: unknown[]
  snippets: unknown[]
  sshKeys: unknown[]
  knownHosts: unknown[]
  workspaces: unknown[]
  workspaceLayouts: unknown[]
  settings: Record<string, unknown>
}

/** The two lossy column rules stay in TypeScript; Rust writes what it is given. */
function importedHostRow(row: unknown): Resource {
  const item = row as Resource
  return {
    ...item,
    agent_forwarding: normalizeImportedAgentForwarding(item.agent_forwarding),
    shell_integration: normalizeImportedShellIntegration(item.shell_integration),
  }
}

/** Known host ids were always minted during the import, never read from a file. */
function importedKnownHostRow(row: unknown): Resource {
  const item = row as Resource
  return { ...item, id: crypto.randomUUID() }
}

function buildImportPayload(
  data: ExportData,
  mergeMode: MergeMode,
): ImportPayload {
  return {
    mergeMode,
    now: Date.now(),
    groups: data.groups || [],
    hosts: (data.hosts || []).map(importedHostRow),
    snippetPackages: data.snippetPackages || [],
    snippets: data.snippets || [],
    sshKeys: data.sshKeys || [],
    knownHosts: (data.knownHosts || []).map(importedKnownHostRow),
    workspaces: data.workspaces || [],
    workspaceLayouts: data.workspaceLayouts || [],
    settings: data.settings || {},
  }
}

/**
 * Restores a backup file or team package. The signature is unchanged for
 * callers: the reported counters are written back into the caller's object, so
 * every reader of `stats` keeps working without knowing where it came from.
 */
export async function importResources(
  data: ExportData,
  mergeMode: MergeMode,
  stats: ImportStats,
): Promise<void> {
  const report = await runImportTransaction(() =>
    invoke<ImportStats>(IMPORT_COMMAND, {
      payload: buildImportPayload(data, mergeMode),
    }),
  )
  stats.groups = report.groups
  stats.hosts = report.hosts
  stats.snippetPackages = report.snippetPackages
  stats.snippets = report.snippets
  stats.sshKeys = report.sshKeys
  stats.knownHosts = report.knownHosts
  stats.workspaces = report.workspaces
}
