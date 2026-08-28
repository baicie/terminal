import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, CircleStop, Play } from 'lucide-react'
import { ViewToolbar } from '@/components/view-container'
import type { TerminalInputProbeState } from '../probe-state'

interface ProbeToolbarProps {
  status: string
  phase: TerminalInputProbeState['phase']
  running: boolean
  onStart: () => void
  onStop: () => void
}

export function ProbeToolbar({
  status,
  phase,
  running,
  onStart,
  onStop,
}: ProbeToolbarProps) {
  const { t } = useTranslation()
  const phaseVariant =
    phase === 'complete'
      ? 'default'
      : phase === 'error'
        ? 'destructive'
        : phase === 'awaiting-input'
          ? 'secondary'
          : 'outline'

  return (
    <ViewToolbar>
      <Link to="/experiments">
        <Button variant="ghost" size="sm">
          <ArrowLeft data-icon="inline-start" />
          {t('common.back')}
        </Button>
      </Link>
      <Badge variant={status === 'connected' ? 'secondary' : 'outline'}>
        {status === 'connected'
          ? t('experiments.inputProbeConnected')
          : status}
      </Badge>
      <Badge variant={phaseVariant}>{phase}</Badge>
      <div className="flex-1" />
      <Button size="sm" onClick={onStart} disabled={running || status !== 'connected'}>
        <Play data-icon="inline-start" />
        {t('experiments.inputProbeStart')}
      </Button>
      <Button size="sm" variant="outline" onClick={onStop} disabled={!running}>
        <CircleStop data-icon="inline-start" />
        {t('experiments.inputProbeStop')}
      </Button>
    </ViewToolbar>
  )
}
