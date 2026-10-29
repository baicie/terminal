import type { SshHostKeyProbeResult } from '@/features/terminal/services/ssh-host-key'
import type { SshHostKeyRole } from '@/features/terminal/hooks/use-ssh-host-key-gate'
import { SshHostKeyDialog, SshHostKeyGateOverlay } from './ssh-host-key-dialog'

interface HostKeyGateSurfaceState {
  status: 'checking' | 'ready' | 'prompt' | 'blocked' | 'error'
  role: SshHostKeyRole | null
  prompt: SshHostKeyProbeResult | null
  saving: boolean
  error: string | null
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
