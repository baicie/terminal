import type { TerminalOutputReceipt } from './terminal-session-manager-types'

const encoder = new TextEncoder()

export interface PendingTerminalOutput {
  data: string
  bytes: number
  receipt?: TerminalOutputReceipt
  completesReceipt: boolean
}

export function terminalOutputByteLength(data: string): number {
  return encoder.encode(data).byteLength
}

function utf8BytesForCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

export function splitTerminalOutput(
  output: PendingTerminalOutput,
  maxBytes: number,
): [PendingTerminalOutput, PendingTerminalOutput | null] {
  if (output.bytes <= maxBytes) return [output, null]

  let index = 0
  let bytes = 0
  while (index < output.data.length) {
    const codePoint = output.data.codePointAt(index) ?? 0
    const codeUnits = codePoint > 0xffff ? 2 : 1
    const characterBytes = utf8BytesForCodePoint(codePoint)
    if (bytes > 0 && bytes + characterBytes > maxBytes) break
    index += codeUnits
    bytes += characterBytes
    if (bytes >= maxBytes) break
  }

  if (index >= output.data.length) return [output, null]

  return [
    {
      data: output.data.slice(0, index),
      bytes,
      receipt: output.receipt,
      completesReceipt: false,
    },
    {
      data: output.data.slice(index),
      bytes: output.bytes - bytes,
      receipt: output.receipt,
      completesReceipt: output.completesReceipt,
    },
  ]
}
