import { describe, expect, it } from 'vitest'
import type { TerminalInputProbeEvent } from './probe-protocol'
import {
  beginTerminalInputProbe,
  consumeTerminalInputProbeEvent,
  createTerminalInputProbeState,
} from './probe-state'

describe('terminal input probe state', () => {
  it('requires a ready marker before accepting a round result', () => {
    const initial = createTerminalInputProbeState(2, 'asd')
    const started = beginTerminalInputProbe(initial)

    const premature = consumeTerminalInputProbeEvent(started, {
      kind: 'result',
      hex: '617364',
    })

    expect(premature.phase).toBe('error')
    expect(premature.error).toContain('before the ready marker')
  })

  it('advances through ready/result pairs and compares exact bytes', () => {
    let state = beginTerminalInputProbe(
      createTerminalInputProbeState(2, 'asd'),
    )

    const events: TerminalInputProbeEvent[] = [
      { kind: 'ready' },
      { kind: 'result', hex: '617364' },
      { kind: 'ready' },
      { kind: 'result', hex: '617364' },
    ]
    for (const event of events) {
      state = consumeTerminalInputProbeEvent(state, event)
    }

    expect(state.phase).toBe('complete')
    expect(state.results).toEqual([
      { round: 1, expectedHex: '617364', receivedHex: '617364', ok: true },
      { round: 2, expectedHex: '617364', receivedHex: '617364', ok: true },
    ])
  })

  it('keeps a failed round visible while allowing later rounds to be inspected', () => {
    let state = beginTerminalInputProbe(
      createTerminalInputProbeState(2, 'asd'),
    )

    for (const event of [
      { kind: 'ready' },
      { kind: 'result', hex: '61736400' },
      { kind: 'ready' },
      { kind: 'result', hex: '617364' },
    ] satisfies TerminalInputProbeEvent[]) {
      state = consumeTerminalInputProbeEvent(state, event)
    }

    expect(state.phase).toBe('complete')
    expect(state.results[0]?.ok).toBe(false)
    expect(state.results[1]?.ok).toBe(true)
    expect(state.results.filter(result => result.ok)).toHaveLength(1)
  })
})
