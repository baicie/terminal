// The AI run state machine: every way a run can end, and the late-chunk rule.

import { describe, expect, it } from 'vitest'
import {
  canStartRun,
  idleRun,
  isRunning,
  isTerminalFailure,
  reduceRun,
  type AiRun,
} from './ai-run-state'

function started(runId = 'r1'): AiRun {
  let state = reduceRun(idleRun(), {
    type: 'prepare', runId, action: 'explain-selection', sessionId: 'tab-1', hostId: 'h-1',
  })
  state = reduceRun(state, { type: 'start', runId })
  return state
}

describe('a normal run', () => {
  it('goes prepare → start → chunk → complete', () => {
    let state = reduceRun(idleRun(), {
      type: 'prepare', runId: 'r1', action: 'explain-selection', sessionId: 'tab-1', hostId: 'h-1',
    })
    expect(state.status).toBe('preparing')
    state = reduceRun(state, { type: 'start', runId: 'r1' })
    expect(state.status).toBe('running')
    state = reduceRun(state, { type: 'chunk', runId: 'r1', text: 'This ' })
    expect(state.status).toBe('streaming')
    state = reduceRun(state, { type: 'chunk', runId: 'r1', text: 'runs ls.' })
    expect(state.text).toBe('This runs ls.')
    state = reduceRun(state, { type: 'complete', runId: 'r1' })
    expect(state.status).toBe('completed')
  })

  it('can complete without any chunk, and says so', () => {
    // "Completed with no text" is different from "still streaming" — the UI must be
    // able to show an empty answer rather than a spinner.
    const state = reduceRun(started(), { type: 'complete', runId: 'r1' })
    expect(state.status).toBe('completed')
    expect(state.receivedChunk).toBe(false)
  })

  it('allows a context-approval pause', () => {
    let state = reduceRun(idleRun(), {
      type: 'prepare', runId: 'r1', action: 'draft-command', sessionId: 'tab-1', hostId: null,
    })
    state = reduceRun(state, { type: 'await-context', runId: 'r1' })
    expect(state.status).toBe('awaiting-context')
    state = reduceRun(state, { type: 'start', runId: 'r1' })
    expect(state.status).toBe('running')
  })
})

describe('the late-chunk rule', () => {
  it('drops a chunk from a previous run', () => {
    // The failure this prevents: the answer to my last question appearing under the
    // current one.
    let state = started('r1')
    state = reduceRun(state, { type: 'chunk', runId: 'r1', text: 'old' })
    // A second run begins.
    state = reduceRun(state, {
      type: 'prepare', runId: 'r2', action: 'explain-error', sessionId: 'tab-1', hostId: null,
    })
    state = reduceRun(state, { type: 'start', runId: 'r2' })
    // r1's stream is still delivering.
    state = reduceRun(state, { type: 'chunk', runId: 'r1', text: ' STALE' })
    expect(state.text).toBe('')
    expect(state.runId).toBe('r2')
  })

  it('drops a chunk after a cancel', () => {
    let state = started()
    state = reduceRun(state, { type: 'chunk', runId: 'r1', text: 'partial' })
    state = reduceRun(state, { type: 'cancel', runId: 'r1' })
    expect(state.status).toBe('cancelling')
    // The server keeps sending; none of it is appended.
    state = reduceRun(state, { type: 'chunk', runId: 'r1', text: ' more' })
    expect(state.text).toBe('partial')
  })

  it('drops a completion from a previous run', () => {
    let state = started('r1')
    state = reduceRun(state, {
      type: 'prepare', runId: 'r2', action: 'explain-error', sessionId: null, hostId: null,
    })
    state = reduceRun(state, { type: 'start', runId: 'r2' })
    state = reduceRun(state, { type: 'complete', runId: 'r1' })
    expect(state.status).toBe('running')
  })
})

describe('cancel', () => {
  it('needs the acknowledgement to reach cancelled', () => {
    // `cancelling` until the stream actually closes: showing "cancelled" while chunks
    // may still arrive would be a lie about what the process is doing.
    let state = reduceRun(started(), { type: 'cancel', runId: 'r1' })
    expect(state.status).toBe('cancelling')
    expect(isRunning(state)).toBe(true)
    state = reduceRun(state, { type: 'cancelled', runId: 'r1' })
    expect(state.status).toBe('cancelled')
    expect(isRunning(state)).toBe(false)
  })

  it('cannot cancel a finished run', () => {
    const completed = reduceRun(started(), { type: 'complete', runId: 'r1' })
    expect(reduceRun(completed, { type: 'cancel', runId: 'r1' }).status).toBe('completed')
  })

  it('blocks starting a new run while cancelling', () => {
    const cancelling = reduceRun(started(), { type: 'cancel', runId: 'r1' })
    expect(canStartRun(cancelling)).toBe(false)
  })
})

describe('failure', () => {
  it('records a structured failure', () => {
    const state = reduceRun(started(), {
      type: 'fail', runId: 'r1',
      failure: { kind: 'unauthorized', message: 'The API key was rejected.' },
    })
    expect(state.status).toBe('failed')
    expect(state.failure).toMatchObject({ kind: 'unauthorized' })
  })

  it('does not fail a run that already completed', () => {
    // A late network error after the last chunk must not turn a good answer into a
    // failed one.
    let state = reduceRun(started(), { type: 'complete', runId: 'r1' })
    state = reduceRun(state, {
      type: 'fail', runId: 'r1', failure: { kind: 'offline', message: 'gone' },
    })
    expect(state.status).toBe('completed')
  })

  it('distinguishes retryable failures from terminal ones', () => {
    expect(isTerminalFailure('unauthorized')).toBe(true)
    expect(isTerminalFailure('forbidden')).toBe(true)
    expect(isTerminalFailure('context-changed')).toBe(true)
    expect(isTerminalFailure('rate-limited')).toBe(false)
    expect(isTerminalFailure('offline')).toBe(false)
    expect(isTerminalFailure('timeout')).toBe(false)
  })
})

describe('session changes', () => {
  it('marks a result stale when the user switched hosts', () => {
    // The design's rule: an old response must not be presented as the new session's.
    let state = started()
    state = reduceRun(state, { type: 'chunk', runId: 'r1', text: 'answer' })
    state = reduceRun(state, { type: 'session-changed', visibleSessionId: 'tab-2' })
    expect(state.stale).toBe(true)
    // The text is kept so the user can still read it; only its framing changes.
    expect(state.text).toBe('answer')
  })

  it('clears stale when the user returns to the original session', () => {
    let state = started()
    state = reduceRun(state, { type: 'session-changed', visibleSessionId: 'tab-2' })
    expect(state.stale).toBe(true)
    state = reduceRun(state, { type: 'session-changed', visibleSessionId: 'tab-1' })
    expect(state.stale).toBe(false)
  })

  it('does nothing to an idle run', () => {
    expect(reduceRun(idleRun(), { type: 'session-changed', visibleSessionId: 'tab-9' }).stale).toBe(false)
  })
})

describe('reset', () => {
  it('returns to idle from any state', () => {
    for (const state of [started(), reduceRun(started(), { type: 'cancel', runId: 'r1' })]) {
      expect(reduceRun(state, { type: 'reset' }).status).toBe('idle')
    }
  })
})
