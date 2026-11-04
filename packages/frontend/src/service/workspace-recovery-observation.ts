import { traceStage } from '@/service/database/startup-trace'

export type WorkspaceRecoveryPhase =
  | 'workspace-load-start'
  | 'workspace-load-done'
  | 'workspace-load-failed'
  | 'layout-load-start'
  | 'layout-load-done'
  | 'layout-load-failed'
  | 'layout-absent'
  | 'host-load-start'
  | 'host-load-done'
  | 'host-load-failed'
  | 'recovery-layout-available'
  | 'restore-layout-committed'
  | 'restore-layout-skipped'

export interface WorkspaceRecoveryObservation {
  correlationId: string
  phase: WorkspaceRecoveryPhase
  workspaceId?: string
  remoteLayoutExpected?: boolean
  tabCount?: number
  remoteTabCount?: number
  reason?: string
}

export interface WorkspaceRecoveryReporter {
  correlationId: string
  report: (
    phase: WorkspaceRecoveryPhase,
    extra?: Omit<WorkspaceRecoveryObservation, 'correlationId' | 'phase'>,
  ) => void
}

let recoverySequence = 0

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function recoveryDetail(observation: WorkspaceRecoveryObservation): string {
  const facts = [
    `correlationId=${observation.correlationId}`,
    ...(observation.workspaceId
      ? [`workspaceId=${observation.workspaceId}`]
      : []),
    ...(observation.tabCount === undefined
      ? []
      : [`tabs=${observation.tabCount}`]),
    ...(observation.remoteTabCount === undefined
      ? []
      : [`remoteTabs=${observation.remoteTabCount}`]),
    ...(observation.reason ? [`reason=${observation.reason}`] : []),
  ]
  return facts.join(' ')
}

/**
 * One correlation id per recovery attempt. Every stage line carries it so a
 * fallback decision can be tied to the exact workspace/layout read that was in
 * flight, without logging any host secret.
 */
export function createWorkspaceRecoveryReporter(
  onObservation?: (observation: WorkspaceRecoveryObservation) => void,
): WorkspaceRecoveryReporter {
  recoverySequence += 1
  const correlationId = `recovery-${recoverySequence}`
  return {
    correlationId,
    report(phase, extra = {}) {
      const observation: WorkspaceRecoveryObservation = {
        correlationId,
        phase,
        ...extra,
      }
      traceStage(phase, recoveryDetail(observation))
      onObservation?.(observation)
    },
  }
}
