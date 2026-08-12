import type { Terminal as XTerminal } from '@baicie/xterm'

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

export function setupWebKitInputCompensation(
  term: XTerminal,
  send: (data: string) => void,
): () => void {
  if (typeof navigator === 'undefined') return () => {}
  const userAgent = navigator.userAgent
  const isWebKit =
    /AppleWebKit/i.test(userAgent) && !/Chrome|Chromium|Edg/i.test(userAgent)
  if (!isWebKit) return () => {}

  const root = term.element as HTMLElement | undefined
  const textarea = root?.querySelector('textarea') as HTMLTextAreaElement | null
  if (!textarea) return () => {}

  let recentSent = ''
  const recordSent = (data: string) => {
    recentSent = (recentSent + data).slice(-32)
  }
  const onDataDisposable = term.onData(recordSent)
  const onInput = (event: Event) => {
    const inputData = (event as InputEvent).data
    if (!inputData) return
    requestAnimationFrame(() => {
      if (recentSent.endsWith(inputData)) return
      send(inputData)
      recordSent(inputData)
    })
  }
  textarea.addEventListener('input', onInput)
  return () => {
    textarea.removeEventListener('input', onInput)
    onDataDisposable.dispose()
  }
}
