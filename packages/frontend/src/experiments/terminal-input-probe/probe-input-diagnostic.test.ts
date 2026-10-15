import { describe, expect, it } from 'vitest'
import { formatInputProbeDiagnostic } from './probe-input-diagnostic'

describe('formatInputProbeDiagnostic', () => {
  it('records UTF-8 text bytes exactly', () => {
    expect(
      formatInputProbeDiagnostic({ kind: 'text', data: 'asd\r', bytes: 4 }),
    ).toBe('input kind=text bytes=4 hex=6173640d')
  })

  it('records raw non-UTF-8 bytes without rewriting them', () => {
    expect(
      formatInputProbeDiagnostic({
        kind: 'raw',
        data: Uint8Array.from([0x00, 0x80, 0xff]),
        bytes: 3,
      }),
    ).toBe('input kind=raw bytes=3 hex=0080ff')
  })

  it('records whether a text event is still composing', () => {
    expect(
      formatInputProbeDiagnostic({
        kind: 'text',
        data: '中',
        bytes: 3,
        isComposing: true,
      }),
    ).toBe('input kind=text bytes=3 composing=true hex=e4b8ad')
  })
})
