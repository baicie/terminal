export interface TerminalInputProbeDiagnosticEvent {
  kind: 'text' | 'raw'
  data: string | Uint8Array
  bytes: number
  isComposing?: boolean
}

export function formatInputProbeDiagnostic(
  event: TerminalInputProbeDiagnosticEvent,
): string {
  const bytes =
    typeof event.data === 'string'
      ? new TextEncoder().encode(event.data)
      : event.data
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  const composing =
    event.isComposing === undefined ? '' : ` composing=${event.isComposing}`
  return `input kind=${event.kind} bytes=${event.bytes}${composing} hex=${hex}`
}
