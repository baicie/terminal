/** Restore plumbing shared by the backup import path. */
import type { ImportStats } from './sync-types'

let importQueue: Promise<unknown> = Promise.resolve()

/**
 * Serializes restores so two entry points (backup file, team package) cannot
 * run at the same time. Atomicity itself lives in the Rust command, which runs
 * the whole batch on one connection inside one transaction; this queue is only
 * the frontend half of the two-layer protection and touches no database.
 */
export async function runImportTransaction<T>(
  task: () => Promise<T>,
): Promise<T> {
  const run = importQueue.then(task)
  importQueue = run.catch(() => undefined)
  return run
}

export function createImportStats(): ImportStats {
  return {
    hosts: 0,
    groups: 0,
    snippets: 0,
    snippetPackages: 0,
    sshKeys: 0,
    knownHosts: 0,
    workspaces: 0,
  }
}

export function normalizeImportedAgentForwarding(value: unknown): 0 | 1 {
  return value === true || value === 1 ? 1 : 0
}

export function normalizeImportedShellIntegration(
  value: unknown,
): 'off' | 'bash' | 'zsh' {
  return value === 'bash' || value === 'zsh' ? value : 'off'
}
