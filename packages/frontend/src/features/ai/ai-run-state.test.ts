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

  it('keeps the partial text when the stream stopped without a completion signal', () => {
    /*
     * ## The distinction this pins
     *
     * `incomplete` and `bad-response` are both failures, and collapsing them would be
     * the easy thing to do. They are not the same event: `bad-response` means nothing
     * usable arrived, `incomplete` means the answer arrived and stopped.
     *
     * The Rust side used to report the second as `Done` (measured: a two-chunk stream
     * with no `[DONE]` produced `Chunk, Chunk, Done`). Now it fails with `Incomplete`,
     * and what matters on the frontend is that the chunks already delivered stay on
     * screen — a user reading a cut-off explanation is better served by the text plus a
     * warning than by an empty panel.
     */
    let state = reduceRun(started(), { type: 'start', runId: 'r1' })
    state = reduceRun(state, { type: 'chunk', runId: 'r1', text: 'It lists ' })
    state = reduceRun(state, { type: 'chunk', runId: 'r1', text: 'pods' })
    state = reduceRun(state, {
      type: 'fail', runId: 'r1',
      failure: { kind: 'incomplete', message: 'The provider stopped mid-answer.' },
    })

    expect(state.status).toBe('failed')
    expect(state.failure?.kind).toBe('incomplete')
    expect(
      state.text,
      'the text that did arrive must survive the failure that says it is unfinished',
    ).toBe('It lists pods')
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

/*
 * ## A 401 ends the run, and nothing restarts it
 *
 * The task asks for "401 → the UI does not retry". The module has a predicate for it,
 * `isTerminalFailure`, and a test that the predicate answers `true` for `unauthorized`.
 *
 * What no test asked — until this one — is whether anything **acts** on that answer.
 * `grep -rn isTerminalFailure packages/frontend/src` returns the definition and the
 * test file, and no production caller. The AI surface has no retry loop at all, so
 * "does not retry a 401" holds for a reason that has nothing to do with the predicate:
 * it holds because nothing retries anything.
 *
 * That is worth pinning as two separate facts, because they can diverge:
 *
 *   1. the *state machine* never moves a failed run back to running on its own;
 *   2. the *predicate* would be the thing to consult if a retry loop were added.
 *
 * Only (1) is a property of today's product. (2) is a rule waiting for a consumer, and
 * saying so here is more useful than a comment claiming the behaviour is enforced.
 */
describe('a rejected API key ends the run', () => {
  const rejected = { kind: 'unauthorized' as const, message: 'The API key was rejected.' }

  it('leaves the run failed and does not restart it', () => {
    let state = reduceRun(started(), { type: 'fail', runId: 'r1', failure: rejected })
    expect(state.status).toBe('failed')

    /*
     * No event in the vocabulary moves `failed` back to a running state except a
     * deliberate new `prepare`, which is a user action (`canStartRun` gates it).
     * Feeding every other event is the check: none of them revive the run.
     */
    for (const event of [
      { type: 'start', runId: 'r1' } as const,
      { type: 'chunk', runId: 'r1', text: 'late' } as const,
      { type: 'complete', runId: 'r1' } as const,
    ]) {
      state = reduceRun(state, event)
      expect(state.status, `event ${event.type} revived a failed run`).toBe('failed')
    }
    expect(state.failure).toMatchObject({ kind: 'unauthorized' })
  })

  it('only a user-initiated start can begin again', () => {
    // `canStartRun` is the gate the runtime consults before accepting a new request.
    // It answers "yes" for a failed run — that is the *user* retrying, which is the
    // behaviour we want, and it is a different thing from an automatic retry.
    const failed = reduceRun(started(), { type: 'fail', runId: 'r1', failure: rejected })
    expect(canStartRun(failed)).toBe(true)
    expect(canStartRun({ ...failed, status: 'running' })).toBe(false)
  })

  it('the predicate agrees, for whoever wires a retry loop next', () => {
    expect(isTerminalFailure('unauthorized')).toBe(true)
    expect(isTerminalFailure('rate-limited')).toBe(false)
  })
})
