// Pasting must not let a copied block of text execute its last line unasked, and
// must not alter what the user copied.

import { describe, expect, it } from 'vitest'
import {
  PASTE_CONFIRM_BYTES,
  assessPaste,
  pastePreview,
} from './paste-policy'

describe('assessPaste', () => {
  it('lets a single line through without asking', () => {
    const decision = assessPaste('ls -la /var/log')
    expect(decision.allowed).toBe(true)
    expect(decision.risks).toEqual([])
    expect(decision.lineCount).toBe(1)
  })

  it('lets a single line with trailing spaces through', () => {
    expect(assessPaste('  echo hi  ').allowed).toBe(true)
  })

  it('asks before a multi-line paste: the last line would execute', () => {
    const decision = assessPaste('cd /tmp\nls\nrm -rf ./build')
    expect(decision.allowed).toBe(false)
    expect(decision.risks).toContain('multiline')
    expect(decision.lineCount).toBe(3)
  })

  it('treats a trailing newline as a second line (it sends Return)', () => {
    const decision = assessPaste('git status\n')
    expect(decision.allowed).toBe(false)
    expect(decision.risks).toContain('multiline')
  })

  it('asks before text carrying a carriage return', () => {
    expect(assessPaste('echo a\recho b').risks).toContain('control')
  })

  it('asks before text carrying ESC (hidden key sequences)', () => {
    expect(assessPaste('\u001b[200~evil').risks).toContain('control')
  })

  it('asks before text carrying Ctrl-C / Ctrl-D / Ctrl-Z', () => {
    expect(assessPaste('partial\u0003').risks).toContain('control')
    expect(assessPaste('partial\u0004').risks).toContain('control')
    expect(assessPaste('partial\u001a').risks).toContain('control')
  })

  it('asks before a very large paste', () => {
    const decision = assessPaste('x'.repeat(PASTE_CONFIRM_BYTES + 1))
    expect(decision.allowed).toBe(false)
    expect(decision.risks).toContain('large')
    expect(decision.byteLength).toBeGreaterThan(PASTE_CONFIRM_BYTES)
  })

  it('does not flag a large paste of exactly the threshold', () => {
    expect(assessPaste('x'.repeat(PASTE_CONFIRM_BYTES)).risks).not.toContain(
      'large',
    )
  })

  it('counts bytes, not code units, for multi-byte text', () => {
    const text = '中'.repeat(3000)
    expect(assessPaste(text).byteLength).toBe(9000)
    expect(assessPaste(text).risks).toContain('large')
  })

  it('handles empty text without claiming it is pasteable', () => {
    const decision = assessPaste('')
    expect(decision.lineCount).toBe(0)
    expect(decision.byteLength).toBe(0)
  })

  it('never modifies the text it classifies', () => {
    const original = 'a\r\nb\u0003c\n'
    assessPaste(original)
    expect(original).toBe('a\r\nb\u0003c\n')
  })
})

describe('pastePreview', () => {
  it('returns every line for a short paste', () => {
    const preview = pastePreview('one\ntwo\nthree')
    expect(preview.head).toEqual(['one', 'two', 'three'])
    expect(preview.tail).toEqual([])
    expect(preview.omitted).toBe(0)
  })

  it('keeps the tail, which is the part that executes', () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line-${index}`)
    const preview = pastePreview(lines.join('\n'), 10)
    expect(preview.head.length + preview.tail.length).toBe(10)
    // The final line of the paste is always visible.
    expect(preview.tail[preview.tail.length - 1]).toBe('line-99')
    expect(preview.omitted).toBe(90)
  })
})
