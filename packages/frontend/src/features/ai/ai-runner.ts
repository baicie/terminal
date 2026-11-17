/**
 * Running one AI request: the glue between the contracts.
 *
 * Every rule it enforces was established by a module that tests it in isolation; this
 * file is where they meet, and it is deliberately thin. It:
 *
 * 1. refuses a context the user has not approved, or one whose text changed since
 *    approval, or one bound to a session the user has left;
 * 2. resolves the profile's key at the moment of the call and refuses if the profile
 *    is unusable;
 * 3. builds the delimited payload;
 * 4. streams the driver's events through the reducer, so the late-chunk rule holds on
 *    the real path and not only in a test;
 * 5. cancels by tripping a signal, and reports the cancellation as its own state.
 *
 * What it never does: write to a terminal. A `draft-command` result is text.
 */

import {
  canStartRun,
  idleRun,
  reduceRun,
  type AiAction,
  type AiFailure,
  type AiRun,
} from './ai-run-state'
import { buildRequestPayload } from './ai-prompt'
import { contextMatchesSession, contextStillApproved, type ApprovedContext } from './context-review'
import {
  checkEndpoint,
  profileProblem,
  type AiProvider,
  type ModelProfilePublic,
} from './model-profile'
import type { CancelSignal, DriverRequest, ModelDriver } from './model-driver'
import { OpenAiCompatibleDriver } from './openai-compatible-driver'

/** What the orchestration needs from the app, injected so it is testable. */
export interface AiRuntimeDeps {
  /** The driver for a provider family. */
  driverFor(provider: AiProvider): ModelDriver | undefined
  /** Read a profile's key. Throws when a *stored* key cannot be read. */
  readKey(profileId: string): Promise<string | undefined>
  /** The session the user can see, for the approval check. */
  visibleSessionId(): string | null
  /** Called with each new state so a component can render it. */
  onState(state: AiRun): void
  /** Monotonic ids, injected so tests are deterministic. */
  nextRunId(): string
  /** One-shot cancellation token per run. */
  createSignal(): CancelSignal & { cancel(): void }
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
 * class exists to sequence the checks and translate driver events into reducer events.
 */
export class AiRunner {
  private state: AiRun = idleRun()
  private signal: (CancelSignal & { cancel(): void }) | null = null
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
   * All the refusals happen before a single byte is sent, and each names the one thing
   * the user has to do — "review the text again" is actionable; "the request failed"
   * is not.
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
    if (!contextMatchesSession(input.context, this.deps.visibleSessionId())) {
      return this.refuse('session-changed')
    }
    // The endpoint was validated when the profile was saved, but re-checking here is
    // what keeps a profile edited in another window from becoming a cleartext send.
    if (!checkEndpoint(input.profile.endpoint).ok) {
      return this.refuse('profile-unusable', 'That endpoint is not allowed.')
    }

    const driver = this.deps.driverFor(input.profile.provider)
    if (!driver) {
      return this.refuse('profile-unusable', 'No driver is available for that provider.')
    }

    const runId = this.deps.nextRunId()
    this.transition({
      type: 'prepare',
      runId,
      action: input.action,
      sessionId: input.context.sessionId,
      hostId: input.context.hostId,
    })

    let apiKey: string | undefined
    try {
      apiKey = await this.deps.readKey(input.profile.id)
    } catch (error) {
      // A key that exists but cannot be read is a provider problem, not a missing
      // key. Reporting it as "no key" would send the user to re-enter one.
      this.transition({
        type: 'fail',
        runId,
        failure: {
          kind: 'unauthorized',
          message: error instanceof Error ? error.message : String(error),
        },
      })
      return { ok: true, runId }
    }

    const payload = buildRequestPayload(input.action, input.context.text)
    const request: DriverRequest = {
      requestId: runId,
      profileId: input.profile.id,
      endpoint: input.profile.endpoint,
      modelId: input.profile.modelId,
      temperature: input.profile.temperature,
      maxOutputTokens: input.profile.maxOutputTokens,
      timeoutMs: input.profile.timeoutMs,
      streaming: input.profile.streaming,
      apiKey: apiKey ?? null,
      action: input.action,
      context: input.context,
      messages: payload.messages,
    }

    const signal = this.deps.createSignal()
    this.signal = signal
    this.transition({ type: 'start', runId })

    // Not awaited: the caller gets the run id immediately and observes progress
    // through `onState`. Waiting here would make the UI block for the whole answer.
    void this.pump(runId, driver, request, signal)
    return { ok: true, runId }
  }

  /** Cancel the current run. Idempotent, and a no-op when nothing is running. */
  cancel(): void {
    if (!this.state.runId) return
    this.signal?.cancel()
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
    driver: ModelDriver,
    request: DriverRequest,
    signal: CancelSignal,
  ): Promise<void> {
    try {
      for await (const event of driver.stream(request, signal)) {
        // Every event goes through the reducer, which is what applies the late-chunk
        // rule on the real path rather than only in a test.
        if (event.type === 'chunk') {
          this.transition({ type: 'chunk', runId, text: event.text })
        } else if (event.type === 'done') {
          this.transition({ type: 'complete', runId })
        } else {
          if (event.failure.kind === 'cancelled') {
            this.transition({ type: 'cancelled', runId })
          } else {
            this.transition({ type: 'fail', runId, failure: event.failure })
          }
        }
      }
      // A stream that ended without `done` and without a failure: the reducer's state
      // decides whether that is a completion (it already got `done`) or an abrupt
      // close, which is reported rather than silently left running.
      if (this.state.runId === runId && (this.state.status === 'running' || this.state.status === 'streaming')) {
        this.transition({
          type: 'fail',
          runId,
          failure: { kind: 'bad-response', message: 'The response ended unexpectedly.' },
        })
      }
    } catch (error) {
      if (this.state.runId === runId) {
        this.transition({
          type: 'fail',
          runId,
          failure: {
            kind: signal.cancelled ? 'cancelled' : 'bad-response',
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
      this.signal = null
    }
  }

  private transition(event: Parameters<typeof reduceRun>[1]): void {
    const next = reduceRun(this.state, event)
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

/** The driver registry. One entry today; a second provider is a line here. */
export function driverRegistry(): Map<AiProvider, ModelDriver> {
  const registry = new Map<AiProvider, ModelDriver>()
  const openai = new OpenAiCompatibleDriver()
  // `local` speaks the same wire format, which is the whole reason one adapter covers
  // both. `anthropic` is declared in the profile type and has no driver yet, so
  // `driverFor` returns undefined and the run is refused rather than attempted.
  registry.set('openai-compatible', openai)
  registry.set('local', openai)
  return registry
}

/** A failure the UI can render without inventing one. */
export function failureForRefusal(refusal: StartRefusal): AiFailure {
  return { kind: 'no-profile', message: REFUSAL_MESSAGES[refusal] }
}
