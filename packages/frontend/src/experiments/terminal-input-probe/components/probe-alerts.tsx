import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Check, TriangleAlert, X } from 'lucide-react'
import type { TerminalInputProbeState } from '../probe-state'

interface ProbeAlertsProps {
  error: string | null
  probeState: TerminalInputProbeState
}

export function ProbeAlerts({ error, probeState }: ProbeAlertsProps) {
  const { t } = useTranslation()
  const passed = probeState.results.filter(result => result.ok).length

  return (
    <>
      {error && (
        <Alert variant="destructive" className="mt-4">
          <TriangleAlert />
          <AlertTitle>{t('terminal.errorTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {probeState.phase === 'complete' && (
        <Alert className="mt-4">
          {passed === probeState.rounds ? <Check /> : <X />}
          <AlertTitle>
            {passed}/{probeState.rounds}
          </AlertTitle>
          <AlertDescription>{probeState.expectedHex}</AlertDescription>
        </Alert>
      )}
    </>
  )
}
