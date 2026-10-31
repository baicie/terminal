/**
 * Database-bootstrap stage tracing.
 *
 * The bootstrap runs in the frontend, but nothing in this build forwards
 * frontend output to the process log - which is why a stalled bootstrap used to
 * be indistinguishable from one that never started (#59).
 *
 * Two rules:
 * 1. Tracing never fails startup - a missing command is swallowed silently.
 * 2. Tracing stays out of the tests. Unit tests count `invoke` calls to assert
 *    the exact bootstrap order, and an unconditional trace would add calls they
 *    neither expect nor should have to know about.
 */
import { isTauri } from '@tauri-apps/api/core'

function enabled(): boolean {
  try {
    return isTauri()
  } catch {
    return false
  }
}

export function traceStage(stage: string, detail = ''): void {
  if (!enabled()) return
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('startup_stage', { stage, detail }))
    .catch(() => undefined)
}

/** Report a bootstrap failure together with the stage it happened in. */
export function traceStageFailed(stage: string, error: unknown): void {
  if (!enabled()) return
  const message = error instanceof Error ? error.message : String(error)
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('startup_stage_failed', { stage, error: message }))
    .catch(() => undefined)
}