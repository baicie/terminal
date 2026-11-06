/**
 * Redacted product recovery status (Phase 9.6.1).
 *
 * The backend resolves partial migrations before the webview opens the
 * database and stores that verdict for the whole launch. This probe reports
 * the stored verdict; it never performs a restore on its own and never
 * receives a password or key.
 */
import { isTauri } from '@tauri-apps/api/core'

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

const STATES = new Set<string>([
  'HEALTHY',
  'RECOVERY_REQUIRED',
  'BACKUP_VALIDATING',
  'RESTORING',
  'RESTORE_INTERRUPTED',
  'RECOVERED',
  'MANUAL_INTERVENTION_REQUIRED',
])

export type RecoveryProbe =
  | { ok: true; status: DbRecoveryStatus }
  | { ok: false; nonTauri: boolean; reason: string }

export function isValidRecoveryStatus(value: unknown): value is DbRecoveryStatus {
  if (!value || typeof value !== 'object') return false
  const status = value as Record<string, unknown>
  return (
    typeof status.state === 'string' &&
    STATES.has(status.state) &&
    typeof status.reason === 'string' &&
    Array.isArray(status.stages)
  )
}

/** Only a definitive, safe state may mount the business UI. */
export function startupAllowed(status: DbRecoveryStatus): boolean {
  return status.state === 'HEALTHY' || status.state === 'RECOVERED'
}

/**
 * Fail closed under Tauri: a timeout, an exception or a malformed payload is
 * never treated as a healthy database. Outside Tauri (browser dev/tests) the
 * caller gets an explicit non-Tauri result instead of a silent null.
 */
export async function probeRecoveryStatus({ retry = false } = {}): Promise<RecoveryProbe> {
  if (!isTauri()) {
    return { ok: false, nonTauri: true, reason: 'not running under Tauri' }
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const status = retry
      ? await invoke<unknown>('db_recovery_retry')
      : await invoke<unknown>('db_recovery_status')
    if (!isValidRecoveryStatus(status)) {
      return { ok: false, nonTauri: false, reason: 'invalid recovery status payload' }
    }
    return { ok: true, status }
  } catch (error) {
    return {
      ok: false,
      nonTauri: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
