interface TerminalBufferLine {
  readonly isWrapped: boolean
  readonly length: number
  translateToString(trimRight: boolean, startColumn: number, endColumn: number): string
}

interface TerminalBufferReader {
  readonly cols: number
  readonly buffer: {
    readonly active: {
      readonly length: number
      getLine(index: number): TerminalBufferLine | undefined
    }
  }
}

export interface ParsedTerminalBuffer extends TerminalBufferReader {
  onWriteParsed(listener: () => void): { dispose(): void }
}

export function readLogicalTail(
  term: TerminalBufferReader,
  maxPhysicalLines = 256,
): string[] {
  const buffer = term.buffer.active
  const start = Math.max(0, buffer.length - maxPhysicalLines)
  const logicalLines: string[] = []
  for (let index = start; index < buffer.length; index += 1) {
    const line = buffer.getLine(index)
    if (!line) continue
    const text = line.translateToString(true, 0, line.length)
    if (line.isWrapped && logicalLines.length > 0) {
      logicalLines[logicalLines.length - 1] += text
    } else {
      logicalLines.push(text)
    }
  }
  return logicalLines
}

export function hasExactLogicalLine(
  term: TerminalBufferReader,
  expected: string,
): boolean {
  return readLogicalTail(term).some(line => line === expected)
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Terminal smoke aborted')
}

export function waitForExactLogicalLine(
  term: ParsedTerminalBuffer,
  expected: string,
  options: { signal: AbortSignal; timeoutMs?: number },
): Promise<void> {
  if (hasExactLogicalLine(term, expected)) return Promise.resolve()
  if (options.signal.aborted) return Promise.reject(abortError(options.signal))

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const disposable = term.onWriteParsed(check)

    function finish(error?: Error) {
      if (settled) return
      settled = true
      disposable.dispose()
      options.signal.removeEventListener('abort', onAbort)
      if (timer !== undefined) clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }

    function check() {
      if (hasExactLogicalLine(term, expected)) finish()
    }

    function onAbort() {
      finish(abortError(options.signal))
    }

    options.signal.addEventListener('abort', onAbort, { once: true })
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(
        () => finish(new Error(`Timed out waiting for terminal marker: ${expected}`)),
        options.timeoutMs,
      )
    }
    check()
  })
}
