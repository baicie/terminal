/**
 * Running one AI request: the glue between the contracts.
 *
 * ## Where the request actually goes now
 *
 * It goes to Rust. This class keeps the checks that are about the *user's intent* —
 * a context they approved, a text that has not changed since, a session they have not
 * left, one run at a time — and hands the approved text across the IPC boundary.
 * Everything that touches the network or the key (endpoint validation against the
 * stored row, the vault read, the HTTP request, the SSE parse, the timeout) is on the
 * other side, in `src-tauri/src/ai/`.
 *
 * The pre-flight checks here are not the security boundary and are not presented as
 * one: the backend repeats every one of them on the values it re-reads from the
 * profile row. What they buy is a refusal that names the one thing the user has to do
 * ("review the text again") without a round trip.
 *
 * ## What it never does
 *
 * Write to a terminal. A `draft-command` result is text. And: hold an API key. There
 * is no `readKey` in the dependencies any more — the caller cannot supply one, which
 * is a stronger guarantee than a comment saying not to.
 */

import {
  canStartRun,
  idleRun,
  reduceRun,
  type AiAction,
  type AiFailure,
  type AiRun,
} from './ai-run-state'
import {
  contextMatchesSession,
  contextStillApproved,
  type ApprovedContext,
} from './context-review'
import { checkEndpoint, profileProblem, type ModelProfilePublic } from './model-profile'
import { RunIdIssuer } from './run-id-issuer'
import { contextForIpc, type AiBackendEvent, type AiGenerateOutcome } from './ai-ipc'

/** What the orchestration needs from the app, injected so it is testable. */
export interface AiRuntimeDeps {
  /** Send one request to the backend and stream its events. */
  generate(
    input: {
      requestId: string
      profileId: string
      action: AiAction
      context: ReturnType<typeof contextForIpc>
    },
    onEvent: (event: AiBackendEvent) => void,
  ): Promise<AiGenerateOutcome>
  /** Ask the backend to cancel one run. */
  cancel(requestId: string): Promise<unknown>
  /** The session the user can see, for the approval check. */
  visibleSessionId(): string | null
  /** The backend session behind the visible tab, when it has one. */
  visibleBackendSessionId?(): string | null
  /** Called with each new state so a component can render it. */
  onState(state: AiRun): void
  /** Monotonic ids, injected so tests are deterministic. */
  nextRunId(): string
}

/** The outcome of asking to start a run. */
export type StartRefusal =
  | 'no-profile'
  | 'profile-unusable'
  | 'context-not-approved'
  | 'context-changed'
  | 'session-changed'
  | 'run-in-progress'

export type StartResult = { ok: true; runId: string } | { ok: false; refusal: StartRefusal; message: string }

const REFUSAL_MESSAGES: Record<StartRefusal, string> = {
  'no-profile': 'Choose a model profile first.',
  'profile-unusable': 'That model profile cannot be used right now.',
  'context-not-approved': 'Review and approve the text before sending it.',
  'context-changed': 'The text changed after you approved it. Review it again.',
  'session-changed': 'You switched sessions. Re-select the text in this one.',
  'run-in-progress': 'A request is already running. Cancel it or wait.',
}

/**
 * The orchestrator.
 *
 * Holds no state of its own beyond the current run: the reducer owns it, and this
 * class exists to sequence the checks and translate backend events into reducer
 * events.
 */
export class AiRunner {
  private state: AiRun = idleRun()
  private currentRunId: string | null = null
  /** Unique request ids; see `run-id-issuer.ts` for why the caller's are not enough. */
  private readonly runIds = new RunIdIssuer()
  private readonly listeners = new Set<(state: AiRun) => void>()

  constructor(private readonly deps: AiRuntimeDeps) {}

  current(): AiRun {
    return this.state
  }

