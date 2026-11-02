import type { Terminal } from '@baicie/xterm'
import { readLogicalTail } from './terminal-smoke-buffer'

const TAIL_LINE_LIMIT = 8
const TAIL_LINE_LENGTH = 160

/**
 * A cleared xterm viewport keeps its rows as blank lines, so the bottom of the
 * buffer is empty even when the screen shows output. Report the most recent
 * non-empty lines and the buffer geometry, otherwise "empty tail" and "empty
 * terminal" are indistinguishable.
 */
export function collectTerminalSmokeDiagnostics(
  term: Terminal,
  getInputDiagnostics: () => unknown,
  getOutputDiagnostics: () => unknown,
  getRawOutputTail?: () => string,
): string {
  const active = term.buffer.active
  const tail = readLogicalTail(term)
    .filter(line => line.trim().length > 0)
    .slice(-TAIL_LINE_LIMIT)
    .map(line => line.slice(0, TAIL_LINE_LENGTH))
  return JSON.stringify({
    input: getInputDiagnostics(),
    output: getOutputDiagnostics(),
    rawOutputTail: getRawOutputTail?.(),
    tail,
    bufferLength: active.length,
    cursorY: active.cursorY,
    viewportY: active.viewportY,
    baseY: active.baseY,
  })
}
