import type {
  TerminalSmokeConfig,
  TerminalSmokeResult,
  TerminalSmokeStaleOutputProbe,
} from './terminal-smoke-contract'
import { TerminalSmokeRound } from './terminal-smoke-round'
import { useTerminalSmokeOrchestrator } from './use-terminal-smoke-orchestrator'
import '@baicie/xterm/css/xterm.css'

interface TerminalSmokeRootProps {
  config: TerminalSmokeConfig
  submitResult: (result: TerminalSmokeResult) => Promise<void>
  reportConnected: () => Promise<number>
  reportReconnect?: () => Promise<void>
  emitStaleOutput?: (
    retiredSessionId: string,
    activeSessionId: string,
  ) => Promise<TerminalSmokeStaleOutputProbe>
}

export default function TerminalSmokeRoot({
  config,
  submitResult,
  reportConnected,
  reportReconnect,
  emitStaleOutput,
}: TerminalSmokeRootProps) {
  const orchestrator = useTerminalSmokeOrchestrator(config, submitResult)

  return (
    <main className="h-dvh w-full overflow-hidden bg-black">
      {orchestrator.roundIndex !== null && (
        <TerminalSmokeRound
          key={orchestrator.roundIndex}
          applicationStartedAt={orchestrator.applicationStartedAt}
          config={config}
          roundIndex={orchestrator.roundIndex}
          signal={orchestrator.signal}
          reportConnected={reportConnected}
          reportReconnect={reportReconnect ?? (async () => {})}
          emitStaleOutput={
            emitStaleOutput ??
            (async () => {
              throw new Error('Terminal smoke stale-output probe is unavailable')
            })
          }
          onComplete={orchestrator.completeRound}
        />
      )}
    </main>
  )
}
