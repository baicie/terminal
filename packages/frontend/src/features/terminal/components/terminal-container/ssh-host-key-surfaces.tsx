import type { SshHostKeyProbeResult } from '@/features/terminal/services/ssh-host-key'
import type { SshHostKeyRole } from '@/features/terminal/hooks/use-ssh-host-key-gate'
import type { SshHostKeyGateFailure } from '@/features/terminal/hooks/ssh-host-key-gate-failure'
import { SshHostKeyDialog } from './ssh-host-key-dialog'
import { SshHostKeyGateOverlay } from './ssh-host-key-gate-overlay'

interface HostKeyGateSurfaceState {
  status: 'checking' | 'ready' | 'prompt' | 'blocked' | 'error'
  role: SshHostKeyRole | null
  prompt: SshHostKeyProbeResult | null
  saving: boolean
  error: string | null
  /** Which preflight step failed, when a probe produced the error. */
  failure?: SshHostKeyGateFailure
  trustOnce: () => void
  trustAndSave: () => void
  cancel: () => void
  retry: () => void
}

export function SshHostKeyOverlaySurface({
  gate,
}: {
  gate: HostKeyGateSurfaceState
}) {
  if (gate.status !== 'checking' && gate.status !== 'error') return null
  return (
    <SshHostKeyGateOverlay
      status={gate.status}
      error={gate.error}
      failure={gate.failure}
      onRetry={gate.retry}
    />
  )
}

export function SshHostKeyDialogSurface({
  gate,
}: {
  gate: HostKeyGateSurfaceState
}) {
  if (!gate.prompt) return null
  return (
    <SshHostKeyDialog
      prompt={gate.prompt}
      role={gate.role}
      saving={gate.saving}
      error={gate.error}
      onTrustOnce={gate.trustOnce}
      onTrustAndSave={gate.trustAndSave}
      onCancel={gate.cancel}
    />
  )
}
