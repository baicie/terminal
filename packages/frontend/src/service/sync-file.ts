import {
  createImportStats,
  importResources,
  importWithSecretPolicy,
} from './sync-import'
import type {
  ImportSecretsDiagnosis,
  ImportSecretsPolicy,
} from './import-security'
import type { ExportData, ImportStats, MergeMode } from './sync-types'

/**
 * Import a file whose secrets have already been decided on.
 *
 * Kept for the code paths that must stay synchronous with respect to the decision —
 * chiefly tests and the cloud-restore path, which is handed a policy by its caller.
 * A file that still carries plaintext and no policy is refused by the backend.
 */
export async function importDataFromFile(
  content: string,
  mergeMode: MergeMode = 'merge',
  policy: ImportSecretsPolicy = 'reject',
): Promise<ImportStats> {
  try {
    const data = JSON.parse(content) as ExportData
    if (!data.version || !data.exportedAt)
      throw new Error('Invalid export file format')
    const stats = createImportStats()
    await importResources(data, mergeMode, stats, { policy })
    return stats
  } catch (error) {
    console.error('Import failed:', error)
    throw error
  }
}

/**
 * Import with the decision the user made, including the vault migration.
 *
 * The one entry point a UI should call: it diagnoses first, moves the secrets into
 * the vault when asked (before any row is written), and reports which rows still
 * need a credential.
 */
export async function importDataWithSecretPolicy(
  content: string,
  mergeMode: MergeMode,
  options: { policy: ImportSecretsPolicy },
): Promise<{ stats: ImportStats, diagnosis: ImportSecretsDiagnosis }> {
  const data = JSON.parse(content) as ExportData
  if (!data.version || !data.exportedAt)
    throw new Error('Invalid export file format')
  const stats = createImportStats()
  const { diagnosis } = await importWithSecretPolicy(data, mergeMode, stats, {
    policy: options.policy,
  })
  return { stats, diagnosis }
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
