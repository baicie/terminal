// SSH19 — report the failure the ladder ended in, with the reason the user was given.
//
// ## Why this is its own hook
//
// It reads six fields off `useTerminal` and hands them to `onComplete`. Inline it pushed
// `use-terminal-smoke-round.ts` from 340 to 347 lines against a 300-line limit, and the
// alternative — trimming the explanation — would have deleted the part a reader needs.
//
// ## Why the fields come from the caller, not from this file
//
// `diagnosis`, `hop`, `stage` and `attempt` are the same values the terminal pane renders
// from (`useTerminal` → `TerminalSessionSnapshot` → the error overlay). Passing them
// through is what makes the reported reason evidence that the diagnosis survived
// Rust → IPC → classifier → record, rather than a sentence this file made up.
//
// A run whose terminal never reaches `error` never reports, and the harness deadline
// fails it — which is correct: the scenario's premise is that the connection cannot
// succeed.

import { useEffect, useRef } from 'react'
import type {
  TerminalSmokeConfig,
  TerminalSmokeResult,
} from './terminal-smoke-contract'
import { terminalSmokeFailure } from './terminal-smoke-results'

export interface TerminalSmokeFailureSignals {
  error: string | null
  diagnosis?: string
  hop?: string
  stage?: string
  attempt?: number
}

export function useTerminalSmokeFailureReport(args: {
  enabled: boolean
  status: string
  signals: TerminalSmokeFailureSignals
  cols: number
  rows: number
  startedAt: number
  config: TerminalSmokeConfig
  completed: boolean
  onComplete: (result: TerminalSmokeResult) => void
}) {
  const { enabled, status, signals, cols, rows, startedAt, config, completed } = args
  // The callback identity changes every render; the report must fire exactly once, so the
  // ref carries the latest one instead of making it a dependency.
  const onCompleteRef = useRef(args.onComplete)
  onCompleteRef.current = args.onComplete

  const { error, diagnosis, hop, stage, attempt } = signals

  useEffect(() => {
    if (!enabled) return
    if (status !== 'error' || completed) return
    onCompleteRef.current({
      ...terminalSmokeFailure(
        config,
        startedAt,
        'connecting',
        error ?? 'the connection failed without a message',
        {
          resourcesRecovered: true,
          roundsCompleted: 0,
          uniqueSessionCount: 0,
          terminalCols: cols,
          terminalRows: rows,
        },
      ),
      failureReason: {
        ...(typeof error === 'string' ? { message: error } : {}),
        ...(diagnosis === undefined ? {} : { diagnosis }),
        ...(hop === undefined ? {} : { hop }),
        ...(stage === undefined ? {} : { stage }),
        ...(attempt === undefined ? {} : { attempts: attempt }),
      },
    })
  }, [
    enabled,
    status,
    completed,
    error,
    diagnosis,
    hop,
    stage,
    attempt,
    cols,
    rows,
    startedAt,
    config,
  ])
}
