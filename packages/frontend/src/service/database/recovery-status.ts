/**
 * Redacted product recovery status (Phase 9.6).
 *
 * The backend resolves partial migrations before the webview opens the
 * database. This probe only reports the state; it never performs a restore and
 * never receives a password or key.
 */
export type DbRecoveryState =
  | 'HEALTHY'
  | 'RECOVERY_REQUIRED'
  | 'BACKUP_VALIDATING'
  | 'RESTORING'
  | 'RESTORE_INTERRUPTED'
  | 'RECOVERED'
  | 'MANUAL_INTERVENTION_REQUIRED'

export interface DbRecoveryStatus {
  state: DbRecoveryState
  reason: string
  restoredFrom: string | null
  stages: string[]
  markerCleared: boolean
}

/** Returns null outside Tauri so browser tests and the dev server keep working. */
export async function fetchDbRecoveryStatus(): Promise<DbRecoveryStatus | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<DbRecoveryStatus>('db_recovery_status')
  } catch {
    return null
  }
}

