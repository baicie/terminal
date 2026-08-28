import { describe, expect, it } from 'vitest'
import {
  hasExactLogicalLine,
  readLogicalTail,
} from './terminal-smoke-buffer'

function terminalWithLines(
  lines: Array<{ text: string; isWrapped?: boolean; length?: number }>,
  cols = 80,
) {
  return {
    cols,
    buffer: {
      active: {
        length: lines.length,
        getLine(index: number) {
          const line = lines[index]
          if (!line) return undefined
          return {
            isWrapped: line.isWrapped ?? false,
            length: line.length ?? line.text.length,
            translateToString: (
              _trimRight: boolean,
              _start: number,
              end: number,
            ) => line.text.slice(0, end).trimEnd(),
          }
        },
      },
    },
  }
}

describe('readLogicalTail', () => {
  it('keeps hard line breaks as separate logical lines', () => {
    const term = terminalWithLines([{ text: 'one' }, { text: 'two' }])

    expect(readLogicalTail(term)).toEqual(['one', 'two'])
  })

  it('joins soft-wrapped physical lines', () => {
    const term = terminalWithLines([
      { text: 'LOAD_END_' },
      { text: 'a1b2c3d4', isWrapped: true },
    ])

    expect(readLogicalTail(term)).toEqual(['LOAD_END_a1b2c3d4'])
  })

  it('handles a retained tail that begins with a wrapped line', () => {
    const term = terminalWithLines([{ text: 'orphan', isWrapped: true }])

    expect(readLogicalTail(term)).toEqual(['orphan'])
  })

  it('reads the full stored line after the terminal is resized', () => {
    const term = terminalWithLines(
      [{ text: 'RESIZED_SIZE_a1b2c3d4 31 97', length: 30 }],
      10,
    )

    expect(readLogicalTail(term)).toEqual(['RESIZED_SIZE_a1b2c3d4 31 97'])
  })
})

describe('hasExactLogicalLine', () => {
  it('rejects a command echo that only contains the marker as a substring', () => {
    const term = terminalWithLines([
      { text: "printf '%s%s' 'LOAD_END_' 'a1b2c3d4'" },
      { text: 'prompt LOAD_END_a1b2c3d4 suffix' },
    ])

    expect(hasExactLogicalLine(term, 'LOAD_END_a1b2c3d4')).toBe(false)
  })
})
