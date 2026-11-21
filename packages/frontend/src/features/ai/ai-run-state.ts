/**
 * One AI run at a time per dock, with every way it can end accounted for.
 *
 * ## The states and why each exists
 *
 * `idle → preparing → awaiting-context → running → streaming → completed`, plus
 * `cancelling`, `cancelled` and `failed`. `awaiting-context` is separate from
 * `preparing` because the user has a decision to make there (approve the text or
 * not) and the UI must not look busy while it waits.
 *
 * ## The three things this module refuses to do
 *
 * 1. **Accept a late chunk from a dead run.** Every transition is keyed by `runId`;
 *    a chunk arriving after a cancel or a new run carries a stale id and is dropped,
 *    not appended. This is what stops "the answer to my previous question" appearing
 *    under the current one.
 * 2. **Let a result land in a different session.** A run records the session it was
 *    started for; a result whose session no longer matches the visible one is
 *    surfaced as stale rather than shown as if it described the new host.
 * 3. **Auto-execute anything.** A `DraftCommand` result is a string plus metadata.
 *    Nothing in this module writes to a shell, and there is no call that could.
 *
 * ## Why the reducer is a pure function
 *
 * Every transition is testable without a network, a timer or a component. The parts
 * that touch the world — starting a request, cancelling one — are separate and thin.
 */

/** What the user asked for. */
export const AI_ACTIONS = [
  'explain-selection',
  'explain-error',
  'summarize-output',
  'draft-command',
] as const

export type AiAction = (typeof AI_ACTIONS)[number]

export type AiRunStatus =
  | 'idle'
  | 'preparing'
  | 'awaiting-context'
  | 'running'
  | 'streaming'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed'

/** A failure the UI can act on, rather than a string to parse. */
export type AiFailureKind =
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'timeout'
  | 'offline'
  | 'bad-response'
  | 'no-profile'
  | 'profile-unusable'
  | 'context-not-approved'
  | 'context-changed'
  | 'context-too-large'
  | 'cancelled'
  /** The stored key exists but could not be read: unlock the vault, or re-save it. */
  | 'key-unreadable'
  /** This build was compiled without the `ai` feature. */
  | 'feature-disabled'
  /** A run with this request id is already in flight. */
  | 'busy'
  /**
   * The stream ended without the provider's completion signal.
   *
   * Distinct from `bad-response`: the answer arrived but stopped, so what is on screen
   * is worth reading and is not the whole thing. Collapsing the two would tell a user
   * whose answer was cut off that nothing usable arrived, and losing the partial text
   * over a missing sentinel is worse than showing it with a warning.
   */
  | 'incomplete'

export interface AiFailure {
  kind: AiFailureKind
  /** A sentence for the user. Never contains the API key or the raw body. */
  message: string
  /** Set for `rate-limited` when the server said how long to wait. */
  retryAfterMs?: number
}

export interface AiRun {
  /** Identity for this attempt. A chunk for any other id is dropped. */
  runId: string
  action: AiAction
  /** The session the user started the run for. Results are bound to it. */
  sessionId: string | null
  hostId: string | null
  status: AiRunStatus
  /** Accumulated output. Appended only for the current runId. */
  text: string
  failure: AiFailure | null
  /** Whether any chunk arrived — distinguishes "no stream yet" from "empty answer". */
  receivedChunk: boolean
  /** True when the result was produced for a session that is no longer visible. */
  stale: boolean
}

export type AiEvent =
  | { type: 'prepare'; runId: string; action: AiAction; sessionId: string | null, hostId: string | null }
  | { type: 'await-context'; runId: string }
  | { type: 'start'; runId: string }
  | { type: 'chunk'; runId: string; text: string }
  | { type: 'complete'; runId: string }
  | { type: 'cancel'; runId: string }
  | { type: 'cancelled'; runId: string }
  | { type: 'fail'; runId: string; failure: AiFailure }
  | { type: 'session-changed'; visibleSessionId: string | null }
  | { type: 'reset' }

export function idleRun(): AiRun {
  return {
    runId: '',
    action: 'explain-selection',
    sessionId: null,
    hostId: null,
    status: 'idle',
    text: '',
    failure: null,
    receivedChunk: false,
    stale: false,
  }
}

/** Errors that mean "stop and tell the user", never "retry silently". */
export function isTerminalFailure(kind: AiFailureKind): boolean {
  // `key-unreadable` and `feature-disabled` are user actions, not transient network
  // conditions: retrying the same request produces the same answer.
  if (kind === 'key-unreadable' || kind === 'feature-disabled') return true
  return kind !== 'rate-limited' && kind !== 'offline' && kind !== 'timeout'
}

/**
 * The reducer.
 *
 * Every event that carries a `runId` is checked against the current one. A mismatch
 * is a no-op — that is the late-chunk rule, and it lives here rather than in each
 * caller so it cannot be forgotten in one of them.
 */
export function reduceRun(state: AiRun, event: AiEvent): AiRun {
  if (event.type === 'reset') return idleRun()

  if (event.type === 'session-changed') {
    // A run whose session is no longer visible keeps its text — the user may still
    // want to read it — but is marked stale so the UI can say which host produced it
    // instead of presenting it as the current one's.
    if (state.status === 'idle' || state.sessionId === null) return state
    const stale = state.sessionId !== event.visibleSessionId
    return stale === state.stale ? state : { ...state, stale }
  }

  if (event.type === 'prepare') {
    // A new run replaces the old one entirely. Anything still streaming is abandoned
    // by virtue of its runId no longer matching.
    return {
      runId: event.runId,
      action: event.action,
      sessionId: event.sessionId,
      hostId: event.hostId,
      status: 'preparing',
      text: '',
      failure: null,
      receivedChunk: false,
      stale: false,
    }
  }

  // Everything below applies only to the current run.
  if (event.runId !== state.runId) return state

  switch (event.type) {
    case 'await-context':
      return state.status === 'preparing' || state.status === 'running'
        ? { ...state, status: 'awaiting-context' }
        : state

    case 'start':
      // Only from a state where starting means something. A second `start` for the
      // same run must not clear text that already arrived.
      return state.status === 'preparing' || state.status === 'awaiting-context'
        ? { ...state, status: 'running', failure: null }
        : state

    case 'chunk':
      // A chunk arriving after cancel is dropped, which is the point of the status
      // check: the server may keep sending after we stop listening.
      if (state.status !== 'running' && state.status !== 'streaming') return state
      return {
        ...state,
        status: 'streaming',
        text: state.text + event.text,
        receivedChunk: true,
      }

    case 'complete':
      if (state.status !== 'running' && state.status !== 'streaming') return state
      return { ...state, status: 'completed' }

    case 'cancel':
      if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
        return state
      }
      return { ...state, status: 'cancelling' }

    case 'cancelled':
      if (state.status !== 'cancelling') return state
      return { ...state, status: 'cancelled' }

    case 'fail':
      // A failure after completion is not a failure of this run.
      if (state.status === 'completed' || state.status === 'cancelled') return state
      return { ...state, status: 'failed', failure: event.failure }

    default:
      return state
  }
}

/** Can a new run start? `cancelling` is deliberately excluded — wait for it. */
export function canStartRun(state: AiRun): boolean {
  return state.status === 'idle' || state.status === 'completed' || state.status === 'cancelled' || state.status === 'failed'
}

/** Should the UI show a Cancel control? */
export function isRunning(state: AiRun): boolean {
  return state.status === 'running' || state.status === 'streaming' || state.status === 'cancelling'
}
