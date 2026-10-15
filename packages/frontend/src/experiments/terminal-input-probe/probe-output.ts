import type { RefObject } from 'react'
import {
  createTerminalInputProbeCommand,
  type TerminalInputProbeParser,
} from './probe-protocol'
import {
  consumeTerminalInputProbeEvent,
  type TerminalInputProbeState,
} from './probe-state'
import {
  publishInputProbeReady,
  publishInputProbeResult,
  publishInputProbeDiag,
  type InputProbeAutomationConfig,
} from './probe-automation'

interface ProbeOutputContext {
  parserRef: RefObject<TerminalInputProbeParser | null>
  finishedRef: RefObject<boolean>
  stateRef: RefObject<TerminalInputProbeState>
  writeRef: RefObject<(data: string) => void>
  nonceRef: RefObject<string>
  config: InputProbeAutomationConfig
  startedAt: number
  publishFailure: (message: string) => void
}

export function consumeProbeOutput(
  data: string,
  {
    parserRef,
    finishedRef,
    stateRef,
    writeRef,
    nonceRef,
    config,
    startedAt,
    publishFailure,
  }: ProbeOutputContext,
): void {
  const parser = parserRef.current
  if (!parser || finishedRef.current) return
  try {
    for (const protocolEvent of parser.push(data)) {
      const next = consumeTerminalInputProbeEvent(
        stateRef.current,
        protocolEvent,
      )
      stateRef.current = next
      if (next.phase === 'awaiting-input') {
        void publishInputProbeReady(next.currentRound).catch(() => {
          publishFailure(
            'Failed to publish the terminal input probe checkpoint',
          )
        })
      }
      if (next.phase === 'waiting-ready') {
        window.setTimeout(() => {
          if (stateRef.current.phase === 'waiting-ready') {
            writeRef.current(
              `${createTerminalInputProbeCommand(nonceRef.current)}\r`,
            )
          }
        }, 0)
      }
      if (next.phase === 'complete' && !finishedRef.current) {
        finishedRef.current = true
        const state = stateRef.current
        const failedRounds = state.results
          .filter(result => !result.ok)
          .map(result => result.round)
        const ok = failedRounds.length === 0
        void publishInputProbeResult({
          ok,
          rounds: config.rounds,
          expectedText: config.expectedText,
          expectedHex: state.expectedHex,
          durationMs: Math.max(1, Math.ceil(performance.now() - startedAt)),
          results: state.results,
          error: ok
            ? null
            : `round(s) ${failedRounds.join(',')} received mismatched bytes`,
        }).catch(publishError => {
          console.error('Failed to publish terminal input probe result')
          void publishInputProbeDiag(
            `result-publish-failed: ${String(publishError)}`,
          ).catch(() => {})
        })
      }
      if (next.phase === 'error') {
        publishFailure(next.error ?? 'Terminal input probe protocol error')
      }
    }
  } catch (error) {
    publishFailure(error instanceof Error ? error.message : String(error))
  }
}
