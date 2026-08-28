import type { Terminal } from '@baicie/xterm'
import { readLogicalTail } from './terminal-smoke-buffer'

export function collectTerminalSmokeDiagnostics(
  term: Terminal,
  getInputDiagnostics: () => unknown,
  getOutputDiagnostics: () => unknown,
  getRawOutputTail?: () => string,
): string {
  const tail = readLogicalTail(term, 32)
    .slice(-8)
    .map(line => line.slice(0, 160))
  return JSON.stringify({
    input: getInputDiagnostics(),
    output: getOutputDiagnostics(),
    rawOutputTail: getRawOutputTail?.(),
    tail,
  })
}
