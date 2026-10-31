/** Restore plumbing shared by the backup import path. */
import { executeQuery } from '@/service/database'
import type { ImportStats } from './sync-types'

let importQueue: Promise<unknown> = Promise.resolve()

/**
 * Run a whole restore on the singleton connection inside one IMMEDIATE
 * transaction: a failure halfway through rolls the batch back instead of
 * leaving half-restored tables behind. Restores are serialized because a
 * second BEGIN on the same connection while one is open would fail rather
 * than wait.
 */
export async function runImportTransaction(
  fn: () => Promise<void>,
): Promise<void> {
  const run = importQueue.then(async () => {
    await executeQuery('BEGIN IMMEDIATE')
    try {
      await fn()
      await executeQuery('COMMIT')
    } catch (error) {
      await executeQuery('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
  importQueue = run.catch(() => undefined)
  await run
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
