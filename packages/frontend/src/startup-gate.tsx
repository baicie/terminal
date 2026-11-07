import { useCallback, useEffect, useRef, useState } from 'react'
import App from './App'
import { Button } from '@/components/ui/button'
import {
  probeRecoveryStatus,
  startupAllowed,
  type DbRecoveryStatus,
} from './service/database/recovery-status'
import {
  allowStartup,
  beginStartupGate,
  blockStartup,
} from './service/database/startup-gate'

const vaultProbeEnabled =
  import.meta.env.VITE_TERMINAL_SMOKE_BUILD === '1' &&
  import.meta.env.VITE_TERMINAL_VAULT_PROBE === '1'

async function maybeRunVaultProbe() {
  if (!vaultProbeEnabled) return
  const { invoke } = await import('@tauri-apps/api/core')
  const enabled = await invoke<boolean>('vault_probe_enabled')
  if (!enabled) return
  const { runVaultProbe } = await import('./service/vault-probe')
  await runVaultProbe()
}

type Decision =
  | { kind: 'checking' }
  | { kind: 'allowed' }
  | { kind: 'blocked'; status: DbRecoveryStatus | null; reason: string }

interface StartupGateProps {
  startupTerminalFallbackAt?: number
}

/**
 * The root component: business App (and therefore every database effect) is
 * mounted only after an explicit allow decision. A blocked state never mounts
 * App, so initializeTeam/hydrate/workspace recovery cannot run.
 */
export default function StartupGate({ startupTerminalFallbackAt }: StartupGateProps) {
  const [decision, setDecision] = useState<Decision>({ kind: 'checking' })
  const generation = useRef(0)

  const run = useCallback(async (retry: boolean) => {
    const current = generation.current + 1
    generation.current = current
    beginStartupGate()
    setDecision({ kind: 'checking' })
    const probe = await probeRecoveryStatus({ retry })
    if (generation.current !== current) return
    if (!probe.ok) {
      if (probe.nonTauri) {
        // Browser dev/tests have no backend to protect; the DB layer itself
        // refuses to open SQLite outside Tauri.
        allowStartup()
        setDecision({ kind: 'allowed' })
        return
      }
      blockStartup()
      setDecision({ kind: 'blocked', status: null, reason: probe.reason })
      return
    }
    if (startupAllowed(probe.status)) {
      allowStartup()
      setDecision({ kind: 'allowed' })
      void maybeRunVaultProbe()
      return
    }
    blockStartup()
    setDecision({
      kind: 'blocked',
      status: probe.status,
      reason: probe.status.reason,
    })
  }, [])

  useEffect(() => {
    void run(false)
  }, [run])

  if (decision.kind === 'checking') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Checking database state…</p>
      </div>
    )
  }

  if (decision.kind === 'allowed') {
    return <App startupTerminalFallbackAt={startupTerminalFallbackAt} />
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-lg space-y-4 rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">Database recovery needs attention</h1>
        <p className="text-sm text-muted-foreground">
          The application has not opened your database. Resolve the state below,
          then retry; no data was overwritten.
        </p>
        <p className="text-xs text-muted-foreground">
          {decision.status ? decision.status.state : 'STATUS_UNAVAILABLE'} ·{' '}
          {decision.reason}
        </p>
        <Button size="sm" onClick={() => void run(true)}>
          Retry recovery
        </Button>
      </div>
    </div>
  )
}
