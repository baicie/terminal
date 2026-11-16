/**
 * What gets sent to a model, and the proof that the user chose it.
 *
 * ## The rule this module enforces
 *
 * The design is unambiguous: a model may only see text the user **explicitly selected
 * and confirmed**. Never the scrollback, the clipboard, command history, environment
 * variables, private keys, vault entries or remote files. That is not a UI preference
 * — it is the difference between "an assistant" and "a process that exfiltrates
 * whatever it can reach".
 *
 * So the context is a value built here, and the request carries its digest. The
 * digest is what makes "the user approved this" checkable at the moment of sending:
 * if the text changed after approval, the digests differ and the send is refused.
 *
 * ## Why redaction is an edit list and not a regex pass
 *
 * The user sees a preview and may delete or replace parts of it. Recording those as
 * `{start, end, replacement}` edits means the preview the user approved is
 * reconstructible from the text plus the edits — so "what they saw" and "what is
 * about to be sent" cannot drift apart. A regex pass that rewrote the text silently
 * would leave the preview describing something else.
 */

import { createHashOf } from './content-hash'

/** What the user pointed at. */
export const CONTEXT_KINDS = ['selection', 'error', 'output'] as const

export type ContextKind = (typeof CONTEXT_KINDS)[number]

/** A single user-driven change to the selected text. */
export interface RedactionEdit {
  start: number
  end: number
  replacement: string
}

/** An approved context, ready to send. */
export interface ApprovedContext {
  kind: ContextKind
  hostId: string | null
  sessionId: string | null
  /** Bytes of `text` after redaction, in UTF-8. */
  bytes: number
  /** SHA-256 of `text` after redaction. Recomputed on every change. */
  contentSha256: string
  /** What the preview shows — the same string the digest covers. */
  preview: string
  /** The text that will actually be sent. */
  text: string
  approved: boolean
  redactionEdits: RedactionEdit[]
}

/**
 * The hard ceiling on context size.
 *
 * A model request is not a way to move a scrollback out of the machine. 64 KiB is far
 * more than any explanation needs and far less than a real scrollback.
 */
export const MAX_CONTEXT_BYTES = 64 * 1024

export type ContextProblem =
  | { reason: 'empty' }
  | { reason: 'too-large'; bytes: number; limit: number }
  | { reason: 'invalid-edit'; detail: string }

/** Apply redaction edits, rejecting overlaps and out-of-range spans. */
export function applyRedactions(
  text: string,
  edits: readonly RedactionEdit[],
): { ok: true; text: string } | { ok: false; detail: string } {
  if (edits.length === 0) return { ok: true, text }
  // Sort a copy: the caller's array is theirs, and editing it would make the
  // preview and the digest disagree depending on call order.
  const sorted = [...edits].sort((a, b) => a.start - b.start)
  let result = ''
  let cursor = 0
  for (const edit of sorted) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
      return { ok: false, detail: 'an edit has non-integer offsets' }
    }
    if (edit.start < 0 || edit.end > text.length || edit.start > edit.end) {
      return { ok: false, detail: 'an edit is out of range' }
    }
    if (edit.start < cursor) {
      return { ok: false, detail: 'two edits overlap' }
    }
    result += text.slice(cursor, edit.start)
    result += edit.replacement
    cursor = edit.end
  }
  result += text.slice(cursor)
  return { ok: true, text: result }
}

/** UTF-8 byte length, without allocating a copy of a large string when avoidable. */
export function utf8Bytes(text: string): number {
  // TextEncoder is exact and available everywhere this runs.
  return new TextEncoder().encode(text).byteLength
}

/**
 * Build the context a request would carry.
 *
 * Returns the problem rather than throwing, because "the selection is too large" is
 * something the UI must show with a byte count, not an error the user has to
 * interpret.
 */
export function buildContext(input: {
  kind: ContextKind
  hostId: string | null
  sessionId: string | null
  text: string
  redactionEdits?: readonly RedactionEdit[]
  approved?: boolean
}): { ok: true; context: ApprovedContext } | { ok: false; problem: ContextProblem } {
  const redacted = applyRedactions(input.text, input.redactionEdits ?? [])
  if (!redacted.ok) {
    return { ok: false, problem: { reason: 'invalid-edit', detail: redacted.detail } }
  }
  const text = redacted.text
  if (text.length === 0) {
    return { ok: false, problem: { reason: 'empty' } }
  }
  const bytes = utf8Bytes(text)
  if (bytes > MAX_CONTEXT_BYTES) {
    return {
      ok: false,
      problem: { reason: 'too-large', bytes, limit: MAX_CONTEXT_BYTES },
    }
  }
  return {
    ok: true,
    context: {
      kind: input.kind,
      hostId: input.hostId,
      sessionId: input.sessionId,
      bytes,
      contentSha256: createHashOf(text),
      preview: text,
      text,
      approved: input.approved ?? false,
      redactionEdits: [...(input.redactionEdits ?? [])],
    },
  }
}

/**
 * Has the context changed since it was approved?
 *
 * Checked immediately before a request is dispatched. An approval that survives a
 * text change is not an approval of what is actually sent.
 */
export function contextStillApproved(context: ApprovedContext): boolean {
  if (!context.approved) return false
  return createHashOf(context.text) === context.contentSha256
}

/**
 * Is this context bound to the session the user is looking at?
 *
 * The design's "old response must not land in a new Session" rule, applied on the
 * send side: a context captured on one host and approved on another is refused.
 */
export function contextMatchesSession(
  context: ApprovedContext,
  visibleSessionId: string | null,
): boolean {
  if (context.sessionId === null) return true
  return context.sessionId === visibleSessionId
}
