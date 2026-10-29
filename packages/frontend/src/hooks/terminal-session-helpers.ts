export { startTerminalShell } from '@/features/terminal/services/terminal-launcher'

export function formatIpcError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.length > 0) {
      return record.message
    }
    const kind = record.type ?? record.kind
    if (typeof kind === 'string' && kind.length > 0) return kind
    try {
      return JSON.stringify(record)
    } catch {
      return 'Unknown IPC error'
    }
  }
  return String(error)
}

export function sanitizeTerminalOutput(data: string): string {
  return (
    data
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m%\x1b\[[0-9;]*m+\r?\n/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m%\r?\n/g, '')
      .replace(/^%\r?\n/gm, '')
  )
}
