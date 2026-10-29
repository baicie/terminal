import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Keyboard } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { TerminalInputProbeState } from '../probe-state'

interface ProbeTerminalPanelProps {
  containerRef: RefObject<HTMLDivElement | null>
  probeState: TerminalInputProbeState
}

export function ProbeTerminalPanel({
  containerRef,
  probeState,
}: ProbeTerminalPanelProps) {
  const { t } = useTranslation()

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="gap-1 border-b py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Keyboard />
          {t('experiments.inputProbeInstruction')}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {probeState.currentRound > 0
            ? `${probeState.currentRound}/${probeState.rounds}`
            : t('experiments.inputProbeIdle')}
        </p>
      </CardHeader>
      <CardContent className="flex min-h-[26rem] flex-col gap-3 p-3">
        <div
          ref={containerRef}
          className="min-h-0 flex-1 rounded-md bg-black/90 p-2"
        />
        <p className="text-xs text-muted-foreground">
          {t('experiments.inputProbeExpectedHex')}:{' '}
          <code>{probeState.expectedHex}</code>
        </p>
      </CardContent>
    </Card>
  )
}
