// What may be sent to a model, and the proof the user chose it.

import { describe, expect, it } from 'vitest'
import {
  MAX_CONTEXT_BYTES,
  applyRedactions,
  buildContext,
  contextMatchesSession,
  contextStillApproved,
  utf8Bytes,
} from './context-review'

describe('building a context', () => {
  it('records the digest of the text it will send', () => {
    const built = buildContext({
      kind: 'selection', hostId: 'h-1', sessionId: 'tab-1', text: 'kubectl get pods',
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.context.text).toBe('kubectl get pods')
    expect(built.context.preview).toBe(built.context.text)
    expect(built.context.contentSha256).toHaveLength(32)
    expect(built.context.bytes).toBe(16)
  })

  it('refuses an empty selection instead of sending nothing', () => {
    expect(
      buildContext({ kind: 'selection', hostId: null, sessionId: null, text: '' }),
    ).toMatchObject({ ok: false, problem: { reason: 'empty' } })
  })

  it('refuses a context over the ceiling, with the byte count', () => {
    const huge = 'x'.repeat(MAX_CONTEXT_BYTES + 1)
    const built = buildContext({ kind: 'output', hostId: null, sessionId: null, text: huge })
    expect(built).toMatchObject({ ok: false, problem: { reason: 'too-large' } })
    if (built.ok) return
    expect(built.problem.reason === 'too-large' && built.problem.bytes).toBe(MAX_CONTEXT_BYTES + 1)
  })

  it('counts bytes, not characters', () => {
    const text = '汉'.repeat(30_000)
    expect(utf8Bytes(text)).toBe(90_000)
    expect(
      buildContext({ kind: 'output', hostId: null, sessionId: null, text }),
    ).toMatchObject({ ok: false, problem: { reason: 'too-large' } })
  })

  it('accepts a context exactly at the ceiling', () => {
    expect(buildContext({ kind: 'output', hostId: null, sessionId: null, text: 'x'.repeat(MAX_CONTEXT_BYTES) }).ok).toBe(true)
  })

  it('is unapproved unless the caller says otherwise', () => {
    const built = buildContext({ kind: 'selection', hostId: null, sessionId: null, text: 'ls' })
    expect(built.ok && built.context.approved).toBe(false)
    expect(contextStillApproved(built.ok ? built.context : ({} as never))).toBe(false)
  })
})

describe('redaction edits', () => {
  it('applies non-overlapping edits in order', () => {
    const result = applyRedactions('password=hunter2 token=abc123', [
      { start: 9, end: 16, replacement: '***' },
      { start: 23, end: 29, replacement: '***' },
    ])
    expect(result).toEqual({ ok: true, text: 'password=*** token=***' })
  })

  it('rejects overlapping edits', () => {
    expect(
      applyRedactions('abcdef', [
        { start: 0, end: 3, replacement: 'x' },
        { start: 2, end: 5, replacement: 'y' },
      ]),
    ).toMatchObject({ ok: false })
  })

  it('rejects an out-of-range or inverted edit', () => {
    expect(applyRedactions('abc', [{ start: 0, end: 99, replacement: '' }])).toMatchObject({ ok: false })
    expect(applyRedactions('abc', [{ start: 2, end: 1, replacement: '' }])).toMatchObject({ ok: false })
    expect(applyRedactions('abc', [{ start: -1, end: 1, replacement: '' }])).toMatchObject({ ok: false })
  })

  it('does not mutate the caller array', () => {
    const edits = [
      { start: 4, end: 6, replacement: 'X' },
      { start: 0, end: 2, replacement: 'Y' },
    ]
    const copy = [...edits]
    applyRedactions('abcdefgh', edits)
    expect(edits).toEqual(copy)
  })

  it('the digest covers the redacted text, not the original', () => {
    const built = buildContext({
      kind: 'output', hostId: null, sessionId: null, text: 'token=secret',
      redactionEdits: [{ start: 6, end: 12, replacement: '***' }],
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.context.text).toBe('token=***')
    expect(built.context.preview).toBe('token=***')
  })

  it('can redact down to an empty context, which is then refused', () => {
    expect(
      buildContext({
        kind: 'output', hostId: null, sessionId: null, text: 'secret',
        redactionEdits: [{ start: 0, end: 6, replacement: '' }],
      }),
    ).toMatchObject({ ok: false, problem: { reason: 'empty' } })
  })
})

describe('approval is checked at send time', () => {
  it('an unchanged approved context passes', () => {
    const built = buildContext({
      kind: 'selection', hostId: 'h-1', sessionId: 'tab-1', text: 'ls -la', approved: true,
    })
    expect(built.ok && contextStillApproved(built.context)).toBe(true)
  })

  it('a context whose text changed after approval fails', () => {
    const built = buildContext({
      kind: 'selection', hostId: 'h-1', sessionId: 'tab-1', text: 'ls -la', approved: true,
    })
    if (!built.ok) return
    expect(contextStillApproved({ ...built.context, text: 'rm -rf /' })).toBe(false)
  })
})

describe('session binding', () => {
  it('matches the session it was captured on', () => {
    const built = buildContext({ kind: 'selection', hostId: 'h-1', sessionId: 'tab-1', text: 'ls' })
    if (!built.ok) return
    expect(contextMatchesSession(built.context, 'tab-1')).toBe(true)
    expect(contextMatchesSession(built.context, 'tab-2')).toBe(false)
  })

  it('a context with no session is not bound to one', () => {
    const built = buildContext({ kind: 'output', hostId: null, sessionId: null, text: 'ls' })
    if (!built.ok) return
    expect(contextMatchesSession(built.context, null)).toBe(true)
    expect(contextMatchesSession(built.context, 'tab-9')).toBe(true)
  })
})
