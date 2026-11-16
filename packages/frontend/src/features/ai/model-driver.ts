/**
 * The one thing that talks to a model.
 *
 * ## Why an interface and not a direct `fetch`
 *
 * Every rule in this feature — what may be sent, when a run is cancelled, what a
 * failure means — is decided by code that must not depend on a network. So the network
 * lives behind this interface, and the reducer, the context builder and the prompt
 * builder are all testable without one. The HTTP implementation is one file; a test
 * double is another.
 *
 * ## The contract a driver must keep
 *
 * - **Never see the key.** The driver receives an already-resolved `apiKey` and must
 *   not log, echo or store it. It is passed as an argument rather than read from a
 *   provider so the driver has no way to fetch a *different* secret.
 * - **Honour cancellation promptly.** A cancelled request must stop reading the body;
 *   a driver that finishes "because it was almost done" keeps a token bill alive for
 *   an answer nobody will read.
 * - **Report failures structurally.** `AiFailureKind` exists so the UI does not parse
 *   English, and so `rate-limited` is distinguishable from `unauthorized` — one is
 *   retryable, the other is not.
 * - **Never surface the raw body on failure.** A provider error can echo the request,
 *   and the request contains the user's terminal text. The message is ours.
 */

import type { AiAction, AiFailure, AiFailureKind } from './ai-run-state'
import type { ApprovedContext } from './context-review'
import type { ChatMessage } from './ai-prompt'

/** Everything a driver needs for one request. Never persisted, never logged. */
export interface DriverRequest {
  requestId: string
  profileId: string
  endpoint: string
  modelId: string
  temperature: number | null
  maxOutputTokens: number
  timeoutMs: number
  streaming: boolean
  /** Resolved at the moment of the call. The driver never caches it. */
  apiKey: string | null
  action: AiAction
  context: ApprovedContext
  messages: ChatMessage[]
}

/** One event from a driver. A stream is a sequence of these. */
export type DriverEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'failed'; failure: AiFailure }

/** What the driver is given to observe cancellation. */
export interface CancelSignal {
  readonly cancelled: boolean
  /** Resolves when cancellation happens. Never rejects. */
  whenCancelled(): Promise<void>
}

/**
 * A driver. One per provider family; the registry picks by `provider`.
 *
 * `stream` is async-iterable so a caller can `for await` over events and stop by
 * breaking — which is also how cancellation stops a stream that has already started.
 */
export interface ModelDriver {
  readonly provider: string
  test(request: DriverRequest, cancel: CancelSignal): Promise<{ ok: true } | { ok: false; failure: AiFailure }>
  stream(request: DriverRequest, cancel: CancelSignal): AsyncIterable<DriverEvent>
}

/** Map an HTTP status onto a failure kind. Kept pure and shared. */
export function failureForStatus(status: number, retryAfterMs?: number): AiFailure {
  const kind: AiFailureKind =
    status === 401 ? 'unauthorized'
      : status === 403 ? 'forbidden'
        : status === 429 ? 'rate-limited'
          : status === 408 || status === 504 ? 'timeout'
            : status >= 500 ? 'offline'
              : 'bad-response'
  return {
    kind,
    message: messageForStatus(kind),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  }
}

/** Our sentence for a failure kind. Never a provider's body. */
export function messageForStatus(kind: AiFailureKind): string {
  switch (kind) {
    case 'unauthorized':
      return 'The API key was rejected. Check the key for this model profile.'
    case 'forbidden':
      return 'This key is not allowed to use this model.'
    case 'rate-limited':
      return 'The provider is rate limiting this key. Try again shortly.'
    case 'timeout':
      return 'The model did not answer in time.'
    case 'offline':
      return 'The provider could not be reached.'
    case 'no-profile':
      return 'No usable model profile is selected.'
    case 'context-changed':
      return 'The text changed after you approved it. Review it again before sending.'
    case 'context-too-large':
      return 'That selection is too large to send.'
    case 'cancelled':
      return 'Cancelled.'
    case 'bad-response':
      return 'The provider returned a response this app could not read.'
  }
}

/** Parse a `Retry-After` header into milliseconds, tolerating both forms. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  // HTTP-date form
  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return undefined
}
