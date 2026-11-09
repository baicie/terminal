/** Restore a backup through one transactional Rust command. */
import { invoke } from '@tauri-apps/api/core'
import {
  diagnoseImport,
} from './import-security'
import type {
  ImportSecretsDiagnosis,
  ImportSecretsPolicy,
} from './import-security'
import {
  migrateSecretToVault,
  rollbackMigratedSecrets,
} from './import-vault-migration'
import type { BoundCredential } from './import-vault-migration'
import { importableSettings } from './settings-export-policy'
import {
  normalizeImportedAgentForwarding,
  normalizeImportedShellIntegration,
  runImportTransaction,
} from './sync-import-support'
import type { ExportData, ImportStats, MergeMode } from './sync-types'

// Re-exported so callers keep one import for the import path as a whole.
export {
  migrateSecretToVault,
  rollbackMigratedSecrets,
} from './import-vault-migration'
export type { BoundCredential } from './import-vault-migration'

export { createImportStats } from './sync-import-support'
export { diagnoseImport, describeImportSecrets } from './import-security'
export type { ImportSecretsDiagnosis, ImportSecretsPolicy } from './import-security'

type Resource = Record<string, unknown>

/** Rust command that executes the whole restore in one transaction. */
const IMPORT_COMMAND = 'import_backup_data'

/**
 * One object per table plus the decisions Rust must not invent: the merge mode,
 * the timestamp used for `updated_at` rewrites, and what to do with plaintext
 * secrets in the file.
 */
export interface ImportPayload {
  mergeMode: MergeMode
  now: number
  /**
   * Secret handling. `reject` is the default on the backend too: a caller that has
   * not considered secrets does not get to import a file that has them.
   */
  secrets: ImportSecretsPolicy
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

/**
 * What the caller decided about the file's secrets.
 *
 * `migrate` is not a permission slip: by the time it is passed to the writer, every
 * secret must already be in this device's vault and read back, and `boundRefs` must
 * name each one. The whole point of the split is that the writer never holds a
 * plaintext value.
 */
export interface ImportSecretDecision {
  policy: ImportSecretsPolicy
  /** Filled by `migrateSecretToVault`; empty for `discard` and for clean files. */
  boundRefs?: BoundCredential[]
}

/** The two lossy column rules stay in TypeScript; Rust writes what it is given. */
function importedHostRow(row: unknown, bound: BoundCredential | undefined): Resource {
  const item = row as Resource
  // The secret fields never travel: they are either in the vault (with a bound
  // reference) or deliberately discarded. Sending them would put them back in the
  // writer's reach, which is the boundary this module exists to hold.
  const { password: _password, private_key: _privateKey, ...rest } = item
  return {
    ...rest,
    agent_forwarding: normalizeImportedAgentForwarding(item.agent_forwarding),
    shell_integration: normalizeImportedShellIntegration(item.shell_integration),
    ...(bound ? { bound_credential_ref: bound.boundRef } : {}),
  }
}

function importedSshKeyRow(row: unknown, bound: BoundCredential | undefined): Resource {
  const item = row as Resource
  const { private_key: _privateKey, passphrase: _passphrase, ...rest } = item
  return {
    ...rest,
    ...(bound ? { bound_credential_ref: bound.boundRef } : {}),
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
  decision: ImportSecretDecision,
): ImportPayload {
  const byId = new Map<string, BoundCredential>()
  for (const bound of decision.boundRefs ?? []) {
    byId.set(`${bound.resource}:${bound.id}`, bound)
  }
  return {
    mergeMode,
    now: Date.now(),
    secrets: decision.policy,
    groups: data.groups || [],
    hosts: (data.hosts || []).map(row => {
      const item = row as Resource
      return importedHostRow(row, byId.get(`host:${String(item.id)}`))
    }),
    snippetPackages: data.snippetPackages || [],
    snippets: data.snippets || [],
    sshKeys: (data.sshKeys || []).map(row => {
      const item = row as Resource
      return importedSshKeyRow(row, byId.get(`sshKey:${String(item.id)}`))
    }),
    knownHosts: (data.knownHosts || []).map(importedKnownHostRow),
    workspaces: data.workspaces || [],
    workspaceLayouts: data.workspaceLayouts || [],
    // Settings go through the same field-level allowlist as the export, so a file
    // cannot write a credential key this build keeps locally.
    settings: importableSettings(data.settings || {}),
  }
}

/**
 * The report the Rust writer returns, widened with what the UI has to show.
 */
export interface ImportReport extends ImportStats {
  credentialsNeedingRebind: Array<{
    resource: 'host' | 'sshKey'
    id: string
    name: string
    kinds: string[]
  }>
  secrets: {
    hostSecrets: {
      hostPasswords: number
      hostPrivateKeys: number
      sshKeyPrivateKeys: number
      sshKeyPassphrases: number
    }
    hosts: Array<{ id: string, name: string }>
    keys: Array<{ id: string, name: string }>
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
  decision: ImportSecretDecision = { policy: 'reject' },
): Promise<ImportReport> {
  const report = await runImportTransaction(() =>
    invoke<ImportReport>(IMPORT_COMMAND, {
      payload: buildImportPayload(data, mergeMode, decision),
    }),
  )
  stats.groups = report.groups
  stats.hosts = report.hosts
  stats.snippetPackages = report.snippetPackages
  stats.snippets = report.snippets
  stats.sshKeys = report.sshKeys
  stats.knownHosts = report.knownHosts
  stats.workspaces = report.workspaces
  return report
}

/**
 * Import with the full secret flow: diagnose, migrate if asked, import, and undo
 * the vault writes if the database side fails.
 *
 * This is the entry point the UI should use. The lower-level `importResources`
 * stays exported for tests and for callers that have already resolved the
 * decision, but anything user-facing goes through here so the ordering rules
 * cannot be reimplemented differently.
 */
export async function importWithSecretPolicy(
  data: ExportData,
  mergeMode: MergeMode,
  stats: ImportStats,
  options: {
    policy: ImportSecretsPolicy
    versionFor?: (resource: 'host' | 'sshKey', id: string) => number
  },
): Promise<{ report: ImportReport, diagnosis: ImportSecretsDiagnosis }> {
  const diagnosis = diagnoseImport(data)
  let bound: BoundCredential[] = []
  if (options.policy === 'migrate' && diagnosis.rows.length > 0) {
    bound = await migrateSecretToVault(data, { versionFor: options.versionFor })
  }
  try {
    const report = await importResources(data, mergeMode, stats, {
      policy: options.policy,
      boundRefs: bound,
    })
    return { report, diagnosis }
  } catch (error) {
    if (bound.length > 0) {
      const failed = await rollbackMigratedSecrets(bound)
      if (failed > 0) {
        console.warn(
          `[credential] ${failed} secret(s) written for a failed import could not be removed`,
        )
      }
    }
    throw error
  }
}
