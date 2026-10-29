import type { TerminalInputProbeEvent } from './probe-protocol'
import { encodeTerminalInputProbeText } from './probe-protocol'

export type TerminalInputProbePhase =
  | 'idle'
  | 'waiting-ready'
  | 'awaiting-input'
  | 'complete'
  | 'error'

export interface TerminalInputProbeRoundResult {
  round: number
  expectedHex: string
  receivedHex: string
  ok: boolean
}

export interface TerminalInputProbeState {
  phase: TerminalInputProbePhase
  rounds: number
  expectedText: string
  expectedHex: string
  currentRound: number
  results: TerminalInputProbeRoundResult[]
  error: string | null
}

export function createTerminalInputProbeState(
  rounds: number,
  expectedText: string,
): TerminalInputProbeState {
  const boundedRounds = Number.isSafeInteger(rounds)
    ? Math.min(100, Math.max(1, rounds))
    : 1
  return {
    phase: 'idle',
    rounds: boundedRounds,
    expectedText,
    expectedHex: encodeTerminalInputProbeText(expectedText),
    currentRound: 0,
    results: [],
    error: null,
  }
}

export function beginTerminalInputProbe(
  state: TerminalInputProbeState,
): TerminalInputProbeState {
  return {
    ...state,
    phase: 'waiting-ready',
    currentRound: 1,
    results: [],
    error: null,
  }
}

export function consumeTerminalInputProbeEvent(
  state: TerminalInputProbeState,
  event: TerminalInputProbeEvent,
): TerminalInputProbeState {
  if (state.phase === 'error' || state.phase === 'complete') return state

  if (event.kind === 'ready') {
    if (state.phase !== 'waiting-ready') {
      return probeError(state, 'Received a ready marker before the next round')
    }
    return { ...state, phase: 'awaiting-input' }
  }

  if (state.phase !== 'awaiting-input') {
    return probeError(state, 'Received a result before the ready marker')
  }

  const result: TerminalInputProbeRoundResult = {
    round: state.currentRound,
    expectedHex: state.expectedHex,
    receivedHex: event.hex,
    ok: event.hex === state.expectedHex,
  }
  const results = [...state.results, result]
  const complete = results.length >= state.rounds
  return {
    ...state,
    phase: complete ? 'complete' : 'waiting-ready',
    currentRound: complete ? state.currentRound : state.currentRound + 1,
    results,
  }
}

function probeError(
  state: TerminalInputProbeState,
  error: string,
): TerminalInputProbeState {
  return { ...state, phase: 'error', error }
}
