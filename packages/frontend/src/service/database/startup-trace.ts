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

const TRACE_TIMEOUT_MS = 1_000
let traceQueue: Promise<void> = Promise.resolve()

async function invokeStage(stage: string, detail: string): Promise<void> {
  if (!enabled()) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    // A diagnostic write must never become a startup dependency. The queue
    // below preserves order, but a hung IPC call is dropped after one second
    // so the operation it annotates can still proceed.
    await Promise.race([
      invoke('startup_stage', { stage, detail }),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, TRACE_TIMEOUT_MS)
      }),
    ])
  } catch {
    // Tracing must never fail startup.
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function enqueueStage(stage: string, detail: string): Promise<void> {
  const next = traceQueue.then(() => invokeStage(stage, detail))
  traceQueue = next.catch(() => undefined)
  return next
}

export function traceStage(stage: string, detail = ''): void {
  void enqueueStage(stage, detail)
}

/**
 * Await the stage write before dispatching the operation it describes.
 *
 * `traceStage` is fire-and-forget, so the backend command it annotates can
 * reach Rust first. That made `session-create-requested` appear after
 * `ssh-connect-start` in real runner evidence (run 41596246878), turning a
 * causal edge into a negative duration. Critical-path callers use this variant
 * when the order itself is part of the measured contract.
 */
export function traceStageAndWait(stage: string, detail = ''): Promise<void> {
  return enqueueStage(stage, detail)
}

/** Report a bootstrap failure together with the stage it happened in. */
export function traceStageFailed(stage: string, error: unknown): void {
  if (!enabled()) return
  // A non-Error rejection used to arrive as the literal string "undefined",
  // which cost a whole CI round to interpret. Describe the value instead.
  const message =
    error instanceof Error
      ? error.message
      : (() => {
          try {
            return JSON.stringify(error) ?? String(error)
          } catch {
            return String(error)
          }
        })()
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('startup_stage_failed', { stage, error: message }))
    .catch(() => undefined)
}
