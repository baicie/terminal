import type {
  TerminalSmokeConfig,
  TerminalSmokeHostWakeReporter,
  TerminalSmokeResult,
  TerminalSmokeStaleOutputProbe,
} from './terminal-smoke-contract'

export interface UseTerminalSmokeRoundOptions {
  applicationStartedAt: number
  config: TerminalSmokeConfig
  roundIndex: number
  signal: AbortSignal
  reportConnected: () => Promise<number>
  reportReconnect: () => Promise<void>
  reportHostWake?: TerminalSmokeHostWakeReporter
  emitStaleOutput: (
    retiredSessionId: string,
    activeSessionId: string,
  ) => Promise<TerminalSmokeStaleOutputProbe>
  onComplete: (
    roundIndex: number,
    tabId: string,
    sessionIds: string[],
    result: TerminalSmokeResult,
  ) => void
}
