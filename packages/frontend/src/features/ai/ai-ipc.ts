/**
 * The renderer's side of the AI IPC boundary.
 *
 * ## What changed, and what it buys
 *
 * Before this module the dock held the API key: `getProfileSecret` read it from the
 * vault into JavaScript and handed it to a `fetch`. The design (§4) says the renderer
 * must never see a key, so the transport moved to Rust and this file is what is left
 * — `invoke`, a channel of events, and nothing secret.
 *
 * Note what is **not** in the request: endpoint, model, limits, key. They are read
 * from the stored profile on the backend, so a request cannot carry a value that
 * differs from what Settings last wrote. `profileId` is the only reference.
 *
 * ## Why a missing command is a state, not a thrown error
 *
 * A build compiled without the `ai` feature has no `ai_generate` command at all. Tauri
 * rejects the invoke with a message about an unknown command. Reporting that as "AI
 * is not enabled in this build" is truthful and actionable; letting the rejection
 * surface as "error while invoking" is not.
 */

import { Channel, invoke } from '@tauri-apps/api/core'
import type { AiAction, AiFailure } from './ai-run-state'
import type { ApprovedContext } from './context-review'

/** A profile as the backend reports it: public fields only. */
export interface AiProfilePublic {
  id: string
  provider: string
  endpoint: string
  modelId: string
  temperature: number | null
  maxOutputTokens: number
  timeoutMs: number
  streaming: boolean
  enabled: boolean
  /** Whether a key is stored — answered without reading it. */
  hasKey: boolean
}

/** One event from the backend transport. */
export type AiBackendEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'failed'; failure: AiFailure }

/** What the backend says when a run ended. */
export interface AiGenerateOutcome {
  /** False when the run was refused before a socket opened. */
  sent: boolean
  failure?: AiFailure
}

/** The text the user approved, plus the digest they approved. */
export interface ApprovedContextForIpc {
  text: string
  contentSha256: string
  approved: boolean
}

/** True when the running binary has no AI transport. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiUnavailableError'
  }
}

/**
 * Is this a rejection caused by the command not existing?
 *
 * Tauri's wording for an unknown command has varied across versions, so the check is
 * on the distinguishing substring rather than an exact sentence. A real failure from
 * our own handler never contains it: our messages are the `AiFailure` sentences.
 */
function isUnknownCommand(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return /not found|unknown command|not allowed|does not exist/i.test(text)
}

function toUnavailable(error: unknown): AiUnavailableError | null {
  if (error instanceof AiUnavailableError) return error
  if (!isUnknownCommand(error)) return null
  return new AiUnavailableError('AI is not enabled in this build of the app.')
}

/** Every configured profile, or `[]` when this build has no AI. */
export async function listProfiles(): Promise<AiProfilePublic[]> {
  try {
    return await invoke<AiProfilePublic[]>('ai_profiles_list')
  } catch (error) {
    const unavailable = toUnavailable(error)
    if (unavailable) return []
    throw error
  }
}

/** Is this build capable, and is a profile configured? */
export async function isAvailable(): Promise<boolean> {
  try {
    return await invoke<boolean>('ai_available')
  } catch (error) {
    if (toUnavailable(error)) return false
    throw error
  }
}

/**
 * Cancel one run.
 *
 * Returns whether the backend had a run under that id. A `false` for a run that has
 * already finished is a no-op, not a failure: the user's Cancel and the stream's last
 * chunk can cross.
 */
export async function cancelRun(requestId: string): Promise<boolean> {
  try {
    return await invoke<boolean>('ai_cancel', { requestId })
  } catch (error) {
    // A build without AI cannot have a run in flight, so "nothing to cancel" is the
    // honest answer rather than an error the dock has to render.
    if (toUnavailable(error)) return false
    throw error
  }
}

/** What `generate` needs. Deliberately no endpoint, model, limits or key. */
export interface GenerateInput {
  requestId: string
  profileId: string
  action: AiAction
  context: ApprovedContextForIpc
}

/**
 * Start one run. `onEvent` is called for every streamed chunk.
 *
 * The returned promise resolves when the run is over; chunks arrive through the
 * channel while it is in flight. A refusal resolves with `sent: false` rather than
 * rejecting — a refusal is a normal outcome the dock renders, not an exception.
 */
export async function generate(
  input: GenerateInput,
  onEvent: (event: AiBackendEvent) => void,
): Promise<AiGenerateOutcome> {
  const channel = new Channel<AiBackendEvent>()
  channel.onmessage = onEvent
  try {
    return await invoke<AiGenerateOutcome>('ai_generate', {
      request: {
        requestId: input.requestId,
        profileId: input.profileId,
        action: input.action,
        context: input.context,
      },
      onEvent: channel,
    })
  } catch (error) {
    const unavailable = toUnavailable(error)
    if (unavailable) {
      return {
        sent: false,
        failure: {
          kind: 'feature-disabled',
          message: unavailable.message,
        },
      }
    }
    throw error
  }
}

/** Build the context payload the backend expects, from an approved context. */
export function contextForIpc(context: ApprovedContext): ApprovedContextForIpc {
  return {
    text: context.text,
    contentSha256: context.contentSha256,
    approved: context.approved,
  }
}
