import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { TerminalSessionIoSnapshot } from '@/features/terminal/services/terminal-session-io'
import type { TerminalInputProbeState } from '../probe-state'
import type { InputEventLog } from '../probe-types'

interface ProbeSidebarProps {
  rounds: string
  expectedText: string
  onRoundsChange: (value: string) => void
  onExpectedTextChange: (value: string) => void
  running: boolean
  probeState: TerminalInputProbeState
  diagnostics: TerminalSessionIoSnapshot | null
  inputEvents: InputEventLog[]
}

export function ProbeSidebar({
  rounds,
  expectedText,
  onRoundsChange,
  onExpectedTextChange,
  running,
  probeState,
  diagnostics,
  inputEvents,
}: ProbeSidebarProps) {
  const { t } = useTranslation()
  const passed = probeState.results.filter(result => result.ok).length

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="probe-rounds">
              {t('experiments.inputProbeRounds')}
            </Label>
            <Input
              id="probe-rounds"
              type="number"
              min={1}
              max={100}
              value={rounds}
              onChange={event => onRoundsChange(event.target.value)}
              disabled={running}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="probe-expected">
              {t('experiments.inputProbeExpected')}
            </Label>
            <Input
              id="probe-expected"
              value={expectedText}
              onChange={event => onExpectedTextChange(event.target.value)}
              disabled={running}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1 py-3">
          <CardTitle className="text-sm">
            {t('experiments.inputProbeDiagnostics')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 p-4 text-xs">
          <span className="text-muted-foreground">
            {t('experiments.inputProbePassed')}
          </span>
          <span className="text-right font-mono">
            {passed}/{probeState.results.length}
          </span>
          <span className="text-muted-foreground">accepted / sent</span>
          <span className="text-right font-mono">
            {diagnostics?.acceptedBytes ?? 0} / {diagnostics?.sentBytes ?? 0}
          </span>
          <span className="text-muted-foreground">queued</span>
          <span className="text-right font-mono">
            {diagnostics?.queuedBytes ?? 0} B
          </span>
        </CardContent>
      </Card>

      <Card className="min-h-0">
        <CardHeader className="gap-1 py-3">
          <CardTitle className="text-sm">
            {t('experiments.inputProbeResults')}
          </CardTitle>
        </CardHeader>
        <ScrollArea className="h-40">
          <CardContent className="flex flex-col gap-1.5 p-4 pt-0 font-mono text-[11px]">
            {probeState.results.length === 0 ? (
              <span className="text-muted-foreground">
                {t('experiments.inputProbeNoEvents')}
              </span>
            ) : (
              probeState.results.map(result => (
                <div
                  key={result.round}
                  className="grid grid-cols-[2rem_1fr_auto] items-center gap-2"
                >
                  <span>{result.round}</span>
                  <span className="min-w-0 truncate">
                    {result.expectedHex} / {result.receivedHex}
                  </span>
                  <Badge variant={result.ok ? 'secondary' : 'destructive'}>
                    {result.ok ? 'OK' : 'FAIL'}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </ScrollArea>
      </Card>

      <Card className="min-h-0">
        <CardHeader className="gap-1 py-3">
          <CardTitle className="text-sm">
            {t('experiments.inputProbeEvents')}
          </CardTitle>
        </CardHeader>
        <ScrollArea className="h-48">
          <CardContent className="flex flex-col gap-1 p-4 pt-0 font-mono text-[11px]">
            {inputEvents.length === 0 ? (
              <span className="text-muted-foreground">
                {t('experiments.inputProbeNoEvents')}
              </span>
            ) : (
              inputEvents.slice(-30).map(event => (
                <span key={event.id} className="flex justify-between gap-2">
                  <span>{event.kind === 'text' ? 'onData' : 'onBinary'}</span>
                  <span className="truncate">{event.hex}</span>
                  <span>{event.bytes} B</span>
                </span>
              ))
            )}
          </CardContent>
        </ScrollArea>
      </Card>
    </div>
  )
}