  /**
   * Subscribe to state changes.
   *
   * A component needs to re-render when a chunk arrives, and polling would either lag
   * or make the dock re-render on a timer for no reason. Returns an unsubscribe;
   * `deps.onState` remains the app-level hook, so both see every transition.
   */
  subscribe(listener: (state: AiRun) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Start a run.
   *
   * All the refusals happen before the IPC call, and each names the one thing the
   * user has to do — "review the text again" is actionable; "the request failed" is
   * not. The backend re-checks the same rules against the stored profile, so a
   * refusal here is a courtesy, never the guarantee.
   */
  async start(input: {
    action: AiAction
    profile: ModelProfilePublic
    context: ApprovedContext
  }): Promise<StartResult> {
    if (!canStartRun(this.state)) {
      return this.refuse('run-in-progress')
    }
    const problem = profileProblem(input.profile)
    if (problem) return this.refuse('profile-unusable', problem)
    if (!input.context.approved) return this.refuse('context-not-approved')
    if (!contextStillApproved(input.context)) return this.refuse('context-changed')
    if (
      !contextMatchesSession(
        input.context,
        this.deps.visibleSessionId(),
        this.deps.visibleBackendSessionId?.() ?? null,
      )
    ) {
      return this.refuse('session-changed')
    }
    // The endpoint was validated when the profile was saved, but re-checking here is
    // what keeps a profile edited in another window from becoming a cleartext send.
    if (!checkEndpoint(input.profile.endpoint).ok) {
      return this.refuse('profile-unusable', 'That endpoint is not allowed.')
    }

    const runId = this.runIds.next(this.deps.nextRunId())
    this.currentRunId = runId
    this.transition({
      type: 'prepare',
      runId,
      action: input.action,
      sessionId: input.context.sessionId,
      hostId: input.context.hostId,
    })

    const ipcContext = contextForIpc(input.context)
    this.transition({ type: 'start', runId })

    // Not awaited: the caller gets the run id immediately and observes progress
    // through `onState`. Waiting here would make the UI block for the whole answer.
    void this.pump(
      runId,
      {
        requestId: runId,
        profileId: input.profile.id,
        action: input.action,
        context: ipcContext,
      },
    )
    return { ok: true, runId }
  }

  /** Cancel the current run. Idempotent, and a no-op when nothing is running. */
  cancel(): void {
    if (!this.state.runId) return
    // The backend holds the flag, so the rejection here is not ours to interpret:
    // a run that already finished has nothing to cancel, and the stream's own
    // terminal event is what moves the state.
    void this.deps.cancel(this.state.runId).catch(() => undefined)
    this.transition({ type: 'cancel', runId: this.state.runId })
  }

  /** Tell the runner the visible session changed, so a result can be marked stale. */
  sessionChanged(visibleSessionId: string | null): void {
    this.transition({ type: 'session-changed', visibleSessionId })
  }

  /** Clear the current run. */
  reset(): void {
    this.transition({ type: 'reset' })
  }

  private async pump(
    runId: string,
    request: Parameters<AiRuntimeDeps['generate']>[0],
  ): Promise<void> {
    try {
      const outcome = await this.deps.generate(request, event => {
        // Every event goes through the reducer, which is what applies the late-chunk
        // rule on the real path rather than only in a test.
        this.applyBackendEvent(runId, event)
      })
      // A refusal never reached a socket. The state machine shows it as a failure of
      // this run, with the backend's sentence, so the dock has one thing to render.
      if (!outcome.sent && outcome.failure && this.state.runId === runId) {
        const status = this.state.status
        if (status === 'running' || status === 'streaming' || status === 'cancelling') {
          this.transition({ type: 'fail', runId, failure: outcome.failure })
        }
      }
    } catch (error) {
      if (this.state.runId === runId) {
        this.transition({
          type: 'fail',
          runId,
          failure: {
            kind: 'bad-response',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }
    } finally {
      if (this.state.runId === runId && this.state.status === 'cancelling') {
        // The stream closed after a cancel: acknowledge it so the UI stops showing
        // "cancelling" forever.
        this.transition({ type: 'cancelled', runId })
      }
      if (this.currentRunId === runId) this.currentRunId = null
    }
  }

  /** Translate one backend event into a reducer event. */
  private applyBackendEvent(runId: string, event: AiBackendEvent): void {
    if (event.type === 'chunk') {
      this.transition({ type: 'chunk', runId, text: event.text })
      return
    }
    if (event.type === 'done') {
      this.transition({ type: 'complete', runId })
      return
    }
    const failure: AiFailure = event.failure
    if (failure.kind === 'cancelled') {
      // The reducer only accepts the acknowledgement from `cancelling` — a rule that
      // exists so "cancelled" is never shown while chunks may still arrive. The
      // backend can be the one that ends the run though (its own cancel flag, or a
      // stop request from another surface), so record the cancel first rather than
      // dropping the event and leaving the dock streaming forever.
      if (this.state.runId === runId && !this.isCancelling()) {
        this.transition({ type: 'cancel', runId })
      }
      this.transition({ type: 'cancelled', runId })
    } else {
      this.transition({ type: 'fail', runId, failure })
    }
  }

  private isCancelling(): boolean {
    return this.state.status === 'cancelling'
  }

  private transition(event: Parameters<typeof reduceRun>[1]): void {    const next = reduceRun(this.state, event)
    if (next === this.state) return
    this.state = next
    this.deps.onState(next)
    for (const listener of this.listeners) {
      // One broken subscriber must not stop the others or the run itself.
      try {
        listener(next)
      } catch {
        // Ignored deliberately.
      }
    }
  }

  private refuse(refusal: StartRefusal, message?: string): StartResult {
    return { ok: false, refusal, message: message ?? REFUSAL_MESSAGES[refusal] }
  }
}

/** A failure the UI can render without inventing one. */
export function failureForRefusal(refusal: StartRefusal): AiFailure {
  return { kind: 'no-profile', message: REFUSAL_MESSAGES[refusal] }
}
