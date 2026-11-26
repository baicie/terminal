import type {
  TerminalSmokeConfig,
  TerminalSmokeHostWakeReporter,
  TerminalSmokeResult,
  TerminalSmokeStaleOutputProbe,
} from './terminal-smoke-contract'
import { TerminalSmokeRound } from './terminal-smoke-round'
import { useTerminalSmokeOrchestrator } from './use-terminal-smoke-orchestrator'
import { useTerminalSmokeReconnectPolicy } from './use-terminal-smoke-reconnect-policy'
import { useTerminalSmokeRendererHeartbeat } from './use-terminal-smoke-renderer-heartbeat'
import '@baicie/xterm/css/xterm.css'

interface TerminalSmokeRootProps {
  config: TerminalSmokeConfig
  submitResult: (result: TerminalSmokeResult) => Promise<void>
  reportConnected: () => Promise<number>
  reportReconnect?: () => Promise<void>
  reportHostWake?: TerminalSmokeHostWakeReporter
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
  reportHostWake,
  emitStaleOutput,
}: TerminalSmokeRootProps) {
  const reconnectPolicy = useTerminalSmokeReconnectPolicy()
  /*
   * `ready` is handed to the orchestrator rather than gating this render.
   *
   * The orchestrator awaits it at the point where the first round is mounted, which is the
   * only place the ordering matters. Gating here instead stopped the round from *ever*
   * mounting in tests that have no IPC to answer the policy call — measured: two
   * `terminal-smoke-lifecycle` cases failed with "expected vi.fn() to be called at least
   * once" while the policy promise sat pending forever.
   */
  const orchestrator = useTerminalSmokeOrchestrator(
    config,
    submitResult,
    reconnectPolicy.ready,
  )
  // Declared before the guard below: hooks run in call order, and a `return` between two
  // `use*` calls makes React throw "rendered fewer hooks than expected".
  useTerminalSmokeRendererHeartbeat(config.hostWakeRequired)
  if (reconnectPolicy.state.status === 'failed') {
    /*
     * Announced, and the run continues. A render gate here would leave every smoke run
     * unable to submit a result — a harness timeout that loses the one line saying what
     * went wrong. The server-side dial check is what fails the run, naming the numbers it
     * counted; this is the operator's copy of the reason.
     */
    console.error(
      `terminal smoke reconnect policy: ${reconnectPolicy.state.error.message}`,
    )
  }
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
          reportHostWake={reportHostWake}
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
