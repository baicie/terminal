const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,48}$/
const MAX_BUFFER_BYTES = 128 * 1024

export type TerminalInputProbeEvent =
  | { kind: 'ready' }
  | { kind: 'result'; hex: string }

export function encodeTerminalInputProbeText(value: string): string {
  return Array.from(new TextEncoder().encode(value), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export function terminalInputProbeMarkers(nonce: string): {
  ready: string
  result: string
  end: string
} {
  validateNonce(nonce)
  const base = `__TERMINAL_INPUT_PROBE_${nonce}_`
  return {
    ready: `${base}READY__`,
    result: `${base}RESULT__`,
    end: '__END__',
  }
}

/**
 * The command constructs markers from shell variables so the line-echoed
 * command cannot be mistaken for a result before `stty -echo` takes effect.
 */
export function createTerminalInputProbeCommand(nonce: string): string {
  validateNonce(nonce)
  return [
    "__tip_a='__TERMINAL_INPUT_';",
    "__tip_b='PROBE_';",
    `__tip_n='${nonce}';`,
    "trap 'stty echo; trap - EXIT INT TERM' EXIT INT TERM;",
    'stty -echo;',
    "printf '\\r\\n%s%s%s_READY__\\r\\n' \"$__tip_a\" \"$__tip_b\" \"$__tip_n\";",
    'IFS= read -r __tip_v;',
    "printf '\\r\\n%s%s%s_RESULT__' \"$__tip_a\" \"$__tip_b\" \"$__tip_n\";",
    "printf '%s' \"$__tip_v\" | od -An -tx1 | tr -d ' \\n';",
    "printf '__END__\\r\\n';",
    'stty echo;',
    'trap - EXIT INT TERM;',
    'unset __tip_a __tip_b __tip_n __tip_v',
  ].join(' ')
}

export class TerminalInputProbeParser {
  private buffer = ''
  private waitingForReady = true

  constructor(private readonly nonce: string) {
    validateNonce(nonce)
  }

  push(chunk: string): TerminalInputProbeEvent[] {
    if (!chunk) return []
    this.buffer += chunk
    if (new TextEncoder().encode(this.buffer).byteLength > MAX_BUFFER_BYTES) {
      throw new Error('Terminal input probe output exceeded its safety limit')
    }

    const markers = terminalInputProbeMarkers(this.nonce)
    const events: TerminalInputProbeEvent[] = []
    while (true) {
      if (this.waitingForReady) {
        const readyIndex = this.buffer.indexOf(markers.ready)
        if (readyIndex < 0) {
          this.retainMarkerSuffix(markers.ready)
          return events
        }
        this.buffer = this.buffer.slice(readyIndex + markers.ready.length)
        this.waitingForReady = false
        events.push({ kind: 'ready' })
        continue
      }

      const resultIndex = this.buffer.indexOf(markers.result)
      if (resultIndex < 0) {
        this.retainMarkerSuffix(markers.result)
        return events
      }
      const valueStart = resultIndex + markers.result.length
      const endIndex = this.buffer.indexOf(markers.end, valueStart)
      if (endIndex < 0) {
        this.buffer = this.buffer.slice(resultIndex)
        return events
      }

      const hex = this.buffer.slice(valueStart, endIndex).toLowerCase()
      if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) {
        throw new Error('Terminal input probe returned invalid hexadecimal data')
      }
      this.buffer = this.buffer.slice(endIndex + markers.end.length)
      this.waitingForReady = true
      events.push({ kind: 'result', hex })
    }
  }

  private retainMarkerSuffix(marker: string): void {
    const maxSuffix = Math.min(marker.length - 1, this.buffer.length)
    for (let length = maxSuffix; length > 0; length -= 1) {
      if (this.buffer.endsWith(marker.slice(0, length))) {
        this.buffer = this.buffer.slice(-length)
        return
      }
    }
    this.buffer = ''
  }
}

function validateNonce(nonce: string): void {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error('Invalid terminal input probe nonce')
  }
}
