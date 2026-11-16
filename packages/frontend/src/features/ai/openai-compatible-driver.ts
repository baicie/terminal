/**
 * OpenAI-compatible chat completions over HTTP.
 *
 * Covers the provider family the design names (`openai-compatible`, `local`) because
 * they share one wire format. Not an SDK: one POST, one optional SSE stream, and a
 * mapping from status codes onto the app's failure vocabulary.
 *
 * ## What this file is careful about
 *
 * - **The key never appears in an error.** A provider's error body can echo the
 *   request, and the request carries the user's terminal text. Every failure uses our
 *   own sentence (`messageForStatus`), never the body.
 * - **Cancellation stops reading.** The stream loop checks the signal between chunks
 *   and breaks, which closes the reader and stops the transfer.
 * - **A bad chunk is skipped, not fatal.** Providers emit keep-alives and comments; an
 *   unparseable data line mid-stream is not a reason to discard the answer already
 *   received.
 * - **`[DONE]` ends the stream** without being treated as content.
 */

import type { AiFailure } from './ai-run-state'
import type { ChatMessage } from './ai-prompt'
import {
  failureForStatus,
  messageForStatus,
  parseRetryAfter,
  type CancelSignal,
  type DriverEvent,
  type DriverRequest,
  type ModelDriver,
} from './model-driver'

/** The subset of the response this adapter reads. Unknown fields are ignored. */
interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string | null }
    message?: { content?: string | null }
    finish_reason?: string | null
  }>
}

/** Build the request body. Exported so a test can assert its exact shape. */
export function buildRequestBody(
  request: Pick<DriverRequest, 'modelId' | 'messages' | 'maxOutputTokens' | 'streaming' | 'temperature'>,
): Record<string, unknown> {
  return {
    model: request.modelId,
    messages: request.messages,
    max_tokens: request.maxOutputTokens,
    stream: request.streaming,
    // Omitted rather than defaulted when unset: sending 0.0 makes a model
    // deterministic, which is a different request than "use your default".
    ...(request.temperature === null ? {} : { temperature: request.temperature }),
  }
}

/** The URL a profile's endpoint resolves to, tolerant of both conventions. */
export function chatCompletionsUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '')
  // A user may paste either `https://host/v1` or `https://host/v1/chat/completions`.
  if (/\/chat\/completions$/.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

/** Extract the delta text from one streamed chunk, or null when there is none. */
export function chunkText(payload: unknown): string | null {
  const chunk = payload as ChatCompletionChunk
  const content = chunk?.choices?.[0]?.delta?.content
  return typeof content === 'string' && content.length > 0 ? content : null
}

/** Extract the whole message from a non-streamed response. */
export function fullText(payload: unknown): string | null {
  const chunk = payload as ChatCompletionChunk
  const content = chunk?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : null
}

/**
 * Split one SSE line into its data payload, or null for anything else.
 *
 * Providers send `data: {...}`, blank lines, comments starting with `:` and
 * keep-alives. Only the data lines matter, and `[DONE]` is a terminator rather than
 * content.
 */
export function parseSseLine(
  line: string,
): { kind: 'data'; json: string } | { kind: 'done' } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (trimmed.startsWith(':')) return null
  if (!trimmed.startsWith('data:')) return null
  const body = trimmed.slice('data:'.length).trim()
  if (!body) return null
  if (body === '[DONE]') return { kind: 'done' }
  return { kind: 'data', json: body }
}

export class OpenAiCompatibleDriver implements ModelDriver {
  readonly provider = 'openai-compatible'

  /**
   * A cheap reachability check.
   *
   * Sends a fixed one-token prompt and **no terminal context** — a connection test
   * must not move the user's text anywhere.
   */
  async test(
    request: DriverRequest,
    cancel: CancelSignal,
  ): Promise<{ ok: true } | { ok: false; failure: AiFailure }> {
    const result = await this.send(
      request,
      cancel,
      [{ role: 'user', content: 'ping' }],
      1,
      false,
    )
    return result.ok ? { ok: true } : { ok: false, failure: result.failure }
  }

  async *stream(request: DriverRequest, cancel: CancelSignal): AsyncIterable<DriverEvent> {
    const result = await this.send(
      request,
      cancel,
      request.messages,
      request.maxOutputTokens,
      request.streaming,
    )
    if (!result.ok) {
      yield { type: 'failed', failure: result.failure }
      return
    }
    if (!result.stream) {
      // The provider answered in one piece even though streaming was requested.
      yield { type: 'chunk', text: result.text }
      yield { type: 'done' }
      return
    }

    const reader = result.stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let sawAnything = false
    try {
      while (true) {
        if (cancel.cancelled) {
          yield {
            type: 'failed',
            failure: { kind: 'cancelled', message: messageForStatus('cancelled') },
          }
          return
        }
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          const parsed = parseSseLine(line)
          if (parsed?.kind === 'done') {
            yield { type: 'done' }
            return
          }
          if (parsed?.kind === 'data') {
            try {
              const text = chunkText(JSON.parse(parsed.json))
              if (text) {
                sawAnything = true
                yield { type: 'chunk', text }
              }
            } catch {
              // One unparseable line mid-stream is not a reason to discard the answer
              // already received. Skipping keeps a keep-alive or a malformed delta
              // from failing the whole run.
            }
          }
          newline = buffer.indexOf('\n')
        }
      }
      if (!sawAnything) {
        yield {
          type: 'failed',
          failure: { kind: 'bad-response', message: messageForStatus('bad-response') },
        }
        return
      }
      yield { type: 'done' }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * One POST, with cancellation and a timeout.
   *
   * `AbortController` rather than racing promises: an abandoned `fetch` must actually
   * be aborted, or the connection stays open.
   */
  private async send(
    request: DriverRequest,
    cancel: CancelSignal,
    messages: ChatMessage[],
    maxOutputTokens: number,
    streaming: boolean,
  ): Promise<
    | { ok: true; text: string; stream: ReadableStream<Uint8Array> | null }
    | { ok: false; failure: AiFailure }
  > {
    const controller = new AbortController()
    void cancel.whenCancelled().then(() => controller.abort())
    const timer = setTimeout(() => controller.abort(), request.timeoutMs)

    try {
      const response = await fetch(chatCompletionsUrl(request.endpoint), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(request.apiKey ? { authorization: `Bearer ${request.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: request.modelId,
          messages,
          max_tokens: maxOutputTokens,
          stream: streaming,
          ...(request.temperature === null ? {} : { temperature: request.temperature }),
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
        // The body is read only to drain the connection, never surfaced.
        await response.text().catch(() => undefined)
        return { ok: false, failure: failureForStatus(response.status, retryAfter) }
      }

      if (streaming && response.body) {
        return { ok: true, text: '', stream: response.body }
      }
      const payload = await response.json().catch(() => null)
      const text = fullText(payload)
      if (text === null) {
        return {
          ok: false,
          failure: { kind: 'bad-response', message: messageForStatus('bad-response') },
        }
      }
      return { ok: true, text, stream: null }
    } catch (error) {
      if (cancel.cancelled) {
        return {
          ok: false,
          failure: { kind: 'cancelled', message: messageForStatus('cancelled') },
        }
      }
      const aborted = (error as { name?: string })?.name === 'AbortError'
      return {
        ok: false,
        failure: aborted
          ? { kind: 'timeout', message: messageForStatus('timeout') }
          : { kind: 'offline', message: messageForStatus('offline') },
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

export { buildRequestBody as buildDriverBody }
