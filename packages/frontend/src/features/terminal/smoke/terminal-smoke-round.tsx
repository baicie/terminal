import {
  useTerminalSmokeRound,
  type UseTerminalSmokeRoundOptions,
} from './use-terminal-smoke-round'

type TerminalSmokeRoundProps = UseTerminalSmokeRoundOptions

export function TerminalSmokeRound({
  applicationStartedAt,
  config,
  roundIndex,
  signal,
  reportConnected,
  reportReconnect,
  reportHostWake,
  emitStaleOutput,
  onComplete,
}: TerminalSmokeRoundProps) {
  const containerRef = useTerminalSmokeRound({
    applicationStartedAt,
    config,
    roundIndex,
    signal,
    reportConnected,
    reportReconnect,
    reportHostWake,
    emitStaleOutput,
    onComplete,
  })

  return (
    <div
      ref={containerRef}
      className="size-full"
      role="application"
      aria-label={`Terminal smoke test round ${roundIndex + 1}`}
    />
  )
}
